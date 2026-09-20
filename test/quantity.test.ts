// Quantities read out of a pasted message. Pure functions, no network.

import { describe, expect, it } from "vitest";
import { quantityFor } from "../src/quantity";

const qty = (text: string, token = "1u3352") => quantityFor(text, token);

describe("quantities the prompt names", () => {
  it("reads a count before the number", () => {
    expect(qty("need 2 nos 1u3352 urgent")).toBe(2);
    expect(qty("4 pcs of 1u3352")).toBe(4);
    expect(qty("qty 4 1u3352")).toBe(4);
    expect(qty("QTY: 12 1u3352")).toBe(12);
  });

  it("reads a count after the number", () => {
    expect(qty("1u3352 x2")).toBe(2);
    expect(qty("1u3352 X 3")).toBe(3);
    expect(qty("1u3352 - 2 pcs")).toBe(2);
    expect(qty("1u3352 2 nos")).toBe(2);
    expect(qty("1u3352 1 unit")).toBe(1);
  });
});

describe("what is not a quantity", () => {
  it("leaves a bare number alone", () => {
    // The 2023 is a year, a price or anything else. Without a unit it is not a count.
    expect(qty("1u3352 2023")).toBe(null);
    expect(qty("1u3352 320")).toBe(null);
    expect(qty("need 2 1u3352")).toBe(null);
  });

  it("gives up when the message says two different things", () => {
    expect(qty("2 nos 1u3352 and later 1u3352 x5")).toBe(null);
  });

  it("keeps a quantity when the second mention simply carries none", () => {
    expect(qty("2 nos 1u3352, ship 1u3352 by Friday")).toBe(2);
  });

  it("refuses zero, and anything absurd", () => {
    expect(qty("0 nos 1u3352")).toBe(null);
    expect(qty("99999 nos 1u3352")).toBe(null);
  });

  it("does not read a neighbouring part's count", () => {
    expect(quantityFor("2 nos 1u3352 and 40/300893", "40/300893")).toBe(null);
    expect(quantityFor("2 nos 1u3352 and 40/300893 x1", "40/300893")).toBe(1);
  });

  it("does not match a number inside a longer one", () => {
    expect(quantityFor("x1 991u3352123", "1u3352")).toBe(null);
  });
});
