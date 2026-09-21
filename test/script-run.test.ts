// Step 7c: running the client script, rather than reading it.
//
// Step 7's tests asserted what the script said - that it contained a fetch call, that it parsed
// as JavaScript - and all of them passed while the script threw ReferenceError on its first
// useful line in every real browser. new Function(source) parses; it never runs. These cases
// execute the exact string the Worker sends, so an undefined name is a thrown error here.
//
// No network, no browser: node:vm, the stub DOM in test/dom.ts, a fake turnstile and a stubbed
// fetch. Google's own object is deliberately hostile, so the map's failure path runs too.

import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT_SCRIPT, FETCH_TIMEOUT_MS, QUEUE_HINT, VERIFY_FAILED } from "../src/vendors/script";
import { FINDING, MAP_UNAVAILABLE, SUPPLIERS_UNAVAILABLE } from "../src/vendors/suppliers";
import { ANSWER, runScript, type Harness, type RunOptions } from "./run-script";
import { SEARCH, get, searchReply, stubFetch } from "./helpers";

/**
 * Every harness this file has booted, checked after each case.
 *
 * One assertion covers every path any test drives, and it is the one that catches a crash the
 * script hides from itself: its fetch chain ends in .catch(), so anything handle() or show()
 * throws is absorbed and the page shows the same "unavailable" message either way. The tell is
 * that the .catch() runs done() a second time. One round, one cleared timer - or a callback
 * threw. Three of step 7's four undefined names were sitting behind exactly that.
 */
const booted: Harness[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  // Drained before the assertion, not after: a failing expect() throws, and a harness left in
  // the list would fail every case that followed it.
  const ran = booted.splice(0, booted.length);
  for (const app of ran) {
    expect(app.cleared, "a callback in the fetch chain threw and was swallowed").toBe(
      app.calls.length,
    );
  }
});

/** The page as the Worker renders it, and the script exactly as it ships inside that page. */
async function page(): Promise<{ html: string; script: string }> {
  stubFetch(searchReply);
  const html = await (await get(`/parts/${SEARCH}`)).text();
  const script = html.match(/<script nonce="[^"]*">([\s\S]*?)<\/script>/)![1]!;
  // The script the browser runs, not a copy of it, and not the module constant on its own.
  expect(script).toBe(CLIENT_SCRIPT);
  return { html, script };
}

async function boot(options: RunOptions = {}): Promise<Harness> {
  const { html, script } = await page();
  const app = runScript(html, script, options);
  booted.push(app);
  return app;
}

/** Boots, renders the widget, hands it a token, and waits for the round to finish. */
async function search(reply: unknown = ANSWER): Promise<Harness> {
  const app = await boot();
  const widget = app.turnstile();
  app.reply(reply);
  widget.callback("a-token");
  await app.settle();
  return app;
}

describe("the script, executed", () => {
  it("runs to the end without throwing, and defines its two global callbacks", async () => {
    const app = await boot();
    expect(typeof app.window.pfTurnstile).toBe("function");
    expect(typeof app.window.initMap).toBe("function");
    expect(app.status()).toBe(FINDING);
  });

  it("renders the Turnstile widget with the site key off the page's own element", async () => {
    const app = await boot();
    const widget = app.turnstile();
    expect(widget.sitekey).toBe("turnstile-site-key-meant-to-be-rendered");
    expect(widget.appearance).toBe("interaction-only");
    expect(typeof widget.callback).toBe("function");
  });

  it("posts the token to the endpoint when Turnstile succeeds - the step 7 crash", async () => {
    const app = await boot();
    const widget = app.turnstile();
    // Before step 7c this threw ReferenceError: FINDING_TEXT is not defined, and no request was
    // ever made. The assertion that matters is simply that the call below does not throw.
    expect(() => widget.callback("a-token")).not.toThrow();
    await app.settle();

    expect(app.calls).toHaveLength(1);
    const call = app.calls[0]!;
    expect(call.url).toBe("/parts/api/suppliers");
    expect(call.method).toBe("POST");
    expect(call.body.token).toBe("a-token");
    expect(call.body.city).toBe("Bengaluru");
    expect(app.timeouts).toEqual([FETCH_TIMEOUT_MS]);
  });

  it("shows the cards and counts them when the endpoint answers", async () => {
    const app = await search();
    expect(app.status()).toBe("2 suppliers found");
    const list = app.byId("pf-list")!;
    expect(list.textContent).toContain('<li class="shop" id="pf-shop-1">');
    expect(app.byId("pf-shop-1")).not.toBeNull();
    expect(app.byId("pf-shop-2")).not.toBeNull();
    // The placeholders are taken away once there is something real in their place.
    expect(app.byId("pf-ghosts")!.parentNode).toBeNull();
  });

  it("says '1 supplier found' for one, in the singular", async () => {
    const one = { ...ANSWER, queue: [ANSWER.queue[0]!], pins: [ANSWER.pins[0]!] };
    const app = await search(one);
    expect(app.status()).toBe("1 supplier found");
  });
});

describe("every path that used to hold an undefined name", () => {
  it("a network failure says so and offers a retry", async () => {
    const app = await boot();
    const widget = app.turnstile();
    app.rejectNext();
    expect(() => widget.callback("a-token")).not.toThrow();
    await app.settle();
    expect(app.status()).toBe(SUPPLIERS_UNAVAILABLE);
    expect(app.byId("pf-retry")).not.toBeNull();
    expect(app.byId("pf-elsewhere")!.open).toBe(true);
  });

  it("a body that is not an object says so and offers a retry", async () => {
    const app = await search("not json");
    expect(app.status()).toBe(SUPPLIERS_UNAVAILABLE);
    expect(app.byId("pf-retry")).not.toBeNull();
  });

  it("an answer with no html says so, and offers no retry", async () => {
    const app = await search({ pins: [], queue: [] });
    expect(app.status()).toBe(SUPPLIERS_UNAVAILABLE);
    expect(app.byId("pf-retry")).toBeNull();
    expect(app.byId("pf-elsewhere")!.open).toBe(true);
  });

  it("a refused token says the browser could not be verified", async () => {
    const app = await search({ error: "verify" });
    expect(app.status()).toBe(VERIFY_FAILED);
    expect(app.byId("pf-retry")).not.toBeNull();
  });

  it("Turnstile's own error callback says the same thing", async () => {
    const app = await boot();
    const widget = app.turnstile();
    expect(() => widget.error()).not.toThrow();
    expect(app.status()).toBe(VERIFY_FAILED);
  });

  it("an expired token resets the widget rather than failing", async () => {
    const app = await boot();
    const widget = app.turnstile();
    expect(() => widget.expired()).not.toThrow();
    expect(app.resets).toBe(1);
  });

  it("a city Google cannot place names the city, not an error code", async () => {
    const app = await search({ error: "city" });
    expect(app.status()).toBe("Couldn't find Bengaluru. Check the spelling.");
    expect(app.byId("pf-retry")).toBeNull();
  });

  it("Retry puts the status back to 'Finding suppliers…' and resets the widget", async () => {
    const app = await search({ error: "verify" });
    const retry = app.byId("pf-retry")!;
    expect(() => retry.fire("click")).not.toThrow();
    expect(app.status()).toBe(FINDING);
    expect(app.resets).toBe(1);
  });

  it("the send panel opens and carries the queue hint", async () => {
    const app = await search();
    const pick = app.doc.createElement("input");
    pick.className = "pick";
    pick.setAttribute("data-n", "1");
    pick.checked = true;
    expect(() => app.doc.fire("change", { target: pick })).not.toThrow();

    const bar = app.doc.body.querySelector(".sendbar")!;
    expect(bar.hidden).toBe(false);
    expect(bar.textContent).toBe("1 selected · Message selected");

    expect(() => bar.firstChild!.fire("click")).not.toThrow();
    const panel = app.doc.body.querySelector(".sendpanel")!;
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain(QUEUE_HINT);
    expect(panel.textContent).toContain("Shared Spares");
    expect(panel.querySelector(".whatsapp")!.href).toBe(
      "https://wa.me/919876543210?text=one%20part",
    );
  });

  it("the map says so when Google will not load, rather than throwing", async () => {
    const app = await search();
    // Google's loader is what calls initMap. Here its library never arrives.
    app.window.google = {
      maps: {
        importLibrary: () => Promise.reject(new Error("blocked")),
      },
    };
    expect(() => (app.window.initMap as () => void)()).not.toThrow();
    await app.settle();
    expect(app.byId("pf-map")!.textContent).toBe(MAP_UNAVAILABLE);
  });

  it("the filter chips are built, and filter the cards", async () => {
    const app = await search();
    const filters = app.byId("pf-filters")!;
    const chips = filters.querySelectorAll(".filter");
    expect(chips.map((chip) => chip.textContent)).toEqual(["All", "1U-3352", "40/300893"]);

    expect(() => chips[2]!.fire("click")).not.toThrow();
    // Shop 1 is listed for 1U-3352 only, so filtering to the other number hides it.
    expect(app.byId("pf-shop-1")!.hidden).toBe(true);
    expect(app.byId("pf-shop-2")!.hidden).toBe(false);
    expect(chips[2]!.getAttribute("aria-pressed")).toBe("true");
    expect(chips[0]!.getAttribute("aria-pressed")).toBe("false");

    expect(() => chips[0]!.fire("click")).not.toThrow();
    expect(app.byId("pf-shop-1")!.hidden).toBe(false);
  });

  it("'Use my location' says where distances are from when the browser refuses", async () => {
    const app = await boot({ geolocation: { getCurrentPosition: (_ok, no) => no() } });
    const button = app.byId("pf-locate-button")!;
    expect(button.hidden).toBe(false);
    expect(() => button.fire("click")).not.toThrow();
    expect(button.disabled).toBe(false);
    expect(app.byId("pf-locate-note")!.textContent).toBe(
      "Location off. Distances are from Bengaluru centre.",
    );
  });

  it("'Use my location' rounds the position and asks again with it", async () => {
    const position = { coords: { latitude: 12.97159, longitude: 77.59457 } };
    const app = await boot({ geolocation: { getCurrentPosition: (ok) => ok(position) } });
    const widget = app.turnstile();
    app.reply(ANSWER);
    widget.callback("first-token");
    await app.settle();

    // again() runs on the success path, and used to be the one place FINDING_TEXT worked.
    expect(() => app.byId("pf-locate-button")!.fire("click")).not.toThrow();
    expect(app.status()).toBe(FINDING);
    expect(app.resets).toBe(1);

    // The reset makes Turnstile call back a second time, and only then is the location sent.
    widget.callback("second-token");
    await app.settle();
    expect(app.calls).toHaveLength(2);
    expect(app.calls[0]!.body.near).toBeUndefined();
    // Three decimals, as the privacy page promises: about a hundred metres.
    expect(app.calls[1]!.body.near).toBe("12.972,77.595");
  });
});
