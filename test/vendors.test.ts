// Step 6: the passcode gate, the inline supplier search on /parts/, and the fallbacks.
//
// No network. Global fetch is stubbed in every test that expects a Google call, and the tests that
// expect none assert the stub was never called. No real key and no real passcode are used.

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { vendorToken } from "../src/vendors/auth";
import { TEXT_SEARCH_FIELD_MASK } from "../src/vendors/places";
import {
  CITY_CENTRE,
  PASSCODE,
  Q,
  SEARCH,
  cookie,
  env,
  get,
  hrefs,
  isOriginCall,
  place,
  searchReply,
  shopSearches,
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
    // Link-outs, one set per brand, and nothing about signing in outside the footer.
    expect(html).toContain("Caterpillar parts shops on Google Maps");
    expect(html).toContain("Search suppliers on Google");
    expect(html).toContain('class="card"');
    const main = html.slice(0, html.indexOf("<footer"));
    expect(main).not.toContain("Sign in");
    expect(main).not.toContain("passcode");
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
    expect(await res.text()).toContain("Search suppliers on Google");
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
  it("places the city first, then searches once per brand group and once for all brands", async () => {
    const calls = stubFetch(searchReply);
    await signedIn(`/parts/${SEARCH}`);
    // One origin call plus three searches: four of the five a page view may make.
    expect(calls).toHaveLength(4);
    expect(isOriginCall(calls[0]!)).toBe(true);
    expect(calls[0]!.body).toMatchObject({
      textQuery: "Bengaluru, India",
      regionCode: "IN",
      pageSize: 1,
    });

    const searches = shopSearches(calls);
    expect(searches.map((c) => c.body?.textQuery)).toEqual([
      "Caterpillar spare parts dealer in Bengaluru, India",
      "JCB spare parts dealer in Bengaluru, India",
      "earthmoving spare parts in Bengaluru, India",
    ]);
    for (const call of searches) {
      expect(call.url).toBe("https://places.googleapis.com/v1/places:searchText");
      expect(call.method).toBe("POST");
      expect(call.headers["X-Goog-Api-Key"]).toBe(env.GOOGLE_PLACES_KEY);
      expect(call.headers["X-Goog-FieldMask"]).toBe(
        "places.id,places.displayName,places.formattedAddress,places.shortFormattedAddress," +
          "places.location,places.googleMapsUri,places.internationalPhoneNumber," +
          "places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount," +
          "places.currentOpeningHours.openNow",
      );
      expect(call.body).toMatchObject({
        regionCode: "IN",
        languageCode: "en",
        pageSize: 10,
        locationBias: {
          circle: {
            center: { latitude: CITY_CENTRE.latitude, longitude: CITY_CENTRE.longitude },
            radius: 30000,
          },
        },
      });
    }
  });

  it("asks for nothing beyond what a supplier card and its pin need", async () => {
    // Since step 6 this is the Enterprise tier, because of the phone, website and opening fields.
    // The list is closed: anything added here costs money on every search, so it is asserted whole.
    expect(TEXT_SEARCH_FIELD_MASK.split(",")).toEqual([
      "places.id",
      "places.displayName",
      "places.formattedAddress",
      "places.shortFormattedAddress",
      "places.location",
      "places.googleMapsUri",
      "places.internationalPhoneNumber",
      "places.nationalPhoneNumber",
      "places.websiteUri",
      "places.rating",
      "places.userRatingCount",
      "places.currentOpeningHours.openNow",
    ]);
    for (const field of ["review", "priceLevel", "photos", "editorialSummary"]) {
      expect(TEXT_SEARCH_FIELD_MASK).not.toContain(field);
    }
  });

  it("measures distance from a shared location, and makes no origin call", async () => {
    const calls = stubFetch(searchReply);
    const html = await (await signedIn(`/parts/${SEARCH}&near=12.9352,77.5467`)).text();
    expect(calls.every((c) => !isOriginCall(c))).toBe(true);
    expect(calls).toHaveLength(3);
    // Rounded to three decimals: about a hundred metres, which is all a shop search needs.
    expect(calls[0]!.body).toMatchObject({
      locationBias: { circle: { center: { latitude: 12.935, longitude: 77.547 } } },
    });
    expect(html).toContain("from you");
    expect(html).not.toContain("centre");
    // It is read from the query and goes nowhere else.
    expect(html.slice(html.indexOf("<textarea id=\"message\""))).not.toContain("near=");

  });

  it("ignores a location that is not one, and falls back to the city", async () => {
    for (const near of ["91,77", "12.9,200", "banana", "12.9", "12.9,77,5"]) {
      const calls = stubFetch(searchReply);
      const html = await (await signedIn(`/parts/${SEARCH}&near=${encodeURIComponent(near)}`)).text();
      expect(calls.some(isOriginCall), near).toBe(true);
      expect(html, near).toContain("Bengaluru centre");
    }
  });


  it("puts the section under the cards, numbered, boxed and credited", async () => {
    stubFetch(searchReply);
    const html = await (await signedIn(`/parts/${SEARCH}`)).text();
    expect(html).toContain("<h2>Suppliers near Bengaluru (3)</h2>");
    expect(unescapeHtml(html)).toContain(
      "Matched by the brands Google lists each shop for. Listed doesn't mean in stock. Ask them.",
    );
    expect(html).toContain('<section class="gmaps" aria-label="Google Maps">');
    expect(html).toContain('<p class="attribution">Google Maps</p>');
    // The shop that can be asked about both parts sorts first.
    const names = [...html.matchAll(/<p class="sname">.*?<\/span> ([^<]*)<\/p>/g)].map((m) => m[1]);
    expect(names).toEqual(["Shared Spares", "Cat Corner", "Multi Brand Traders"]);
    expect(html).toContain('<span class="pin">1</span>');
    expect(html).toContain("from Bengaluru centre");
    expect(html).toContain("Indiranagar");
    // The cards come first: the answer to "what is this number" precedes "who sells it".
    expect(html.indexOf('class="card"')).toBeLessThan(html.indexOf('class="suppliers"'));
  });

  it("tells each part how many shops can be asked about it", async () => {
    stubFetch(searchReply);
    const html = await (await signedIn(`/parts/${SEARCH}`)).text();
    // 1U-3352 is Caterpillar's: Shared Spares and Cat Corner. 40/300893 is JCB's: Shared Spares.
    expect([...html.matchAll(/Suppliers to ask: (\d+)/g)].map((m) => m[1])).toEqual(["2", "1"]);
  });

  it("says when Google cannot place the city", async () => {
    stubFetch((call) =>
      new Response(JSON.stringify(isOriginCall(call) ? {} : { places: [] }), { status: 200 }),
    );
    const html = await (await signedIn(`/parts/?q=${encodeURIComponent(Q)}&city=Bengalru`)).text();
    expect(html).toContain("Couldn&#39;t find Bengalru. Check the spelling.");
    expect(html).toContain("Caterpillar parts shops on Google Maps");
  });

  it("asks Google nothing without a recognised number", async () => {
    const calls = stubFetch(searchReply);
    const noParts = await (await signedIn("/parts/?q=hello%20there&city=Bengaluru")).text();
    expect(calls).toHaveLength(0);
    expect(noParts).not.toContain("Suppliers near");
  });
});

describe("the remembered city and country", () => {
  it("is set when one is typed, and prefills the field next time", async () => {
    stubFetch(searchReply);
    const res = await signedIn(`/parts/${SEARCH}`);
    // Two cookies, so they are read as a list: Headers.get() would join them with a comma.
    expect(res.headers.getSetCookie()).toEqual([
      "pf_city=Bengaluru; HttpOnly; Secure; SameSite=Lax; Path=/parts/; Max-Age=2592000",
      "pf_country=IN; HttpOnly; Secure; SameSite=Lax; Path=/parts/; Max-Age=2592000",
    ]);

    // Same query, no city in the URL: the cookie supplies it, and the search still runs.
    const calls = stubFetch(searchReply);
    const back = await signedIn(
      `/parts/?q=${encodeURIComponent(Q)}`,
      "pf_city=Bengaluru; pf_country=IN",
    );
    const html = await back.text();
    expect(shopSearches(calls)).toHaveLength(3);
    expect(html).toContain('id="city" name="city" type="text" value="Bengaluru"');
    expect(html).toContain("<h2>Suppliers near Bengaluru (3)</h2>");
    // Nothing was typed, so nothing is rewritten.
    expect(back.headers.getSetCookie()).toEqual([]);
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
    expect(html).toContain("Supplier list unavailable right now");
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
    const html = await (await signedIn(`/parts/${SEARCH}`)).text();
    expect(html).toContain("Supplier list unavailable right now");
  });

  it("says something neutral for anything else, with the same links", async () => {
    stubFetch(() => new Response("kaboom", { status: 500 }));
    const html = unescapeHtml(await (await signedIn(`/parts/${SEARCH}`)).text());
    expect(html).toContain("Supplier list unavailable right now");
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
    expect(html).toContain("Supplier list unavailable right now");
    expect(html).toContain("Caterpillar parts shops on Google Maps");
  });
});

describe("what a redirect carries", () => {
  it("carries the three parameters the page reads, and drops the rest", async () => {
    const res = await get(
      "/parts/vendors/?q=1u3352&city=Bengaluru&country=IN" +
        "&v=leftover&scope_leftover=all&utm_source=somewhere",
    );
    expect(res.headers.get("Location")).toBe("/parts/?q=1u3352&city=Bengaluru&country=IN");
  });
});

describe("what a supplier card offers", () => {
  it("names the parts it was listed for, and who for", async () => {
    stubFetch(searchReply);
    const html = await (await signedIn(`/parts/${SEARCH}`)).text();
    const shared = html.slice(html.indexOf('id="pf-shop-1"'), html.indexOf('id="pf-shop-2"'));
    expect(shared).toContain("Ask about:");
    expect(shared).toContain("1U-3352 (listed for Caterpillar)");
    expect(shared).toContain("40/300893 (listed for JCB)");
    expect(shared).toContain("4.3 &#9733; (120)");
    expect(shared).toContain("Open now");

    const catOnly = html.slice(html.indexOf('id="pf-shop-2"'), html.indexOf('id="pf-shop-3"'));
    expect(catOnly).toContain("1U-3352 (listed for Caterpillar)");
    expect(catOnly).not.toContain("40/300893 (listed for");
  });

  it("says so plainly when only the multi-brand search found it", async () => {
    stubFetch(searchReply);
    const html = await (await signedIn(`/parts/${SEARCH}`)).text();
    const multi = html.slice(html.indexOf('id="pf-shop-3"'));
    expect(multi).toContain("General earthmoving spares: ask about all parts");
    expect(multi).not.toContain("listed for");
  });

  it("asks a part-matched shop about its parts, and offers all parts beside it", async () => {
    stubFetch(searchReply);
    const html = await (await signedIn(`/parts/${SEARCH}`)).text();
    const catOnly = html.slice(html.indexOf('id="pf-shop-2"'), html.indexOf('id="pf-shop-3"'));
    const matched = whatsappMessage(catOnly, "WhatsApp \\(if they use it\\)")!;
    expect(matched.startsWith("Hi Cat Corner,\nWe have a requirement for:")).toBe(true);
    expect(matched).toContain("1. 1U-3352 (likely Caterpillar)");
    expect(matched).not.toContain("40/300893");
    // Without JavaScript there is no toggle, so the wider message is its own link.
    const all = whatsappMessage(catOnly, "WhatsApp: all parts")!;
    expect(all).toContain("1U-3352");
    expect(all).toContain("40/300893");
    // A shop listed for everything has nothing wider to ask.
    const shared = html.slice(html.indexOf('id="pf-shop-1"'), html.indexOf('id="pf-shop-2"'));
    expect(shared).not.toContain("WhatsApp: all parts");
  });

  it("carries the quantities into every message", async () => {
    stubFetch(searchReply);
    const html = await (
      await signedIn(`/parts/?q=${encodeURIComponent("2 nos 1u3352 and 40/300893 x1")}&city=Bengaluru&country=IN`)
    ).text();
    const message = whatsappMessage(html, "WhatsApp \\(if they use it\\)")!;
    expect(message).toContain("1. 1U-3352 (likely Caterpillar), qty 2");
    expect(message).toContain("2. 40/300893 (likely JCB), qty 1");
  });

  it("offers Select, Call, Website and Map, and says when there is no WhatsApp number", async () => {
    stubFetch(searchReply);
    const html = await (await signedIn(`/parts/${SEARCH}`)).text();
    const shared = html.slice(html.indexOf('id="pf-shop-1"'), html.indexOf('id="pf-shop-2"'));
    expect(shared).toContain('<input type="checkbox" class="pick" data-n="1"> Select');
    expect(shared).toContain('href="tel:+919876543210"');
    expect(shared).toContain(">Website<");
    expect(shared).toContain(">Map<");

    stubFetch((call) =>
      isOriginCall(call)
        ? new Response(JSON.stringify({ places: [{ location: CITY_CENTRE }] }), { status: 200 })
        : new Response(
            JSON.stringify({
              places: [
                place("local", "Local Only", {
                  internationalPhoneNumber: undefined,
                  nationalPhoneNumber: undefined,
                  websiteUri: undefined,
                }),
              ],
            }),
            { status: 200 },
          ),
    );
    const plain = await (await signedIn(`/parts/${SEARCH}`)).text();
    const shops = plain.slice(plain.indexOf('class="suppliers"'), plain.indexOf('class="send"'));
    expect(shops).toContain("No WhatsApp number listed");
    expect(shops).not.toContain("wa.me");
    expect(shops).not.toContain(">Website<");
  });

  it("renders a shop the demo key returned no rating or opening hours for", async () => {
    stubFetch((call) =>
      isOriginCall(call)
        ? new Response(JSON.stringify({ places: [{ location: CITY_CENTRE }] }), { status: 200 })
        : new Response(
            JSON.stringify({
              places: [
                place("plain", "Plain Shop", {
                  rating: undefined,
                  userRatingCount: undefined,
                  currentOpeningHours: undefined,
                  shortFormattedAddress: undefined,
                }),
              ],
            }),
            { status: 200 },
          ),
    );
    const html = await (await signedIn(`/parts/${SEARCH}`)).text();
    expect(html).toContain("Plain Shop");
    expect(html).not.toContain('class="srating"');
    expect(html).not.toContain("Open now");
    // It falls back to the long address rather than showing none.
    expect(html).toContain("Bengaluru 560038");
  });

  it("offers the city prompt when there is none", async () => {
    const calls = stubFetch(searchReply);
    const html = await (await signedIn(`/parts/?q=${encodeURIComponent(Q)}`)).text();
    expect(calls).toHaveLength(0);
    expect(html).toContain("Add your city to see suppliers near you.");
    expect(html).toContain("Caterpillar parts shops on Google Maps");
  });
});
