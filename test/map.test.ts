// The helpers behind the map pins and the script's JSON block.
//
// The page itself no longer renders either: since step 7 the supplier cards, the pins and the
// queue come from POST /parts/api/suppliers. What is left here is the pure functions.

import { describe, expect, it } from "vitest";
import { jsonForScript, pinsFor } from "../src/vendors/suppliers";

describe("pin helpers", () => {
  it("numbers pins as the list numbers rows, skipping shops with no location", () => {
    const supplier = (id: string, located: boolean) => ({
      place: {
        id,
        name: id,
        address: "",
        shortAddress: "",
        mapsUri: "",
        location: located ? { lat: 1, lng: 2 } : null,
        internationalPhone: "",
        nationalPhone: "",
        website: "",
        rating: null,
        ratingCount: null,
        openNow: null,
      },
      matchedGroups: [],
      matchedParts: [],
      multiBrandOnly: true,
      distanceKm: null,
    });
    // The second shop has no coordinates, so it has a row but no pin - and the third keeps the
    // number its row shows.
    expect(pinsFor([supplier("a", true), supplier("b", false), supplier("c", true)])).toEqual([
      { n: 1, name: "a", lat: 1, lng: 2 },
      { n: 3, name: "c", lat: 1, lng: 2 },
    ]);
  });

  it("escapes the characters that could end a script block", () => {
    expect(jsonForScript({ a: "<>&" })).toBe('{"a":"\\u003c\\u003e\\u0026"}');
    expect(jsonForScript("  ")).toBe('"\\u2028\\u2029"');
  });
});
