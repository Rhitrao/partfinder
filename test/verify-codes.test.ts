// Step 8c: what a Turnstile refusal says, and what it must never say.
//
// No network: siteverify is stubbed in every case, and Google is asserted never to have been
// asked. The point of the file is the second half of that title - the codes exist to be
// diagnosable, and the test that matters most is the one proving they carry nothing else.

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { UNKNOWN, UNREACHABLE, readCodes } from "../src/vendors/turnstile";
import { Q, env, isVerifyCall, placesCalls, searchReply, stubFetch } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const ASK = { token: "a-token", q: Q, city: "Bengaluru", country: "IN" };

/** POSTs to the endpoint with siteverify answering however `verify` says. */
async function ask(verify: (call: { url: string }) => Response, body = ASK) {
  const calls = stubFetch((call) => (isVerifyCall(call) ? verify(call) : searchReply(call)));
  const res = await worker.fetch(
    new Request("https://rohitrao.in/parts/api/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://rohitrao.in" },
      body: JSON.stringify(body),
    }),
    env,
  );
  const text = await res.text();
  return { res, text, json: JSON.parse(text) as { error?: string; codes?: string[] }, calls };
}

const siteverify = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status });

describe("what Cloudflare said", () => {
  it("returns a spent token's code rather than a bare refusal", async () => {
    const { res, json, calls } = await ask(() =>
      siteverify({ success: false, "error-codes": ["timeout-or-duplicate"] }),
    );
    expect(res.status).toBe(403);
    expect(json).toEqual({ error: "verify", codes: ["timeout-or-duplicate"] });
    // Still costs nothing: Google is never reached on a refusal.
    expect(placesCalls(calls)).toHaveLength(0);
  });

  it("returns a wrong secret's code, which is a different problem with a different fix", async () => {
    const { json } = await ask(() =>
      siteverify({ success: false, "error-codes": ["invalid-input-secret"] }),
    );
    expect(json).toEqual({ error: "verify", codes: ["invalid-input-secret"] });
  });

  it("returns every code when Cloudflare gives more than one", async () => {
    const { json } = await ask(() =>
      siteverify({ success: false, "error-codes": ["invalid-input-response", "bad-request"] }),
    );
    expect(json.codes).toEqual(["invalid-input-response", "bad-request"]);
  });

  it("says unknown when the refusal carries no code at all", async () => {
    const { json } = await ask(() => siteverify({ success: false }));
    expect(json).toEqual({ error: "verify", codes: [UNKNOWN] });
  });

  it("asks siteverify exactly once, because asking twice is what spends a token twice", async () => {
    const { calls } = await ask(() =>
      siteverify({ success: false, "error-codes": ["timeout-or-duplicate"] }),
    );
    expect(calls.filter(isVerifyCall)).toHaveLength(1);
  });
});

describe("when Cloudflare said nothing", () => {
  it("names a network failure rather than blaming the token", async () => {
    const { res, json } = await ask(() => {
      throw new Error("connection reset");
    });
    expect(res.status).toBe(403);
    expect(json).toEqual({ error: "verify", codes: [UNREACHABLE] });
  });

  it("says the same for an HTTP error and for a body that will not parse", async () => {
    const http = await ask(() => siteverify({ success: true }, 502));
    expect(http.json).toEqual({ error: "verify", codes: [UNREACHABLE] });

    const garbage = await ask(() => new Response("<html>gateway</html>", { status: 200 }));
    expect(garbage.json).toEqual({ error: "verify", codes: [UNREACHABLE] });

    const notAnObject = await ask(() => siteverify("yes"));
    expect(notAnObject.json).toEqual({ error: "verify", codes: [UNREACHABLE] });
  });

  it("never falls open: an unreachable siteverify is still a refusal", async () => {
    const { res, calls } = await ask(() => {
      throw new Error("timeout");
    });
    expect(res.status).toBe(403);
    expect(placesCalls(calls)).toHaveLength(0);
  });
});

describe("what a refusal must never carry", () => {
  /** Every shape of no there is, so the assertion below covers all of them. */
  const refusals = [
    { name: "spent token", reply: () => siteverify({ success: false, "error-codes": ["timeout-or-duplicate"] }) },
    { name: "bad secret", reply: () => siteverify({ success: false, "error-codes": ["invalid-input-secret"] }) },
    { name: "no codes", reply: () => siteverify({ success: false }) },
    { name: "unreachable", reply: () => { throw new Error("down"); } },
    { name: "garbage body", reply: () => new Response("nope") },
  ];

  it("holds neither the token nor the secret, in any of them", async () => {
    for (const { name, reply } of refusals) {
      const { text } = await ask(reply);
      expect(text, name).not.toContain(ASK.token);
      expect(text, name).not.toContain(env.TURNSTILE_SECRET_KEY);
      expect(text, name).not.toContain(env.GOOGLE_PLACES_KEY);
    }
  });

  it("holds nothing from the siteverify body but the codes themselves", async () => {
    const { text, json } = await ask(() =>
      siteverify({
        success: false,
        "error-codes": ["timeout-or-duplicate"],
        hostname: "rohitrao.in",
        challenge_ts: "2026-09-21T02:00:00.000Z",
        action: "",
        cdata: "something-internal",
      }),
    );
    expect(json).toEqual({ error: "verify", codes: ["timeout-or-duplicate"] });
    for (const leaked of ["hostname", "challenge_ts", "cdata", "something-internal"]) {
      expect(text, leaked).not.toContain(leaked);
    }
  });

  it("drops anything not shaped like one of Cloudflare's codes", async () => {
    // A siteverify body that is not what we expected cannot push a value through.
    const { json } = await ask(() =>
      siteverify({
        success: false,
        "error-codes": [
          "timeout-or-duplicate",
          "0x4AAAAAAA.Token_With.Capitals",
          { nested: true },
          42,
          "a".repeat(200),
        ],
      }),
    );
    expect(json.codes).toEqual(["timeout-or-duplicate"]);
  });
});

describe("readCodes", () => {
  it("keeps Cloudflare's own shape and nothing else", () => {
    expect(readCodes(["timeout-or-duplicate", "invalid-input-secret"])).toEqual([
      "timeout-or-duplicate",
      "invalid-input-secret",
    ]);
    expect(readCodes([])).toEqual([]);
    expect(readCodes("timeout-or-duplicate")).toEqual([]);
    expect(readCodes(undefined)).toEqual([]);
    expect(readCodes(null)).toEqual([]);
  });

  it("drops anything not shaped like a code", () => {
    expect(readCodes(["0.ABcD_eF-gh.iJkL"])).toEqual([]);
    expect(readCodes(["has space"])).toEqual([]);
    expect(readCodes(["UPPER"])).toEqual([]);
    expect(readCodes(["a".repeat(65)])).toEqual([]);
  });

  it("drops a value it was told not to let out, whatever shape it is", () => {
    // The fixture secret is lowercase and hyphenated, so it passes the shape check. It must not
    // pass this one: an argument about character classes is not a guarantee.
    const secret = env.TURNSTILE_SECRET_KEY;
    expect(secret).toMatch(/^[a-z0-9-]+$/);
    expect(readCodes([secret])).toEqual([secret]);
    expect(readCodes([secret], [secret])).toEqual([]);
    // Containing one is enough, not only equalling it.
    expect(readCodes([`prefix-${secret}-suffix`], [secret])).toEqual([]);
    expect(readCodes(["timeout-or-duplicate", secret], [secret, "a-token"])).toEqual([
      "timeout-or-duplicate",
    ]);
    // An empty secret is not a filter that drops everything.
    expect(readCodes(["timeout-or-duplicate"], ["", ""])).toEqual(["timeout-or-duplicate"]);
  });

  it("caps the count and drops duplicates", () => {
    const many = Array.from({ length: 30 }, (_, i) => `code-${i}`);
    expect(readCodes(many)).toHaveLength(10);
    expect(readCodes(["same", "same", "other"])).toEqual(["same", "other"]);
  });
});
