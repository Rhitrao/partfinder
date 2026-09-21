// The only client-side JavaScript Partfinder ships.
//
// It runs on a /parts/ page that has a Suppliers section, and nowhere else. The page it runs on
// already works: the parts are identified, the messages are written, and "Search on Google
// instead" is one tap away. What this adds is the supplier list itself - fetched from
// /parts/api/suppliers with a Turnstile token - and then the map, "Use my location", the filter
// chips and the send queue.
//
// Three rules hold throughout. The endpoint's `html` field is the only string that ever becomes
// HTML, and it goes through one <template>; every other string goes in with textContent, so a
// shop's name is text however it is spelled. No message is composed here: waMatched and waAll
// arrive already written. And nothing is stored: no localStorage, no cookies, no beacons.

import { escapeHtml } from "../page";
import { FINDING, MAP_UNAVAILABLE, SUPPLIERS_UNAVAILABLE, jsonForScript } from "./suppliers";

/** What the script is told before it fetches anything: the part keys, for the filter chips. */
export interface PageData {
  parts: string[];
  /** "india" or "near": what the page was rendered for, echoed back with every request. */
  scope: string;
}

/** Every string this script can end up showing, handed to it rather than written into it. */
export interface ScriptText {
  finding: string;
  unavailable: string;
  verify: string;
  mapUnavailable: string;
  queueHint: string;
}

/**
 * The whole of the #pf-data block: the page's data, plus every constant the script uses.
 *
 * The script is a constant string, emitted byte for byte, and nothing is substituted into it.
 * That is the point. Until step 7c the constants were spliced in by name, one
 * String.prototype.replace per name - and a string pattern replaces only the first occurrence.
 * Every name used twice kept its placeholder, and the browser threw ReferenceError the moment
 * that line ran. Nothing on the server could see it: a script with an undefined name in it still
 * parses, and parsing was all anything checked.
 */
export interface ScriptData extends PageData {
  text: ScriptText;
  /** How long the whole fetch round has, in milliseconds. */
  timeoutMs: number;
}

/** Turnstile could not mint a token, or would not accept the one it minted. */
export const VERIFY_FAILED = "Couldn't verify this browser.";

export const QUEUE_HINT = "WhatsApp opens one chat at a time. Tap each supplier in turn.";

/** The whole round has this long, however many calls it is made of. */
export const FETCH_TIMEOUT_MS = 15000;

/** Cloudflare's own loader, told not to render anything until we ask it to. */
export const TURNSTILE_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=pfTurnstile";

/**
 * The script, exactly as the browser receives it. Exported so a test can execute it, and so a
 * test can assert the page emits it unchanged.
 */
export const CLIENT_SCRIPT = String.raw`
(function () {
  "use strict";
  var el = document.getElementById("pf-data");
  if (!el) return;
  var data;
  try { data = JSON.parse(el.textContent || "{}"); } catch (e) { return; }
  var parts = data.parts || [];
  // Near a city or all of India, as the server decided when it rendered this page. The endpoint
  // derives it again from the city and this flag; nothing is stored on either side.
  var scope = data.scope || "";
  // Every constant this script shows or waits on arrives in that same block rather than being
  // written into the script body. A property that is missing reads as undefined; a bare name
  // that is missing throws, which is how this script spent a week not running at all. It is
  // "words" rather than "text" because make() already takes a parameter by that name.
  var words = data.text || {};
  var timeoutMs = data.timeoutMs;

  var status = document.getElementById("pf-status");
  var ghosts = document.getElementById("pf-ghosts");
  var list = document.getElementById("pf-list");
  var elsewhere = document.getElementById("pf-elsewhere");
  var widget = document.getElementById("pf-turnstile");
  var box = document.getElementById("pf-map");
  if (!status || !list || !widget) return;

  var shops = [];
  var pins = [];
  var near = null;
  var widgetId = null;
  var running = null;
  /**
   * Whether anybody has asked for a search since the last one finished.
   *
   * Turnstile resets its widget when a token expires, and a reset mints a token, and a token
   * arriving calls search(). Left alone, an open tab therefore started a fresh round of Google
   * calls every five minutes, for nobody. Expiry now resets only when a search is actually
   * wanted; the first render, Retry and "Use my location" are the three things that want one.
   */
  var searchWanted = true;

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function card(n) { return document.getElementById("pf-shop-" + n); }
  function say(message) { status.textContent = message; }
  function field(id) {
    var node = document.getElementById(id);
    return node && typeof node.value === "string" ? node.value : "";
  }
  function openElsewhere() { if (elsewhere) elsewhere.open = true; }

  /** Cloudflare's reason for a refusal, to the console. Never to the page, and never stored. */
  function warn(codes) {
    if (!codes || !codes.length) return;
    var log = window.console;
    if (!log || typeof log.warn !== "function") return;
    log.warn("Partfinder: Turnstile rejected this browser: " + codes.join(", "));
  }

  // ---- Asking the endpoint ---------------------------------------------------------------
  function clearRetry() {
    var old = document.getElementById("pf-retry");
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  function offerRetry() {
    clearRetry();
    var button = make("button", "retry", "Retry");
    button.type = "button";
    button.id = "pf-retry";
    button.addEventListener("click", again);
    if (status.parentNode) status.parentNode.insertBefore(button, status.nextSibling);
  }

  function again() {
    clearRetry();
    if (!window.turnstile || widgetId === null) return;
    searchWanted = true;
    say(words.finding);
    window.turnstile.reset(widgetId);
  }

  function fail(message, retry) {
    say(message);
    openElsewhere();
    if (retry) offerRetry();
  }

  function quantities() {
    var out = {};
    var inputs = document.querySelectorAll("input[name^='qty_']");
    for (var i = 0; i < inputs.length; i++) {
      var amount = Number(inputs[i].value);
      if (Number.isInteger(amount) && amount >= 1 && amount <= 9999) {
        out[inputs[i].name.slice(4)] = amount;
      }
    }
    return out;
  }

  function search(token) {
    // A round already in flight is abandoned rather than allowed to block this one. It used to
    // return here, which threw away the token Turnstile had just minted and, worse, threw away
    // what the user had just asked for: tapping "Use my location" while the status still said
    // "Finding suppliers..." did nothing at all, and the list that arrived was measured from the
    // city centre. The newer token is always about the newer question.
    if (running) running.abort();
    clearRetry();
    say(words.finding);
    var payload = {
      token: token,
      q: field("q"),
      city: field("city"),
      country: field("country"),
      note: field("note"),
      scope: scope,
      qty: quantities()
    };
    if (near) payload.near = near;

    var controller = new AbortController();
    running = controller;
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
    /**
     * Ends this round. The timer is always cleared - a superseded round still owns one - but
     * only the round that is still the current one goes on to report anything.
     */
    function finish() {
      clearTimeout(timer);
      if (running !== controller) return false;
      running = null;
      return true;
    }

    fetch("/parts/api/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal
    }).then(function (response) {
      return response.json();
    }).then(function (body) {
      if (finish()) handle(body);
    }).catch(function () {
      // An abort is this code's own doing, not a failure to report: the round that replaced it
      // is already saying "Finding suppliers..." and will say what happened.
      if (finish()) fail(words.unavailable, true);
    });
  }

  function handle(body) {
    if (!body || typeof body !== "object") return fail(words.unavailable, true);
    if (body.error === "verify") {
      // The console, and nowhere else. "timeout-or-duplicate" tells whoever is looking at the
      // console what went wrong; it tells a parts buyer nothing, so the page says what it said
      // before and this line is the only place the codes appear.
      warn(body.codes);
      return fail(words.verify, true);
    }
    if (body.error === "city") {
      say("Couldn't find " + field("city").trim() + ". Check the spelling.");
      openElsewhere();
      return;
    }
    if (typeof body.html !== "string") return fail(words.unavailable, false);
    show(body);
  }

  function show(body) {
    // The one place in this script that assigns markup, and the only string allowed to be
    // markup: body.html came from our own endpoint, which escaped every value in it on the
    // server. Nothing a user typed is ever assigned this way.
    var template = document.createElement("template");
    template.innerHTML = body.html;
    list.textContent = "";
    list.appendChild(template.content);
    if (ghosts && ghosts.parentNode) ghosts.parentNode.removeChild(ghosts);

    shops = body.queue || [];
    pins = body.pins || [];
    // Answered. Nothing is wanted again until somebody asks.
    searchWanted = false;
    say(shops.length === 1 ? "1 supplier found" : shops.length + " suppliers found");
    visible = null;
    buildFilters();
    drawMap();
    picked = [];
    refreshBar();
  }

  // ---- Turnstile -------------------------------------------------------------------------
  window.pfTurnstile = function () {
    if (!window.turnstile) return;
    widgetId = window.turnstile.render(widget, {
      sitekey: widget.getAttribute("data-sitekey") || "",
      appearance: widget.getAttribute("data-appearance") || "interaction-only",
      callback: search,
      "error-callback": function () { fail(words.verify, true); },
      // Only when a search is actually wanted. A token expiring on a tab nobody is looking at is
      // not a reason to spend the day's Google allowance again.
      "expired-callback": function () {
        if (searchWanted && window.turnstile) window.turnstile.reset(widgetId);
      }
    });
  };

  // ---- Use my location -------------------------------------------------------------------
  var slot = document.getElementById("pf-locate");
  var locate = document.getElementById("pf-locate-button");
  if (slot && locate && navigator.geolocation) {
    locate.hidden = false;
    locate.addEventListener("click", function () {
      locate.disabled = true;
      locate.textContent = "Finding you…";
      navigator.geolocation.getCurrentPosition(
        function (position) {
          var round = function (v) { return Math.round(v * 1000) / 1000; };
          // Three decimals: about a hundred metres, which is all a shop search needs. It is held
          // in this one variable, is sent to our endpoint, and is never stored or put in the URL.
          near = round(position.coords.latitude) + "," + round(position.coords.longitude);
          locate.disabled = false;
          locate.textContent = "Use my location";
          again();
        },
        function () {
          locate.disabled = false;
          locate.textContent = "Use my location";
          var said = document.getElementById("pf-locate-note");
          if (!said) {
            said = make("p", "note", "");
            said.id = "pf-locate-note";
            slot.appendChild(said);
          }
          said.textContent =
            "Location off. Distances are from " + field("city").trim() + " centre.";
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
      );
    });
  }

  // ---- Filter chips ----------------------------------------------------------------------
  var visible = null;
  function matches(n) {
    if (visible === null) return true;
    var shop = shops.filter(function (row) { return row.n === n; })[0];
    return !!shop && (shop.matchedParts || []).indexOf(visible) >= 0;
  }
  function applyFilter() {
    shops.forEach(function (shop) {
      var row = card(shop.n);
      if (row) row.hidden = !matches(shop.n);
    });
    fit();
  }
  function buildFilters() {
    var filters = document.getElementById("pf-filters");
    if (!filters || parts.length < 2) return;
    filters.textContent = "";
    var choices = [null].concat(parts);
    var buttons = [];
    choices.forEach(function (part) {
      var chip = make("button", "chip filter", part === null ? "All" : part);
      chip.type = "button";
      chip.setAttribute("aria-pressed", part === null ? "true" : "false");
      chip.addEventListener("click", function () {
        visible = part;
        buttons.forEach(function (other) {
          other.setAttribute("aria-pressed", other === chip ? "true" : "false");
        });
        applyFilter();
      });
      buttons.push(chip);
      filters.appendChild(chip);
    });
  }

  // ---- The map ---------------------------------------------------------------------------
  var mapsReady = false;
  var gmap = null;
  var placed = [];

  window.initMap = function () { mapsReady = true; drawMap(); };

  function shopPins() {
    return pins.filter(function (pin) { return !pin.you; });
  }

  async function drawMap() {
    if (!box || !mapsReady || !pins.length) return;
    try {
      var maps = await google.maps.importLibrary("maps");
      var markers = await google.maps.importLibrary("marker");
      placed.forEach(function (entry) { entry.marker.map = null; });
      placed = [];
      if (!gmap) {
        box.textContent = "";
        // greedy: one finger pans and pinch zooms, without the "use two fingers" overlay. The
        // map is the only thing on this page worth zooming into, and it sits inside its own
        // bordered box rather than under the scroll, so it is not stealing a gesture the page
        // needs. Full screen is the rest of it: a 220px strip on a phone is for orientation,
        // and looking properly means filling the screen.
        gmap = new maps.Map(box, {
          mapId: "DEMO_MAP_ID",
          zoom: 12,
          center: { lat: pins[0].lat, lng: pins[0].lng },
          gestureHandling: "greedy",
          fullscreenControl: true,
          mapTypeControl: false,
          streetViewControl: false
        });
      }
      pins.forEach(function (pin) {
        var glyph = new markers.PinElement({ glyph: pin.you ? "You" : String(pin.n) });
        var marker = new markers.AdvancedMarkerElement({
          map: gmap,
          position: { lat: pin.lat, lng: pin.lng },
          title: pin.name,
          content: glyph.element,
          gmpClickable: !pin.you
        });
        if (!pin.you) {
          marker.addListener("gmp-click", function () { focusCard(pin.n); });
        }
        placed.push({ pin: pin, marker: marker });
      });
      fit();
      addShowOnMap();
    } catch (e) {
      if (box) box.textContent = words.mapUnavailable;
    }
  }

  function fit() {
    if (!gmap || !placed.length) return;
    var bounds = new google.maps.LatLngBounds();
    var any = false;
    placed.forEach(function (entry) {
      if (!entry.pin.you && !matches(entry.pin.n)) { entry.marker.map = null; return; }
      entry.marker.map = gmap;
      bounds.extend({ lat: entry.pin.lat, lng: entry.pin.lng });
      any = true;
    });
    if (any) gmap.fitBounds(bounds);
  }

  function focusCard(n) {
    var row = card(n);
    if (!row) return;
    shops.forEach(function (shop) {
      var other = card(shop.n);
      if (other) other.classList.remove("here");
    });
    row.classList.add("here");
    row.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function addShowOnMap() {
    shopPins().forEach(function (pin) {
      var row = card(pin.n);
      if (!row || row.querySelector(".showmap")) return;
      var actions = row.querySelector(".actions");
      if (!actions) return;
      var button = make("button", "link showmap", "Show on map");
      button.type = "button";
      button.addEventListener("click", function () {
        if (!gmap) return;
        gmap.panTo({ lat: pin.lat, lng: pin.lng });
        if (box) box.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      actions.appendChild(button);
    });
  }

  // ---- Send queue ------------------------------------------------------------------------
  var picked = [];
  var bar = null;
  var panel = null;

  function selected() {
    return shops.filter(function (shop) { return picked.indexOf(shop.n) >= 0; });
  }

  function refreshBar() {
    var count = picked.length;
    if (!bar) {
      bar = make("div", "sendbar");
      bar.setAttribute("role", "region");
      bar.setAttribute("aria-label", "Selected suppliers");
      var open = make("button", "primary", "");
      open.type = "button";
      open.addEventListener("click", openPanel);
      bar.appendChild(open);
      document.body.appendChild(bar);
    }
    bar.hidden = count === 0;
    bar.firstChild.textContent = count + " selected · Message selected";
  }

  document.addEventListener("change", function (event) {
    var input = event.target;
    if (!input || !input.classList || !input.classList.contains("pick")) return;
    var n = Number(input.getAttribute("data-n"));
    var at = picked.indexOf(n);
    if (input.checked && at < 0) picked.push(n);
    if (!input.checked && at >= 0) picked.splice(at, 1);
    picked.sort(function (a, b) { return a - b; });
    refreshBar();
    if (panel && !panel.hidden) fillPanel();
  });

  function closePanel() {
    if (panel) panel.hidden = true;
  }

  function openPanel() {
    if (!panel) {
      panel = make("div", "sendpanel");
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "false");
      panel.setAttribute("aria-label", "Message selected suppliers");
      document.body.appendChild(panel);
    }
    panel.hidden = false;
    fillPanel();
    panel.setAttribute("tabindex", "-1");
    panel.focus();
  }

  function fillPanel() {
    if (!panel) return;
    panel.textContent = "";
    var head = make("div", "sendhead");
    head.appendChild(make("p", "hint", words.queueHint));
    var shut = make("button", "link", "Close");
    shut.type = "button";
    shut.addEventListener("click", closePanel);
    head.appendChild(shut);
    panel.appendChild(head);

    var live = make("p", "sr-live", "");
    live.setAttribute("aria-live", "polite");
    panel.appendChild(live);

    var rows = selected();
    rows.forEach(function (shop, index) {
      var row = make("div", "sendrow");
      row.appendChild(make("p", "sname", shop.name));
      var matched = shop.matchedParts || [];
      var scoped = matched.length > 0 && matched.length < parts.length;
      var state = { all: !scoped };
      var listed = make("p", "sendparts", "");
      function describe() {
        listed.textContent = "Parts: " + (state.all ? parts : matched).join(", ");
      }
      describe();
      row.appendChild(listed);

      if (scoped) {
        var toggle = make("button", "chip", "");
        toggle.type = "button";
        var label = function () {
          toggle.textContent = state.all ? "All parts" : "Only matched parts";
          toggle.setAttribute("aria-pressed", state.all ? "true" : "false");
        };
        label();
        toggle.addEventListener("click", function () {
          state.all = !state.all;
          label();
          describe();
          setLink();
        });
        row.appendChild(toggle);
      }

      var action;
      if (shop.waMatched || shop.waAll) {
        action = make("a", "whatsapp", "Open WhatsApp ↗");
        action.target = "_blank";
        action.rel = "noopener";
        action.addEventListener("click", function () {
          action.textContent = "Opened ✓";
          row.classList.add("done");
          live.textContent = shop.name + " opened. Next: " +
            (rows[index + 1] ? rows[index + 1].name : "none left");
          var next = panel.querySelectorAll(".sendrow")[index + 1];
          if (next) next.classList.add("next");
        });
      } else if (shop.tel) {
        action = make("a", "link", "Call");
        action.href = "tel:" + shop.tel;
      } else {
        action = make("p", "note", "No number listed");
      }
      function setLink() {
        if (action.tagName !== "A" || !(shop.waMatched || shop.waAll)) return;
        action.href = state.all ? shop.waAll || shop.waMatched : shop.waMatched || shop.waAll;
      }
      setLink();
      row.appendChild(action);

      var copy = make("button", "link", "Copy message");
      copy.type = "button";
      copy.addEventListener("click", function () {
        var href = state.all ? shop.waAll || shop.waMatched : shop.waMatched || shop.waAll;
        var text = "";
        try {
          text = decodeURIComponent((href.split("?text=")[1] || "").replace(/\+/g, " "));
        } catch (e) { text = ""; }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            function () { copy.textContent = "Copied ✓"; },
            function () { showText(row, text); }
          );
        } else {
          showText(row, text);
        }
      });
      row.appendChild(copy);
      panel.appendChild(row);
    });
  }

  function showText(row, text) {
    var area = row.querySelector("textarea");
    if (!area) {
      area = document.createElement("textarea");
      area.readOnly = true;
      area.rows = 8;
      row.appendChild(area);
    }
    area.value = text;
    area.focus();
    area.select();
  }
})();
`;

/**
 * The data block, the script, Turnstile's loader and Google's, all carrying the nonce.
 *
 * Turnstile is loaded with render=explicit so nothing appears until the script asks for it, and
 * the widget's own element carries the site key. Google's loader is only added when there is a
 * browser key to add; without it the list stands on its own and the map box says so.
 */
export function renderScripts(data: PageData, mapsKey: string | undefined, nonce: string): string {
  const n = escapeHtml(nonce);
  const block: ScriptData = {
    ...data,
    text: {
      finding: FINDING,
      unavailable: SUPPLIERS_UNAVAILABLE,
      verify: VERIFY_FAILED,
      mapUnavailable: MAP_UNAVAILABLE,
      queueHint: QUEUE_HINT,
    },
    timeoutMs: FETCH_TIMEOUT_MS,
  };
  const maps =
    mapsKey === undefined || mapsKey === ""
      ? ""
      : `\n    <script src="${escapeHtml(
          "https://maps.googleapis.com/maps/api/js" +
            `?key=${encodeURIComponent(mapsKey)}&callback=initMap&loading=async`,
        )}" async nonce="${n}"></script>`;
  return `
    <script type="application/json" id="pf-data" nonce="${n}">${jsonForScript(block)}</script>
    <script nonce="${n}">${CLIENT_SCRIPT}</script>
    <script src="${escapeHtml(TURNSTILE_SRC)}" async defer nonce="${n}"></script>${maps}`;
}
