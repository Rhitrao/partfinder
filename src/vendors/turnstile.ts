// Cloudflare Turnstile: the one thing standing between a bot and the Google allowance.
//
// The supplier list is public now, so nothing identifies who is asking. What the endpoint checks
// instead is that a browser did the asking: the page renders a Turnstile widget, the widget mints
// a token, and the token is spent here, once, against Cloudflare's siteverify.
//
// Nothing about a token is stored or logged, and TURNSTILE_SECRET_KEY never leaves this file.

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** One verification has this long. It is in the request path, so it cannot be generous. */
export const VERIFY_TIMEOUT_MS = 5000;

/** Turnstile's own documented ceiling. Anything longer was not minted by the widget. */
const MAX_TOKEN_LENGTH = 2048;

/** Our own code, for the case Cloudflare has no code for: it never answered. */
export const UNREACHABLE = "siteverify-unreachable";

/** What is left when Cloudflare said no and gave nothing usable to say why. */
export const UNKNOWN = "unknown";

/** At most this many codes leave this file, and each at most this long. */
const MAX_CODES = 10;
const MAX_CODE_LENGTH = 64;

/**
 * A code shaped like Cloudflare's own: lowercase, digits and hyphens, and nothing else.
 *
 * Real Turnstile keys and tokens carry dots, underscores and capitals, so this alone stops
 * almost everything. It is not relied on as the guarantee, though - `secrets` below is.
 */
const CODE = /^[a-z0-9-]+$/;

/**
 * Cloudflare's error-codes array, reduced to what may be shown to the caller.
 *
 * Two filters, and they are not the same kind of thing. The shape check drops anything that does
 * not look like one of Cloudflare's codes, because a value that does not look like one is not
 * one, and guessing at it is how a response body grows something it should not have. `secrets`
 * is the guarantee: every value this request holds that must not leave is passed in, and any
 * code equal to one, or containing one, is dropped whatever it looks like. An argument about
 * character classes is not a guarantee - a secret could be lowercase - and this is the one
 * place in the Worker where a third party's bytes are copied into a response.
 */
export function readCodes(value: unknown, secrets: readonly string[] = []): string[] {
  if (!Array.isArray(value)) return [];
  const guarded = secrets.filter((secret) => secret !== "");
  const codes: string[] = [];
  for (const entry of value) {
    if (codes.length >= MAX_CODES) break;
    if (typeof entry !== "string") continue;
    if (entry.length > MAX_CODE_LENGTH) continue;
    if (!CODE.test(entry)) continue;
    if (guarded.some((secret) => entry.includes(secret))) continue;
    if (!codes.includes(entry)) codes.push(entry);
  }
  return codes;
}

/**
 * What Cloudflare said about a token, and why.
 *
 * `codes` is Cloudflare's own vocabulary - "timeout-or-duplicate",
 * "invalid-input-response", "invalid-input-secret" - which says nothing about the token or the
 * secret and everything about which of them was wrong. It is empty when `ok` is true.
 */
export interface Verification {
  ok: boolean;
  codes: string[];
}

const no = (...codes: string[]): Verification => ({ ok: false, codes });

/**
 * Whether Cloudflare says this token is good, and what it said when it does not.
 *
 * A missing secret is a false, not a pass: a Worker deployed without TURNSTILE_SECRET_KEY can
 * verify nothing, and "cannot verify" must never mean "verified".
 *
 * Until step 8c this returned a bare boolean and dropped Cloudflare's reason on the floor, which
 * left a production 403 with nothing behind it: the keys were all present and the same length as
 * when it last worked, and there was no way to tell a spent token from a wrong secret. The codes
 * are generic by construction - readCodes above is what keeps them that way - so they cost
 * nothing to return and are the whole of the answer.
 */
export async function verifyTurnstile(
  secret: string | undefined,
  token: string,
  remoteIp: string | null,
): Promise<Verification> {
  const key = (secret ?? "").trim();
  // Cloudflare's own names for these two, because they mean the same thing here as there and an
  // operator reading the response should not have to learn a second vocabulary.
  if (key === "") return no("missing-input-secret");
  if (token === "") return no("missing-input-response");
  if (token.length > MAX_TOKEN_LENGTH) return no("invalid-input-response");

  const form = new URLSearchParams({ secret: key, response: token });
  // Cloudflare sets CF-Connecting-IP itself, so this cannot be spoofed by a client header.
  if (remoteIp !== null && remoteIp !== "") form.set("remoteip", remoteIp);

  let response: Response;
  try {
    response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
  } catch {
    // A timeout or a dropped connection. Still not a pass, but now it says which kind of no.
    return no(UNREACHABLE);
  }
  // An HTTP error, a body that will not parse, and a body that is not an object are the same
  // thing from here: Cloudflare did not answer the question.
  if (!response.ok) return no(UNREACHABLE);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return no(UNREACHABLE);
  }
  if (typeof payload !== "object" || payload === null) return no(UNREACHABLE);
  const body = payload as { success?: unknown; "error-codes"?: unknown };
  if (body.success === true) return { ok: true, codes: [] };
  const codes = readCodes(body["error-codes"], [key, token]);
  return no(...(codes.length > 0 ? codes : [UNKNOWN]));
}
