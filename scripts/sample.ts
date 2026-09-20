// Renders docs/sample-page.html: the page's exact output for one query, committed so the page can
// be read without deploying. Run it with `npm run sample`.
//
// It goes through the Worker itself rather than calling the renderer, so the committed file is a
// real response - the Suppliers section, the placeholders, the Turnstile container and the script
// included - and not a hand-assembled approximation of one. The per-response nonce is the only
// thing replaced, with a fixed string, so the file is stable from run to run.
//
// test/sample.test.ts fails when the committed file no longer matches what the page renders, so
// this script and that test must always agree on the query below.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import worker from "../src/index";

export const SAMPLE_QUERY = "need 1u3352 and 40/300893 for JCB 3CX";
export const SAMPLE_FILE = "docs/sample-page.html";

/** What the nonce becomes in the committed file. A real one is random on every response. */
export const SAMPLE_NONCE = "sample-nonce";

/**
 * Placeholder keys, both of them public by design. GOOGLE_PLACES_KEY and TURNSTILE_SECRET_KEY are
 * deliberately absent: the page render never uses either, and the sample proves it.
 */
const SAMPLE_ENV = {
  GOOGLE_MAPS_BROWSER_KEY: "sample-maps-browser-key",
  TURNSTILE_SITE_KEY: "sample-turnstile-site-key",
};

/** A city, a supplier's number and a note, so the sample shows the whole flow, not just cards. */
export async function renderSample(): Promise<string> {
  const params = new URLSearchParams({
    q: SAMPLE_QUERY,
    city: "Bengaluru",
    country: "IN",
    to: "98765 43210",
    note: "Qty 4",
  });
  const response = await worker.fetch(
    new Request(`https://rohitrao.in/parts/?${params.toString()}`),
    SAMPLE_ENV,
  );
  const html = await response.text();
  const nonce = /nonce-([^']+)'/.exec(response.headers.get("Content-Security-Policy") ?? "")?.[1];
  return nonce === undefined ? html : html.replaceAll(nonce, SAMPLE_NONCE);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  mkdirSync(dirname(SAMPLE_FILE), { recursive: true });
  writeFileSync(SAMPLE_FILE, await renderSample());
  process.stdout.write(`wrote ${SAMPLE_FILE}\n`);
}
