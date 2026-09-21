// Step 9: where a supplier search looks, and what it asks for.
//
// No network: Cloudflare's siteverify and Google Places are both stubbed, and every case asserts
// what was sent rather than what came back.

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { asksFor, areaOf, resolveScope } from "../src/vendors/search";
import { groupByOem } from "../src/vendors/search";
import { outbound, readQuery } from "../src/page";
import {
  Q,
  apiReply,
  env,
  get,
  isOriginCall,
  place,
  placesCalls,
  postSuppliers,
  searchReply,
  shopSearches,
  stubFetch,
} from "./helpers";

afterEach(() => vi.unstubAllGlobals());

/** Every textQuery the round sent to Google, in order, leaving out the origin call. */
const queries = (calls: Parameters<typeof shopSearches>[0]) =>
  shopSearches(calls).map((call) => String((call.body as { textQuery: string }).textQuery));

const biased = (calls: Parameters<typeof shopSearches>[0]) =>
  shopSearches(calls).map((call) => Object.keys(call.body as object).includes("locationBias"));

describe("which scope a page view is at", () => {
  it("is India with no city, and near one with a city", () => {
    expect(resolveScope("", "")).toBe("india");
    expect(resolveScope("   ", "")).toBe("india");
    expect(resolveScope("Bengaluru", "")).toBe("near");
    expect(resolveScope("Bengaluru", "india")).toBe("india");
    expect(resolveScope("Bengaluru", "INDIA")).toBe("india");
    expect(resolveScope("Bengaluru", "anything else")).toBe("near");
  });

  it("is never stored: no cookie asks for it and none carries it", async () => {
    stubFetch(searchReply);
    const res = await get(`/parts/?q=${encodeURIComponent(Q)}&city=Bengaluru&scope=india`);
    const cookies = res.headers.get("Set-Cookie") ?? "";
    expect(cookies).not.toContain("scope");
    expect(cookies).not.toContain("india");
  });
});

describe("the chips above the list", () => {
  it("shows both when there is a city, with the current one pressed", async () => {
    stubFetch(searchReply);
    const html = await (await get(`/parts/?q=${encodeURIComponent(Q)}&city=Bengaluru`)).text();
    expect(html).toContain("<h2>Suppliers near Bengaluru</h2>");
    expect(html).toContain(">Near Bengaluru<");
    expect(html).toContain(">All India<");
    const scopes = html.slice(html.indexOf('<div class="scopes">'), html.indexOf("</div>", html.indexOf('<div class="scopes">')));
    expect(scopes).toMatch(/Near Bengaluru/);
    // The pressed one is the scope this page is at.
    expect(/aria-pressed="true">Near Bengaluru/.test(scopes)).toBe(true);
    expect(/aria-pressed="false">All India/.test(scopes)).toBe(true);
  });

  it("shows only All India when there is no city to be near", async () => {
    stubFetch(searchReply);
    const html = await (await get(`/parts/?q=${encodeURIComponent(Q)}`)).text();
    expect(html).toContain("<h2>Suppliers in India</h2>");
    expect(html).toContain(">All India<");
    expect(html).not.toContain(">Near ");
  });

  it("keeps the query on the link, and carries the flag only when it means India", async () => {
    stubFetch(searchReply);
    const html = await (await get(`/parts/?q=${encodeURIComponent(Q)}&city=Bengaluru`)).text();
    const hrefs = [...html.matchAll(/<a class="chip filter" href="([^"]*)"/g)].map((m) =>
      m[1]!.replaceAll("&amp;", "&"),
    );
    expect(hrefs).toHaveLength(2);
    for (const href of hrefs) {
      const params = new URL(href, "https://rohitrao.in").searchParams;
      expect(params.get("q")).toBe(Q);
      expect(params.get("city")).toBe("Bengaluru");
      expect(params.get("country")).toBe("IN");
    }
    expect(hrefs[0]).not.toContain("scope=");
    expect(hrefs[1]).toContain("scope=india");
  });
});

describe("searching all of India", () => {
  const ask = (body: Record<string, unknown>) => postSuppliers({ token: "t", q: Q, country: "IN", ...body });

  it("names the country, biases nothing, and never places a city", async () => {
    const calls = stubFetch(apiReply());
    await ask({});
    expect(calls.filter(isOriginCall), "no origin call").toHaveLength(0);
    for (const query of queries(calls)) expect(query, query).toContain(" in India");
    expect(biased(calls)).toEqual([false, false, false]);
  });

  it("does the same with a city when the flag asks for it, and keeps both chips", async () => {
    const calls = stubFetch(apiReply());
    await ask({ city: "Bengaluru", scope: "india" });
    expect(calls.filter(isOriginCall)).toHaveLength(0);
    for (const query of queries(calls)) expect(query, query).toContain(" in India");
    expect(biased(calls).some(Boolean)).toBe(false);

    stubFetch(searchReply);
    const html = await (
      await get(`/parts/?q=${encodeURIComponent(Q)}&city=Bengaluru&scope=india`)
    ).text();
    expect(html).toContain(">Near Bengaluru<");
    expect(html).toContain(">All India<");
    expect(html).toContain("<h2>Suppliers in India</h2>");
  });

  it("shows where a shop is instead of how far it is", async () => {
    stubFetch(apiReply());
    const res = await ask({});
    const { html } = (await res.json()) as { html: string };
    expect(html).toContain('<span class="sarea">Indiranagar</span>');
    expect(html).not.toContain('class="sdist"');
  });

  it("still measures from you when the browser shared a location", async () => {
    stubFetch(apiReply());
    const res = await ask({ near: "12.972,77.595" });
    const { html } = (await res.json()) as { html: string };
    expect(html).toContain("from you");
    expect(html).not.toContain('class="sarea"');
  });

  it("ranks by matched parts, then rating weighted by how many rated it", async () => {
    // Two shops the brand searches both found, and two only the trade search did. Among the
    // latter, a 5.0 from two reviews must not outrank a 4.4 from six hundred.
    const calls = stubFetch((call) => {
      if (call.url.includes("siteverify")) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      const query = String((call.body as { textQuery: string }).textQuery);
      if (query.startsWith("Caterpillar")) return json([place("both", "Both Brands")]);
      if (query.startsWith("JCB")) return json([place("both", "Both Brands")]);
      return json([
        place("few", "Few Reviews", { rating: 5, userRatingCount: 2 }),
        place("many", "Many Reviews", { rating: 4.4, userRatingCount: 600 }),
      ]);
    });
    const res = await postSuppliers({ token: "t", q: Q, country: "IN" });
    const { queue } = (await res.json()) as { queue: { name: string }[] };
    expect(queue.map((row) => row.name)).toEqual(["Both Brands", "Many Reviews", "Few Reviews"]);
    expect(placesCalls(calls).filter(isOriginCall)).toHaveLength(0);
  });
});

const json = (places: unknown[]) => new Response(JSON.stringify({ places }), { status: 200 });

describe("what each kind of card asks Google for", () => {
  const asks = (q: string) => {
    const { results } = readQuery(q, "");
    const sending = outbound(results);
    return asksFor(sending, groupByOem(sending).groups);
  };

  it("asks per brand for a described part, then by the name", () => {
    const plan = asks("ex200 pin pivot");
    expect(plan.map((a) => a.subject)).toEqual([
      "Hitachi spare parts dealer",
      "Tata Hitachi spare parts dealer",
      "pin pivot supplier",
    ]);
    expect(plan.map((a) => a.oem)).toEqual(["Hitachi", "Tata Hitachi", null]);
    for (const one of plan) expect(one.parts).toEqual(["desc:EX200:pin pivot"]);
  });

  it("asks by the words around a number nobody placed", () => {
    const plan = asks("9ZZ123456 CVVT");
    expect(plan.map((a) => a.subject)).toEqual(["cvvt spare parts"]);
    expect(plan[0]!.parts).toEqual(["9ZZ123456"]);
  });

  it("asks nothing for a number with no words around it", () => {
    expect(asks("9ZZ123456")).toEqual([]);
  });

  it("asks nothing by the words once there is more than one part to attach them to", () => {
    // The same rule as the message line, and for the same reason: the query would be about a
    // part nobody said it was about. It falls out of the field being the same one.
    expect(asks("9ZZ123456 8YY654321 CVVT")).toEqual([]);
    expect(asks("1u3352 9ZZ123456 CVVT").map((a) => a.subject)).toEqual([
      "Caterpillar spare parts dealer",
      "earthmoving spare parts",
    ]);
    // One part, and the words are its own again.
    expect(asks("9ZZ123456 CVVT").map((a) => a.subject)).toEqual(["cvvt spare parts"]);
  });

  it("sends those queries with a place attached", async () => {
    const calls = stubFetch(apiReply());
    await postSuppliers({ token: "t", q: "9ZZ123456 CVVT", country: "IN" });
    expect(queries(calls)).toEqual(["cvvt spare parts in India"]);
  });

  it("makes no call at all for a number with no words", async () => {
    const calls = stubFetch(apiReply());
    await postSuppliers({ token: "t", q: "9ZZ123456", country: "IN" });
    expect(shopSearches(calls)).toHaveLength(0);
  });

  it("writes the described part's queue message as a sentence", async () => {
    stubFetch(apiReply());
    const res = await postSuppliers({ token: "t", q: "ex200 pin pivot", country: "IN" });
    const { queue } = (await res.json()) as { queue: { waMatched: string }[] };
    const text = decodeURIComponent(queue[0]!.waMatched.split("?text=")[1]!);
    expect(text).toContain("Pin pivot for EX200 (Hitachi or Tata Hitachi)");
  });

  it("never asks for more than four searches", () => {
    const plan = asks("1u3352 40/300893 6754611102 24370-2E000");
    expect(plan.length).toBeLessThanOrEqual(4);
  });
});

describe("the area a card shows", () => {
  it("is the last component of Google's short address, without the postcode", () => {
    const at = (shortAddress: string, address = "") =>
      areaOf({ shortAddress, address } as Parameters<typeof areaOf>[0]);
    expect(at("Shared Spares, Indiranagar")).toBe("Indiranagar");
    expect(at("MG Road, Bengaluru 560001")).toBe("Bengaluru");
    expect(at("", "A Shop, Peenya, Bengaluru 560058, India")).toBe("India");
    expect(at("")).toBe("");
  });
});
