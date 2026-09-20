// Step 7: the passcode gate is gone, and the page render calls nobody.
//
// No network. Global fetch is stubbed in every test, and every test here asserts the stub was
// never called: rendering /parts/ must never reach Google or Cloudflare.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Q,
  SEARCH,
  env,
  get,
  searchReply,
  stubFetch,
} from "./helpers";

afterEach(() => vi.unstubAllGlobals());

describe("the page render", () => {
  it("asks Google nothing, whoever is asking", async () => {
    const calls = stubFetch(searchReply);
    const res = await get(`/parts/${SEARCH}`);
    const html = await res.text();
    expect(calls).toHaveLength(0);
    expect(html).toContain('class="card"');
    expect(html).toContain("Caterpillar parts shops on Google Maps");
    expect(html).toContain("Search suppliers on Google");
  });

  it("offers no sign-in, and sets no session cookie", async () => {
    const res = await get(`/parts/${SEARCH}`);
    const html = await res.text();
    expect(html).not.toContain("Owner sign-in");
    expect(html).not.toContain("Sign out");
    expect(html).not.toContain("passcode");
    expect(res.headers.getSetCookie().join(" ")).not.toContain("pf_vendor");
  });

  it("keeps the Places key and the Turnstile secret out of every response", async () => {
    stubFetch(searchReply);
    for (const path of [`/parts/${SEARCH}`, `/parts/?q=${encodeURIComponent(Q)}`, "/parts/terms"]) {
      const res = await get(path);
      const body = await res.text();
      const headers = [...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n");
      for (const secret of [env.GOOGLE_PLACES_KEY, env.TURNSTILE_SECRET_KEY]) {
        expect(body, path).not.toContain(secret);
        expect(headers, path).not.toContain(secret);
      }
    }
  });
});

describe("the old passcode routes", () => {
  it("all 302 to the page, keeping the query", async () => {
    for (const path of [
      "/parts/vendors/login",
      "/parts/vendors/logout",
      "/parts/vendors/",
      "/parts/vendors/contact",
      "/parts/vendors",
    ]) {
      const res = await get(`${path}${SEARCH}`);
      expect(res.status, path).toBe(302);
      expect(res.headers.get("Location"), path).toBe(
        "/parts/?q=1u3352+40%2F300893&city=Bengaluru&country=IN",
      );
      expect(res.headers.get("Cache-Control"), path).toBe("no-store");
      expect(res.headers.get("Set-Cookie"), path).toBe(null);
    }
  });

  it("redirects a POST to the old login too, rather than stranding the browser", async () => {
    const res = await get("/parts/vendors/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "passcode=anything",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/parts/");
  });

  it("redirects to the bare page when there is no query", async () => {
    expect((await get("/parts/vendors/")).headers.get("Location")).toBe("/parts/");
  });

  it("carries the three parameters the page reads, and drops the rest", async () => {
    const res = await get(
      "/parts/vendors/?q=1u3352&city=Bengaluru&country=IN" +
        "&v=leftover&scope_leftover=all&utm_source=somewhere",
    );
    expect(res.headers.get("Location")).toBe("/parts/?q=1u3352&city=Bengaluru&country=IN");
  });
});

describe("the remembered city and country", () => {
  it("is set when one is typed, and prefills the field next time", async () => {
    const res = await get(`/parts/${SEARCH}`);
    // Two cookies, so they are read as a list: Headers.get() would join them with a comma.
    expect(res.headers.getSetCookie()).toEqual([
      "pf_city=Bengaluru; HttpOnly; Secure; SameSite=Lax; Path=/parts/; Max-Age=2592000",
      "pf_country=IN; HttpOnly; Secure; SameSite=Lax; Path=/parts/; Max-Age=2592000",
    ]);

    const back = await get(`/parts/?q=${encodeURIComponent(Q)}`, {
      headers: { Cookie: "pf_city=Bengaluru; pf_country=IN" },
    });
    const html = await back.text();
    expect(html).toContain('id="city" name="city" type="text" value="Bengaluru"');
    // Nothing was typed, so nothing is rewritten.
    expect(back.headers.getSetCookie()).toEqual([]);
  });
});
