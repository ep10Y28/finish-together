// Route drawing for Finish Together.
//
// The agents decide how far each pace group runs. This file turns each distance
// into a line on real streets, starting at the club's meeting point and ending at
// the start (a loop) or at the club's chosen finish (point to point).
//
// Street routes come from the free OpenStreetMap foot router run by FOSSGIS
// (routing.openstreetmap.de, no key needed). If it can't be reached, the map falls
// back to a straight-line sketch of the same shape, drawn dashed and labelled.
// Map tiles: CARTO basemaps over OpenStreetMap data (free, attribution shown).
"use strict";

const FT_MAP = (() => {
  const ROUTER = "https://routing.openstreetmap.de/routed-foot/route/v1/foot/";
  const STREET_FACTOR = 1.25;               // streets wander; aim the sketch shorter so the street route lands near the target
  const MI = 1609.344;
  const cache = new Map();
  let routerDown = false;                   // after one failure, stop calling it for this page load
  const dark = () => window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

  const GROUP_COLORS = ["#e4572e", "#3a86ff", "#06a77d", "#8338ec", "#d9a21b", "#ff006e", "#118ab2", "#fb5607"];
  const groupColor = (i) => GROUP_COLORS[i % GROUP_COLORS.length];

  // ---------- geometry (miles, degrees) ----------
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  function dest([lat, lng], bearingDeg, miles) {
    const R = 3958.8, d = miles / R, b = toRad(bearingDeg);
    const p1 = toRad(lat), l1 = toRad(lng);
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [toDeg(p2), toDeg(l2)];
  }
  function dist([a, b], [c, d]) {
    const R = 3958.8, dp = toRad(c - a), dl = toRad(d - b);
    const h = Math.sin(dp / 2) ** 2 + Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function bearing([a, b], [c, d]) {
    const y = Math.sin(toRad(d - b)) * Math.cos(toRad(c));
    const x = Math.cos(toRad(a)) * Math.sin(toRad(c)) - Math.sin(toRad(a)) * Math.cos(toRad(c)) * Math.cos(toRad(d - b));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }
  const lineMiles = (pts) => pts.slice(1).reduce((s, p, i) => s + dist(pts[i], p), 0);

  // Waypoints whose straight-line length is `straight` miles.
  // Loop: start -> A -> B -> start, an equilateral triangle pointing along `bearingDeg`.
  // Point to point: start -> W -> finish, W pushed sideways off the midpoint far enough to add the extra distance.
  function waypoints(start, end, straight, i) {
    if (!end) {
      const r = straight / 3;
      const b = (i * 137.5) % 360;             // spread groups around the start
      return [start, dest(start, b - 30, r), dest(start, b + 30, r), start];
    }
    const d = dist(start, end);
    if (straight <= d * 1.05) return [start, end];
    const half = straight / 2;
    const h = Math.sqrt(Math.max(0, half * half - (d * d) / 4));
    const mid = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    const side = i % 2 === 0 ? 90 : -90;      // alternate sides so routes don't sit on top of each other
    return [start, dest(mid, bearing(start, end) + side, h), end];
  }

  async function osrm(pts) {
    const coords = pts.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(";");
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(`${ROUTER}${coords}?overview=full&geometries=geojson`, { signal: ctl.signal });
      if (!r.ok) throw new Error(`router ${r.status}`);
      const j = await r.json();
      if (j.code !== "Ok" || !j.routes || !j.routes.length) throw new Error("no route");
      return { pts: j.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]), miles: j.routes[0].distance / MI };
    } finally {
      clearTimeout(t);
    }
  }

  // One group's route. Returns {pts, miles, street: bool}.
  async function route(start, end, miles, i) {
    const key = JSON.stringify([start, end, miles, i]);
    if (cache.has(key)) return cache.get(key);
    let straight = miles / STREET_FACTOR;
    let best = null;
    if (!routerDown) {
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const got = await osrm(waypoints(start, end, straight, i));
          if (!best || Math.abs(got.miles - miles) < Math.abs(best.miles - miles)) best = got;
          if (Math.abs(got.miles - miles) / miles < 0.06) break;
          straight *= miles / got.miles;          // one correction pass gets most routes within a few percent
        }
      } catch (e) {
        routerDown = true;
        console.warn("Street routing unavailable, drawing approximate shapes.", e);
      }
    }
    const out = best ? { ...best, street: true } : (() => {
      const pts = waypoints(start, end, miles, i);
      return { pts, miles: lineMiles(pts), street: false };
    })();
    cache.set(key, out);
    return out;
  }

  // ---------- Leaflet helpers ----------
  const hasLeaflet = () => typeof window.L !== "undefined";

  function makeMap(el, center, zoom = 14) {
    if (!hasLeaflet()) {
      el.classList.add("map-missing");
      el.textContent = "The map couldn't load. Everything else still works.";
      return null;
    }
    const map = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false })
      .setView(center, zoom);
    L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark() ? "dark_all" : "light_all"}/{z}/{x}/{y}{r}.png`, {
      maxZoom: 19, subdomains: "abcd",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);
    return map;
  }

  function pin(target, latlng, label, kind) {   // target: a map or a layer group
    const icon = L.divIcon({ className: `pin pin-${kind}`, html: `<span>${kind === "finish" ? "🏁" : "●"}</span>`,
                             iconSize: [30, 30], iconAnchor: [15, 15] });
    return L.marker(latlng, { icon, title: label, keyboard: false }).addTo(target).bindTooltip(label);
  }

  // Draw every group's route. Returns {layers, routes} so the replay can move dots along them.
  async function drawPlan(map, plan, onNote) {
    const layers = L.layerGroup().addTo(map);
    if (!plan || !plan.start) return { layers, routes: [] };
    const start = [plan.start.lat, plan.start.lng];
    const end = plan.route && plan.route.type === "point" && plan.route.end ? [plan.route.end.lat, plan.route.end.lng] : null;
    pin(layers, start, `Start: ${plan.start.name}`, "start");
    if (end) pin(layers, end, `Finish: ${plan.route.end.name}`, "finish");
    const routes = [];
    const bounds = L.latLngBounds([start, ...(end ? [end] : [])]);
    let sketched = false;
    for (let i = 0; i < plan.groups.length; i++) {   // one at a time, to be polite to the free router
      const g = plan.groups[i];
      const r = await route(start, end, g.miles, i);
      if (!r.street) sketched = true;
      const line = L.polyline(r.pts, { color: groupColor(i), weight: 5, opacity: 0.85,
                                       dashArray: r.street ? null : "8 8" }).addTo(layers);
      line.bindTooltip(`Group ${g.id}: ${g.miles} mi plan${r.street ? `, ${r.miles.toFixed(1)} mi on these streets` : " (sketch)"}`);
      r.pts.forEach((p) => bounds.extend(p));
      routes.push({ group: g, pts: r.pts, miles: r.miles, color: groupColor(i), street: r.street });
    }
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
    if (onNote) onNote(sketched
      ? "Street routing couldn't be reached, so routes are sketched as straight lines (dashed)."
      : "Routes follow real streets from OpenStreetMap. Street distance can differ a little from the plan.");
    return { layers, routes };
  }

  // ---------- replay: runners' dots move along their group's route (simulated, no real locations) ----------
  function along(pts, frac) {
    if (frac <= 0) return pts[0];
    if (frac >= 1) return pts[pts.length - 1];
    const seg = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) { const d = dist(pts[i - 1], pts[i]); seg.push(d); total += d; }
    let goal = total * frac;
    for (let i = 0; i < seg.length; i++) {
      if (goal <= seg[i]) {
        const t = seg[i] ? goal / seg[i] : 0;
        return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
      }
      goal -= seg[i];
    }
    return pts[pts.length - 1];
  }

  function replay(map, drawn, plan, onTick, seconds = 18) {
    const dots = L.layerGroup().addTo(map);
    const runners = [];
    drawn.routes.forEach((r) => {
      const people = [];
      r.group.members.forEach((m) => {
        people.push({ color: m.color || r.color, name: m.name });
        for (let k = 0; k < (m.guests || 0); k++) people.push({ color: "#b8b1a7", name: "Guest" });
      });
      people.forEach((p, k) => {
        const dot = L.circleMarker(r.pts[0], { radius: 6, color: "#fff", weight: 2, fillColor: p.color, fillOpacity: 1 })
          .addTo(dots).bindTooltip(p.name);
        // a little spread inside each group so the dots don't stack
        runners.push({ dot, pts: r.pts, minutes: r.group.minutes * (1 + (k % 3 - 1) * 0.012) });
      });
    });
    const runMinutes = Math.max(...drawn.routes.map((r) => r.group.minutes), 1) * 1.03;
    const t0 = performance.now();
    let raf;
    const frame = (now) => {
      const m = Math.min(runMinutes, ((now - t0) / 1000 / seconds) * runMinutes);
      runners.forEach((r) => r.dot.setLatLng(along(r.pts, m / r.minutes)));
      onTick(m, m >= runMinutes);
      if (m < runMinutes) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return { stop() { cancelAnimationFrame(raf); map.removeLayer(dots); } };
  }

  return { makeMap, pin, drawPlan, replay, groupColor, hasLeaflet, dist };
})();
