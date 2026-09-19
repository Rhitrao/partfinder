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
});

describe("step 1b: typed separators and tighter rules", () => {
  const ignores = "ignores the separators you typed";

  it("320-0677: Caterpillar first, JCB from jcb-dash below it", () => {
    const { candidates } = parse("320-0677");
    expect(candidates[0]).toMatchObject({ oem: "Caterpillar", canonical: "320-0677" });
    const jcb = candidates.findIndex((c) => c.oem === "JCB");
    expect(jcb).toBeGreaterThan(0);
    expect(candidates[jcb]).toMatchObject({ ruleId: "jcb-dash", canonical: "320/0677" });
    const hitachi = candidates[candidates.length - 1];
    expect(hitachi).toMatchObject({ oem: "Hitachi", canonical: "3200677" });
    expect(hitachi?.warnings).toContain(ignores);
  });

  it("40/300893: one candidate, JCB 40/300893, distinctive", () => {
    const { candidates } = parse("40/300893");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      oem: "JCB",
      canonical: "40/300893",
      strength: "distinctive",
    });
  });

  it("403008930: JCB 403/008930 only, no 7-character body", () => {
    const { candidates } = parse("403008930");
    expect(candidates.map((c) => [c.oem, c.canonical])).toEqual([["JCB", "403/008930"]]);
  });

  it("205-70-19570: no 2057-01-9570 candidate", () => {
    const { candidates } = parse("205-70-19570");
    expect(candidates.map((c) => c.canonical)).not.toContain("2057-01-9570");
    expect(candidates[0]).toMatchObject({ oem: "Komatsu", canonical: "205-70-19570" });
  });

  it("TD02217/1: Tata Hitachi TD02217/1, no typo candidate", () => {
    const { candidates } = parse("TD02217/1");
    expect(candidates.map((c) => [c.oem, c.canonical])).toEqual([["Tata Hitachi", "TD02217/1"]]);
  });

  it("40/3008TL: JCB 40/3008TL only, no suffix split", () => {
    const { candidates } = parse("40/3008TL");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ oem: "JCB", canonical: "40/3008TL" });
    expect(candidates[0]?.suffix).toBeUndefined();
  });

  it("1U3352WTL: Caterpillar 1U-3352, suffix WTL, meaning unconfirmed", () => {
    const c = first("1U3352WTL");
    expect(c).toMatchObject({ oem: "Caterpillar", canonical: "1U-3352", suffix: "WTL" });
    expect(c.warnings).toContain("suffix meaning unconfirmed");
  });
});

describe("step 1c: hint-gated rules", () => {
  it("40300893 with a Volvo hint also gives Volvo CE 40300893", () => {
    const text = "40300893 volvo";
    const hints = extractHints(text);
    expect(hints).toEqual(["Volvo CE"]);
    const [token] = extractTokens(text);
    const { candidates } = parse(token ?? "", hints);
    expect(candidates.map((c) => [c.oem, c.canonical])).toContainEqual(["Volvo CE", "40300893"]);
    expect(candidates.some((c) => c.oem === "JCB")).toBe(true);
  });
});

describe("step 1c: machine model words are hints", () => {
  it.each([
    ["PC200-8", "Komatsu"],
    ["EX200LC", "Hitachi"],
    ["SK210LC-8", "Kobelco"],
    ["3CX", "JCB"],
  ])("%s yields a hint and no token", (text, hint) => {
    expect(extractHints(text)).toContain(hint);
    expect(extractTokens(text)).toEqual([]);
  });

  it("need 205-70-19570 for PC200-8: one token, hint Komatsu", () => {
    const msg = "need 205-70-19570 for PC200-8";
    expect(extractTokens(msg)).toEqual(["205-70-19570"]);
    expect(extractHints(msg)).toEqual(["Komatsu"]);
  });

  it("hints come back in the order they first appear in the text", () => {
    expect(extractHints("JCB 3200677 hitachi")).toEqual(["JCB", "Hitachi", "Tata Hitachi"]);
  });
});

describe("normalisation", () => {
  it("keeps the original input and the compact form", () => {
    const r = parse("1u-3352rc");
    expect(r.input).toBe("1u-3352rc");
    expect(r.compact).toBe("1U3352RC");
    expect(r.candidates[0]?.base).toBe("1U3352");
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

describe("step 1b: tokens and hints", () => {
  it("VOE 14589129 merges into one Volvo CE token, distinctive", () => {
    expect(extractTokens("VOE 14589129")).toEqual(["VOE14589129"]);
    const c = first("VOE14589129");
    expect(c).toMatchObject({ oem: "Volvo CE", canonical: "VOE14589129", strength: "distinctive" });
  });

  it("a hint word is a hint only, never a part-number token", () => {
    const msg = "for PC200 need 205-70-19570";
    expect(extractTokens(msg)).toEqual(["205-70-19570"]);
    expect(extractHints(msg)).toEqual(["Komatsu"]);
  });

  it("TATA HITACHI consumes HITACHI, so only Tata Hitachi is hinted", () => {
    expect(extractHints("TATA HITACHI TD02217")).toEqual(["Tata Hitachi"]);
  });

  it("tokens are deduplicated by compact form, keeping the first spelling", () => {
    expect(extractTokens("1u3352 and 1U-3352")).toEqual(["1U3352"]);
  });
});

describe("compact", () => {
  it("removes spaces, dashes, dots, slashes and backslashes", () => {
    expect(compact("40 / 300.893-A\\B")).toBe("40300893AB");
  });
});

describe("step 2c: phone-shaped numbers are still tokens", () => {
  it("keeps a bare run that could be a phone number or a part number", () => {
    expect(extractTokens("Ramesh 9876543210 needs 1u3352")).toEqual(["9876543210", "1U3352"]);
  });

  it("reads a bare Komatsu number that is shaped like a phone number", () => {
    expect(extractTokens("6754611102")).toEqual(["6754611102"]);
    expect(first("6754611102").oem).toBe("Komatsu");
  });

  it("keeps a 10-digit number the user typed with separators", () => {
    expect(extractTokens("205-70-19570")).toEqual(["205-70-19570"]);
    expect(first("205-70-19570").oem).toBe("Komatsu");
  });

  it("reads 6754-61-1102 as Komatsu", () => {
    expect(first("6754-61-1102")).toMatchObject({ oem: "Komatsu", canonical: "6754-61-1102" });
  });
});

describe("step 2c: a number after a currency marker is a price", () => {
  it("drops the price and keeps the part number", () => {
    expect(extractTokens("price ₹45,000 for 40/300893")).toEqual(["40/300893"]);
    expect(extractTokens("Rs. 125000 40/300893")).toEqual(["40/300893"]);
    expect(extractTokens("US$1,299.00 1u3352")).toEqual(["1U3352"]);
  });

  it("covers the markers of every country in the list", () => {
    for (const marker of ["Rs", "INR", "₹", "AED", "SAR", "KES", "KSh", "NGN", "₦", "ZAR", "USD"]) {
      expect(extractTokens(`${marker} 45000 1u3352`)).toEqual(["1U3352"]);
      expect(extractTokens(`${marker}45000 1u3352`)).toEqual(["1U3352"]);
    }
  });

  it("does not read a marker out of the middle of a word", () => {
    expect(extractTokens("cars 45000 and 1u3352")).toEqual(["45000", "1U3352"]);
  });
});
