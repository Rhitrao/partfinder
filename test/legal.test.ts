// Step 5b: the Terms and Privacy pages Google's Places API policies require, and the footer that
// makes them reachable from everywhere. The handler is called in-process; no network.

import { describe, expect, it } from "vitest";
import worker from "../src/index";
import {
  CLOUDFLARE_PRIVACY_URL,
  GOOGLE_MAPS_TERMS_URL,
  GOOGLE_PRIVACY_URL,
  TURNSTILE_PRIVACY_URL,
} from "../src/legal";

const env = { GOOGLE_PLACES_KEY: "not-a-real-key", TURNSTILE_SITE_KEY: "not-a-real-site-key" };

const get = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://rohitrao.in${path}`, init), env);

const hrefs = (html: string) =>
  [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!.replaceAll("&amp;", "&"));

/** Just the footer element. */
const footer = (html: string) => html.match(/<footer class="footer">[\s\S]*?<\/footer>/)?.[0];

describe("GET /parts/terms and /parts/privacy", () => {
  it("both answer 200 as HTML, noindex, with the site's security headers", async () => {
    for (const path of ["/parts/terms", "/parts/privacy"]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("Content-Type"), path).toBe("text/html; charset=utf-8");
      expect(res.headers.get("X-Robots-Tag"), path).toBe("noindex");
      expect(res.headers.get("Referrer-Policy"), path).toBe("no-referrer");
      expect(res.headers.get("Content-Security-Policy"), path).toContain("default-src 'none'");
      const html = await res.text();
      expect(html, path).toContain('<meta name="robots" content="noindex">');
    }
  });

  it("carry no form at all, so there is nothing on them to submit", async () => {
    for (const path of ["/parts/terms", "/parts/privacy"]) {
      const html = await (await get(path)).text();
      expect(html, path).not.toContain("<form");
      expect(html, path).not.toContain("<input");
    }
  });

  it("incorporates Google's terms on the terms page", async () => {
    const html = await (await get("/parts/terms")).text();
    expect(GOOGLE_MAPS_TERMS_URL).toBe("https://maps.google.com/help/terms_maps/");
    expect(hrefs(html)).toContain(GOOGLE_MAPS_TERMS_URL);
    expect(html).toContain("Google Maps / Google Earth Additional Terms of");
  });

  it("references the Turnstile Privacy Addendum, as invisible mode requires", async () => {
    const html = await (await get("/parts/privacy")).text();
    expect(TURNSTILE_PRIVACY_URL).toBe("https://www.cloudflare.com/turnstile-privacy-policy/");
    expect(hrefs(html)).toContain(TURNSTILE_PRIVACY_URL);
    // The link text is the addendum's name, so it is findable by what it is called.
    expect(html).toContain(`<a href="${TURNSTILE_PRIVACY_URL}">Turnstile Privacy Addendum</a>`);
    // Beside Cloudflare's general policy, not instead of it, and in the Turnstile paragraph.
    expect(hrefs(html)).toContain(CLOUDFLARE_PRIVACY_URL);
    const turnstile = html.slice(html.indexOf("<h2>Turnstile</h2>"), html.indexOf("<h2>Your location</h2>"));
    expect(turnstile).toContain(TURNSTILE_PRIVACY_URL);
  });

  it("incorporates Google's privacy policy on the privacy page", async () => {
    const html = await (await get("/parts/privacy")).text();
    expect(GOOGLE_PRIVACY_URL).toBe("https://policies.google.com/privacy");
    expect(hrefs(html)).toContain(GOOGLE_PRIVACY_URL);
    // The three things the page has to be straight about.
    expect(html).toContain("Workers Logs are turned off");
    expect(html).toContain("place IDs");
    expect(html).toContain("WhatsApp link");
  });

  it("says what Turnstile does, and links Cloudflare's policy", async () => {
    const html = await (await get("/parts/privacy")).text();
    expect(CLOUDFLARE_PRIVACY_URL).toBe("https://www.cloudflare.com/privacypolicy/");
    expect(hrefs(html)).toContain(CLOUDFLARE_PRIVACY_URL);
    expect(html).toContain(
      "To keep bots from using the supplier search, Cloudflare Turnstile checks the browser",
    );
  });

  it("says what a supplier search sends to Google", async () => {
    const html = await (await get("/parts/privacy")).text();
    expect(html).toContain(
      "Supplier searches send the brands, the city, and your rounded location if you share it",
    );
  });

  it("no longer claims a passcode cookie, or that no script runs", async () => {
    const html = await (await get("/parts/privacy")).text();
    expect(html).not.toContain("pf_vendor");
    expect(html).not.toContain("passcode");
    expect(html).not.toContain("runs no JavaScript at all");
  });

  it("rejects anything but GET", async () => {
    for (const path of ["/parts/terms", "/parts/privacy"]) {
      const res = await get(path, { method: "POST" });
      expect(res.status, path).toBe(405);
      expect(res.headers.get("Allow"), path).toBe("GET");
    }
  });
});

describe("the footer", () => {
  it("links both pages from the public page", async () => {
    const html = await (await get("/parts/?q=1u3352")).text();
    expect(footer(html)).toContain('href="/parts/terms"');
    expect(footer(html)).toContain('href="/parts/privacy"');
  });

  it("links both pages from the pages themselves", async () => {
    for (const path of ["/parts/terms", "/parts/privacy"]) {
      const html = await (await get(path)).text();
      expect(footer(html), path).toContain('href="/parts/terms"');
      expect(footer(html), path).toContain('href="/parts/privacy"');
    }
  });
});

describe("what the privacy page has to say since the cards", () => {
  it("names the two cookies that are left, the rounded location and what the map sends", async () => {
    const html = await (await get("/parts/privacy")).text();
    expect(html).toContain("pf_city");
    expect(html).toContain("pf_country");
    expect(html).toContain("only what you typed or picked");
    expect(html).toContain("rounded to about a hundred metres");
    expect(html).toContain("It is not stored");
    expect(html).toContain("the map is loaded from Google");
    expect(html).toContain("never the page's query string");
  });
});
