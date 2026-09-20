// Step 6: the passcode gate, the inline supplier search on /parts/, and the fallbacks.
//
// No network. Global fetch is stubbed in every test that expects a Google call, and the tests that
// expect none assert the stub was never called. No real key and no real passcode are used.

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { vendorToken } from "../src/vendors/auth";
import { TEXT_SEARCH_FIELD_MASK } from "../src/vendors/places";
import {
  PASSCODE,
  Q,
  SEARCH,
  cookie,
  env,
  get,
  hrefs,
  place,
  searchReply,
  signedIn,
  stubFetch,
  unescapeHtml,
  whatsappMessage,
} from "./helpers";

afterEach(() => vi.unstubAllGlobals());

describe("signed out", () => {
  it("asks Google nothing, runs no script, and offers the passcode form", async () => {
    const calls = stubFetch(searchReply);
    const res = await get(`/parts/${SEARCH}`);
    const html = await res.text();
    expect(calls).toHaveLength(0);
    expect(html).not.toContain("maps.googleapis.com");
    expect(html).not.toContain("pf-pins");
    expect(html).toContain("Sign in to see suppliers here");
    expect(hrefs(html)).toContain(
      "/parts/vendors/login?q=1u3352%2040%2F300893&city=Bengaluru&country=IN",
    );
    // Today's page is otherwise untouched: the cards and their link-outs are still there.
    expect(html).toContain("Find suppliers in India");
  });

  it("keeps today's CSP and referrer policy", async () => {
    const res = await get(`/parts/${SEARCH}`);
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; manifest-src 'self'; " +
        "form-action 'self'; base-uri 'none'",
    );
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Cache-Control")).toBe(null);
  });
});

describe("the passcode gate", () => {
  it("serves the form on GET, carrying the query into the return path", async () => {
    const html = await (await get(`/parts/vendors/login${SEARCH}`)).text();
    expect(html).toContain('name="passcode"');
    expect(html).toContain('value="/parts/?q=1u3352+40%2F300893&amp;city=Bengaluru&amp;country=IN"');
  });

  it("refuses a wrong passcode with 401 and no cookie", async () => {
    const res = await get("/parts/vendors/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `passcode=wrong&next=${encodeURIComponent(`/parts/${SEARCH}`)}`,
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toBe(null);
    expect(unescapeHtml(await res.text())).toContain("That passcode didn't match.");
  });

  it("accepts the right passcode and returns to the page that offered it", async () => {
    const res = await get("/parts/vendors/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:
        `passcode=${encodeURIComponent(PASSCODE)}` +
        `&next=${encodeURIComponent(`/parts/${SEARCH}`)}`,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(
      "/parts/?q=1u3352+40%2F300893&city=Bengaluru&country=IN",
    );
    const set = res.headers.get("Set-Cookie")!;
    expect(set).toContain(`pf_vendor=${await vendorToken(PASSCODE)}`);
    for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/parts/", "Max-Age=2592000"]) {
      expect(set).toContain(attribute);
    }
  });

  it("rejects a cookie made with an old passcode", async () => {
    const calls = stubFetch(searchReply);
    const res = await get(`/parts/${SEARCH}`, { headers: { Cookie: await cookie("the-old-one") } });
    expect(calls).toHaveLength(0);
    expect(await res.text()).toContain("Sign in to see suppliers here");
  });

  it("never sends a login anywhere but the page", async () => {
    const res = await get("/parts/vendors/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `passcode=${encodeURIComponent(PASSCODE)}&next=https%3A%2F%2Felsewhere.example%2Ftake-me`,
    });
    expect(res.headers.get("Location")).toBe("/parts/");
  });

  it("clears the cookie on logout and allows POST only on login", async () => {
    const out = await get("/parts/vendors/logout", { headers: { Cookie: await cookie() } });
    expect(out.status).toBe(303);
    expect(out.headers.get("Location")).toBe("/parts/");
    expect(out.headers.get("Set-Cookie")).toContain("Max-Age=0");

    const post = await get("/parts/vendors/logout", { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("Allow")).toBe("GET");
    const put = await get("/parts/vendors/login", { method: "PUT" });
    expect(put.status).toBe(405);
    expect(put.headers.get("Allow")).toBe("POST");
  });
});

describe("the old vendor pages", () => {
  it("redirect to the page that replaced them, keeping the query", async () => {
    for (const path of ["/parts/vendors/", "/parts/vendors/contact", "/parts/vendors"]) {
      const res = await get(`${path}${SEARCH}`);
      expect(res.status, path).toBe(302);
      expect(res.headers.get("Location"), path).toBe(
        "/parts/?q=1u3352+40%2F300893&city=Bengaluru&country=IN",
      );
      expect(res.headers.get("Cache-Control"), path).toBe("no-store");
    }
  });

  it("redirect to the bare page when there is no query", async () => {
    expect((await get("/parts/vendors/")).headers.get("Location")).toBe("/parts/");
  });
});

describe("the inline supplier search", () => {
  it("makes one Text Search call per brand group plus the multi-brand one", async () => {
    const calls = stubFetch(searchReply);
    await signedIn(`/parts/${SEARCH}`);
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.body?.textQuery)).toEqual([
      "Caterpillar spare parts dealer in Bengaluru, India",
      "JCB spare parts dealer in Bengaluru, India",
      "earthmoving spare parts in Bengaluru, India",
    ]);
    for (const call of calls) {
      expect(call.url).toBe("https://places.googleapis.com/v1/places:searchText");
      expect(call.method).toBe("POST");
      expect(call.headers["X-Goog-Api-Key"]).toBe(env.GOOGLE_PLACES_KEY);
      expect(call.headers["X-Goog-FieldMask"]).toBe(
        "places.id,places.displayName,places.formattedAddress,places.location," +
          "places.googleMapsUri,places.internationalPhoneNumber,places.nationalPhoneNumber," +
          "places.websiteUri,places.rating,places.userRatingCount",
      );
      expect(call.body).toMatchObject({ regionCode: "IN", languageCode: "en", pageSize: 10 });
    }
  });

  it("asks for nothing beyond what a supplier row and its pin need", async () => {
    // Since step 6 this is the Enterprise tier, because of the phone and website fields. The list
    // is closed: anything added here costs money on every search, so it is asserted whole.
    expect(TEXT_SEARCH_FIELD_MASK.split(",")).toEqual([
      "places.id",
      "places.displayName",
      "places.formattedAddress",
      "places.location",
      "places.googleMapsUri",
      "places.internationalPhoneNumber",
      "places.nationalPhoneNumber",
      "places.websiteUri",
      "places.rating",
      "places.userRatingCount",
    ]);
    for (const field of ["review", "openingHours", "priceLevel", "photos", "editorialSummary"]) {
      expect(TEXT_SEARCH_FIELD_MASK).not.toContain(field);
    }
  });

  it("puts the section under the cards, numbered, boxed and credited", async () => {
    stubFetch(searchReply);
    const html = await (await signedIn(`/parts/${SEARCH}`)).text();
    expect(html).toContain("<h2>Suppliers near Bengaluru</h2>");
    expect(unescapeHtml(html)).toContain(
      "These are shops Google lists for these brands in Bengaluru. " +
        "Being listed doesn't mean they have your part in stock. Ask them.",
    );
    expect(html).toContain('<section class="gmaps" aria-label="Google Maps">');
    expect(html).toContain('<p class="attribution">Google Maps</p>');
    // The shop listed for both brands sorts first and is numbered 1.
    const names = [...html.matchAll(/<p class="sname">([^<]*)<\/p>/g)].map((m) => m[1]);
    expect(names).toEqual(["1. Shared Spares", "2. Cat Corner", "3. Multi Brand Traders"]);
    expect(html).toContain('id="pf-shop-1"');
    expect(html).toContain("Found for: Caterpillar, JCB");
    expect(html).toContain("Appeared for 2 of your 2 brands");
    expect(html).toContain("Rated 4.3 on Google (128 ratings)");
    // The cards come first: the answer to "what is this number" precedes "who sells it".
    expect(html.indexOf('class="card"')).toBeLessThan(html.indexOf('class="suppliers"'));
    // Step 5's form is gone.
    expect(html).not.toContain("Get contact details");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('type="radio"');
  });

  it("gives a shop found for one brand of two both WhatsApp buttons", async () => {
    stubFetch(searchReply);
    const html = await (await signedIn(`/parts/${SEARCH}`)).text();
    const everything = whatsappMessage(html, "WhatsApp \\(if they use it\\)")!;
    const narrower = whatsappMessage(html, "WhatsApp: only Caterpillar parts")!;
    // The wide button is on every shop with a number, so the first match is shop 1's.
    expect(everything).toContain("1U3352");
    expect(everything).toContain("40/300893");
    // The narrow one belongs to Cat Corner, which Google listed for Caterpillar only.
    expect(narrower.startsWith("Hi Cat Corner,")).toBe(true);
    expect(narrower).toContain("1U3352");
    expect(narrower).not.toContain("40/300893");
    // The shop listed for both brands has nothing narrower to ask, so it gets one button.
    const shared = html.slice(html.indexOf("pf-shop-1"), html.indexOf("pf-shop-2"));
    expect(shared).not.toContain("WhatsApp: only");
    expect(shared).toContain('href="tel:+919876543210"');
    expect(shared).toContain("Website");
    expect(shared).toContain("Open in Google Maps");
  });

  it("gives a shop with no international number a call and no wa.me link", async () => {
    stubFetch(() =>
      new Response(
        JSON.stringify({
          places: [place("local", "Local Only", { internationalPhoneNumber: undefined })],
        }),
        { status: 200 },
      ),
    );
    const html = await (await signedIn(`/parts/${SEARCH}`)).text();
    // Scoped to the section: the step 4 send box above it always offers a WhatsApp contact picker.
    const shops = html.slice(html.indexOf('class="suppliers"'));
    expect(shops).toContain('href="tel:09876543210"');
    expect(shops).not.toContain("wa.me");
  });

  it("renders a shop the demo key returned no rating for", async () => {
    stubFetch(() =>
      new Response(
        JSON.stringify({
          places: [place("plain", "Plain Shop", { rating: undefined, userRatingCount: undefined })],
        }),
        { status: 200 },
      ),
    );
    const html = await (await signedIn(`/parts/${SEARCH}`)).text();
    expect(html).toContain("1. Plain Shop");
    expect(html).not.toContain('class="srating"');
  });

  it("asks Google nothing without a city, or without a recognised number", async () => {
    const calls = stubFetch(searchReply);
    const noCity = await (await signedIn(`/parts/?q=${encodeURIComponent(Q)}`)).text();
    expect(calls).toHaveLength(0);
    expect(noCity).not.toContain("Suppliers near");

    const noParts = await (await signedIn("/parts/?q=hello%20there&city=Bengaluru")).text();
    expect(calls).toHaveLength(0);
    expect(noParts).not.toContain("Suppliers near");
  });
});

describe("the remembered city", () => {
  it("is set when one is typed, and prefills the field next time", async () => {
    stubFetch(searchReply);
    const res = await signedIn(`/parts/${SEARCH}`);
    expect(res.headers.get("Set-Cookie")).toBe(
      "pf_city=Bengaluru; HttpOnly; Secure; SameSite=Lax; Path=/parts/; Max-Age=2592000",
    );

    // Same query, no city in the URL: the cookie supplies it, and the search still runs.
    const calls = stubFetch(searchReply);
    const back = await signedIn(`/parts/?q=${encodeURIComponent(Q)}`, "pf_city=Bengaluru");
    const html = await back.text();
    expect(calls).toHaveLength(3);
    expect(html).toContain('id="city" name="city" type="text" value="Bengaluru"');
    expect(html).toContain("<h2>Suppliers near Bengaluru</h2>");
    // Nothing was typed, so nothing is rewritten.
    expect(back.headers.get("Set-Cookie")).toBe(null);
  });
});

describe("when Google will not answer", () => {
  const QUOTA_BODY = JSON.stringify({
    error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for quota metric" },
  });

  it("shows the limit message and step 4's links, never Google's own words, and no map", async () => {
    stubFetch(() => new Response(QUOTA_BODY, { status: 429 }));
    const res = await signedIn(`/parts/${SEARCH}`);
    const html = await res.text();
    expect(unescapeHtml(html)).toContain(
      "Vendor search hit today's Google limit. Use the links below instead.",
    );
    for (const word of ["RESOURCE_EXHAUSTED", "Quota exceeded", "maps.googleapis.com", "pf-pins"]) {
      expect(html).not.toContain(word);
    }
    expect(html).toContain("Caterpillar parts shops on Google Maps");
    expect(html).toContain("JCB parts shops on Google Maps");
    expect(html).not.toContain('class="shop"');
    // A page with no script keeps today's CSP.
    expect(res.headers.get("Content-Security-Policy")).not.toContain("nonce-");
  });

  it("treats a 403 that names a quota the same way", async () => {
    stubFetch(() => new Response(QUOTA_BODY, { status: 403 }));
    const html = unescapeHtml(await (await signedIn(`/parts/${SEARCH}`)).text());
    expect(html).toContain("Vendor search hit today's Google limit.");
  });

  it("says something neutral for anything else, with the same links", async () => {
    stubFetch(() => new Response("kaboom", { status: 500 }));
    const html = unescapeHtml(await (await signedIn(`/parts/${SEARCH}`)).text());
    expect(html).toContain("Vendor search isn't available right now. Use the links below instead.");
    expect(html).not.toContain("kaboom");
    expect(html).toContain("Caterpillar parts shops on Google Maps");
  });

  it("falls back the same way with no Places key, and calls nothing", async () => {
    const calls = stubFetch(searchReply);
    const res = await worker.fetch(
      new Request(`https://rohitrao.in/parts/${SEARCH}`, {
        headers: { Cookie: await cookie() },
      }),
      { VENDOR_PASSCODE: PASSCODE },
    );
    const html = unescapeHtml(await res.text());
    expect(calls).toHaveLength(0);
    expect(html).toContain("Vendor search isn't available right now.");
    expect(html).toContain("Caterpillar parts shops on Google Maps");
  });
});
