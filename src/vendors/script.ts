// The only client-side JavaScript Partfinder ships.
//
// It runs on a signed-in /parts/ page that rendered the Suppliers section, and nowhere else. It
// adds four things to a page that already works without it: the map, "Use my location", the
// filter chips, and the send queue. Everything it needs is in one JSON block; it never builds a
// message, because every message was built on the server and is already in the data.
//
// Two rules hold throughout. Text goes in with textContent, never innerHTML, so a shop's name is
// text however it is spelled. And nothing is stored: no localStorage, no cookies, no beacons.

import { escapeHtml } from "../page";
import { jsonForScript } from "./suppliers";

/** What the script is told about one shop. Nothing here is not already on the page. */
export interface ShopData {
  n: number;
  name: string;
  lat: number | null;
  lng: number | null;
  /** The part keys this shop was listed for. Empty means the multi-brand search found it. */
  matchedParts: string[];
  /** The full wa.me URL for its own parts, built on the server. Empty when it has no number. */
  waMatched: string;
  /** The same for every part on the page. */
  waAll: string;
  tel: string;
}

export interface PageData {
  /** Where distances were measured from, and whether that was the user's own location. */
  origin: { lat: number; lng: number; you: boolean } | null;
  /** Every part key on the page, for the filter chips. */
  parts: string[];
  shops: ShopData[];
}

/** What the map box says until the script replaces it, and forever if the script never runs. */
export const MAP_UNAVAILABLE = "Map unavailable. The list below has everything.";

/** What the button says when the browser refuses. It names where distances come from instead. */
export function locationRefused(originLabel: string): string {
  return `Location off. Distances are from ${originLabel}.`;
}
export const QUEUE_HINT = "WhatsApp opens one chat at a time. Tap each supplier in turn.";

const SCRIPT = String.raw`
(function () {
  "use strict";
  var el = document.getElementById("pf-data");
  var data = { origin: null, parts: [], shops: [] };
  if (el) { try { data = JSON.parse(el.textContent || "{}"); } catch (e) { return; } }
  var shops = data.shops || [];
  var byN = {};
  shops.forEach(function (shop) { byN[shop.n] = shop; });

  function card(n) { return document.getElementById("pf-shop-" + n); }
  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // ---- Use my location -------------------------------------------------------------------
  var slot = document.getElementById("pf-locate");
  if (slot && navigator.geolocation) {
    var locate = make("button", "locate", "Use my location");
    locate.type = "button";
    locate.addEventListener("click", function () {
      locate.disabled = true;
      locate.textContent = "Finding you…";
      navigator.geolocation.getCurrentPosition(
        function (position) {
          var round = function (v) { return Math.round(v * 1000) / 1000; };
          var url = new URL(window.location.href);
          url.searchParams.set(
            "near",
            round(position.coords.latitude) + "," + round(position.coords.longitude)
          );
          window.location.assign(url.toString());
        },
        function () {
          locate.disabled = false;
          locate.textContent = "Use my location";
          var said = document.getElementById("pf-locate-note");
          if (!said) {
            said = make("p", "note", LOCATION_REFUSED_TEXT);
            said.id = "pf-locate-note";
            slot.appendChild(said);
          }
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
      );
    });
    slot.appendChild(locate);
  }

  if (!shops.length) return;

  // ---- Filter chips ----------------------------------------------------------------------
  var visible = null;
  function matches(shop) {
    if (visible === null) return true;
    return (shop.matchedParts || []).indexOf(visible) >= 0;
  }
  function applyFilter() {
    shops.forEach(function (shop) {
      var row = card(shop.n);
      if (row) row.hidden = !matches(shop);
    });
    if (window.pfRedrawPins) window.pfRedrawPins();
  }
  var filters = document.getElementById("pf-filters");
  if (filters && (data.parts || []).length > 1) {
    var choices = [null].concat(data.parts);
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
  var box = document.getElementById("pf-map");
  var pinned = shops.filter(function (shop) { return shop.lat !== null && shop.lng !== null; });
  window.initMap = async function () {
    if (!box || !pinned.length) return;
    try {
      var maps = await google.maps.importLibrary("maps");
      var markers = await google.maps.importLibrary("marker");
      box.textContent = "";
      var map = new maps.Map(box, {
        mapId: "DEMO_MAP_ID",
        zoom: 12,
        center: { lat: pinned[0].lat, lng: pinned[0].lng }
      });
      var placed = [];
      pinned.forEach(function (shop) {
        var position = { lat: shop.lat, lng: shop.lng };
        var glyph = new markers.PinElement({ glyph: String(shop.n) });
        var marker = new markers.AdvancedMarkerElement({
          map: map,
          position: position,
          title: shop.name,
          content: glyph.element,
          gmpClickable: true
        });
        marker.addListener("gmp-click", function () { focusCard(shop.n); });
        placed.push({ shop: shop, marker: marker });
      });
      if (data.origin && data.origin.you) {
        var here = new markers.PinElement({ glyph: "You" });
        new markers.AdvancedMarkerElement({
          map: map,
          position: { lat: data.origin.lat, lng: data.origin.lng },
          title: "You",
          content: here.element
        });
      }
      function fit() {
        var bounds = new google.maps.LatLngBounds();
        var any = false;
        placed.forEach(function (entry) {
          if (!matches(entry.shop)) { entry.marker.map = null; return; }
          entry.marker.map = map;
          bounds.extend({ lat: entry.shop.lat, lng: entry.shop.lng });
          any = true;
        });
        if (data.origin && data.origin.you) {
          bounds.extend({ lat: data.origin.lat, lng: data.origin.lng });
          any = true;
        }
        if (any) map.fitBounds(bounds);
      }
      window.pfRedrawPins = fit;
      window.pfShowOnMap = function (n) {
        var entry = placed.filter(function (e) { return e.shop.n === n; })[0];
        if (!entry) return;
        map.panTo({ lat: entry.shop.lat, lng: entry.shop.lng });
        box.scrollIntoView({ behavior: "smooth", block: "center" });
      };
      fit();
      addShowOnMap();
    } catch (e) {
      if (box) box.textContent = MAP_UNAVAILABLE_TEXT;
    }
  };

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
    pinned.forEach(function (shop) {
      var row = card(shop.n);
      if (!row || row.querySelector(".showmap")) return;
      var actions = row.querySelector(".actions");
      if (!actions) return;
      var button = make("button", "link showmap", "Show on map");
      button.type = "button";
      button.addEventListener("click", function () {
        if (window.pfShowOnMap) window.pfShowOnMap(shop.n);
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
    head.appendChild(make("p", "hint", QUEUE_HINT_TEXT));
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
      var scoped = (shop.matchedParts || []).length > 0 && (shop.matchedParts || []).length < data.parts.length;
      var state = { all: !scoped };
      var parts = make("p", "sendparts", "");
      function describe() {
        var list = state.all ? data.parts : shop.matchedParts;
        parts.textContent = "Parts: " + list.join(", ");
      }
      describe();
      row.appendChild(parts);

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
        action = make("a", "whatsapp", "Open WhatsApp");
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

  refreshBar();
})();
`;

/** The one script tag, its data, and Google's loader. Everything carries the nonce. */
export function renderScripts(
  data: PageData,
  mapsKey: string | undefined,
  nonce: string,
  originLabel: string,
): string {
  const n = escapeHtml(nonce);
  const body = SCRIPT.replace("LOCATION_REFUSED_TEXT", jsonForScript(locationRefused(originLabel)))
    .replace("MAP_UNAVAILABLE_TEXT", jsonForScript(MAP_UNAVAILABLE))
    .replace("QUEUE_HINT_TEXT", jsonForScript(QUEUE_HINT));
  const pinned = data.shops.some((shop) => shop.lat !== null && shop.lng !== null);
  const loader =
    mapsKey === undefined || mapsKey === "" || !pinned
      ? ""
      : `\n    <script src="${escapeHtml(
          "https://maps.googleapis.com/maps/api/js" +
            `?key=${encodeURIComponent(mapsKey)}&callback=initMap&loading=async`,
        )}" async nonce="${n}"></script>`;
  return `
    <script type="application/json" id="pf-data" nonce="${n}">${jsonForScript(data)}</script>
    <script nonce="${n}">${body}</script>${loader}`;
}
