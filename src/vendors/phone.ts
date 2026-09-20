// What can be done with a phone number Google returned.
//
// There is no guess here about whether a number is a mobile. India's mobile shape - +91 then ten
// digits starting 6 to 9 - does not separate them: Bengaluru's own area code is 80, so half the
// landlines in the city Partfinder was written for satisfy it. Guessing wrong in one direction
// hides a working WhatsApp number, and in the other it labels a landline as a mobile, so a shop
// is offered both and the buttons say which is which.

/** A plausible international number, so a mangled one never becomes a wa.me link. */
const DIALLABLE = /^\d{8,15}$/;

export interface Phone {
  /** What to print. Empty when Google lists no number at all. */
  display: string;
  /** The tel: target, or null when there is no number. */
  tel: string | null;
  /** Digits for wa.me, or null when the number has no country code to dial internationally. */
  whatsapp: string | null;
}

/** Says the uncertainty out loud instead of resolving it. A shop may be on WhatsApp or may not. */
export const WHATSAPP_LABEL = "WhatsApp (if they use it)";

export const NO_PHONE = "Google lists no phone number for this shop.";

/**
 * Both things, whenever the number allows it. The only number that gets no WhatsApp link is one
 * with no country code, which cannot be dialled internationally at all.
 */
export function phoneFor(source: { internationalPhone: string; nationalPhone: string }): Phone {
  const international = source.internationalPhone.trim();
  const national = source.nationalPhone.trim();
  const display = international !== "" ? international : national;
  if (display === "") return { display: "", tel: null, whatsapp: null };

  if (!international.startsWith("+")) {
    const local = national.replace(/[^\d+]/g, "");
    return { display, tel: local === "" ? null : local, whatsapp: null };
  }
  const digits = international.replace(/\D/g, "");
  return { display, tel: `+${digits}`, whatsapp: DIALLABLE.test(digits) ? digits : null };
}
