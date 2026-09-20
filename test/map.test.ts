// Step 6: the map, its nonce CSP, and what may and may not appear in a response body.
//
// No network. Nothing here loads Google's script; it checks what the page says about loading it.

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { jsonForScript, pinsFor } from "../src/vendors/suppliers";
import {
  CITY_CENTRE,
  Q,
  SEARCH,
  cookie,
  isOriginCall,
  place,
  searchReply,
  signedIn,
  stubFetch,
} from "./helpers";

const PLACES_KEY = "places-key-must-never-be-rendered";
const BROWSER_KEY = "browser-key-meant-to-be-rendered";

afterEach(() => vi.unstubAllGlobals());

/** The nonce the response's CSP declares, from either directive. */
function cspNonce(res: Response, directive: "script-src" | "style-src"): string | undefined {
  const csp = res.headers.get("Content-Security-Policy") ?? "";
  return new RegExp(`${directive} 'nonce-([^']+)'`).exec(csp)?.[1];
}

/** The nonce on every tag that carries one, in document order. */
const tagNonces = (html: string) =>
  [...html.matchAll(/<(?:script|style)[^>]*\snonce="([^"]*)"/g)].map((m) => m[1]!);

describe("the map", () => {
  it("loads Google's script, carries the pins, and ties them to the list", async () => {
    stubFetch(searchReply);
    const res = await signedIn(`/parts/${SEARCH}`);
    const html = await res.text();
    const nonce = cspNonce(res, "script-src")!;

    expect(html).toContain(
      `<script src="https://maps.googleapis.com/maps/api/js?key=${BROWSER_KEY}` +
        `&amp;callback=initMap&amp;loading=async" async nonce="${nonce}">`,
    );
    expect(html).toContain('<div class="map" id="pf-map">Map unavailable.');
    expect(html).toContain('mapId: "DEMO_MAP_ID"');
    expect(html).toContain("AdvancedMarkerElement");
    // Every pin's number has a row to scroll to.
    expect(html).toContain('id="pf-shop-1"');
  });

  it("puts only the number, name and position in the pin data", async () => {
    stubFetch(searchReply);
    const html = await (await signedIn(`/parts/${SEARCH}`)).text();
    const json = html.match(/<script type="application\/json" id="pf-pins"[^>]*>([\s\S]*?)<\/script>/)?.[1];
    const pins = JSON.parse(json!) as Record<string, unknown>[];
    expect(pins).toHaveLength(3);
    expect(pins[0]).toEqual({ n: 1, name: "Shared Spares", lat: 12.978, lng: 77.64 });
    for (const pin of pins) {
      expect(Object.keys(pin).sort()).toEqual(["lat", "lng", "n", "name"]);
    }
    // Nothing that identifies the place to a third party rides along.
    expect(json).not.toContain("shared");
    expect(json).not.toContain("98765");
    expect(json).not.toContain("560038");
  });

  it("escapes a name that would otherwise close the script block", async () => {
    const nasty = 'Bad </script><script>alert(1)</script> Spares';
    stubFetch(
      () => new Response(JSON.stringify({ places: [place("x", nasty)] }), { status: 200 }),
    );
    const html = await (await signedIn(`/parts/${SEARCH}`)).text();
    const json = html.match(/id="pf-pins"[^>]*>([\s\S]*?)<\/script>/)?.[1]!;
    expect(json).not.toContain("</script>");
    expect(json).toContain("\\u003c/script\\u003e");
    // It survives a round trip: escaped for HTML, still the same name to the map.
    expect((JSON.parse(json) as { name: string }[])[0]!.name).toBe(nasty);
  });

  it("draws nothing when Google gave no coordinates", async () => {
    stubFetch((call) =>
      isOriginCall(call)
        ? new Response(JSON.stringify({ places: [{ location: CITY_CENTRE }] }), { status: 200 })
        : new Response(
            JSON.stringify({ places: [place("nowhere", "No Pin Shop", { location: undefined })] }),
            { status: 200 },
          ),
    );
    const res = await signedIn(`/parts/${SEARCH}`);
    const html = await res.text();
    expect(html).toContain("No Pin Shop");
    expect(html).not.toContain("maps.googleapis.com");
    expect(html).not.toContain("pf-pins");
    expect(res.headers.get("Content-Security-Policy")).not.toContain("nonce-");
  });

  it("draws nothing without a browser key, and the list still works", async () => {
    stubFetch(searchReply);
    const res = await worker.fetch(
      new Request(`https://rohitrao.in/parts/${SEARCH}`, { headers: { Cookie: await cookie() } }),
      { VENDOR_PASSCODE: "step-six-passcode", GOOGLE_PLACES_KEY: PLACES_KEY },
    );
    const html = await res.text();
    expect(html).not.toContain("maps.googleapis.com");
    expect(html).toContain("Shared Spares");
    expect(html).toContain("Indiranagar");
  });
});

describe("the map page CSP", () => {
  it("nonces every tag it needs to, and lets Google's own hosts through", async () => {
    stubFetch(searchReply);
    const res = await signedIn(`/parts/${SEARCH}`);
    const html = await res.text();
    const scriptNonce = cspNonce(res, "script-src")!;
    expect(scriptNonce).toBeTruthy();
    expect(cspNonce(res, "style-src")).toBe(scriptNonce);

    // Our <style> and all three <script> tags, and nothing without a nonce.
    const nonces = tagNonces(html);
    expect(nonces).toHaveLength(4);
    expect(new Set(nonces)).toEqual(new Set([scriptNonce]));
    expect(html).toContain(`<style nonce="${scriptNonce}">`);

    const csp = res.headers.get("Content-Security-Policy")!;
    expect(csp).toContain("googleapis.com");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("manifest-src 'self'");
    // 'unsafe-inline' is ignored once a nonce is present, so it must not be relied on.
    expect(csp).not.toContain("'unsafe-inline'");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("uses a fresh nonce for every response", async () => {
    stubFetch(searchReply);
    const first = await signedIn(`/parts/${SEARCH}`);
    const second = await signedIn(`/parts/${SEARCH}`);
    const a = cspNonce(first, "script-src")!;
    const b = cspNonce(second, "script-src")!;
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it("sends Google the origin and never the query string", async () => {
    stubFetch(searchReply);
    const res = await signedIn(`/parts/${SEARCH}`);
    // The browser key is referrer-restricted, so no-referrer would stop the map loading at all.
    // strict-origin-when-cross-origin sends "https://rohitrao.in/" and no path or query.
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });
});

describe("the two keys", () => {
  it("never puts the Places key in a response body", async () => {
    stubFetch(searchReply);
    for (const path of [
      `/parts/${SEARCH}`,
      `/parts/?q=${encodeURIComponent(Q)}`,
      "/parts/terms",
      "/parts/privacy",
      "/parts/vendors/login",
    ]) {
      const res = await signedIn(path);
      expect(await res.text(), path).not.toContain(PLACES_KEY);
    }
  });

  it("puts the browser key in the Maps script URL and nowhere else", async () => {
    stubFetch(searchReply);
    const html = await (await signedIn(`/parts/${SEARCH}`)).text();
    const appearances = [...html.matchAll(new RegExp(BROWSER_KEY, "g"))];
    expect(appearances).toHaveLength(1);
    const line = html.slice(0, appearances[0]!.index).split("\n").pop()!;
    expect(line).toContain("https://maps.googleapis.com/maps/api/js");
  });

  it("keeps the Places key out of a page that fell back", async () => {
    stubFetch(() => new Response(JSON.stringify({ error: { message: PLACES_KEY } }), { status: 500 }));
    const html = await (await signedIn(`/parts/${SEARCH}`)).text();
    expect(html).not.toContain(PLACES_KEY);
  });
});

describe("pin helpers", () => {
  it("numbers pins as the list numbers rows, skipping shops with no location", async () => {
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

  it("escapes the characters that could end a script block", async () => {
    expect(jsonForScript({ a: "<>&" })).toBe('{"a":"\\u003c\\u003e\\u0026"}');
    expect(jsonForScript("\u2028\u2029")).toBe('"\\u2028\\u2029"');
  });
});
