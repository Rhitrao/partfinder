// Tests for the server-rendered page at /parts/. The handler is called in-process; no network.

import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { WHATSAPP_LIMIT } from "../src/page";

const page = async (query = ""): Promise<string> => {
  const res = await worker.fetch(new Request(`https://rohitrao.in/parts/${query}`));
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

const searchLinks = (html: string) => hrefs(html).filter((h) => h.includes("/search?q="));
const whatsappLink = (html: string) => hrefs(html).find((h) => h.startsWith("https://wa.me/"));

/** The text of every candidate's manufacturer line, in rendered order. */
const oems = (html: string) => [...html.matchAll(/<p class="oem">([^<]*)<\/p>/g)].map((m) => m[1]);

describe("GET /parts/ with no q", () => {
  it("renders the form", async () => {
    const html = await page();
    expect(html).toContain('<form method="GET" action="/parts/">');
    expect(html).toContain('name="q"');
    expect(html).toContain("Paste part numbers or a WhatsApp message");
    expect(html).toContain('name="hint"');
    expect(html).toContain("Brand or machine (optional)");
    expect(html).toContain("Identify");
  });

  it("defaults the country to India", async () => {
    const html = await page();
    expect(html).toContain('<option value="IN" selected>India (google.co.in)</option>');
    expect(html).not.toContain('value="AE" selected');
  });

  it("shows no results and no WhatsApp button", async () => {
    const html = await page();
    expect(html).not.toContain('class="card"');
    expect(whatsappLink(html)).toBeUndefined();
  });

  it("carries the fixed text", async () => {
    const html = await page();
    expect(html).toContain("quoted per account");
    expect(html).toContain("Identification aid only. Confirm fitment with your supplier.");
    expect(html).toContain("Not affiliated with any manufacturer.");
  });

  it("has no client-side JavaScript", async () => {
    const html = await page();
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });
});

describe("a candidate card", () => {
  it("renders Caterpillar for 1u3352 with the unconfirmed basis", async () => {
    const html = await page(q("1u3352"));
    expect(html).toContain("1U3352");
    expect(oems(html)).toContain("Caterpillar");
    expect(html).toContain("1U-3352");
    expect(html).toContain("Guess from number format only. Not confirmed.");
    expect(html).toContain("Format: usually unique to this manufacturer.");
  });

  it("links the search to google.co.in with every spelling", async () => {
    const links = searchLinks(await page(q("1u3352")));
    expect(links).toHaveLength(1);
    const url = new URL(links[0]!);
    expect(url.host).toBe("www.google.co.in");
    expect(url.searchParams.get("q")).toBe('"1U3352" OR "1U-3352"');
  });

  it("says a shared format is shared", async () => {
    const html = await page(q("3200677"));
    expect(html).toContain("Format: shared with other manufacturers.");
  });

  it("nudges for a hint only when more than one manufacturer fits", async () => {
    const ambiguous = await page(q("3200677"));
    expect(new Set(oems(ambiguous)).size).toBeGreaterThan(1);
    expect(ambiguous).toContain("Add the brand or machine to narrow this.");

    const single = await page(q("1u3352"));
    expect(new Set(oems(single)).size).toBe(1);
    expect(single).not.toContain("Add the brand or machine to narrow this.");
  });
});

describe("country", () => {
  it("puts the search link on google.ae for AE", async () => {
    const links = searchLinks(await page(q("1u3352", "&country=AE")));
    expect(new URL(links[0]!).host).toBe("www.google.ae");
    expect(await page(q("1u3352", "&country=AE"))).toContain('<option value="AE" selected>');
  });

  it("falls back to India for an unknown code", async () => {
    const links = searchLinks(await page(q("1u3352", "&country=ZZ")));
    expect(new URL(links[0]!).host).toBe("www.google.co.in");
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
    const res = await worker.fetch(new Request(`https://rohitrao.in/parts/${q("HELLO12")}`));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Not determined: no known number format matched.");
    expect(html).toContain("No format matched, so it's left out of the WhatsApp message.");
    expect(html).toContain("Add it yourself if it's a part number.");
  });

  it("offers nothing to send when no number was recognised", async () => {
    const html = await page(q("HELLO12"));
    expect(whatsappLink(html)).toBeUndefined();
    expect(html).toContain("Nothing to send: no part number was recognised.");
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
    expect(message).toContain("Caterpillar (from number format, unconfirmed)");
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

  it("shows a phone-shaped number on the page, with the reason it is not sent", async () => {
    const html = await page(q("Ramesh 9876543210 needs 1u3352 at Rs 4500"));
    const cards = html.slice(html.indexOf('<section class="card"'));
    expect(cards).toContain("9876543210");
    expect(cards).toContain("Looks like a phone number, so it's left out of the WhatsApp message.");
    expect(cards).toContain("Type it with dashes if it's a part number.");
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
    expect(bare).toContain("Looks like a phone number");
    expect(whatsappLink(bare)).toBeUndefined();
    expect(bare).toContain("Nothing to send: no part number was recognised.");

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
    const cards = html.slice(html.indexOf('<section class="card"'));
    expect(cards).not.toContain("45,000");
    expect(cards).toContain("40/300893");
  });
});

describe("headers", () => {
  it("carry noindex, the CSP and no-referrer", async () => {
    const res = await worker.fetch(new Request("https://rohitrao.in/parts/"));
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
    );
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  });
});

describe("the hint field", () => {
  it("ranks Hitachi first for 3200677 with hint hitachi", async () => {
    const withHint = await page(`?q=3200677&hint=hitachi`);
    expect(oems(withHint)[0]).toBe("Hitachi");
    expect(withHint).toContain("Hints used: Hitachi");

    const without = await page(q("3200677"));
    expect(oems(without)[0]).toBe("Caterpillar");
  });
});
