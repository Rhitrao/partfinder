// POST /parts/api/suppliers: the only path that reaches Google.
//
// Splitting the search off the page render is what lets the supplier list be public. A crawler, a
// bot or a WhatsApp link preview renders /parts/ and stops there; only a browser that ran the
// page's script and passed Cloudflare Turnstile gets this far, and only then does anything reach
// Places. The demo key's daily limit is still the backstop behind that, and the link-outs on the
// page are the fallback behind the limit.
//
// Nothing here is logged: not the token, not q, not the city, not a place id, not a phone number.
// GOOGLE_PLACES_KEY and TURNSTILE_SECRET_KEY never reach the response, in the body or a header.

import type { Env } from "../env";
import {
  MAX_QUERY_LENGTH,
  outbound,
  partKey,
  readQuery,
  requirementMessage,
  resolveCountry,
  whatsappUrl,
  type ParsedQuery,
} from "../page";
import type { ParseResult } from "../parse";
import { MAX_LISTED, findSuppliers, groupByOem, type Supplier } from "./search";
import { phoneFor } from "./phone";
import { pinsFor, renderSupplierCards, type Pin } from "./suppliers";
import { verifyTurnstile } from "./turnstile";

/** The one origin whose pages may spend a token. A missing or foreign Origin is refused. */
export const ALLOWED_ORIGIN = "https://rohitrao.in";

/**
 * A JSON body bigger than this was not written by our page. The fields inside are capped at
 * MAX_QUERY_LENGTH each, so this only has to be roomy enough for all of them plus a token.
 */
const MAX_BODY_BYTES = 32_000;

/** Quantity fields, as the page names them: one per part key. */
const MAX_QUANTITIES = 64;

/** What the page's script sends. Nothing here is trusted; every field is re-read and re-checked. */
interface SupplierRequest {
  token: string;
  q: string;
  city: string;
  country: string;
  near: string;
  note: string;
  quantities: Record<string, number>;
}

/** A shop's pin, plus the one for the user's own location when they shared one. */
export type ApiPin = Pin & { you?: boolean };

/** One row of the send queue: everything the script needs, and no message it has to write. */
export interface QueueRow {
  n: number;
  name: string;
  matchedParts: string[];
  waMatched: string;
  waAll: string;
  tel: string;
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The body, read the way the page reads its own query string: same caps, same validation, same
 * rounding. Null means it was not something our page would have sent.
 */
function readBody(payload: unknown): SupplierRequest | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const raw = payload as Record<string, unknown>;
  const fields = {
    token: text(raw.token),
    q: text(raw.q),
    city: text(raw.city),
    country: text(raw.country),
    near: text(raw.near),
    note: text(raw.note),
  };
  for (const value of Object.values(fields)) {
    if (value.length > MAX_QUERY_LENGTH) return null;
  }
  const quantities: Record<string, number> = {};
  const qty = raw.qty;
  if (typeof qty === "object" && qty !== null && !Array.isArray(qty)) {
    let seen = 0;
    for (const [key, value] of Object.entries(qty as Record<string, unknown>)) {
      if (seen++ >= MAX_QUANTITIES) break;
      if (key.length > 64) continue;
      const amount = Number(value);
      if (Number.isInteger(amount) && amount >= 1 && amount <= 9999) quantities[key] = amount;
    }
  }
  return { ...fields, quantities };
}

/** The same three-decimal rounding the page applies, on the same grounds. */
export function readNear(raw: string): { lat: number; lng: number } | null {
  if (raw === "") return null;
  const parts = raw.split(",");
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return { lat: round(lat), lng: round(lng) };
}

/**
 * One queue row per listed shop, with both messages already written.
 *
 * The script never composes a message. It is handed the exact wa.me URL for the parts this shop
 * was listed for and the one for every part on the page, and it chooses between them.
 */
function queueRow(
  supplier: Supplier,
  index: number,
  sending: readonly ParseResult[],
  note: string,
  quantities: Record<string, number>,
): QueueRow {
  const phone = phoneFor(supplier.place);
  const matched = sending.filter((part) => supplier.matchedParts.includes(partKey(part)));
  const asking = matched.length > 0 ? matched : sending;
  const name = supplier.place.name === "" ? "Unnamed listing" : supplier.place.name;
  const wa = (parts: readonly ParseResult[]) =>
    phone.whatsapp === null
      ? ""
      : whatsappUrl(
          requirementMessage(parts, {
            name: supplier.place.name === "" ? "there" : supplier.place.name,
            note,
            quantities,
          }),
          phone.whatsapp,
        );
  return {
    n: index + 1,
    name,
    matchedParts: supplier.matchedParts,
    waMatched: wa(asking),
    waAll: wa(sending),
    tel: phone.tel ?? "",
  };
}

/**
 * The supplier search, from a browser that proved it is one.
 *
 * The order matters. Method, content type and origin are decided before the body is read; the
 * body is read and re-validated before the token is spent; the token is verified before Google is
 * called. A request that fails any of those costs nothing at Google.
 */
export async function handleSupplierApi(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return json(405, { error: "method" }, { Allow: "POST" });
  }
  const contentType = (request.headers.get("Content-Type") ?? "").split(";")[0]!.trim();
  if (contentType.toLowerCase() !== "application/json") {
    return json(415, { error: "type" });
  }
  // Our page is the only page allowed to spend a token. A browser always sends Origin on a
  // cross-origin POST, and sends it on a same-origin POST too, so a missing one is not ours.
  if (request.headers.get("Origin") !== ALLOWED_ORIGIN) {
    return json(403, { error: "origin" });
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return json(400, { error: "request" });
  }
  if (raw.length > MAX_BODY_BYTES) return json(400, { error: "request" });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(400, { error: "request" });
  }
  const body = readBody(payload);
  if (body === null) return json(400, { error: "request" });

  // The codes are Cloudflare's own and are generic by construction - see readCodes - so they go
  // back to the browser with the refusal. They are the difference between a 403 anyone can act
  // on and one nobody can. Nothing else from siteverify leaves here: not the token, not the
  // secret, not the body it came in.
  const verification = await verifyTurnstile(
    env.TURNSTILE_SECRET_KEY,
    body.token,
    request.headers.get("CF-Connecting-IP"),
  );
  if (!verification.ok) return json(403, { error: "verify", codes: verification.codes });

  // Everything from here is recomputed from q. The client's idea of which numbers it holds, and
  // which of them may leave the page, is never taken on trust.
  const country = resolveCountry(body.country);
  const parsed: ParsedQuery = readQuery(body.q, "");
  const sending = outbound(parsed.results);
  const { groups } = groupByOem(sending);
  const quantities = { ...parsed.quantities, ...body.quantities };
  const near = readNear(body.near);

  const answer = await findSuppliers(
    env.GOOGLE_PLACES_KEY,
    groups,
    country,
    body.city,
    near,
  );
  if (answer.failure === "city") return json(200, { error: "city" });
  if (answer.failure !== null) return json(200, { error: "unavailable" });

  const listed = answer.suppliers.slice(0, MAX_LISTED);
  const originLabel = answer.origin?.label ?? `${body.city.trim()} centre`;
  const html = renderSupplierCards({
    suppliers: listed,
    parts: sending,
    quantities,
    note: body.note,
    originLabel,
    omitted: answer.suppliers.length - listed.length,
  });

  const pins: ApiPin[] = pinsFor(listed);
  // The user's own pin is numbered 0: the list numbers shops from 1, and this is not one.
  if (near !== null) pins.push({ n: 0, name: "you", lat: near.lat, lng: near.lng, you: true });

  const queue = listed.map((supplier, index) =>
    queueRow(supplier, index, sending, body.note, quantities),
  );

  return json(200, { html, pins, queue });
}
