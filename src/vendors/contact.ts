// The contact page: Place Details for the vendors the user picked, and one message per vendor.
//
// This is the only place that asks Google for a phone number or a website, and it asks only for
// the vendors the user ticked. Nothing here is stored or logged: not the place ids, not the phone
// numbers, not the message.

import {
  MAX_QUERY_LENGTH,
  emailSubject,
  escapeHtml,
  mailtoUrl,
  requirementMessage,
  textareaRows,
  whatsappUrl,
  type Country,
} from "../page";
import type { ParseResult } from "../parse";
import { PlacesError, placeDetails, type PlaceContact, type PlacesFailure } from "./places";
import { googleMapsBox, hidden, renderVendorDocument, vendorLink } from "./page";
import { MAX_PICKS, SCOPE_ALL, scopedParts } from "./search";

/** An Indian mobile: country code 91, then ten digits starting 6 to 9. */
const INDIA_MOBILE = /^91[6-9]\d{9}$/;

/** A plausible international number, so a mangled one never becomes a wa.me link. */
const DIALLABLE = /^\d{8,15}$/;

export interface Phone {
  /** What to print. Empty when Google lists no number at all. */
  display: string;
  /** The tel: target, or null when there is no number. */
  tel: string | null;
  /** Digits for wa.me, or null when this is not a number to open WhatsApp with. */
  whatsapp: string | null;
  /** The number has a country code but its shape does not prove it is a mobile. */
  caution: boolean;
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * What can be done with the number Google returned.
 *
 * An Indian number is only offered for WhatsApp when it has the shape of an Indian mobile, which
 * is a rule worth trusting: landlines there never start 6 to 9 after the code. No other country
 * has a shape this code can rely on, so a number with a country code is offered with a warning
 * rather than either withheld or claimed. A number with no country code cannot be dialled
 * internationally at all, so it gets tel: and nothing else.
 */
export function phoneFor(contact: PlaceContact): Phone {
  const international = contact.internationalPhone.trim();
  const national = contact.nationalPhone.trim();
  const display = international !== "" ? international : national;
  if (display === "") return { display: "", tel: null, whatsapp: null, caution: false };

  if (!international.startsWith("+")) {
    const local = national.replace(/[^\d+]/g, "");
    return { display, tel: local === "" ? null : local, whatsapp: null, caution: false };
  }
  const digits = digitsOf(international);
  const tel = `+${digits}`;
  if (!DIALLABLE.test(digits)) return { display, tel, whatsapp: null, caution: false };
  if (digits.startsWith("91")) {
    return INDIA_MOBILE.test(digits)
      ? { display, tel, whatsapp: digits, caution: false }
      : { display, tel, whatsapp: null, caution: false };
  }
  return { display, tel, whatsapp: digits, caution: true };
}

export const MAY_NOT_BE_WHATSAPP = "This number may not be on WhatsApp.";
export const NO_PHONE = "Google lists no phone number for this shop.";
export const DETAILS_FAILED = "Contact details didn't load for this shop.";

export function tooManyPicked(count: number): string {
  return `You picked ${count} shops. Contact details are shown for the first ${MAX_PICKS}.`;
}

/** One picked vendor: the id from the form, the scope from the form, and what Google returned. */
export interface PickedVendor {
  id: string;
  scope: string;
  contact: PlaceContact | null;
}

/**
 * Place Details for each picked vendor, at most MAX_PICKS of them.
 *
 * A quota error means today's limit is gone and the whole page falls back; every other failure is
 * per vendor, so one shop that will not load does not take the others' phone numbers with it.
 */
export async function fetchPicked(
  key: string | undefined,
  picks: readonly { id: string; scope: string }[],
  fetchDetails: (key: string, id: string) => Promise<PlaceContact> = placeDetails,
): Promise<{ vendors: PickedVendor[]; failure: PlacesFailure | null }> {
  const wanted = picks.slice(0, MAX_PICKS);
  if (wanted.length === 0) return { vendors: [], failure: null };
  if (key === undefined || key === "") return { vendors: [], failure: "unavailable" };

  const answers = await Promise.all(
    wanted.map(async (pick) => {
      try {
        return { pick, contact: await fetchDetails(key, pick.id), failure: null };
      } catch (error) {
        const kind: PlacesFailure = error instanceof PlacesError ? error.kind : "unavailable";
        return { pick, contact: null, failure: kind };
      }
    }),
  );
  if (answers.some((a) => a.failure === "quota")) return { vendors: [], failure: "quota" };
  if (answers.every((a) => a.failure !== null)) return { vendors: [], failure: "unavailable" };
  return {
    vendors: answers.map((a) => ({ id: a.pick.id, scope: a.pick.scope, contact: a.contact })),
    failure: null,
  };
}

function renderVendorContact(vendor: PickedVendor, parts: readonly ParseResult[]): string {
  if (vendor.contact === null) {
    return `<section class="vendor">
          <p class="vname">${escapeHtml(vendor.id)}</p>
          <p class="note">${DETAILS_FAILED}</p>
        </section>`;
  }
  // Everything below comes from, or is written from, one Google Maps listing, so the whole block
  // is boxed and labelled rather than only the four lines Google itself wrote.
  const contact = vendor.contact;
  const name = contact.name === "" ? "this shop" : contact.name;
  const scoped = scopedParts(vendor.scope, parts);
  // No note: the public page's note-to-supplier field is not carried to the vendor pages.
  const message = requirementMessage(scoped, "", `Hi ${name}`);
  const phone = phoneFor(contact);

  const lines = [`<h2>${escapeHtml(name)}</h2>`];
  lines.push(
    phone.display === ""
      ? `<p class="note">${NO_PHONE}</p>`
      : `<p class="vphone">${escapeHtml(phone.display)}</p>`,
  );
  if (contact.website !== "") lines.push(vendorLink(contact.website, "Website"));
  if (contact.mapsUri !== "") lines.push(vendorLink(contact.mapsUri, "Open in Google Maps"));
  lines.push(
    `<label for="m-${escapeHtml(contact.id)}">Your message to ${escapeHtml(name)}</label>`,
    `<textarea id="m-${escapeHtml(contact.id)}" rows="${textareaRows(message)}" readonly>` +
      `${escapeHtml(message)}</textarea>`,
  );
  if (phone.whatsapp !== null) {
    lines.push(
      `<a class="whatsapp" href="${escapeHtml(whatsappUrl(message, phone.whatsapp))}">` +
        `WhatsApp ${escapeHtml(name)}</a>`,
    );
    if (phone.caution) lines.push(`<p class="note">${MAY_NOT_BE_WHATSAPP}</p>`);
  } else if (phone.tel !== null) {
    lines.push(vendorLink(`tel:${phone.tel}`, "Call"));
  }
  lines.push(vendorLink(mailtoUrl(emailSubject(scoped), message), "Send by email"));
  return googleMapsBox(`<div class="vendor">
          ${lines.join("\n          ")}
          </div>`);
}

export interface ContactInput {
  vendors: readonly PickedVendor[];
  /** Every part number the page carried, before any vendor's scope narrows it. */
  parts: readonly ParseResult[];
  q: string;
  city: string;
  country: Country;
  /** Shown above the list. Not user text. */
  notice?: string;
  /** Replaces the list, e.g. with the fallback links. */
  body?: string;
}

/** The contact page. */
export function renderContact(input: ContactInput): string {
  const { vendors, parts, q, city, country } = input;
  const sections: string[] = [];
  if (input.notice) sections.push(`<p class="warn">${escapeHtml(input.notice)}</p>`);
  if (input.body) {
    sections.push(input.body);
  } else {
    sections.push(...vendors.map((vendor) => renderVendorContact(vendor, parts)));
  }
  const back = `/parts/vendors/?q=${encodeURIComponent(q)}&city=${encodeURIComponent(city)}` +
    `&country=${encodeURIComponent(country.code)}`;
  sections.push(
    `<p class="back"><a href="${escapeHtml(back)}">Back to the vendor list</a> &middot; ` +
      `<a href="/parts/vendors/logout">Sign out</a></p>`,
  );
  return renderVendorDocument(`<main>
      <h1>Contact the vendors</h1>
      <p class="lede">One message per shop, ready to send. Read it before you send it: you are the
      sender, not Partfinder.</p>
      ${sections.join("\n      ")}
    </main>`);
}

/** Kept beside the caps it belongs with, so a form cannot ask for more work than the page allows. */
export function picksFrom(params: URLSearchParams): { id: string; scope: string }[] {
  const picks: { id: string; scope: string }[] = [];
  for (const id of params.getAll("v")) {
    if (id === "" || id.length > MAX_QUERY_LENGTH) continue;
    if (picks.some((p) => p.id === id)) continue;
    picks.push({ id, scope: params.get(`scope_${id}`) ?? SCOPE_ALL });
  }
  return picks;
}
