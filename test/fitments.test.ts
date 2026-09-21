// Step 8: the machine fitment list, and the rule that there is no list without a source.
//
// No network. Fixtures are public part numbers with publicly checkable answers, as everywhere.

import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { FITMENTS, findFitment, machineCount, sourceLabel } from "../src/fitments";

const page = async (query: string) =>
  (await worker.fetch(new Request(`https://rohitrao.in/parts/?q=${encodeURIComponent(query)}`), {})).text();

/** The whole <details class="fitment"> element, or "". */
function block(html: string): string {
  const at = html.indexOf('<details class="fitment">');
  return at < 0 ? "" : html.slice(at, html.indexOf("</details>", at));
}

describe("the seed data", () => {
  it("holds exactly one entry, with its sources, its tier and the date it was read", () => {
    expect(FITMENTS).toHaveLength(1);
    const only = FITMENTS[0]!;
    expect(only.part).toBe("1U-3352");
    expect(only.sources).toEqual(["https://www.romacparts.com/1u3352-teeth.html"]);
    expect(only.checkedOn).toBe("2026-09-18");
    expect(only.note).toContain("aftermarket seller listings");
    expect(only.note).toContain("Lists vary between sellers.");
  });

  it("is T4, because one seller's listing is one seller's claim", () => {
    const only = FITMENTS[0]!;
    expect(only.basis).toBe("T4");
    expect(only.sources).toHaveLength(1);
  });

  /**
   * The tier is not computed from the URLs - five domains reposting one listing count once, and
   * only a person reading them can see that. But an entry claiming T3 on a single domain is
   * wrong however it was arrived at, so that much is checked.
   */
  it("never claims T3 on one domain", () => {
    for (const entry of FITMENTS) {
      const domains = new Set(entry.sources.map(sourceLabel));
      if (entry.basis === "T3") expect(domains.size, entry.part).toBeGreaterThan(1);
      expect(entry.sources.length, entry.part).toBeGreaterThan(0);
    }
  });

  it("labels a source by its domain, which is what the tier turns on", () => {
    expect(sourceLabel("https://www.romacparts.com/1u3352-teeth.html")).toBe("romacparts.com");
    expect(sourceLabel("https://parts.cat.com/en/catcorp/1u3352")).toBe("parts.cat.com");
    // Never throws on something that is not a URL; the page still has a link to render.
    expect(sourceLabel("not a url")).toBe("not a url");
  });

  it("groups 52 machines under the three headings", () => {
    const only = FITMENTS[0]!;
    expect(only.machines.map((group) => group.heading)).toEqual([
      "Excavators",
      "Wheel loaders",
      "Track loaders and other",
    ]);
    expect(only.machines.map((group) => group.machines.length)).toEqual([30, 15, 7]);
    expect(machineCount(only)).toBe(52);
    expect(only.machines[0]!.machines).toContain("321D LCR");
    expect(only.machines[2]!.machines).toContain("M322C");
  });

  it("matches a part key exactly, and never near enough", () => {
    expect(findFitment("1U-3352")).toBeDefined();
    // A suffixed variant is a different part until somebody checks that it is not.
    expect(findFitment("1U-3352RC")).toBeUndefined();
    expect(findFitment("1U3352")).toBeUndefined();
    expect(findFitment("40/300893")).toBeUndefined();
  });
});

describe("a part with an entry", () => {
  it("lists the machines inside Check this part, with the count in the summary", async () => {
    const html = await page("1u3352");
    expect(html).toContain("<summary>Check this part</summary>");
    const fitment = block(html);
    expect(fitment).toContain("<summary>Commonly fitted to (52 machines)</summary>");
    expect(fitment).toContain("<h4>Excavators</h4>");
    expect(fitment).toContain("<h4>Wheel loaders</h4>");
    expect(fitment).toContain("<h4>Track loaders and other</h4>");
    expect(fitment).toContain("320D2");
    expect(fitment).toContain("966K");
    expect(fitment).toContain("633E");
    // Inside the check block, not loose on the card.
    expect(html.indexOf('<details class="check">')).toBeLessThan(html.indexOf('<details class="fitment">'));
  });

  it("says what the list is, where it came from, and when it was read", async () => {
    const fitment = block(await page("1u3352"));
    expect(fitment).toContain(
      "Compiled from aftermarket seller listings, not Caterpillar&#39;s own catalogue.",
    );
    expect(fitment).toContain("Lists vary between sellers.");
    expect(fitment).toContain('href="https://www.romacparts.com/1u3352-teeth.html" rel="noopener"');
    // Every source is a link, labelled by its domain, under a singular or plural label.
    expect(fitment).toContain("Source: <a class=\"link inline\"");
    expect(fitment).toContain(">romacparts.com ");
    expect(fitment).toContain("checked 2026-09-18.");
    // The note is muted, and it is one line under the list rather than a heading above it.
    expect(fitment).toContain('<p class="fitnote">');
    expect(fitment.indexOf("<h4>")).toBeLessThan(fitment.indexOf('class="fitnote"'));
  });
});

describe("a part with no entry", () => {
  it("renders nothing extra at all, rather than guessing", async () => {
    const html = await page("40/300893");
    expect(html).toContain("<summary>Check this part</summary>");
    expect(html).not.toContain("Commonly fitted to");
    expect(html).not.toContain('class="fitment"');
    expect(html).not.toContain("romacparts");
    expect(block(html)).toBe("");
  });

  it("does not carry the entry across to a suffixed variant of the same number", async () => {
    const html = await page("1u3352rc");
    expect(html).toContain("1U-3352");
    expect(html).not.toContain("Commonly fitted to");
  });
});
