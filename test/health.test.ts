// Step 7b: GET /parts/api/health, the endpoint that exists so a misconfigured Worker cannot go
// on looking like a working one.
//
// No network. Global fetch is stubbed in every case and asserted never to have been called: a
// health check must reach neither Google nor Cloudflare, or it would cost something to ask.

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { BLOCKER_REASONS, HEALTH_SAMPLE } from "../src/health";
import { env, stubFetch } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

interface KeyState {
  present: boolean;
  length: number;
}

interface Health {
  ok: boolean;
  env: {
    placesKey: KeyState;
    mapsBrowserKey: KeyState;
    turnstileSiteKey: KeyState;
    turnstileSecret: KeyState;
  };
  render: { suppliersSectionWouldRender: boolean; reasons: string[] };
}

const health = (bindings: Record<string, string> = env, init?: RequestInit) =>
  worker.fetch(new Request("https://rohitrao.in/parts/api/health", init), bindings as never);

/** The four names, and the value each one holds in `env`, so nothing has to be repeated below. */
const KEYS = [
  ["placesKey", "GOOGLE_PLACES_KEY"],
  ["mapsBrowserKey", "GOOGLE_MAPS_BROWSER_KEY"],
  ["turnstileSiteKey", "TURNSTILE_SITE_KEY"],
  ["turnstileSecret", "TURNSTILE_SECRET_KEY"],
] as const;

describe("GET /parts/api/health", () => {
  it("answers JSON, noindex and no-store, and calls nothing", async () => {
    const calls = stubFetch(() => new Response("{}"));
    const res = await health();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(calls).toHaveLength(0);
  });

  it("reports every binding as a present flag and a length, and nothing else", async () => {
    const body = (await (await health()).json()) as Health;
    expect(body.ok).toBe(true);
    expect(Object.keys(body.env)).toEqual(KEYS.map(([field]) => field));
    for (const [field, name] of KEYS) {
      expect(body.env[field], field).toEqual({ present: true, length: env[name].length });
    }
    expect(Object.keys(body.render)).toEqual(["suppliersSectionWouldRender", "reasons"]);
  });

  it("says the section would render, with no reasons, when every key is set", async () => {
    const body = (await (await health()).json()) as Health;
    expect(body.render.suppliersSectionWouldRender).toBe(true);
    expect(body.render.reasons).toEqual([]);
  });

  it("names the Turnstile site key, and only it, when that is what is missing", async () => {
    const { TURNSTILE_SITE_KEY: _absent, ...rest } = env;
    const body = (await (await health(rest)).json()) as Health;
    expect(body.env.turnstileSiteKey).toEqual({ present: false, length: 0 });
    expect(body.render.suppliersSectionWouldRender).toBe(false);
    expect(body.render.reasons).toEqual([BLOCKER_REASONS.no_site_key]);
    expect(body.render.reasons[0]).toContain("TURNSTILE_SITE_KEY");
  });

  it("tells a secret that was set empty apart from one that was never set", async () => {
    const body = (await (await health({ ...env, TURNSTILE_SITE_KEY: "" })).json()) as Health;
    // The dashboard shows both of these as a secret that exists. This is where they differ.
    expect(body.env.turnstileSiteKey).toEqual({ present: true, length: 0 });
    expect(body.render.suppliersSectionWouldRender).toBe(false);
    expect(body.render.reasons).toEqual([BLOCKER_REASONS.no_site_key]);
  });

  it("answers with no key set at all, because that is when it is most needed", async () => {
    const res = await health({});
    expect(res.status).toBe(200);
    const body = (await res.json()) as Health;
    expect(body.ok).toBe(true);
    for (const [field] of KEYS) {
      expect(body.env[field], field).toEqual({ present: false, length: 0 });
    }
    expect(body.render.suppliersSectionWouldRender).toBe(false);
    expect(body.render.reasons).toEqual([BLOCKER_REASONS.no_site_key]);
  });

  it("holds no key value, whatever is set", async () => {
    for (const bindings of [env, { ...env, TURNSTILE_SITE_KEY: "" }]) {
      const text = await (await health(bindings)).text();
      for (const [, name] of KEYS) expect(text, name).not.toContain(env[name]);
    }
  });

  it("holds no part of a key either, not even its first few characters", async () => {
    // Keys shaped the way real ones are: opaque, so a fragment of one cannot be a word that
    // belongs in the answer. The readable fixtures above could not tell the two apart.
    const opaque: Record<string, string> = {
      GOOGLE_PLACES_KEY: "AIzaSyD7Qp2fKx9vLmN4bR8tUwE3hJ6cZaY1sXo",
      GOOGLE_MAPS_BROWSER_KEY: "AIzaSyB2Mn5rTc8qWd1zVfX7gK4pL9hJ3eRuYiA",
      TURNSTILE_SITE_KEY: "0x4QQBnP7yLkVdMz2Rf",
      TURNSTILE_SECRET_KEY: "0x4QQCwJ8nHtXsGb3Aq5Ue7Kv1Md9Rz",
    };
    const text = await (await health(opaque)).text();
    for (const [, name] of KEYS) {
      const value = opaque[name]!;
      for (let cut = 4; cut <= value.length; cut++) {
        expect(text.includes(value.slice(0, cut)), `${name} first ${cut}`).toBe(false);
      }
    }
  });

  it("answers about a fixed sample query, so two answers are comparable", () => {
    expect(HEALTH_SAMPLE).toEqual({ q: "1u3352", city: "Bengaluru", country: "IN" });
  });
});

describe("what /parts/api/health refuses", () => {
  it("answers 405 with Allow: GET to every other method, and still calls nothing", async () => {
    const calls = stubFetch(() => new Response("{}"));
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const res = await health(env, { method });
      expect(res.status, method).toBe(405);
      expect(res.headers.get("Allow"), method).toBe("GET");
      expect(res.headers.get("Cache-Control"), method).toBe("no-store");
      expect(res.headers.get("X-Robots-Tag"), method).toBe("noindex");
      const text = await res.text();
      for (const [, name] of KEYS) expect(text, name).not.toContain(env[name]);
    }
    expect(calls).toHaveLength(0);
  });
});
