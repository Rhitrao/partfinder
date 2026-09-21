// Step 7: POST /parts/api/suppliers, the only path that reaches Google.
//
// No network. Both hosts it talks to - Cloudflare's siteverify and Google Places - are stubbed,
// and every test that expects no Google call asserts the stub recorded none.

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { TEXT_SEARCH_FIELD_MASK } from "../src/vendors/places";
import {
  CITY_CENTRE,
  Q,
  apiReply,
  env,
  get,
  isOriginCall,
  isVerifyCall,
  place,
  placesCalls,
  postSuppliers,
  searchReply,
  shopSearches,
  stubFetch,
  unescapeHtml,
} from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const ASK = { token: "a-token", q: Q, city: "Bengaluru", country: "IN" };

interface Answer {
  html?: string;
  pins?: { n: number; name: string; lat: number; lng: number; you?: boolean }[];
  queue?: { n: number; name: string; matchedParts: string[]; waMatched: string; waAll: string; tel: string }[];
  error?: string;
}

describe("what the endpoint refuses before it costs anything", () => {
  it("answers 405 to a GET and 415 to the wrong content type", async () => {
    const calls = stubFetch(apiReply());
    const wrongMethod = await postSuppliers(ASK, { method: "GET" });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("Allow")).toBe("POST");

    for (const contentType of ["application/x-www-form-urlencoded", "text/plain", null]) {
      const res = await postSuppliers(ASK, { contentType });
      expect(res.status, String(contentType)).toBe(415);
    }
    expect(calls).toHaveLength(0);
  });

  it("answers 403 to a wrong or missing Origin", async () => {
    const calls = stubFetch(apiReply());
    for (const origin of ["https://elsewhere.example", "http://rohitrao.in", null]) {
      const res = await postSuppliers(ASK, { origin });
      expect(res.status, String(origin)).toBe(403);
    }
    expect(calls).toHaveLength(0);
  });

  it("answers 403 {error:verify} to a missing token, and never asks Google", async () => {
    const calls = stubFetch(apiReply());
    const res = await postSuppliers({ ...ASK, token: "" });
    expect(res.status).toBe(403);
    // Cloudflare's own name for an empty response field, without asking Cloudflare for it.
    expect(await res.json()).toEqual({ error: "verify", codes: ["missing-input-response"] });
    expect(placesCalls(calls)).toHaveLength(0);
  });

  it("answers 403 {error:verify} when Cloudflare says the token is no good", async () => {
    const calls = stubFetch(apiReply(false));
    const res = await postSuppliers(ASK);
    expect(res.status).toBe(403);
    // apiReply(false) is a bare {success:false} with no error-codes at all.
    expect(await res.json()).toEqual({ error: "verify", codes: ["unknown"] });
    expect(placesCalls(calls)).toHaveLength(0);
    // It did ask Cloudflare, form-encoded, with the secret and the token.
    const verify = calls.filter(isVerifyCall);
    expect(verify).toHaveLength(1);
    expect(verify[0]!.method).toBe("POST");
    expect(verify[0]!.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(verify[0]!.body).toMatchObject({ secret: env.TURNSTILE_SECRET_KEY, response: "a-token" });
  });

  it("refuses everything when no Turnstile secret is configured", async () => {
    const calls = stubFetch(apiReply());
    const res = await worker.fetch(
      new Request("https://rohitrao.in/parts/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://rohitrao.in" },
        body: JSON.stringify(ASK),
      }),
      { GOOGLE_PLACES_KEY: "k" },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "verify", codes: ["missing-input-secret"] });
    expect(calls).toHaveLength(0);
  });
});

describe("a verified search", () => {
  it("places the city, searches once per brand and once for all, with the step 6 field mask", async () => {
    const calls = stubFetch(apiReply());
    const res = await postSuppliers(ASK);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");

    const google = placesCalls(calls);
    expect(google).toHaveLength(4);
    expect(isOriginCall(google[0]!)).toBe(true);
    expect(google[0]!.body).toMatchObject({ textQuery: "Bengaluru, India", pageSize: 1 });

    const searches = shopSearches(calls);
    expect(searches.map((c) => c.body?.textQuery)).toEqual([
      "Caterpillar spare parts dealer in Bengaluru, India",
      "JCB spare parts dealer in Bengaluru, India",
      "earthmoving spare parts in Bengaluru, India",
    ]);
    for (const call of searches) {
      expect(call.headers["X-Goog-FieldMask"]).toBe(TEXT_SEARCH_FIELD_MASK);
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

  it("answers with numbered cards, pins and a queue", async () => {
    stubFetch(apiReply());
    const answer = (await (await postSuppliers(ASK)).json()) as Answer;
    const html = answer.html!;
    expect(html).toContain('<span class="pin">1</span> Shared Spares');
    expect(html).toContain('<span class="pin">2</span> Cat Corner');
    expect(html).toContain('id="pf-shop-3"');
    expect(html).toContain('<div class="filters" id="pf-filters"></div>');
    expect(unescapeHtml(html)).toContain("Listed doesn't mean in stock");
    expect(html).toContain("from Bengaluru centre");

    expect(answer.pins).toEqual([
      { n: 1, name: "Shared Spares", lat: 12.978, lng: 77.64 },
      { n: 2, name: "Cat Corner", lat: 12.978, lng: 77.64 },
      { n: 3, name: "Multi Brand Traders", lat: 12.978, lng: 77.64 },
    ]);
    expect(answer.queue!.map((row) => row.n)).toEqual([1, 2, 3]);
    expect(answer.queue![0]).toMatchObject({
      name: "Shared Spares",
      matchedParts: ["1U-3352", "40/300893"],
      tel: "+919876543210",
    });
  });

  it("asks a Caterpillar-only shop about 1U-3352 and its quantity, and nothing else", async () => {
    stubFetch(apiReply());
    const answer = (await (
      await postSuppliers({ ...ASK, qty: { "1U-3352": 4, "40/300893": 2 } })
    ).json()) as Answer;
    const catOnly = answer.queue!.find((row) => row.name === "Cat Corner")!;
    const matched = decodeURIComponent(catOnly.waMatched.split("?text=")[1]!);
    expect(matched).toContain("1. 1U-3352 (likely Caterpillar), qty 4");
    expect(matched).not.toContain("40/300893");
    // The wider message is built too, so the script never has to write one.
    const all = decodeURIComponent(catOnly.waAll.split("?text=")[1]!);
    expect(all).toContain("1U-3352 (likely Caterpillar), qty 4");
    expect(all).toContain("40/300893 (likely JCB), qty 2");
  });

  it("measures from a shared location, makes no origin call, and pins you", async () => {
    const calls = stubFetch(apiReply());
    const answer = (await (
      await postSuppliers({ ...ASK, near: "12.9352,77.5467" })
    ).json()) as Answer;
    expect(placesCalls(calls).some(isOriginCall)).toBe(false);
    expect(placesCalls(calls)).toHaveLength(3);
    // Rounded to three decimals, in the bias and in the pin alike.
    expect(placesCalls(calls)[0]!.body).toMatchObject({
      locationBias: { circle: { center: { latitude: 12.935, longitude: 77.547 } } },
    });
    expect(answer.pins).toContainEqual({ n: 0, name: "you", lat: 12.935, lng: 77.547, you: true });
    expect(answer.html).toContain("from you");
  });

  it("recomputes the numbers itself, whatever the client claims to hold", async () => {
    stubFetch(apiReply());
    // A phone number and a price in q reach neither a card nor a message.
    const answer = (await (
      await postSuppliers({ ...ASK, q: "Ramesh 8012345678 needs 1u3352 at Rs 4500" })
    ).json()) as Answer;
    for (const secret of ["8012345678", "4500", "Ramesh"]) {
      expect(answer.html, secret).not.toContain(secret);
      expect(JSON.stringify(answer.queue), secret).not.toContain(secret);
    }
  });
});

describe("when something will not answer", () => {
  it("says unavailable for a spent quota, and never Google's own words", async () => {
    stubFetch((call) =>
      isVerifyCall(call)
        ? new Response(JSON.stringify({ success: true }), { status: 200 })
        : new Response(
            JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } }),
            { status: 429 },
          ),
    );
    const res = await postSuppliers(ASK);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ error: "unavailable" });
    expect(body).not.toContain("RESOURCE_EXHAUSTED");
  });

  it("says unavailable with no Places key, having called nothing at Google", async () => {
    const calls = stubFetch(apiReply());
    const res = await worker.fetch(
      new Request("https://rohitrao.in/parts/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://rohitrao.in" },
        body: JSON.stringify(ASK),
      }),
      { TURNSTILE_SECRET_KEY: "s" },
    );
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(placesCalls(calls)).toHaveLength(0);
  });

  it("says city when Google cannot place it", async () => {
    stubFetch((call) =>
      isVerifyCall(call)
        ? new Response(JSON.stringify({ success: true }), { status: 200 })
        : new Response(JSON.stringify(isOriginCall(call) ? {} : { places: [] }), { status: 200 }),
    );
    const res = await postSuppliers({ ...ASK, city: "Bengalru" });
    expect(await res.json()).toEqual({ error: "city" });
  });
});

describe("what a shop name cannot do", () => {
  it("comes back escaped, however it is spelled", async () => {
    const nasty = 'Bad <img onerror=alert(1)> and </script> Spares';
    stubFetch((call) =>
      isVerifyCall(call)
        ? new Response(JSON.stringify({ success: true }), { status: 200 })
        : isOriginCall(call)
          ? new Response(JSON.stringify({ places: [{ location: CITY_CENTRE }] }), { status: 200 })
          : new Response(JSON.stringify({ places: [place("x", nasty)] }), { status: 200 }),
    );
    const answer = (await (await postSuppliers(ASK)).json()) as Answer;
    expect(answer.html).not.toContain("<img");
    expect(answer.html).not.toContain("</script>");
    expect(answer.html).toContain("&lt;img onerror=alert(1)&gt;");
    expect(answer.html).toContain("&lt;/script&gt;");
    // The name is still the name in the queue, where it only ever becomes textContent.
    expect(answer.queue![0]!.name).toBe(nasty);
  });
});

describe("the two secrets", () => {
  it("never appear in a response body or a response header", async () => {
    const bodies: { token?: string; q?: string; city?: string; country?: string }[] = [
      ASK,
      { ...ASK, token: "" },
      { ...ASK, city: "Bengalru" },
    ];
    for (const body of bodies) {
      for (const reply of [apiReply(), apiReply(false)]) {
        stubFetch(reply);
        const res = await postSuppliers(body);
        const text = await res.text();
        const headers = [...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n");
        for (const secret of [env.GOOGLE_PLACES_KEY, env.TURNSTILE_SECRET_KEY]) {
          expect(text).not.toContain(secret);
          expect(headers).not.toContain(secret);
        }
      }
    }
  });

  it("stay out of the page that will call the endpoint", async () => {
    stubFetch(searchReply);
    const res = await get(`/parts/?q=${encodeURIComponent(Q)}&city=Bengaluru`);
    const html = await res.text();
    expect(html).toContain(env.TURNSTILE_SITE_KEY);
    expect(html).not.toContain(env.TURNSTILE_SECRET_KEY);
    expect(html).not.toContain(env.GOOGLE_PLACES_KEY);
  });
});
