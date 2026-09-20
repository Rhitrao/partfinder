// Renders docs/sample-page.html: the page's exact output for one query, committed so the page can
// be read without deploying. Run it with `npm run sample`.
//
// test/sample.test.ts fails when the committed file no longer matches what the page renders, so
// this script and that test must always agree on the query below.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { renderPage, resolveCountry } from "../src/page";

export const SAMPLE_QUERY = "need 1u3352 and 40/300893 for JCB 3CX";
export const SAMPLE_FILE = "docs/sample-page.html";

export function renderSample(): string {
  return renderPage({ q: SAMPLE_QUERY, hint: "", city: "", country: resolveCountry("IN") });
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  mkdirSync(dirname(SAMPLE_FILE), { recursive: true });
  writeFileSync(SAMPLE_FILE, renderSample());
  process.stdout.write(`wrote ${SAMPLE_FILE}\n`);
}
