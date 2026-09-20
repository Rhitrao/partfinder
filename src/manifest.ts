// The web app manifest, so /parts/ can be kept as a home-screen icon.
//
// A shortcut, not an app: there is no service worker and nothing works offline. The page is
// server-rendered on every request, and a stale cached copy of someone's part search is worth
// less than nothing.

/** Also the page's theme-color meta and the icons' background. Keep the three in step. */
export const THEME_COLOR = "#111827";

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
