// Step 9c: the page's supplier gate and the endpoint's search plan, which must agree.
//
// No network. The page cases render through the Worker; the agreement case is pure functions.

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { BLOCKER_REASONS, supplierGate } from "../src/health";
import { outbound, readQuery } from "../src/page";
import { asksFor, groupByOem, isSearchable, searchableCards } from "../src/vendors/search";
import { env, searchReply, stubFetch } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const page = async (query: string) => {
  stubFetch(searchReply);
  return (await worker.fetch(new Request(`https://rohitrao.in/parts/${query}`), env)).text();
};

const q = (text: string, extra = "") => `?q=${encodeURIComponent(text)}${extra}`;

/** Everything the live Suppliers section is made of. */
function section(html: string): { present: boolean; pending: boolean; heading: string } {
  return {
    present: html.includes('<section class="suppliers">'),
    pending: html.includes("Finding suppliers") && html.includes('id="pf-turnstile"'),
    heading: /<h2>(Suppliers[^<]*)<\/h2>/.exec(html)?.[1] ?? "",
  };
}

const pageData = (html: string) =>
  JSON.parse(html.match(/id="pf-data"[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "null") as {
    parts: string[];
  } | null;

describe("a described part", () => {
  const DESCRIBED = "need 2 nos ex200 pin pivot";

  it("gets a Suppliers section, which it never used to", async () => {
    // The card rendered, the message was right, and the right column showed only "Other ways to
    // send". The gate was still asking for numbers grouped by manufacturer, and a described part
    // has neither.
    const html = await page(q(DESCRIBED, "&city=Bengaluru"));
    expect(section(html)).toEqual({
      present: true,
      pending: true,
      heading: "Suppliers near Bengaluru",
    });
    expect([...html.matchAll(/<li class="ghost">/g)]).toHaveLength(3);
    expect(html).toContain('id="pf-turnstile"');
  });

  it("is named in pf-data by its own key, so the filter chips can address it", async () => {
    const html = await page(q(DESCRIBED, "&city=Bengaluru"));
    expect(pageData(html)?.parts).toEqual(["desc:EX200:pin pivot"]);
  });

  it("gets the section with no city too, in All India scope", async () => {
    const html = await page(q(DESCRIBED));
    expect(section(html)).toEqual({ present: true, pending: true, heading: "Suppliers in India" });
    expect(html).toContain(">All India<");
  });

  it("still carries link-outs for a browser with no JavaScript", async () => {
    const html = await page(q(DESCRIBED, "&city=Bengaluru"));
    const noscript = html.slice(html.indexOf("<noscript>"), html.indexOf("</noscript>"));
    // Its brands are what there is to link out to; the section would otherwise be a dead end.
    expect(noscript).toContain("<h3>Hitachi</h3>");
    expect(noscript).toContain("Hitachi parts shops on Google Maps");
    expect(noscript).toContain("Search suppliers on Google");
  });
});

describe("a number nobody placed", () => {
  it("gets a section when the message said something about it", async () => {
    const html = await page(q("9ZZ123456 CVVT", "&city=Bengaluru"));
    expect(section(html).pending).toBe(true);
    expect(pageData(html)?.parts).toEqual(["9ZZ123456"]);
  });

  it("gets none on its own, because there would be nothing to look for", async () => {
    const html = await page(q("9ZZ123456", "&city=Bengaluru"));
    expect(section(html).present).toBe(false);
    expect(html).not.toContain("Finding suppliers");
    // The card and its own way out are still there.
    expect(html).toContain("9ZZ123456");
    expect(html).toContain("Manufacturer not recognised");
    expect(html).toContain('<details class="send" open>');
  });

  it("heads its link-outs with the number, since it has no brand to head them with", async () => {
    const html = await page(q("9ZZ123456 CVVT", "&city=Bengaluru"));
    const noscript = html.slice(html.indexOf("<noscript>"), html.indexOf("</noscript>"));
    expect(noscript).toContain("<h3>9ZZ123456</h3>");
    expect(noscript).toContain("Search suppliers on Google");
    // No brand means no Maps-by-brand search and no dealer locator to claim.
    expect(noscript).not.toContain("parts shops on Google Maps");
  });
});

/**
 * The table this step exists for.
 *
 * The gate and the search plan were two readings of "is there anything to search for", and they
 * drifted: the endpoint learned about step 9's card types and the gate did not. One definition
 * now, and this is the case that fails if they ever part again.
 */
describe("the gate and the search plan agree", () => {
  const INPUTS = [
    "1u3352",
    "1u3352 40/300893",
    "24370-2E000",
    "need 2 nos ex200 pin pivot",
    "ex200 pin pivot",
    "hitachi bucket pin",
    "9ZZ123456 CVVT",
    "9ZZ123456",
    "9ZZ123456 8YY654321",
    "12345",
    "hello there",
    "",
    "Ramesh 9876543210",
    "Ramesh 9876543210 ex200 pivot pin Rs 4500",
    "1u3352 ex200",
  ];

  it("every input the plan would search, the gate shows - and the other way round", () => {
    for (const input of INPUTS) {
      const { results } = readQuery(input, "");
      const sending = outbound(results);
      const plan = asksFor(sending, groupByOem(sending).groups);
      const wouldSearch = plan.some((ask) => ask.parts.length > 0);
      const gate = supplierGate({ results, siteKey: "a-site-key" });
      expect(gate.render, `${JSON.stringify(input)} -> render`).toBe(wouldSearch);
      expect(gate.cards.length > 0, `${JSON.stringify(input)} -> cards`).toBe(wouldSearch);
    }
  });

  it("counts the same cards either way, one by one", () => {
    for (const input of INPUTS) {
      const { results } = readQuery(input, "");
      const cards = searchableCards(results);
      // Everything searchable may leave the page, and nothing that may not is searchable.
      expect(outbound(results).filter(isSearchable), input).toEqual(cards);
      // Every searchable card is spoken for by at least one ask.
      const plan = asksFor(outbound(results), groupByOem(outbound(results)).groups);
      const spokenFor = new Set(plan.flatMap((ask) => ask.parts));
      for (const card of cards.slice(0, 3)) {
        const key = card.described
          ? `desc:${card.described.machine}:${card.described.name}`
          : undefined;
        if (key !== undefined) expect(spokenFor.has(key), `${input} -> ${key}`).toBe(true);
      }
    }
  });

  it("names the right reason when there is nothing to search for", () => {
    const nothing = supplierGate({ results: readQuery("12345", "").results, siteKey: "k" });
    expect(nothing.blockers).toEqual(["no_parts"]);

    const unsearchable = supplierGate({
      results: readQuery("9ZZ123456", "").results,
      siteKey: "k",
    });
    expect(unsearchable.blockers).toEqual(["no_searchable_part"]);
    expect(BLOCKER_REASONS.no_searchable_part).toContain("nothing to look for");
  });
});

describe("other ways to send", () => {
  it("puts the WhatsApp button and the message label on separate lines", async () => {
    const html = await page(q("9ZZ123456"));
    const css = html.match(/<style[^>]*>([\s\S]*?)<\/style>/)![1]!;
    // A <details> is not a flex column the way a <form> is, so both were inline and collided.
    expect(css).toContain(".send > .whatsapp { display: flex;");
    expect(css).toContain(".send > label { display: block; }");
  });
});
