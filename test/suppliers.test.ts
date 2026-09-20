// Step 4: the Check and Where-to-buy links, and the send-the-requirement section.
// The handler is called in-process. No network: every link here is a link the user clicks.

import { describe, expect, it } from "vitest";
import worker from "../src/index";
import type { DealerLocator } from "../src/dealers";
import { renderWhereToBuy, resolveCountry } from "../src/page";
import { extractHints, extractTokens, parse } from "../src/parse";

const page = async (query: string): Promise<string> => {
  const res = await worker.fetch(new Request(`https://rohitrao.in/parts/${query}`), {});
  expect(res.status).toBe(200);
  return res.text();
};

const q = (text: string, extra = "") => `?q=${encodeURIComponent(text)}${extra}`;

function unescapeHtml(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

/** The href of the link whose visible text is exactly this. */
function linkByText(html: string, text: string): string | undefined {
  const found = html.match(new RegExp(`href="([^"]*)"[^>]*>${text}<`))?.[1];
  return found === undefined ? undefined : unescapeHtml(found);
}

/** The prepared message, not the q box at the top of the page. */
const textarea = (html: string) =>
  unescapeHtml(html.match(/<textarea id="message"[^>]*>([\s\S]*?)<\/textarea>/)?.[1] ?? "");

const results = (text: string) => {
  const hints = [...extractHints(text)];
  return extractTokens(text).map((token) => parse(token, hints));
};

describe("Where to buy: Google Maps", () => {
  it("searches the city by name when one is given", async () => {
    const html = await page(q("1u3352", "&city=Bengaluru&country=IN"));
    const url = new URL(linkByText(html, "Caterpillar parts shops on Google Maps")!);
    expect(url.searchParams.get("query")).toBe("Caterpillar spare parts Bengaluru India");
  });

  it("falls back to near me with no city", async () => {
    const html = await page(q("1u3352", "&country=IN"));
    const url = new URL(linkByText(html, "Caterpillar parts shops on Google Maps")!);
    expect(url.searchParams.get("query")).toBe("Caterpillar spare parts near me");
  });
});

describe("Where to buy: the supplier search", () => {
  it("is on the country's Google domain and names the spellings", async () => {
    const html = await page(q("1u3352", "&country=IN"));
    const url = new URL(linkByText(html, "Find suppliers in India")!);
    expect(url.host).toBe("www.google.co.in");
    const query = url.searchParams.get("q")!;
    for (const part of ["1U3352", "1U-3352", "supplier", "India"]) {
      expect(query).toContain(part);
    }
  });
});

describe("Check", () => {
  it("links images with tbm=isch and every spelling", async () => {
    const html = await page(q("1u3352"));
    const url = new URL(linkByText(html, "See images")!);
    expect(url.searchParams.get("tbm")).toBe("isch");
    expect(url.searchParams.get("q")).toBe('"1U3352" OR "1U-3352"');
  });

  it("links what the part fits", async () => {
    const html = await page(q("1u3352"));
    const url = new URL(linkByText(html, "Check which machines it fits")!);
    const query = url.searchParams.get("q")!;
    for (const part of ["1U3352", "1U-3352", "fits models"]) expect(query).toContain(part);
  });

  it("gives a card with no candidate neither group", async () => {
    const html = await page(q("HELLO12"));
    expect(html).toContain("Not determined: no known number format matched.");
    expect(linkByText(html, "Search all spellings")).toBeUndefined();
    expect(linkByText(html, "See images")).toBeUndefined();
    expect(html).not.toContain("Where to buy");
  });
});

describe("dealer locators", () => {
  it("every committed entry carries a url and the date it was confirmed", async () => {
    const { DEALER_LOCATORS } = await import("../src/dealers");
    for (const entry of DEALER_LOCATORS) {
      expect(entry.url, `${entry.oem}/${entry.country}`).toMatch(/^https:\/\//);
      expect(entry.verifiedOn, `${entry.oem}/${entry.country}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("renders a link when an entry exists, and none when it does not", () => {
    const [result] = results("1u3352");
    const india = resolveCountry("IN");
    const table: DealerLocator[] = [
      {
        oem: "Caterpillar",
        country: "IN",
        url: "https://example.invalid/dealers",
        verifiedOn: "2026-09-20",
        note: "fixture",
      },
    ];
    expect(renderWhereToBuy(result!, india, "", table)).toContain("Authorised Caterpillar dealers");
    expect(renderWhereToBuy(result!, india, "", [])).not.toContain("Authorised");
  });
});

describe("the supplier's WhatsApp number", () => {
  const chat = (html: string) =>
    (html.match(/href="(https:\/\/wa\.me\/\d+\?[^"]*)"/)?.[1] ?? "").split("?")[0];

  it("prefixes the country code for a local Indian number", async () => {
    const html = await page(q("1u3352", `&country=IN&to=${encodeURIComponent("98765 43210")}`));
    expect(chat(html)).toBe("https://wa.me/919876543210");
  });

  it("takes the digits as typed when the number carries its own plus", async () => {
    const html = await page(q("1u3352", `&country=IN&to=${encodeURIComponent("+971 50 123 4567")}`));
    expect(chat(html)).toBe("https://wa.me/971501234567");
  });

  it("drops the trunk zero and prefixes the code for a local UAE number", async () => {
    const html = await page(q("1u3352", `&country=AE&to=${encodeURIComponent("050 123 4567")}`));
    expect(chat(html)).toBe("https://wa.me/971501234567");
  });

  it("says so and offers only the picker when the number is not dialable", async () => {
    const html = await page(q("1u3352", "&country=IN&to=12345"));
    expect(html).toContain(
      "That doesn't look like a WhatsApp number, so pick the contact in WhatsApp instead.",
    );
    expect(chat(html)).toBe("");
    expect(linkByText(html, "Or pick a contact in WhatsApp")).toBeDefined();
  });
});

describe("the requirement message", () => {
  const sample = q("need 1u3352 and 40/300893 for JCB 3CX", "&city=Bengaluru&note=Qty%204");

  it("is the same text in the textarea, on WhatsApp and in the email", async () => {
    const html = await page(sample);
    const shown = textarea(html);
    const picker = new URL(linkByText(html, "Or pick a contact in WhatsApp")!);
    const mail = new URL(linkByText(html, "Send by email")!);

    expect(shown).toContain("Qty 4");
    expect(picker.searchParams.get("text")).toBe(shown);
    expect(mail.searchParams.get("body")).toBe(shown);
    expect(mail.searchParams.get("subject")).toBe("Requirement: 1U3352, 40/300893");
  });

  it("keeps the note, the supplier's number and the city out of the back-link", async () => {
    const html = await page(`${sample}&to=${encodeURIComponent("98765 43210")}`);
    const link = textarea(html).match(/https:\/\/rohitrao\.in\/parts\/\?q=(\S+)/)![1]!;
    expect(decodeURIComponent(link)).toBe("1U3352 40/300893");
    for (const secret of ["Qty", "98765", "Bengaluru"]) expect(link).not.toContain(secret);
  });

  it("encodes the email with %20, never +", async () => {
    const html = await page(sample);
    const href = html.match(/href="(mailto:[^"]*)"/)![1]!;
    expect(href).toContain("%20");
    expect(href).not.toContain("+");
  });

  it("offers nothing to send when no number was recognised", async () => {
    const html = await page(q("HELLO12"));
    expect(html).toContain("Nothing to send: no part number was recognised.");
    expect(html).not.toContain("<textarea id=\"message\"");
    expect(html).not.toContain("https://wa.me/");
    expect(html).not.toContain("mailto:");
  });
});

describe("the send form", () => {
  it("carries q, hint, country and city back as hidden fields", async () => {
    const html = await page(q("1u3352", "&hint=hitachi&country=AE&city=Dubai"));
    const form = html.slice(html.indexOf('<section class="send"'));
    expect(form).toContain('<input type="hidden" name="q" value="1u3352">');
    expect(form).toContain('<input type="hidden" name="hint" value="hitachi">');
    expect(form).toContain('<input type="hidden" name="country" value="AE">');
    expect(form).toContain('<input type="hidden" name="city" value="Dubai">');
  });

  it("keeps the number and the note filled in after it is submitted", async () => {
    const html = await page(q("1u3352", "&to=9876543210&note=Qty%204"));
    expect(html).toContain('name="to" type="text" value="9876543210"');
    expect(html).toContain('name="note" type="text" value="Qty 4"');
  });

  it("escapes the city everywhere it appears", async () => {
    const html = await page(q("1u3352", `&city=${encodeURIComponent('" onfocus="x')}`));
    expect(html).toContain('value="&quot; onfocus=&quot;x"');
    expect(html).not.toContain('value="" onfocus=');
  });
});
