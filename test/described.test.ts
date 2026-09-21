// Step 9: what a message is read as - a number, a description, or a number nobody could place.
//
// No network. Every fixture is a public part number or a plain English enquiry.

import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { STOPWORDS } from "../src/words";
import {
  describedPart,
  descriptiveWords,
  looksLikePartNumber,
  parse,
} from "../src/parse";
import { outbound, partKey, readQuery } from "../src/page";

const page = async (q: string) =>
  (await worker.fetch(new Request(`https://rohitrao.in/parts/?q=${encodeURIComponent(q)}`), {})).text();

const titles = (html: string) =>
  [...html.matchAll(/<p class="number(?: plain)?">([^<]*)<\/p>/g)].map((m) => m[1]!);

/** The prepared message, not the paste box. */
const message = (html: string) =>
  (html.match(/<textarea id="message"[^>]*>([\s\S]*?)<\/textarea>/)?.[1] ?? "")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");

/** The query behind the link whose visible label is exactly this. */
function queryBehind(html: string, label: string): string {
  const mark = `(?: <span class="ext"[^>]*>[^<]*</span>)?`;
  const href = new RegExp(`href="([^"]*)"[^>]*>${label}${mark}<`).exec(html)![1]!;
  return new URL(href.replaceAll("&amp;", "&")).searchParams.get("q")!;
}

describe("a number with words around it", () => {
  it("reads 24370-2E000 as Hyundai / Kia or Toyota, and keeps CVVT", async () => {
    const { results } = readQuery("24370-2E000 CVVT", "");
    expect(results).toHaveLength(1);
    const only = results[0]!;
    expect([...new Set(only.candidates.map((c) => c.oem))]).toEqual(["Hyundai / Kia", "Toyota"]);
    expect(only.words).toEqual(["cvvt"]);
    expect(outbound(results)).toHaveLength(1);

    const html = await page("24370-2E000 CVVT");
    expect(titles(html)).toEqual(["24370-2E000"]);
    // Ambiguity is reported, not resolved: one chip per manufacturer, each re-running the query.
    expect(html).toContain("Hyundai / Kia or Toyota?");
    expect(html).toContain(">Hyundai / Kia<");
    expect(html).toContain(">Toyota<");
  });
});

describe("a part described rather than numbered", () => {
  it("builds one described part from a machine word and a name", async () => {
    const described = describedPart("ex200 pin pivot");
    expect(described).toEqual({
      machine: "EX200",
      brands: ["Hitachi", "Tata Hitachi"],
      name: "pin pivot",
    });

    const html = await page("ex200 pin pivot");
    expect(titles(html)).toEqual(["pin pivot"]);
    expect(html).toContain("for EX200 &middot; Hitachi or Tata Hitachi");
    expect(queryBehind(html, "Search Google")).toBe("EX200 pin pivot");
    expect(queryBehind(html, "See images")).toBe("EX200 pin pivot");
    // No number card, and nothing claiming a format match.
    expect(html).not.toContain("format match");
  });

  it("keys it by what it is, since it has no number to be keyed by", () => {
    const { results } = readQuery("ex200 pin pivot", "");
    expect(partKey(results[0]!)).toBe("desc:EX200:pin pivot");
  });

  it("reads the quantity written around the machine word", async () => {
    const { results, quantities } = readQuery("need 2 nos ex200 pin pivot urgent", "");
    expect(results).toHaveLength(1);
    expect(results[0]!.described!.name).toBe("pin pivot");
    expect(quantities["desc:EX200:pin pivot"]).toBe(2);

    const html = await page("need 2 nos ex200 pin pivot urgent");
    expect(html).toContain("Qty 2 from message");
    expect(message(html)).toContain("1. Pin pivot for EX200 (Hitachi or Tata Hitachi), qty 2");
  });

  it("builds none when the message already names a number", async () => {
    expect(describedPart("1u3352 ex200")).toBeNull();
    const html = await page("1u3352 ex200");
    expect(titles(html)).toEqual(["1U-3352"]);
    expect(html).not.toContain("class=\"maker described\"");
    // EX200 still does its old job: it hints, and hints re-rank.
    expect(readQuery("1u3352 ex200", "").hints).toContain("Hitachi");
  });

  it("builds none from a machine word alone", () => {
    expect(describedPart("ex200")).toBeNull();
    expect(describedPart("please send urgently")).toBeNull();
  });
});

describe("a customer's name and number", () => {
  const PASTED = "Ramesh 9876543210 ex200 pivot pin Rs 4500";

  it("reads the part and drops the person", () => {
    expect(descriptiveWords(PASTED)).toEqual(["pivot", "pin"]);
    expect(describedPart(PASTED)!.name).toBe("pivot pin");
  });

  it("keeps the phone number and the price out of the cards, the message and the back-link", async () => {
    const html = await page(PASTED);
    expect(titles(html)).toEqual(["pivot pin"]);
    const outgoing = message(html);
    expect(outgoing).toContain("Pivot pin for EX200");
    for (const secret of ["9876543210", "4500", "Ramesh", "Rs"]) {
      expect(outgoing, secret).not.toContain(secret);
    }
    // The back-link is inside that message, so it is covered by the loop above; named here too
    // because it is the one that travels to a third party's phone.
    const back = /Details: (\S+)/.exec(outgoing)![1]!;
    expect(decodeURIComponent(new URL(back).searchParams.get("q")!)).toBe("EX200 pivot pin");
  });
});

describe("a number no rule places", () => {
  it("is a card, and it is sendable", async () => {
    expect(looksLikePartNumber("9ZZ123456")).toBe(true);
    expect(parse("9ZZ123456").unplaced).toBe(true);

    const html = await page("9ZZ123456 needed");
    expect(titles(html)).toEqual(["9ZZ123456"]);
    expect(html).toContain("Manufacturer not recognised");
    expect(html).not.toContain("Not recognised: 9ZZ123456");
    expect(message(html)).toContain("1. 9ZZ123456");
    // Nothing is claimed about it.
    expect(message(html)).not.toContain("likely");
  });

  it("carries the words the message had around it into the message", async () => {
    const html = await page("9ZZ123456 CVVT sensor");
    expect(message(html)).toContain("1. 9ZZ123456 (CVVT SENSOR)");
  });

  it("keeps the three link-outs every other card has", async () => {
    const html = await page("9ZZ123456");
    for (const label of ["See images", "Which machines it fits", "Search Google"]) {
      expect(html, label).toContain(`>${label} `);
    }
  });

  it("leaves bare digits and short tokens to the line, as before", async () => {
    expect(looksLikePartNumber("12345")).toBe(false);
    expect(looksLikePartNumber("2437020")).toBe(false);
    expect(looksLikePartNumber("9876543210")).toBe(false);
    const html = await page("12345");
    expect(html).toContain("Not recognised: 12345");
    expect(titles(html)).toEqual([]);
  });
});

describe("the stopword list", () => {
  it("is exactly the words the step named, with no duplicates", () => {
    expect(new Set(STOPWORDS).size).toBe(STOPWORDS.length);
    for (const word of ["need", "pls", "nos", "qty", "sir", "bhai", "kindly", "that"]) {
      expect(STOPWORDS, word).toContain(word);
    }
    // Words a part is called must never be on it.
    for (const word of ["pin", "pivot", "seal", "bearing", "filter", "bush", "ring"]) {
      expect(STOPWORDS, word).not.toContain(word);
    }
  });

  it("caps a name at five words", () => {
    const long = "ex200 one two three four five six seven";
    expect(describedPart(long)!.name.split(" ")).toHaveLength(5);
  });
});
