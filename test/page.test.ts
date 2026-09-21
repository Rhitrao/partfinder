// Tests for the server-rendered page at /parts/. The handler is called in-process; no network.

import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { WHATSAPP_LIMIT } from "../src/page";

const page = async (query = ""): Promise<string> => {
  const res = await worker.fetch(new Request(`https://rohitrao.in/parts/${query}`), {});
  expect(res.status).toBe(200);
  return res.text();
};

const q = (text: string, extra = "") => `?q=${encodeURIComponent(text)}${extra}`;

/** Every href on the page, decoded from its HTML attribute escaping. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) =>
    (m[1] ?? "").replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'"),
  );
}

/**
 * The href of the link whose visible text is exactly this.
 *
 * A link that leaves the site carries the external mark after its label, so the label is no
 * longer the last thing before </a>. The mark is optional in the pattern: internal links, and
 * mailto:, do not have one.
 */
const linkByText = (html: string, text: string) =>
  html
    .match(new RegExp(`href="([^"]*)"[^>]*>${text}(?: <span class="ext"[^>]*>[^<]*</span>)?<`))?.[1]
    ?.replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
const whatsappLink = (html: string) => hrefs(html).find((h) => h.startsWith("https://wa.me/"));

/**
 * Just the cards. The send form below them carries q back as a hidden field, so slicing to the
 * end of the document would find the pasted text again and prove nothing about the cards.
 */
const cards = (html: string) =>
  html.slice(html.indexOf('<section class="parts">'), html.indexOf("</section>", html.indexOf('<p class="caveat"')));

/** The manufacturer line of every card, in rendered order. */
const oems = (html: string) =>
  [...html.matchAll(/<p class="maker">([^<]*?)\??(?: <span)/g)].map((m) => m[1]);

/** The large number on every card, in rendered order. */
const numbers = (html: string) =>
  [...html.matchAll(/<p class="number">([^<]*)<\/p>/g)].map((m) => m[1]);

describe("GET /parts/ with no q", () => {
  it("asks for a paste and a city, and nothing else in front", async () => {
    const html = await page();
    expect(html).toContain('<form method="GET" action="/parts/" class="ask">');
    expect(html).toContain('name="q"');
    expect(html).toContain("Paste a WhatsApp message or part numbers");
    expect(html).toContain("autofocus");
    expect(html).toContain('name="city"');
    expect(html).toContain("e.g. Bengaluru");
    expect(html).toContain("Find parts &amp; suppliers");
  });

  it("keeps country, hint and note behind More options", async () => {
    const html = await page();
    const more = html.slice(html.indexOf("<details class=\"more\">"), html.indexOf("</details>"));
    for (const field of ['name="country"', 'name="hint"', 'name="note"']) {
      expect(more, field).toContain(field);
    }
  });

  it("defaults the country to India, by name and not by Google domain", async () => {
    const html = await page();
    expect(html).toContain('<option value="IN" selected>India</option>');
    expect(html).not.toContain('value="AE" selected');
    // The search domain is plumbing: it belongs in a link, never on the page.
    expect(html).not.toContain("google.co.in");
  });

  it("shows no results and no WhatsApp button", async () => {
    const html = await page();
    expect(html).not.toContain('class="card"');
    expect(whatsappLink(html)).toBeUndefined();
  });

  it("carries the fixed text", async () => {
    const html = await page();
    // All of it now lives behind "How it works", out of the way of the job.
    const how = html.slice(html.indexOf('<details class="how">'));
    expect(how).toContain("quoted per account");
    expect(how).toContain("Suppliers confirm fitment.");
    expect(how).toContain("Not affiliated with any manufacturer");
  });

  it("has no client-side JavaScript", async () => {
    const html = await page();
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });
});

describe("a product card", () => {
  it("leads with the canonical number and says how it was typed", async () => {
    const html = await page(q("1u3352"));
    expect(numbers(html)).toEqual(["1U-3352"]);
    expect(html).toContain("as typed: 1U3352");
    expect(oems(html)).toContain("Caterpillar");
    expect(html).toContain('<span class="badge">format match</span>');
    // The format essays are gone: one caveat serves the whole section.
    expect(html).not.toContain("Guess from number format only");
    expect(html).not.toContain("Format: usually unique");
    expect(html).toContain(
      "Manufacturer matched from the number's format, not confirmed. Suppliers confirm fitment.",
    );
  });

  it("says nothing about how it was typed when it was typed canonically", async () => {
    const html = await page(q("1U-3352"));
    expect(numbers(html)).toEqual(["1U-3352"]);
    expect(html).not.toContain("as typed:");
  });

  it("offers a chip per manufacturer when the number fits more than one", async () => {
    const html = await page(q("3200677", "&city=Bengaluru"));
    expect(html).toContain("Caterpillar or Hitachi?");
    const chips = [...html.matchAll(/<a class="chip" href="([^"]*)">([^<]*)<\/a>/g)];
    expect(chips.map((m) => m[2])).toEqual(["Caterpillar", "Hitachi"]);
    for (const [, href] of chips) {
      const url = new URL(href!.replaceAll("&amp;", "&"), "https://rohitrao.in");
      expect(url.pathname).toBe("/parts/");
      expect(url.searchParams.get("q")).toBe("3200677");
      expect(url.searchParams.get("city")).toBe("Bengaluru");
    }
    expect(chips.map((m) => new URL(m[1]!.replaceAll("&amp;", "&"), "https://rohitrao.in")
      .searchParams.get("hint"))).toEqual(["Caterpillar", "Hitachi"]);
    // The old nudge is gone; the chips are the nudge.
    expect(html).not.toContain("Add the brand or machine to narrow this.");
  });

  it("shows a single manufacturer without chips", async () => {
    const html = await page(q("1u3352"));
    expect(html).not.toContain('class="chip"');
  });

  it("shows a suffix as a tag", async () => {
    const html = await page(q("1u3352RC"));
    expect(html).toContain('<p class="tag">RC</p>');
    expect(numbers(html)).toEqual(["1U-3352"]);
  });
});

describe("quantities on a card", () => {
  it("reads them from the message and prefills the field", async () => {
    const html = await page(q("need 2 nos 1u3352 and 40/300893 x1"));
    expect(numbers(html)).toEqual(["1U-3352", "40/300893"]);
    expect(html).toContain("Qty 2 from message");
    expect(html).toContain("Qty 1 from message");
    expect(html).toContain('name="qty_1U-3352" value="2"');
    expect(html).toContain('name="qty_40/300893" value="1"');
  });

  it("shows an empty field labelled just Qty when the message gives none", async () => {
    const html = await page(q("1u3352 2023"));
    // "Qty not given" is gone: nothing was given because the message did not say, which is the
    // ordinary case and not a finding worth a sentence.
    expect(html).not.toContain("not given");
    expect(html).toContain(">Qty</label>");
    expect(html).toContain('name="qty_1U-3352" value=""');
    expect(html).toContain('placeholder="Qty"');
  });

  it("prefers a typed quantity and stops crediting the message", async () => {
    const html = await page(q("need 2 nos 1u3352", "&qty_1U-3352=7"));
    expect(html).toContain("Qty 7");
    expect(html).not.toContain("(from message)");
    expect(html).toContain('name="qty_1U-3352" value="7"');
  });
});

describe("country", () => {
  it("puts the search link on google.ae for AE", async () => {
    const html = await page(q("1u3352", "&country=AE"));
    expect(new URL(linkByText(html, "Search Google")!).host).toBe("www.google.ae");
    expect(await page(q("1u3352", "&country=AE"))).toContain('<option value="AE" selected>');
  });

  it("falls back to India for an unknown code", async () => {
    const html = await page(q("1u3352", "&country=ZZ"));
    expect(new URL(linkByText(html, "Search Google")!).host).toBe("www.google.co.in");
  });
});

describe("escaping", () => {
  it("never renders user input unescaped", async () => {
    const html = await page(q("<script>alert(1)</script>"));
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).not.toContain("alert(1)</");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes the hint field too", async () => {
    const html = await page(`?q=1u3352&hint=${encodeURIComponent('" onfocus="x')}`);
    // The quotes are escaped, so the value attribute is never closed early.
    expect(html).toContain('value="&quot; onfocus=&quot;x"');
    expect(html).not.toContain('value="" onfocus=');
  });
});

describe("not determined", () => {
  it("is an answer, not an error", async () => {
    const res = await worker.fetch(new Request(`https://rohitrao.in/parts/${q("HELLO12")}`), {});
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Not recognised: HELLO12");
    // One line naming it, not a card explaining itself.
    expect(html).not.toContain('class="card"');
    expect(html).not.toContain("left out of the WhatsApp message");
  });

  it("offers nothing to send when no number was recognised", async () => {
    const html = await page(q("HELLO12"));
    expect(whatsappLink(html)).toBeUndefined();
    expect(html).toContain("Nothing here looks like a part number yet.");
  });
});

describe("the WhatsApp link", () => {
  it("decodes to a message with the back-link, inside the length limit", async () => {
    const text = "need 1u3352 and 40/300893 for JCB 3CX";
    const html = await page(q(text));
    const url = new URL(whatsappLink(html)!);
    const message = url.searchParams.get("text")!;
    expect(message.length).toBeLessThanOrEqual(WHATSAPP_LIMIT);
    expect(message).toContain("https://rohitrao.in/parts/?q=1U3352%2040%2F300893");
    expect(message).toContain("1U3352");
    expect(message).toContain("1. 1U-3352 (likely Caterpillar)");
    expect(message).toContain("40/300893");
  });

  it("carries only the part numbers in the back-link, never the pasted text", async () => {
    const html = await page(q("Ramesh 9876543210 needs 1u3352 at Rs 4500"));
    const message = new URL(whatsappLink(html)!).searchParams.get("text")!;

    const link = message.match(/https:\/\/rohitrao\.in\/parts\/\?q=(\S+)/)![1]!;
    expect(decodeURIComponent(link)).toBe("1U3352");

    for (const secret of ["Ramesh", "9876543210", "4500"]) {
      expect(message).not.toContain(secret);
    }
  });

  it("keeps a phone-shaped number off the page entirely", async () => {
    const html = await page(q("Ramesh 9876543210 needs 1u3352 at Rs 4500"));
    // Echoing a customer's phone number back under "Not recognised" is noise and a small leak.
    // The paste box still shows what the user typed; the Parts section does not repeat it.
    expect(cards(html)).not.toContain("9876543210");
    expect(html).not.toContain("Not recognised");
    expect(numbers(html)).toEqual(["1U-3352"]);
  });

  it("drops a number with a country code from the message", async () => {
    const html = await page(q("+91 98765 43210 need 1u3352"));
    const message = new URL(whatsappLink(html)!).searchParams.get("text")!;
    const link = message.match(/https:\/\/rohitrao\.in\/parts\/\?q=(\S+)/)![1]!;
    expect(decodeURIComponent(link)).toBe("1U3352");
    expect(message).not.toContain("98765");
    expect(message).not.toContain("43210");
  });

  it("sends a phone-shaped number once the user types it with dashes", async () => {
    const bare = await page(q("6754611102"));
    expect(whatsappLink(bare)).toBeUndefined();
    expect(bare).toContain("Nothing here looks like a part number yet.");
    expect(cards(bare)).not.toContain("6754611102");

    const dashed = await page(q("6754-61-1102"));
    expect(oems(dashed)).toContain("Komatsu");
    expect(dashed).not.toContain("Looks like a phone number");
    const message = new URL(whatsappLink(dashed)!).searchParams.get("text")!;
    expect(message).toContain("6754-61-1102");
    expect(message).toContain("Komatsu");
  });

  it("stays inside the limit for a long list, trimming spellings first", async () => {
    const numbers = Array.from({ length: 30 }, (_, i) => `4${i.toString().padStart(2, "0")}00893`);
    const html = await page(q(numbers.join(" ")));
    const message = new URL(whatsappLink(html)!).searchParams.get("text")!;
    expect(message.length).toBeLessThanOrEqual(WHATSAPP_LIMIT);
    expect(message).toContain("https://rohitrao.in/parts/?q=");
  });
});

describe("prices", () => {
  it("never reach the message", async () => {
    for (const text of ["price \u20b945,000 for 40/300893", "Rs. 125000 40/300893"]) {
      const html = await page(q(text));
      const message = new URL(whatsappLink(html)!).searchParams.get("text")!;
      const link = message.match(/https:\/\/rohitrao\.in\/parts\/\?q=(\S+)/)![1]!;
      expect(decodeURIComponent(link)).toBe("40/300893");
      for (const price of ["45,000", "45000", "125000"]) expect(message).not.toContain(price);
    }
  });

  it("never reach a card either", async () => {
    const html = await page(q("price \u20b945,000 for 40/300893"));
    const shown = cards(html);
    expect(shown).not.toContain("45,000");
    expect(shown).toContain("40/300893");
  });
});

describe("headers", () => {
  it("carry noindex, the CSP and no-referrer", async () => {
    const res = await worker.fetch(new Request("https://rohitrao.in/parts/"), {});
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; manifest-src 'self'; " +
        "form-action 'self'; base-uri 'none'",
    );
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  });
});

describe("the hint field", () => {
  it("ranks Hitachi first for 3200677 with hint hitachi", async () => {
    const withHint = await page(`?q=3200677&hint=hitachi`);
    expect(oems(withHint)[0]).toBe("Hitachi or Caterpillar");
    // The hint changed the ranking; the page no longer narrates that it used one.
    expect(withHint).not.toContain("Hints used");

    const without = await page(q("3200677"));
    expect(oems(without)[0]).toBe("Caterpillar or Hitachi");
  });
});

describe("what the page never shows", () => {
  it("prints no spelling list and no Google domain, while the links still use both", async () => {
    for (const query of [q("need 2 nos 1u3352 and 40/300893 x1"), q("3200677"), ""]) {
      const html = await page(query);
      expect(html, query).not.toContain("Also written");
      expect(html, query).not.toContain("Search all spellings");
      expect(html, query).not.toContain("Hints used");
      // A search domain may sit inside an href; it may not be words the user reads.
      const visible = html.replace(/<[^>]*>/g, " ");
      expect(visible, query).not.toContain("google.co.in");
    }
    // The query behind the link is unchanged: every spelling, on the country's own domain.
    const html = await page(q("1u3352", "&country=AE"));
    const url = new URL(linkByText(html, "Search Google")!);
    expect(url.host).toBe("www.google.ae");
    expect(url.searchParams.get("q")).toBe('"1U3352" OR "1U-3352"');
  });

  it("reads two parts and their quantities out of one pasted line", async () => {
    const html = await page(q("need 2 nos 1u3352 and 40/300893 x1"));
    expect(numbers(html)).toEqual(["1U-3352", "40/300893"]);
    expect(html).toContain("Qty 2 from message");
    expect(html).toContain("Qty 1 from message");
    expect(html).toContain("as typed: 1U3352");
  });
});
