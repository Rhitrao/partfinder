// Worker routing tests. The handler is called in-process; no network.

import { describe, expect, it } from "vitest";
import worker from "../src/index";

const get = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://rohitrao.in${path}`, init));

describe("11. X-Robots-Tag: noindex", () => {
  it("is on the parse endpoint", async () => {
    const res = await get("/parts/api/parse?q=1u3352");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
  });

  it("is on 404s", async () => {
    for (const path of ["/", "/parts", "/parts/api/nope"]) {
      const res = await get(path);
      expect(res.status).toBe(404);
      expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    }
  });

  it("is on errors", async () => {
    const missing = await get("/parts/api/parse");
    expect(missing.status).toBe(400);
    expect(missing.headers.get("X-Robots-Tag")).toBe("noindex");

    const post = await get("/parts/api/parse?q=1u3352", { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("X-Robots-Tag")).toBe("noindex");
  });
});

describe("GET /parts/api/parse", () => {
  it("returns hints and one result per token", async () => {
    const q = "need 2 nos 1u3352 for CAT 320 urgent, also 40/300893";
    const res = await get(`/parts/api/parse?q=${encodeURIComponent(q)}`);
    const body = (await res.json()) as {
      hints: string[];
      results: { input: string; candidates: { oem: string; canonical: string; hintMatched: boolean }[] }[];
    };
    expect(body.hints).toEqual(["Caterpillar"]);
    expect(body.results.map((r) => r.input)).toEqual(["1U3352", "40/300893"]);
    expect(body.results[0]?.candidates[0]).toMatchObject({
      oem: "Caterpillar",
      canonical: "1U-3352",
      hintMatched: true,
    });
    expect(body.results[1]?.candidates[0]).toMatchObject({ oem: "JCB", canonical: "40/300893" });
  });
});
