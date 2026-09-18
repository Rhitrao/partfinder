// Acceptance tests for step 1. Public part numbers only; no network.

import { describe, expect, it } from "vitest";
import { compact, extractHints, extractTokens, parse } from "../src/parse";

const first = (token: string, hints?: string[]) => {
  const c = parse(token, hints).candidates[0];
  if (!c) throw new Error(`no candidate for ${token}`);
  return c;
};

describe("parse", () => {
  it("1. 1u3352 is Caterpillar 1U-3352, distinctive, T5", () => {
    const c = first("1u3352");
    expect(c.oem).toBe("Caterpillar");
    expect(c.canonical).toBe("1U-3352");
    expect(c.strength).toBe("distinctive");
    expect(c.basis).toBe("T5");
    expect(c.alternates).toContain("1U3352");
  });

  it("2. 205-70-19570RC is Komatsu 205-70-19570 with suffix RC", () => {
    const c = first("205-70-19570RC");
    expect(c.oem).toBe("Komatsu");
    expect(c.canonical).toBe("205-70-19570");
    expect(c.suffix).toBe("RC");
  });

  it("3. 1U-3352RC is Caterpillar 1U-3352 with suffix RC", () => {
    const c = first("1U-3352RC");
    expect(c.oem).toBe("Caterpillar");
    expect(c.canonical).toBe("1U-3352");
    expect(c.suffix).toBe("RC");
  });

  it("4. 40/300893 is JCB 40/300893 with backslash, dash and bare alternates", () => {
    const c = first("40/300893");
    expect(c.oem).toBe("JCB");
    expect(c.canonical).toBe("40/300893");
    expect(c.alternates).toEqual(expect.arrayContaining(["40\\300893", "40-300893", "40300893"]));
  });

  it("5. 40300893 gives two JCB candidates, each flagged prefix-ambiguous", () => {
    const { candidates } = parse("40300893");
    expect(candidates.map((c) => [c.oem, c.canonical])).toEqual([
      ["JCB", "40/300893"],
      ["JCB", "403/00893"],
    ]);
    for (const c of candidates) expect(c.warnings).toContain("prefix length ambiguous");
  });

  it("6. YN32W01029P1 is Kobelco, canonical unchanged", () => {
    const c = first("YN32W01029P1");
    expect(c.oem).toBe("Kobelco");
    expect(c.canonical).toBe("YN32W01029P1");
  });

  it("7. TD02217 is Tata Hitachi with no warnings; TD022217 carries the typo warning", () => {
    const ok = first("TD02217");
    expect(ok.oem).toBe("Tata Hitachi");
    expect(ok.warnings).toEqual([]);

    const typo = first("TD022217");
    expect(typo.oem).toBe("Tata Hitachi");
    expect(typo.warnings).toContain("unusual length, possible typo");
  });

  describe("8. 3200677 is shared between Caterpillar and Hitachi", () => {
    const ambiguous = (w: string) => w.startsWith("ambiguous format");

    it("without a hint, both are present and each is flagged ambiguous", () => {
      const { candidates } = parse("3200677");
      const cat = candidates.find((c) => c.oem === "Caterpillar");
      const hitachi = candidates.find((c) => c.oem === "Hitachi");
      expect(cat?.canonical).toBe("320-0677");
      expect(hitachi?.canonical).toBe("3200677");
      expect(cat?.warnings.some(ambiguous)).toBe(true);
      expect(hitachi?.warnings.some(ambiguous)).toBe(true);
    });

    it("with the hint Hitachi, Hitachi ranks first and Caterpillar stays", () => {
      const { candidates } = parse("3200677", ["Hitachi"]);
      expect(candidates[0]?.oem).toBe("Hitachi");
      expect(candidates[0]?.hintMatched).toBe(true);
      expect(candidates.some((c) => c.oem === "Caterpillar")).toBe(true);
    });

    it("typed as 320-0677, Caterpillar ranks first", () => {
      const c = first("320-0677");
      expect(c.oem).toBe("Caterpillar");
      expect(c.canonical).toBe("320-0677");
    });
  });

  it("9. HELLO12 has no candidates and reason no_rule_matched", () => {
    const r = parse("HELLO12");
    expect(r.candidates).toEqual([]);
    expect(r.reason).toBe("no_rule_matched");
  });

  it("keeps the original input and the compact form", () => {
    const r = parse("1u-3352rc");
    expect(r.input).toBe("1u-3352rc");
    expect(r.compact).toBe("1U3352RC");
    expect(r.candidates[0]?.base).toBe("1U3352");
  });

  it("splits WTL rather than TL when the token ends in WTL", () => {
    const c = first("1U3352WTL");
    expect(c.canonical).toBe("1U-3352");
    expect(c.suffix).toBe("WTL");
  });
});

describe("10. extraction from a message", () => {
  const msg = "need 2 nos 1u3352 for CAT 320 urgent, also 40/300893";

  it("extractTokens returns exactly the part-number tokens", () => {
    expect(extractTokens(msg)).toEqual(["1U3352", "40/300893"]);
  });

  it("extractHints returns Caterpillar", () => {
    expect(extractHints(msg)).toEqual(["Caterpillar"]);
  });

  it("hints match whole words only", () => {
    expect(extractHints("category scattered")).toEqual([]);
    expect(extractHints("tata  hitachi ex200")).toEqual(["Tata Hitachi", "Hitachi"]);
  });
});

describe("compact", () => {
  it("removes spaces, dashes, dots, slashes and backslashes", () => {
    expect(compact("40 / 300.893-A\\B")).toBe("40300893AB");
  });
});
