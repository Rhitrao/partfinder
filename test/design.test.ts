// Step 8: the theme, the layout and the rules that hold across every link on the page.
//
// No network. The stylesheet is read out of the rendered document rather than imported from the
// module, so what is asserted is what a browser is actually served.

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { THEME_COLOR_DARK, THEME_COLOR_LIGHT } from "../src/manifest";
import { SEARCH, env, get, searchReply, stubFetch } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

/** The page's own <style>, which is the whole stylesheet: there is no external one. */
const styles = (html: string) => html.match(/<style[^>]*>([\s\S]*?)<\/style>/)![1]!;

const page = async (path = "/parts/") => {
  stubFetch(searchReply);
  return (await get(path)).text();
};

describe("the site theme", () => {
  it("carries the light palette as tokens, and nothing hard-coded beside them", async () => {
    const css = styles(await page());
    for (const [token, value] of [
      ["--bg", "#FFFFFF"],
      ["--surface", "#F7F7F5"],
      ["--border", "#E6E5E1"],
      ["--text", "#111111"],
      ["--muted", "#5B5B57"],
      ["--wa-bg", "#25D366"],
      ["--wa-fg", "#111111"],
    ] as const) {
      expect(css, token).toContain(`${token}: ${value};`);
    }
    expect(css).toContain("--r: 8px;");
    expect(css).toContain("--maxw: 760px;");
    // The spacing scale, every step of it.
    for (const step of [4, 8, 12, 16, 24, 32, 48]) {
      expect(css, `--s${step}`).toContain(`--s${step}: ${step}px;`);
    }
    expect(css).toContain("-apple-system, BlinkMacSystemFont");
  });

  it("has a dark block that inverts background and surface and keeps the accents", async () => {
    const css = styles(await page());
    const at = css.indexOf("@media (prefers-color-scheme: dark)");
    expect(at).toBeGreaterThan(-1);
    const dark = css.slice(at, css.indexOf("}\n}", at));
    expect(dark).toContain("--bg: #111111;");
    expect(dark).toContain("--surface: #1B1B19;");
    expect(dark).toContain("--text: #F7F7F5;");
    // The accents are not redeclared, so they are the same colour in both schemes.
    expect(dark).not.toContain("--wa-bg");
  });

  it("declares color-scheme and one theme-color per scheme", async () => {
    const html = await page();
    expect(styles(html)).toContain("color-scheme: light dark;");
    expect(html).toContain(`content="${THEME_COLOR_LIGHT}" media="(prefers-color-scheme: light)"`);
    expect(html).toContain(`content="${THEME_COLOR_DARK}" media="(prefers-color-scheme: dark)"`);
  });
});

describe("the layout", () => {
  it("is one column, 16px in, capped at 760px and centred", async () => {
    const css = styles(await page());
    expect(css).toContain(".wrap { max-width: var(--maxw); margin: 0 auto; }");
    expect(css).toContain("padding: var(--s24) var(--s16);");
    expect(css).toContain(".cols { display: grid; gap: var(--s32); }");
  });

  it("splits in two at 960px, with the gap the tokens name", async () => {
    const css = styles(await page());
    const at = css.indexOf("@media (min-width: 960px)");
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at)).toContain(".cols.two { grid-template-columns: 1fr 1fr; align-items: start; }");
    expect(css.slice(at)).toContain(".cols.two > .left { position: sticky;");
  });

  it("only asks for two columns when there is a second column to fill", async () => {
    // Nothing searched: one column at every width, or the form would be half a page wide.
    expect(await page()).toContain('<div class="cols">');
    const searched = await page(`/parts/${SEARCH}`);
    expect(searched).toContain('<div class="cols two">');
    expect(searched).toContain('<div class="col right">');
  });

  it("sizes the map by width, up to 480px", async () => {
    const css = styles(await page());
    expect(css).toContain(".map {\n  height: 220px;");
    expect(css).toContain("@media (min-width: 700px) { .map { height: 320px; } }");
    expect(css).toContain("@media (min-width: 960px) { .map { height: clamp(320px, 52vh, 480px); } }");
  });

  it("leaves exactly the send bar's height under the last card, and respects safe areas", async () => {
    const html = await page();
    const css = styles(html);
    expect(css).toContain("--bar-h: 72px;");
    expect(css).toContain("padding-bottom: calc(var(--bar-h) + env(safe-area-inset-bottom));");
    expect(css).toContain("padding-bottom: calc(var(--s12) + env(safe-area-inset-bottom));");
    expect(css).toContain("max(var(--s16), env(safe-area-inset-left))");
    // env() is simply zero without this, so the rules above would do nothing.
    expect(html).toContain("width=device-width, initial-scale=1, viewport-fit=cover");
  });

  it("widens the measure once there are two columns", async () => {
    const css = styles(await page());
    const at = css.indexOf("@media (min-width: 960px)");
    // 760px split in two leaves 364px a side, which is not enough for a supplier card's actions.
    expect(css.slice(at)).toContain(":root { --maxw: 1100px; }");
    // Widened through the token, not .wrap, so everything derived from it follows.
    expect(css).toContain(".wrap { max-width: var(--maxw); margin: 0 auto; }");
  });

  it("puts the fixed send bar over the right column on a desktop", async () => {
    const css = styles(await page());
    const at = css.indexOf("@media (min-width: 960px)");
    expect(css.slice(at)).toContain("left: calc(50% + (var(--s32) / 2));");
    expect(css.slice(at)).toContain("width: var(--col-w);");
    expect(css).toContain("--col-w: calc((min(100vw - (2 * var(--s16)), var(--maxw)) - var(--s32)) / 2);");

    /*
     * The bar is fixed, so its geometry is written out rather than inherited from the grid, and
     * the two can drift. They cannot drift silently: the same arithmetic the CSS does is done
     * here, and the right column's left edge has to land where the bar's does.
     *
     * wrap W = min(100vw - 32, maxw), centred. A column is (W - 32) / 2, so the right column
     * begins at 50% - W/2 + (W - 32)/2 + 32, which is 50% + 16px whatever W is - and 50% + 16px
     * is what the bar's `left` says.
     */
    for (const [viewport, maxw] of [
      [1440, 1100],
      [1200, 1100],
      [1000, 1100],
      [960, 1100],
      [900, 760],
    ] as const) {
      const wrap = Math.min(viewport - 32, maxw);
      const column = (wrap - 32) / 2;
      const columnLeft = viewport / 2 - wrap / 2 + column + 32;
      const barLeft = viewport / 2 + 16;
      expect(columnLeft, `${viewport}px viewport`).toBe(barLeft);
    }
  });
});

describe("controls", () => {
  it("gives everything focusable a visible ring", async () => {
    expect(styles(await page())).toContain(":focus-visible { outline: 2px solid var(--text);");
  });

  it("holds every control at the 44px tap target", async () => {
    const css = styles(await page());
    expect(css).toContain("--tap: 44px;");
    for (const rule of ["textarea, input, select", "button", ".link", ".whatsapp", ".select"]) {
      const at = css.indexOf(`${rule} {`);
      expect(at, rule).toBeGreaterThan(-1);
      expect(css.slice(at, css.indexOf("}", at)), rule).toContain("min-height: var(--tap)");
    }
  });

  it("sizes the quantity field at 72px and labels it Qty", async () => {
    const css = styles(await page());
    expect(css).toContain(".qtyinput { width: 72px;");
    const html = await page("/parts/?q=1u3352");
    expect(html).toContain('placeholder="Qty"');
  });

  it("makes Update a small secondary button, under the cards and before the caveat", async () => {
    const html = await page("/parts/?q=1u3352");
    expect(html).toContain('<button type="submit" class="update secondary">Update</button>');
    expect(html).not.toContain("Update quantities");
    expect(html.indexOf('class="update')).toBeLessThan(html.indexOf('class="caveat"'));
    expect(html.indexOf('class="card"')).toBeLessThan(html.indexOf('class="update'));
  });

  it("puts the supplier count beside the heading rather than under it", async () => {
    const html = await page(`/parts/${SEARCH}`);
    expect(html).toContain('<div class="suphead">');
    const head = html.slice(html.indexOf('<div class="suphead">'), html.indexOf("</div>", html.indexOf('<div class="suphead">')));
    expect(head).toContain("<h2>Suppliers near Bengaluru</h2>");
    expect(head).toContain('<p class="status" id="pf-status"');
    expect(styles(html)).toContain(".status { font-size: 14px; color: var(--muted);");
  });

  it("shapes the placeholders like the card that replaces them", async () => {
    const html = await page(`/parts/${SEARCH}`);
    const css = styles(html);
    expect(html).toContain('<span class="ghostbar name"></span>');
    expect(html).toContain('<span class="ghostbar actions"></span>');
    expect(css).toContain(".ghostbar.name { height: 17px;");
    expect(css).toContain(".ghostbar.actions { height: var(--tap);");
    // The same name size and the same row geometry as the real card.
    expect(css).toContain(".sname { font-size: 17px; font-weight: 600; margin: 0; }");
  });
});

/** Every anchor in some markup, with its href and the whole tag. */
const anchors = (html: string) =>
  [...html.matchAll(/<a\s[^>]*href="([^"]*)"[^>]*>/g)].map((m) => ({ href: m[1]!, tag: m[0] }));

describe("links that leave the site", () => {
  it("all carry rel=noopener and the external mark; internal ones carry neither", async () => {
    const html = await page(`/parts/${SEARCH}`);
    const found = anchors(html);
    expect(found.length).toBeGreaterThan(8);
    let external = 0;
    for (const { href, tag } of found) {
      if (href.startsWith("http")) {
        external++;
        expect(tag, href).toContain('rel="noopener"');
      } else {
        // /parts/... and mailto: hand off without opening a site.
        expect(tag, href).not.toContain("noopener");
      }
    }
    expect(external).toBeGreaterThan(5);
    // One mark per external link, and no more.
    expect([...html.matchAll(/<span class="ext" aria-hidden="true">/g)]).toHaveLength(external);
  });

  it("marks the links inside the supplier cards the endpoint sends, too", async () => {
    stubFetch((call) =>
      call.url.includes("siteverify")
        ? new Response(JSON.stringify({ success: true }), { status: 200 })
        : searchReply(call),
    );
    const res = await worker.fetch(
      new Request("https://rohitrao.in/parts/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://rohitrao.in" },
        body: JSON.stringify({ token: "t", q: "1u3352", city: "Bengaluru", country: "IN" }),
      }),
      env,
    );
    const { html } = (await res.json()) as { html: string };
    const external = anchors(html).filter((a) => a.href.startsWith("http"));
    expect(external.length).toBeGreaterThan(0);
    for (const { href, tag } of external) expect(tag, href).toContain('rel="noopener"');
    // tel: is an app hand-off, not a site.
    for (const { tag } of anchors(html).filter((a) => a.href.startsWith("tel:"))) {
      expect(tag).not.toContain("noopener");
    }
  });
});
