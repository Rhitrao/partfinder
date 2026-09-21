// Step 4: the manifest, the icons and the head that points at them. No network.

import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { ICON_192_BASE64, ICON_512_BASE64 } from "../src/icons";
import { ICON_SIZES, renderIcon, renderIconsModule } from "../scripts/icons";
import { THEME_COLOR_DARK, THEME_COLOR_LIGHT } from "../src/manifest";

const get = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://rohitrao.in${path}`, init), {});

/** Width and height straight out of the PNG's IHDR: 8-byte signature, 4-byte length, "IHDR". */
function pngSize(bytes: Uint8Array): { width: number; height: number; signature: boolean } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = [0x89, 0x50, 0x4e, 0x47].every((b, i) => bytes[i] === b);
  return { width: view.getUint32(16), height: view.getUint32(20), signature };
}

describe("GET /parts/manifest.webmanifest", () => {
  it("is served as a manifest, scoped to /parts/", async () => {
    const res = await get("/parts/manifest.webmanifest");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/manifest+json");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");

    const manifest = (await res.json()) as {
      name: string;
      start_url: string;
      scope: string;
      display: string;
      icons: { src: string; sizes: string; type: string }[];
    };
    expect(manifest.name).toBe("Partfinder");
    expect(manifest.start_url).toBe("/parts/");
    expect(manifest.scope).toBe("/parts/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.map((i) => i.sizes)).toEqual(["192x192", "512x512"]);
  });
});

describe("the icons", () => {
  it.each(ICON_SIZES)("serves %ix%i as a PNG of that size", async (size) => {
    const res = await get(`/parts/icon-${size}.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");

    const png = pngSize(new Uint8Array(await res.arrayBuffer()));
    expect(png.signature).toBe(true);
    expect(png).toMatchObject({ width: size, height: size });
  });

  it("are the bytes scripts/icons.ts renders today", () => {
    const committed = { 192: ICON_192_BASE64, 512: ICON_512_BASE64 };
    for (const size of ICON_SIZES) {
      expect(
        committed[size],
        "src/icons.ts is out of date. Run `npm run icons` and commit the result.",
      ).toBe(Buffer.from(renderIcon(size)).toString("base64"));
    }
  });

  it("keep the generated module in step with the script", async () => {
    const { readFileSync } = await import("node:fs");
    expect(
      readFileSync("src/icons.ts", "utf8"),
      "src/icons.ts is out of date. Run `npm run icons` and commit the result.",
    ).toBe(renderIconsModule());
  });

  it("only answer GET", async () => {
    const res = await get("/parts/icon-192.png", { method: "POST" });
    expect(res.status).toBe(405);
  });
});

describe("the page head", () => {
  it("links the manifest and the touch icon", async () => {
    const html = await (await get("/parts/")).text();
    expect(html).toContain('<link rel="manifest" href="/parts/manifest.webmanifest">');
    expect(html).toContain('<link rel="apple-touch-icon" href="/parts/icon-192.png">');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Partfinder">');
    // One per scheme, each matching --bg, so the browser's own chrome never fights the page.
    expect(html).toContain(
      `<meta name="theme-color" content="${THEME_COLOR_LIGHT}" media="(prefers-color-scheme: light)">`,
    );
    expect(html).toContain(
      `<meta name="theme-color" content="${THEME_COLOR_DARK}" media="(prefers-color-scheme: dark)">`,
    );
    expect(THEME_COLOR_LIGHT).toBe("#FFFFFF");
    expect(THEME_COLOR_DARK).toBe("#111111");
  });

  it("allows the manifest and images in the CSP, and nothing else new", async () => {
    const csp = (await get("/parts/")).headers.get("Content-Security-Policy")!;
    expect(csp).toContain("manifest-src 'self'");
    expect(csp).toContain("img-src 'self'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("base-uri 'none'");
  });
});
