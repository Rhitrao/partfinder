// The committed sample page must be what the page renders today. No network.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SAMPLE_FILE, SAMPLE_NONCE, SAMPLE_QUERY, renderSample } from "../scripts/sample";

describe("docs/sample-page.html", () => {
  it("matches what the page renders now", async () => {
    const committed = readFileSync(SAMPLE_FILE, "utf8");
    expect(
      committed,
      `${SAMPLE_FILE} is out of date. Run \`npm run sample\` and commit the result.`,
    ).toBe(await renderSample());
  });

  it("is the page for a query with two numbers and a hint", () => {
    expect(SAMPLE_QUERY).toContain("1u3352");
    expect(SAMPLE_QUERY).toContain("40/300893");
  });

  it("is a whole response, with the Suppliers section and a fixed nonce", async () => {
    const html = await renderSample();
    expect(html).toContain("<h2>Suppliers near Bengaluru</h2>");
    expect(html).toContain('id="pf-turnstile"');
    expect(html).toContain(`nonce="${SAMPLE_NONCE}"`);
    expect(html).not.toMatch(/nonce="(?!sample-nonce)/);
  });
});
