// Step 5: the passcode gate, the vendor search, the contact page and the fallbacks.
//
// No network. Global fetch is stubbed in every test that expects a Google call, and the tests
// that expect none assert the stub was never called. No real key and no real passcode are used.

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { vendorToken } from "../src/vendors/auth";
import { DETAILS_FIELD_MASK, TEXT_SEARCH_FIELD_MASK } from "../src/vendors/places";

const PASSCODE = "step-five-passcode";
const env = { VENDOR_PASSCODE: PASSCODE, GOOGLE_PLACES_KEY: "not-a-real-key" };

/** The two numbers the step prompt names: one Caterpillar, one JCB. */
const Q = "1u3352 40/300893";
const SEARCH = `?q=${encodeURIComponent(Q)}&city=Bengaluru&country=IN`;

const get = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://rohitrao.in${path}`, init), env);

async function cookie(passcode = PASSCODE): Promise<string> {
  return `pf_vendor=${await vendorToken(passcode)}`;
}

async function signedIn(path: string): Promise<Response> {
  return get(path, { headers: { Cookie: await cookie() } });
}

function unescapeHtml(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => unescapeHtml(m[1]!));

/** The text of every <textarea>, unescaped. */
const textareas = (html: string) =>
  [...html.matchAll(/<textarea[^>]*>([\s\S]*?)<\/textarea>/g)].map((m) => unescapeHtml(m[1]!));

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

/** Records every fetch and answers it with `reply`. Nothing leaves the process. */
function stubFetch(reply: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const headers = Object.fromEntries(
        Object.entries((init.headers ?? {}) as Record<string, string>),
      );
      const call: Call = {
        url: String(input),
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? null : JSON.parse(String(init.body)),
      };
      calls.push(call);
      return reply(call);
    }),
  );
  return calls;
}

const place = (id: string, name: string) => ({
  id,
  displayName: { text: name, languageCode: "en" },
  formattedAddress: `${name}, Bengaluru 560001`,
  googleMapsUri: `https://maps.google.com/?cid=${id}`,
});

/** Caterpillar and JCB both return "Shared Spares"; each also returns one shop of its own. */
function searchReply(call: Call): Response {
  const query = String((call.body as { textQuery?: unknown } | null)?.textQuery ?? "");
  const places = query.startsWith("Caterpillar")
    ? [place("shared", "Shared Spares"), place("cat-only", "Cat Corner")]
    : query.startsWith("JCB")
      ? [place("jcb-only", "JCB Spares Co"), place("shared", "Shared Spares")]
      : [place("multi", "Multi Brand Traders")];
  return new Response(JSON.stringify({ places }), { status: 200 });
}

const DETAILS: Record<string, Record<string, unknown>> = {
  mobile: {
    id: "mobile",
    displayName: { text: "Cat Corner" },
    internationalPhoneNumber: "+91 98765 43210",
    nationalPhoneNumber: "098765 43210",
    websiteUri: "https://catcorner.example",
    googleMapsUri: "https://maps.google.com/?cid=mobile",
  },
  landline: {
    id: "landline",
    displayName: { text: "JCB Spares Co" },
    internationalPhoneNumber: "+91 11 2345 6789",
    nationalPhoneNumber: "011 2345 6789",
    googleMapsUri: "https://maps.google.com/?cid=landline",
  },
};

function detailsReply(call: Call): Response {
  const id = call.url.slice(call.url.lastIndexOf("/") + 1);
  return new Response(JSON.stringify(DETAILS[id] ?? { id, displayName: { text: id } }), {
    status: 200,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("the passcode gate", () => {
  it("shows the form and fetches nothing when there is no cookie", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const res = await get(`/parts/vendors/${SEARCH}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(0);
    expect(html).toContain('name="passcode"');
    expect(html).not.toContain('class="vendor"');
    // The query the browser asked for is kept, so signing in does not lose it.
    expect(html).toContain(`value="/parts/vendors/?q=1u3352+40%2F300893&amp;city=Bengaluru`);
  });

  it("carries no-store and the site's security headers", async () => {
    const res = await get("/parts/vendors/");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
  });

  it("refuses a wrong passcode with 401 and no cookie", async () => {
    const res = await get("/parts/vendors/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `passcode=wrong&next=${encodeURIComponent(`/parts/vendors/${SEARCH}`)}`,
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toBe(null);
    const html = await res.text();
    expect(unescapeHtml(html)).toContain("That passcode didn't match.");
    expect(html).toContain('name="passcode"');
  });

  it("accepts the right passcode, sets the cookie and redirects with the query", async () => {
    const res = await get("/parts/vendors/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `passcode=${encodeURIComponent(PASSCODE)}&next=${encodeURIComponent(`/parts/vendors/${SEARCH}`)}`,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(
      "/parts/vendors/?q=1u3352+40%2F300893&city=Bengaluru&country=IN",
    );
    const set = res.headers.get("Set-Cookie")!;
    expect(set).toContain(`pf_vendor=${await vendorToken(PASSCODE)}`);
    expect(set).toContain("HttpOnly");
    expect(set).toContain("Secure");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain("Path=/parts/");
    expect(set).toContain("Max-Age=2592000");
  });

  it("rejects a cookie made with an old passcode", async () => {
    const res = await get("/parts/vendors/", { headers: { Cookie: await cookie("the-old-one") } });
    expect(await res.text()).toContain('name="passcode"');
  });

  it("never sends a login anywhere but the vendor pages", async () => {
    const res = await get("/parts/vendors/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `passcode=${encodeURIComponent(PASSCODE)}&next=https%3A%2F%2Felsewhere.example%2Ftake-me`,
    });
    expect(res.headers.get("Location")).toBe("/parts/vendors/");
  });

  it("clears the cookie on logout", async () => {
    const res = await get("/parts/vendors/logout", { headers: { Cookie: await cookie() } });
    expect(res.status).toBe(303);
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("allows POST on the login path only", async () => {
    for (const path of ["/parts/vendors/", "/parts/vendors/contact", "/parts/vendors/logout"]) {
      const res = await get(path, { method: "POST" });
      expect(res.status, path).toBe(405);
      expect(res.headers.get("Allow"), path).toBe("GET");
    }
    const put = await get("/parts/vendors/login", { method: "PUT" });
    expect(put.status).toBe(405);
    expect(put.headers.get("Allow")).toBe("POST");
  });
});

describe("the vendor search", () => {
  it("makes one Text Search call per brand group plus the multi-brand one", async () => {
    const calls = stubFetch(searchReply);
    await signedIn(`/parts/vendors/${SEARCH}`);
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
        "places.id,places.displayName,places.formattedAddress,places.googleMapsUri",
      );
      expect(call.body).toMatchObject({ regionCode: "IN", languageCode: "en", pageSize: 10 });
    }
  });

  it("asks for no field that costs more than a Pro row", async () => {
    for (const field of ["hone", "ebsite", "ating", "eview", "pening", "rice"]) {
      expect(TEXT_SEARCH_FIELD_MASK).not.toContain(field);
    }
  });

  it("puts the shop found for both brands first and defaults it to all parts", async () => {
    stubFetch(searchReply);
    const html = await (await signedIn(`/parts/vendors/${SEARCH}`)).text();
    const names = [...html.matchAll(/<p class="vname">([^<]*)<\/p>/g)].map((m) => m[1]);
    expect(names[0]).toBe("Shared Spares");
    expect(html).toContain("Found for: Caterpillar, JCB");
    expect(html).toContain("Appeared for 2 of your 2 brands");
    expect(html).toContain('<input type="radio" name="scope_shared" value="all" checked>');
    // A shop found for one brand of two defaults to that brand's parts instead.
    expect(html).toContain('value="only:Caterpillar" checked');
    expect(html).toContain('<input type="radio" name="scope_cat-only" value="all">');
  });

  it("says what the listing is and is not", async () => {
    stubFetch(searchReply);
    const html = unescapeHtml(await (await signedIn(`/parts/vendors/${SEARCH}`)).text());
    expect(html).toContain(
      "These are shops Google lists for these brands in Bengaluru. " +
        "Being listed doesn't mean they have your part in stock. Ask them.",
    );
  });

  it("asks for a city before it asks Google anything", async () => {
    const calls = stubFetch(searchReply);
    const html = await (await signedIn(`/parts/vendors/?q=${encodeURIComponent(Q)}`)).text();
    expect(calls).toHaveLength(0);
    expect(html).toContain('name="city"');
    expect(unescapeHtml(html)).toContain("Enter a city");
  });
});

describe("Google Maps attribution", () => {
  /** The contents of every <section class="gmaps" aria-label="Google Maps"> on the page. */
  function boxes(html: string): string[] {
    return [...html.matchAll(/<section class="gmaps" aria-label="Google Maps">([\s\S]*?)<\/section>/g)]
      .map((m) => m[1]!);
  }

  it("boxes the vendor list and labels it, with the words beside the listings", async () => {
    stubFetch(searchReply);
    const html = await (await signedIn(`/parts/vendors/${SEARCH}`)).text();
    const found = boxes(html);
    expect(found).toHaveLength(1);
    // Every listing is inside the box, and so is the attribution.
    expect(found[0]).toContain('<ol class="vendors">');
    expect(found[0]).toContain("Shared Spares");
    expect(found[0]).toContain('<p class="attribution">Google Maps</p>');
    // The border is what tells Google's content apart from the rest of the page.
    expect(html).toContain(".gmaps {");
    expect(html).toMatch(/\.gmaps \{[^}]*border: 2px solid/);
  });

  it("boxes and labels each vendor block on the contact page", async () => {
    stubFetch(detailsReply);
    const html = await (
      await signedIn(
        `/parts/vendors/contact?q=${encodeURIComponent(Q)}&city=Bengaluru&country=IN` +
          "&v=mobile&v=landline",
      )
    ).text();
    const found = boxes(html);
    expect(found).toHaveLength(2);
    expect(found[0]).toContain("Cat Corner");
    expect(found[0]).toContain('<p class="attribution">Google Maps</p>');
    expect(found[1]).toContain("JCB Spares Co");
    expect(found[1]).toContain('<p class="attribution">Google Maps</p>');
  });

  it("boxes the answer even when Google listed nothing", async () => {
    stubFetch(() => new Response(JSON.stringify({}), { status: 200 }));
    const html = await (await signedIn(`/parts/vendors/${SEARCH}`)).text();
    expect(boxes(html)[0]).toContain('<p class="attribution">Google Maps</p>');
  });
});

describe("contact details", () => {
  const contactUrl =
    `/parts/vendors/contact?q=${encodeURIComponent(Q)}&city=Bengaluru&country=IN` +
    "&v=mobile&scope_mobile=only%3ACaterpillar&v=landline&scope_landline=all";

  it("asks Place Details for exactly the fields the page shows", async () => {
    const calls = stubFetch(detailsReply);
    await signedIn(contactUrl);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe("https://places.googleapis.com/v1/places/mobile");
    expect(calls[0]!.method).toBe("GET");
    for (const call of calls) {
      expect(call.headers["X-Goog-FieldMask"]).toBe(
        "id,displayName,internationalPhoneNumber,nationalPhoneNumber,websiteUri,googleMapsUri",
      );
    }
    expect(DETAILS_FIELD_MASK).toBe(
      "id,displayName,internationalPhoneNumber,nationalPhoneNumber,websiteUri,googleMapsUri",
    );
  });

  it("offers WhatsApp to a +91 mobile, with that shop's parts and its own greeting", async () => {
    stubFetch(detailsReply);
    const html = await (await signedIn(contactUrl)).text();
    const wa = hrefs(html).find((h) => h.startsWith("https://wa.me/"))!;
    expect(wa.startsWith("https://wa.me/919876543210?text=")).toBe(true);
    const message = decodeURIComponent(wa.slice(wa.indexOf("?text=") + 6));
    expect(message.startsWith("Hi Cat Corner, we have a requirement for:")).toBe(true);
    expect(message).toContain("1U3352");
    // Scope "only:Caterpillar": the JCB number belongs to the other shop's message, not this one.
    expect(message).not.toContain("40/300893");
    expect(textareas(html)[0]).toBe(message);
  });

  it("offers a landline a call and the message to copy, and no wa.me link", async () => {
    stubFetch(detailsReply);
    const html = await (await signedIn(contactUrl)).text();
    const landline = html.slice(html.indexOf("JCB Spares Co"));
    expect(landline).toContain('href="tel:+911123456789"');
    expect(landline).not.toContain("wa.me");
    expect(landline).toContain("<textarea");
    // Scope "all": this shop's message carries both numbers.
    const message = textareas(html)[1]!;
    expect(message).toContain("1U3352");
    expect(message).toContain("40/300893");
    expect(message.startsWith("Hi JCB Spares Co,")).toBe(true);
  });

  it("emails the same message, with the step 4 subject", async () => {
    stubFetch(detailsReply);
    const html = await (await signedIn(contactUrl)).text();
    const mailto = hrefs(html).find((h) => h.startsWith("mailto:"))!;
    const params = new URL(mailto).searchParams;
    expect(params.get("subject")).toBe("Requirement: 1U3352");
    expect(params.get("body")).toBe(textareas(html)[0]);
  });

  it("contacts at most five shops and says so", async () => {
    const calls = stubFetch(detailsReply);
    const picked = ["a", "b", "c", "d", "e", "f", "g"].map((id) => `v=${id}`).join("&");
    const html = await (
      await signedIn(
        `/parts/vendors/contact?q=${encodeURIComponent(Q)}&city=Bengaluru&country=IN&${picked}`,
      )
    ).text();
    expect(calls).toHaveLength(5);
    expect(html).toContain("You picked 7 shops. Contact details are shown for the first 5.");
  });
});

describe("when Google will not answer", () => {
  const QUOTA_BODY = JSON.stringify({
    error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for quota metric" },
  });

  it("shows the limit message and step 4's links, never Google's own words", async () => {
    stubFetch(() => new Response(QUOTA_BODY, { status: 429 }));
    const html = await (await signedIn(`/parts/vendors/${SEARCH}`)).text();
    expect(unescapeHtml(html)).toContain(
      "Vendor search hit today's Google limit. Use the links below instead.",
    );
    for (const word of ["RESOURCE_EXHAUSTED", "Quota exceeded", "429"]) {
      expect(html).not.toContain(word);
    }
    const links = hrefs(html);
    expect(links.some((h) => h.startsWith("https://www.google.co.in/search?q="))).toBe(true);
    expect(links.some((h) => h.startsWith("https://www.google.com/maps/search/"))).toBe(true);
    expect(html).toContain("Caterpillar parts shops on Google Maps");
    expect(html).toContain("JCB parts shops on Google Maps");
    expect(html).not.toContain('class="vendor"');
  });

  it("treats a 403 that names a quota the same way", async () => {
    stubFetch(() => new Response(QUOTA_BODY, { status: 403 }));
    const html = unescapeHtml(await (await signedIn(`/parts/vendors/${SEARCH}`)).text());
    expect(html).toContain("Vendor search hit today's Google limit.");
  });

  it("says something neutral for anything else, with the same links", async () => {
    stubFetch(() => new Response("kaboom", { status: 500 }));
    const html = unescapeHtml(await (await signedIn(`/parts/vendors/${SEARCH}`)).text());
    expect(html).toContain("Vendor search isn't available right now. Use the links below instead.");
    expect(html).not.toContain("kaboom");
    expect(html).toContain("Caterpillar parts shops on Google Maps");
  });

  it("falls back the same way with no key at all, and calls nothing", async () => {
    const calls = stubFetch(searchReply);
    const res = await worker.fetch(
      new Request(`https://rohitrao.in/parts/vendors/${SEARCH}`, {
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

describe("the way in from the public page", () => {
  it("links the recognised numbers, never the pasted text", async () => {
    const pasted = "need 1u3352 and 40/300893 for JCB 3CX, call Ramesh 9845012345";
    const res = await worker.fetch(
      new Request(
        `https://rohitrao.in/parts/?q=${encodeURIComponent(pasted)}&city=Bengaluru&country=IN`,
      ),
      {},
    );
    const html = await res.text();
    expect(html).toContain("Find vendors for these parts");
    const href = hrefs(html).find((h) => h.startsWith("/parts/vendors/"))!;
    const carried = new URL(href, "https://rohitrao.in").searchParams;
    expect(carried.get("q")).toBe("1U3352 40/300893");
    expect(carried.get("city")).toBe("Bengaluru");
    expect(carried.get("country")).toBe("IN");
    expect(href).not.toContain("Ramesh");
    expect(href).not.toContain("9845012345");
  });

  it("offers no vendor link when nothing was recognised", async () => {
    const res = await worker.fetch(
      new Request(`https://rohitrao.in/parts/?q=${encodeURIComponent("hello there")}`),
      {},
    );
    const html = await res.text();
    expect(html).not.toContain("Find vendors for these parts");
  });
});
