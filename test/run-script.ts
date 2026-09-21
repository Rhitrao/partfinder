// Running the page's own script, in node:vm, against the stub DOM in test/dom.ts.
//
// The point of this file is that nothing here reads the script: it compiles the exact string the
// Worker sends and executes it, so a name the script refers to but nobody defined is a thrown
// ReferenceError here, as it was in the browser. No jsdom, no Playwright, no network.

import vm from "node:vm";
import { Doc, El, pageFrom } from "./dom";

/** One call the script made to fetch(), recorded rather than sent. */
export interface FetchCall {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

/** What Turnstile was asked to render, and the callbacks it was given. */
export interface Widget {
  sitekey: string;
  appearance: string;
  callback: (token: string) => void;
  error: () => void;
  expired: () => void;
}

export interface Harness {
  doc: Doc;
  /**
   * How many times the script ran its done() - that is, how many times clearTimeout was called.
   *
   * This is how a swallowed crash is caught. The script's fetch chain ends in .catch(), so
   * anything handle() or show() throws is absorbed and the page shows the same "unavailable"
   * message it would have shown anyway: invisible from outside, which is most of why three of
   * step 7's four undefined names stayed hidden behind the first. But the .catch() runs done()
   * a second time, so one completed round clears exactly one timer. More than that means a
   * callback threw. Assert `cleared` equals `calls.length` after any round.
   */
  cleared: number;
  window: Record<string, unknown>;
  calls: FetchCall[];
  timeouts: number[];
  resets: number;
  /** Renders the Turnstile widget, as Cloudflare's loader does, and returns its callbacks. */
  turnstile(): Widget;
  /**
   * Turnstile solving a challenge: a token nobody has seen before, handed to the callback.
   *
   * Real Turnstile does this by itself on render and again after every reset(). Here it is
   * explicit, so a test can say when the callback arrives and can see which token it carried.
   */
  solve(): string;
  /** Every token the widget has minted, in order. */
  minted: string[];
  /** What the status line says now. */
  status(): string;
  byId(id: string): El | null;
  /** Answers the next fetch with this body. */
  reply(body: unknown): void;
  /** Rejects the next fetch, as a timeout or a dropped connection does. */
  rejectNext(): void;
  /** Everything the script sent to console.warn, in order. */
  warnings: string[];
  /** Lets the script's promise chain run to the end. */
  settle(): Promise<void>;
}

/**
 * Compiles and runs `script` against a DOM built from `html`.
 *
 * Anything the script throws at load time propagates out of here, which is the whole point.
 */
export interface RunOptions {
  /** Put in place before the script runs, because it wires "Use my location" at load. */
  geolocation?: {
    getCurrentPosition: (ok: (p: unknown) => void, no: () => void, opts?: unknown) => void;
  };
}

export function runScript(html: string, script: string, options: RunOptions = {}): Harness {
  const doc = pageFrom(html);
  const calls: FetchCall[] = [];
  const timeouts: number[] = [];
  let pending: unknown = { html: "", pins: [], queue: [] };
  let reject = false;
  let resets = 0;
  let widget: Widget | null = null;
  const minted: string[] = [];

  const fetchStub = (url: string, init: Record<string, unknown>) => {
    calls.push({
      url,
      method: String(init.method ?? "GET"),
      body: JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>,
    });
    if (reject) return Promise.reject(new Error("network"));
    return Promise.resolve({ json: () => Promise.resolve(pending) });
  };

  let cleared = 0;
  const warnings: string[] = [];
  const sandbox: Record<string, unknown> = {
    document: doc,
    // Recorded rather than printed: the script logs Turnstile's reason here and nowhere else,
    // so a test has to be able to read it.
    console: { warn: (...args: unknown[]) => warnings.push(args.join(" ")) },
    JSON,
    Number,
    Math,
    String,
    Object,
    Array,
    Promise,
    Error,
    AbortController,
    decodeURIComponent,
    fetch: fetchStub,
    // Timers are recorded, never fired: a fifteen-second abort has nothing to add to a test,
    // and the delay itself is what has to be right.
    setTimeout: (_fn: () => void, ms: number) => {
      timeouts.push(ms);
      return timeouts.length;
    },
    clearTimeout: () => {
      cleared++;
    },
    navigator: options.geolocation === undefined ? {} : { geolocation: options.geolocation },
    turnstile: {
      render: (element: El, options: Record<string, unknown>) => {
        widget = {
          sitekey: String(options.sitekey ?? ""),
          appearance: String(options.appearance ?? ""),
          callback: options.callback as (token: string) => void,
          error: options["error-callback"] as () => void,
          expired: options["expired-callback"] as () => void,
        };
        void element;
        return 1;
      },
      reset: () => {
        resets++;
      },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  new vm.Script(script, { filename: "pf-client.js" }).runInContext(sandbox);

  return {
    doc,
    warnings,
    window: sandbox,
    calls,
    timeouts,
    get resets() {
      return resets;
    },
    get cleared() {
      return cleared;
    },
    turnstile(): Widget {
      (sandbox.pfTurnstile as () => void)();
      if (widget === null) throw new Error("Turnstile was never asked to render a widget");
      return widget;
    },
    minted,
    solve(): string {
      if (widget === null) throw new Error("Turnstile has not rendered a widget yet");
      const token = `pf-token-${minted.length + 1}`;
      minted.push(token);
      widget.callback(token);
      return token;
    },
    status: () => doc.getElementById("pf-status")?.textContent ?? "",
    byId: (id: string) => doc.getElementById(id),
    reply: (body: unknown) => {
      pending = body;
      reject = false;
    },
    rejectNext: () => {
      reject = true;
    },
    settle: async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    },
  } as Harness;
}

/** What the endpoint answers for the two sample numbers, shaped as the script expects it. */
export const ANSWER = {
  html:
    '<p class="caveat">Matched by the brands Google lists each shop for.</p>\n' +
    '<div class="filters" id="pf-filters"></div>\n' +
    '<ol class="shops">\n<li class="shop" id="pf-shop-1"></li>\n' +
    '<li class="shop" id="pf-shop-2"></li>\n</ol>',
  pins: [
    { n: 1, name: "Shared Spares", lat: 12.978, lng: 77.64 },
    { n: 2, name: "Cat Corner", lat: 12.97, lng: 77.6 },
  ],
  queue: [
    {
      n: 1,
      name: "Shared Spares",
      matchedParts: ["1U-3352"],
      waMatched: "https://wa.me/919876543210?text=one%20part",
      waAll: "https://wa.me/919876543210?text=both%20parts",
      tel: "+919876543210",
    },
    { n: 2, name: "Cat Corner", matchedParts: ["1U-3352", "40/300893"], waMatched: "", waAll: "", tel: "" },
  ],
};
