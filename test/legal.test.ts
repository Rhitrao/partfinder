// Step 5b: the Terms and Privacy pages Google's Places API policies require, and the footer that
// makes them reachable from everywhere. The handler is called in-process; no network.

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { GOOGLE_MAPS_TERMS_URL, GOOGLE_PRIVACY_URL } from "../src/legal";
import { vendorToken } from "../src/vendors/auth";

const PASSCODE = "step-five-b-passcode";
const env = { VENDOR_PASSCODE: PASSCODE, GOOGLE_PLACES_KEY: "not-a-real-key" };

const get = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://rohitrao.in${path}`, init), env);

const hrefs = (html: string) =>
  [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!.replaceAll("&amp;", "&"));

/** Just the footer element. */
const footer = (html: string) => html.match(/<footer class="footer">[\s\S]*?<\/footer>/)?.[0];

/** One shop, enough for the footer and attribution checks. */
const SHOP = JSON.stringify({
  places: [
    {
      id: "a",
      displayName: { text: "A Shop" },
      formattedAddress: "A Shop, Bengaluru",
      location: { latitude: 12.97, longitude: 77.59 },
      googleMapsUri: "https://maps.google.com/?cid=a",
    },
  ],
});

afterEach(() => vi.unstubAllGlobals());

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

  it("are public: neither asks for the vendor passcode", async () => {
    for (const path of ["/parts/terms", "/parts/privacy"]) {
      const html = await (await get(path)).text();
      expect(html, path).not.toContain('name="passcode"');
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

  it("incorporates Google's privacy policy on the privacy page", async () => {
    const html = await (await get("/parts/privacy")).text();
    expect(GOOGLE_PRIVACY_URL).toBe("https://policies.google.com/privacy");
    expect(hrefs(html)).toContain(GOOGLE_PRIVACY_URL);
    // The four things the page has to be straight about.
    expect(html).toContain("pf_vendor");
    expect(html).toContain("Workers Logs are turned off");
    expect(html).toContain("place IDs");
    expect(html).toContain("WhatsApp link");
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

  it("links both pages from a page showing suppliers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(SHOP, { status: 200 })));
    const html = await (
      await get("/parts/?q=1u3352&city=Bengaluru", {
        headers: { Cookie: `pf_vendor=${await vendorToken(PASSCODE)}` },
      })
    ).text();
    expect(html).toContain("A Shop");
    expect(footer(html)).toContain('href="/parts/terms"');
    expect(footer(html)).toContain('href="/parts/privacy"');
  });

  it("links both pages from the passcode gate and from the pages themselves", async () => {
    for (const path of ["/parts/vendors/login", "/parts/terms", "/parts/privacy"]) {
      const html = await (await get(path)).text();
      expect(footer(html), path).toContain('href="/parts/terms"');
      expect(footer(html), path).toContain('href="/parts/privacy"');
    }
  });

  it("keeps the Google attribution beside the listings, not down here", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(SHOP, { status: 200 })));
    const html = await (
      await get("/parts/?q=1u3352&city=Bengaluru", {
        headers: { Cookie: `pf_vendor=${await vendorToken(PASSCODE)}` },
      })
    ).text();
    expect(html.indexOf('class="attribution"')).toBeGreaterThan(0);
    expect(html.indexOf('class="attribution"')).toBeLessThan(html.indexOf("<footer"));
    expect(footer(html)).not.toContain("Google");
  });
});

describe("what the privacy page has to say since step 6", () => {
  it("names both cookies and what the map sends to Google", async () => {
    const html = await (await get("/parts/privacy")).text();
    expect(html).toContain("pf_vendor");
    expect(html).toContain("pf_city");
    expect(html).toContain("the last city you typed");
    expect(html).toContain("the map is loaded from Google");
    expect(html).toContain("never the page's query string");
  });
});
