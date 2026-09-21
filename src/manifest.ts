// The web app manifest, so /parts/ can be kept as a home-screen icon.
//
// A shortcut, not an app: there is no service worker and nothing works offline. The page is
// server-rendered on every request, and a stale cached copy of someone's part search is worth
// less than nothing.

/**
 * The page's two theme-color metas, one per scheme, matching --bg in src/page.ts.
 *
 * A browser paints its own chrome with theme-color, so a single value is wrong the moment the
 * page has two schemes: the light page under a dark bar, or the reverse. Both are declared, each
 * with its own media query, and the browser picks.
 */
export const THEME_COLOR_LIGHT = "#FFFFFF";
export const THEME_COLOR_DARK = "#111111";

/**
 * The manifest's colour, and the icons' background. The installed app opens on the light scheme's
 * page, so its splash is the light background; the icon itself stays dark, because a dark tile
 * with light letters is legible on any home screen. scripts/icons.ts holds the same value as
 * bytes, and test/assets.test.ts fails if the two drift.
 */
export const THEME_COLOR = THEME_COLOR_LIGHT;

export const MANIFEST = {
  name: "Partfinder",
  short_name: "Partfinder",
  start_url: "/parts/",
  scope: "/parts/",
  display: "standalone",
  background_color: THEME_COLOR,
  theme_color: THEME_COLOR,
  icons: [
    { src: "/parts/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/parts/icon-512.png", sizes: "512x512", type: "image/png" },
  ],
} as const;

export const MANIFEST_JSON = JSON.stringify(MANIFEST, null, 2);
