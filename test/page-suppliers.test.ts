// Step 7: the Suppliers section as the server renders it, the script it ships, and the CSP that
// governs both.
//
// No network. Global fetch is stubbed in every test and asserted never to have been called:
// rendering /parts/ must reach neither Google nor Cloudflare, whoever is asking.

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { CLIENT_SCRIPT, TURNSTILE_SRC } from "../src/vendors/script";
import { NOT_CONFIGURED } from "../src/vendors/suppliers";
import { Q, SEARCH, env, get, searchReply, stubFetch, unescapeHtml } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

/** The nonce the response's CSP declares, from either directive. */
function cspNonce(res: Response, directive: "script-src" | "style-src"): string | undefined {
  const csp = res.headers.get("Content-Security-Policy") ?? "";
  return new RegExp(`${directive} 'nonce-([^']+)'`).exec(csp)?.[1];
}

/** The nonce on every tag that carries one, in document order. */
const tagNonces = (html: string) =>
  [...html.matchAll(/<(?:script|style)[^>]*\snonce="([^"]*)"/g)].map((m) => m[1]!);

/** Every script tag on the page, whether or not it carries a nonce. */
const scriptTags = (html: string) => [...html.matchAll(/<script[^>]*>/g)].map((m) => m[0]);

/** The inline script's body. */
const inlineScript = (html: string) =>
  html.match(/<script nonce="[^"]*">([\s\S]*?)<\/script>/)![1]!;

/** The #pf-data block: everything the script is told before it fetches anything. */
const pageData = (html: string) =>
  JSON.parse(html.match(/id="pf-data"[^>]*>([\s\S]*?)<\/script>/)![1]!) as {
    parts: string[];
    scope: string;
    text: Record<string, string>;
    timeoutMs: number;
  };

describe("a page with a city", () => {
  it("fetches nothing and promises a list instead", async () => {
    const calls = stubFetch(searchReply);
    const res = await get(`/parts/${SEARCH}`);
    const html = await res.text();
    expect(calls).toHaveLength(0);
    expect(html).toContain("<h2>Suppliers near Bengaluru</h2>");
    expect(html).toContain('<p class="status" id="pf-status" aria-live="polite">Finding suppliers');
    // Three grey placeholders, hidden from assistive technology because they say nothing.
    expect([...html.matchAll(/<li class="ghost">/g)]).toHaveLength(3);
    expect(html).toContain('id="pf-ghosts" aria-hidden="true"');
    expect(html).toContain('<div id="pf-list"></div>');
    expect(html).toContain('<div class="map" id="pf-map">');
  });

  it("carries the Turnstile container, with the site key and interaction-only", async () => {
    stubFetch(searchReply);
    const html = await (await get(`/parts/${SEARCH}`)).text();
    expect(html).toContain(`data-sitekey="${env.TURNSTILE_SITE_KEY}"`);
    expect(html).toContain('data-appearance="interaction-only"');
    expect(html).toContain('id="pf-turnstile"');
    expect(scriptTags(html).join("\n")).toContain(TURNSTILE_SRC.replaceAll("&", "&amp;"));
  });

  it("tells a browser with no JavaScript what to do, and links out for everyone", async () => {
    stubFetch(searchReply);
    const html = await (await get(`/parts/${SEARCH}`)).text();
    const noscript = html.slice(html.indexOf("<noscript>"), html.indexOf("</noscript>"));
    expect(noscript).toContain("Turn on JavaScript to see suppliers here.");
    expect(noscript).toContain("Caterpillar parts shops on Google Maps");
    expect(noscript).toContain("JCB parts shops on Google Maps");

    const details = html.slice(html.indexOf('<details class="elsewhere"'));
    expect(details).toContain("<summary>Search on Google instead</summary>");
    expect(details).toContain("Caterpillar parts shops on Google Maps");
    expect(details).toContain("Search suppliers on Google");
    // Always below the list.
    expect(html.indexOf('id="pf-list"')).toBeLessThan(html.indexOf('class="elsewhere"'));
  });

  it("offers a hidden Use my location button and the send block, server-rendered", async () => {
    stubFetch(searchReply);
    const html = await (await get(`/parts/${SEARCH}`)).text();
    expect(html).toContain('id="pf-locate-button" hidden>Use my location</button>');
    // "Other ways to send" still renders in full, with no supplier needed.
    const send = html.slice(html.indexOf('<details class="send"'));
    expect(send).toContain('<textarea id="message"');
    expect(send).toContain("mailto:");
    expect(send).toContain('name="to"');
    expect(send).toContain("Pick a contact in WhatsApp");
  });

  it("keeps Google's attribution around the list from the first byte", async () => {
    stubFetch(searchReply);
    const html = await (await get(`/parts/${SEARCH}`)).text();
    expect(html).toContain('<section class="gmaps" aria-label="Google Maps">');
    expect(html).toContain('<p class="attribution">Google Maps</p>');
    expect(html.indexOf('class="gmaps"')).toBeLessThan(html.indexOf('id="pf-list"'));
    expect(html.indexOf('id="pf-list"')).toBeLessThan(html.indexOf('class="attribution"'));
  });
});

describe("a page with no city", () => {
  it("searches all of India instead of asking for one", async () => {
    // Until step 9 an empty city stopped the page with "Add your city". There is a better
    // answer: search the whole country, which is what a buyer wants for a part nobody local has.
    const calls = stubFetch(searchReply);
    const res = await get(`/parts/?q=${encodeURIComponent(Q)}`);
    const html = await res.text();
    expect(calls).toHaveLength(0);
    expect(html).not.toContain("Add your city to see suppliers near you.");
    expect(html).toContain("<h2>Suppliers in India</h2>");
    expect(html).toContain("Finding suppliers");
    // One chip, because there is no city to be near.
    expect(html).toContain(">All India<");
    expect(html).not.toContain(">Near ");
    expect(res.headers.get("Content-Security-Policy")).toContain("nonce-");
  });

  it("does the same with no site key, because no token could be minted", async () => {
    const res = await worker.fetch(new Request(`https://rohitrao.in/parts/${SEARCH}`), {
      GOOGLE_PLACES_KEY: "k",
    });
    const html = await res.text();
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).not.toContain("Finding suppliers");
    expect(html).toContain("Caterpillar parts shops on Google Maps");
  });
});

describe("a page whose supplier search is not configured", () => {
  const withoutSiteKey = () => {
    const { TURNSTILE_SITE_KEY: _absent, ...rest } = env;
    return worker.fetch(new Request(`https://rohitrao.in/parts/${SEARCH}`), rest as never);
  };

  it("says so, in the section, above the link-outs it falls back to", async () => {
    const calls = stubFetch(searchReply);
    const html = unescapeHtml(await (await withoutSiteKey()).text());
    expect(calls).toHaveLength(0);
    // The heading is still there, and so is everything the page can still do.
    expect(html).toContain("<h2>Suppliers near Bengaluru</h2>");
    expect(html).toContain(NOT_CONFIGURED);
    expect(html).toContain("Caterpillar parts shops on Google Maps");
    expect(html).toContain("JCB parts shops on Google Maps");
    // The line comes before the link-outs, not after them.
    expect(html.indexOf(NOT_CONFIGURED)).toBeLessThan(html.indexOf("parts shops on Google Maps"));
  });

  it("promises nothing it cannot keep: no script, no widget, no status line", async () => {
    const res = await withoutSiteKey();
    const html = await res.text();
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).not.toContain("Finding suppliers");
    expect(html).not.toContain("pf-turnstile");
    expect(html).not.toContain("pf-ghosts");
    expect(res.headers.get("Content-Security-Policy")).not.toContain("nonce-");
  });

  it("tells the visitor nothing about which key that was", async () => {
    const html = unescapeHtml(await (await withoutSiteKey()).text());
    const start = html.indexOf('<section class="suppliers">');
    const section = html.slice(start, html.indexOf("</section>", start));
    expect(start).toBeGreaterThan(-1);
    expect(section).toContain(NOT_CONFIGURED);
    for (const word of ["TURNSTILE_SITE_KEY", "Turnstile", "site key", "key", "secret", "env"]) {
      expect(section, word).not.toContain(word);
    }
  });

  it("says it even with no city, because a missing city is no longer a blocker", async () => {
    const { TURNSTILE_SITE_KEY: _absent, ...rest } = env;
    const res = await worker.fetch(
      new Request(`https://rohitrao.in/parts/?q=${encodeURIComponent(Q)}`),
      rest as never,
    );
    const html = unescapeHtml(await res.text());
    expect(html).toContain(NOT_CONFIGURED);
    expect(html).not.toContain("Add your city to see suppliers near you.");
  });

  it("runs no script for a query with nothing recognised in it", async () => {
    const calls = stubFetch(searchReply);
    const html = await (await get("/parts/?q=hello%20there&city=Bengaluru")).text();
    expect(calls).toHaveLength(0);
    expect(html).not.toContain("Suppliers near");
    expect(html.toLowerCase()).not.toContain("<script");
  });
});

describe("the query from the step 7b report", () => {
  // The exact address that showed the symptom in production: one Caterpillar number, one city,
  // no country parameter. With every key set it has to be the live section, not the link-outs.
  const URL_AS_REPORTED = "/parts/?q=1u3352&city=Bengaluru";

  it("renders the section, the placeholders and the Turnstile container", async () => {
    const calls = stubFetch(searchReply);
    const res = await get(URL_AS_REPORTED);
    const html = await res.text();
    expect(calls).toHaveLength(0);
    expect(html).toContain("<h2>Suppliers near Bengaluru</h2>");
    expect(html).toContain("Finding suppliers");
    expect([...html.matchAll(/<li class="ghost">/g)]).toHaveLength(3);
    expect(html).toContain('<div id="pf-list"></div>');
    expect(html).toContain(`data-sitekey="${env.TURNSTILE_SITE_KEY}"`);
    expect(html).toContain('id="pf-turnstile"');
    expect(html).not.toContain(NOT_CONFIGURED);
    expect(html.toLowerCase()).toContain("<script");
    expect(res.headers.get("Content-Security-Policy")).toContain("nonce-");
  });

  it("and health agrees with it, key for key", async () => {
    const res = await worker.fetch(
      new Request("https://rohitrao.in/parts/api/health"),
      env as never,
    );
    const body = (await res.json()) as { render: { suppliersSectionWouldRender: boolean } };
    expect(body.render.suppliersSectionWouldRender).toBe(true);
  });
});

describe("the supplier page CSP", () => {
  it("nonces every tag, and lets Google and Cloudflare's challenge host through", async () => {
    stubFetch(searchReply);
    const res = await get(`/parts/${SEARCH}`);
    const html = await res.text();
    const nonce = cspNonce(res, "script-src")!;
    expect(nonce).toBeTruthy();
    expect(cspNonce(res, "style-src")).toBe(nonce);

    // Our <style>, the data block, the inline script, Turnstile's loader and Google's.
    const nonces = tagNonces(html);
    expect(nonces).toHaveLength(5);
    expect(new Set(nonces)).toEqual(new Set([nonce]));
    expect(scriptTags(html)).toHaveLength(4);
    for (const tag of scriptTags(html)) expect(tag, tag).toContain(`nonce="${nonce}"`);

    const csp = res.headers.get("Content-Security-Policy")!;
    expect(csp).toContain("frame-src *.google.com https://challenges.cloudflare.com");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("https://challenges.cloudflare.com data: blob:");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("manifest-src 'self'");
    // 'unsafe-inline' is ignored once a nonce is present, so it must not be relied on.
    expect(csp).not.toContain("'unsafe-inline'");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Permissions-Policy")).toBe("geolocation=(self)");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
  });

  it("uses a fresh nonce for every response", async () => {
    stubFetch(searchReply);
    const a = cspNonce(await get(`/parts/${SEARCH}`), "script-src")!;
    const b = cspNonce(await get(`/parts/${SEARCH}`), "script-src")!;
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

describe("the client script", () => {
  it("assigns HTML exactly once, to a template", async () => {
    stubFetch(searchReply);
    const script = inlineScript(await (await get(`/parts/${SEARCH}`)).text());
    const assignments = [...script.matchAll(/innerHTML/g)];
    expect(assignments).toHaveLength(1);
    expect(script).toContain('document.createElement("template")');
    expect(script).toContain("template.innerHTML = body.html;");
    expect(script).toContain("list.appendChild(template.content)");
  });

  it("posts to the endpoint and writes no message of its own", async () => {
    stubFetch(searchReply);
    const script = inlineScript(await (await get(`/parts/${SEARCH}`)).text());
    expect(script).toContain('fetch("/parts/api/suppliers"');
    expect(script).toContain("window.turnstile.render");
    expect(script).toContain("window.turnstile.reset");
    expect(script).toContain("textContent");
    expect(script).not.toContain("We have a requirement");
    expect(script).toContain("waMatched");
  });

  it("stores nothing at all", async () => {
    stubFetch(searchReply);
    const script = inlineScript(await (await get(`/parts/${SEARCH}`)).text());
    for (const forbidden of ["localStorage", "sessionStorage", "document.cookie", "indexedDB"]) {
      expect(script, forbidden).not.toContain(forbidden);
    }
  });

  it("carries every message the page can end up showing", async () => {
    stubFetch(searchReply);
    const html = await (await get(`/parts/${SEARCH}`)).text();
    // Since step 7c the constants ride in the data block and the ones the script builds itself
    // stay in the script, so the page as a whole is what has to carry them.
    const script = inlineScript(html);
    const block = pageData(html);
    expect(block.text.verify).toBe("Couldn't verify this browser.");
    expect(block.text.unavailable).toBe("Supplier list unavailable right now");
    expect(block.text.finding).toBe("Finding suppliers\u2026");
    expect(block.text.mapUnavailable).toBe("Map unavailable. The list below has everything.");
    expect(block.text.queueHint).toBe(
      "WhatsApp opens one chat at a time. Tap each supplier in turn.",
    );
    expect(block.timeoutMs).toBe(15000);
    expect(script).toContain("Couldn't find ");
    expect(script).toContain("Location off. Distances are from ");
    expect(script).toContain("suppliers found");
  });

  it("is told the part keys, the wording and the timeout, and nothing else", async () => {
    stubFetch(searchReply);
    const html = await (await get(`/parts/${SEARCH}`)).text();
    const block = pageData(html);
    expect(Object.keys(block).sort()).toEqual(["parts", "scope", "text", "timeoutMs"]);
    expect(block.scope).toBe("near");
    expect(block.parts).toEqual(["1U-3352", "40/300893"]);
    // Still nothing the user typed: not the query, not the city, not a note or a number.
    const json = JSON.stringify(block);
    for (const typed of ["Bengaluru", "1u3352", "need ", "98765"]) {
      expect(json, typed).not.toContain(typed);
    }
  });

  it("emits the script itself byte for byte, with nothing substituted into it", async () => {
    stubFetch(searchReply);
    const script = inlineScript(await (await get(`/parts/${SEARCH}`)).text());
    // The invariant that replaces the old placeholder substitution: there is nothing left to
    // get wrong, because the body the browser runs is the constant in src/vendors/script.ts.
    expect(script).toBe(CLIENT_SCRIPT);
  });

  it("parses as JavaScript", async () => {
    stubFetch(searchReply);
    const script = inlineScript(await (await get(`/parts/${SEARCH}`)).text());
    expect(() => new Function(script)).not.toThrow();
  });
});

describe("the browser key", () => {
  it("rides in the Maps script URL and nowhere else", async () => {
    stubFetch(searchReply);
    const html = await (await get(`/parts/${SEARCH}`)).text();
    const key = env.GOOGLE_MAPS_BROWSER_KEY;
    const appearances = [...html.matchAll(new RegExp(key, "g"))];
    expect(appearances).toHaveLength(1);
    const line = html.slice(0, appearances[0]!.index).split("\n").pop()!;
    expect(line).toContain("https://maps.googleapis.com/maps/api/js");
  });

  it("is simply absent when it is not set, and the rest of the script still runs", async () => {
    const res = await worker.fetch(new Request(`https://rohitrao.in/parts/${SEARCH}`), {
      GOOGLE_PLACES_KEY: "k",
      TURNSTILE_SITE_KEY: "site",
      TURNSTILE_SECRET_KEY: "secret",
    });
    const html = await res.text();
    expect(html).not.toContain("maps.googleapis.com");
    expect(html).not.toContain('id="pf-map"');
    expect(html).toContain('id="pf-data"');
    expect(html).toContain("challenges.cloudflare.com");
  });
});
