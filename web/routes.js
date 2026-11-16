// Route drawing for Finish Together.
//
// The agents decide how far each pace group runs. This file turns each distance
// into a line on real streets, starting at the club's meeting point and ending at
// the start (a loop) or at the club's chosen finish (point to point).
//
// Routes are kept simple so nobody gets lost: every group runs the same shape (out and
// back along one long street for a loop) and only the turnaround point differs. The shape
// is picked from a few candidates by counting turns, matching the planned distance and, in
// Philadelphia, avoiding streets with more violent incidents in the last 12 months
// (counts per ~200 m cell from the server, see app/crime.py).
//
// Street routes come from the free OpenStreetMap foot router run by FOSSGIS
// (routing.openstreetmap.de, no key needed). If it can't be reached, the map falls
// back to a straight-line sketch of the same shape, drawn dashed and labelled.
// Map tiles: the standard OpenStreetMap tile server (free, no key, attribution shown).
"use strict";

const FT_MAP = (() => {
  const ROUTER = "https://routing.openstreetmap.de/routed-foot/route/v1/foot/";
  const STREET_FACTOR = 1.25;               // streets wander; aim the sketch shorter so the street route lands near the target
  const MI = 1609.344;
  const cache = new Map();
  let routerDown = false;                   // after one failure, stop calling it for this page load

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

  // ---------- route shapes ----------
  // Runners get lost at turns, so routes are built from simple shapes that keep to one or two
  // long streets: out and back along one bearing for a loop, and for a separate finish either a
  // straight line, an overshoot past the finish and back, a backtrack behind the start first, or a
  // wide detour to one side. The router then follows real streets between those points.
  // Loop candidates: out and back along 8 compass bearings. Point candidates: the four shapes.
  function shapes(start, end) {
    if (!end) return [0, 45, 90, 135, 180, 225, 270, 315].map((b) => ({ kind: "outback", bearing: b }));
    return [{ kind: "overshoot" }, { kind: "backtrack" }, { kind: "detour", side: 90 }, { kind: "detour", side: -90 }];
  }
  function waypoints(start, end, straight, shape) {
    if (!end) {
      if (shape.kind === "triangle") {
        const r = straight / 3, b = shape.bearing || 0;
        return [start, dest(start, b - 30, r), dest(start, b + 30, r), start];
      }
      return [start, dest(start, shape.bearing, straight / 2), start];
    }
    const d = dist(start, end);
    if (straight <= d * 1.05) return [start, end];
    const extra = straight - d, b = bearing(start, end);
    if (shape.kind === "overshoot") return [start, dest(end, b, extra / 2), end];
    if (shape.kind === "backtrack") return [start, dest(start, b + 180, extra / 2), end];
    const half = straight / 2;
    const h = Math.sqrt(Math.max(0, half * half - (d * d) / 4));
    const mid = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    return [start, dest(mid, b + shape.side, h), end];
  }

  // A turn is a left or right (not a slight bend) or a roundabout; leaving and arriving don't count.
  function countTurns(r) {
    let n = 0;
    for (const leg of r.legs || []) for (const st of leg.steps || []) {
      const t = st.maneuver.type, m = st.maneuver.modifier || "";
      if (t === "depart" || t === "arrive") continue;
      if (t === "roundabout" || t === "rotary" || (/left|right|uturn/.test(m) && !/slight/.test(m))) n++;
    }
    return n;
  }

  async function osrm(pts) {
    const coords = pts.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(";");
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(`${ROUTER}${coords}?overview=full&geometries=geojson&steps=true`, { signal: ctl.signal });
      if (!r.ok) throw new Error(`router ${r.status}`);
      const j = await r.json();
      if (j.code !== "Ok" || !j.routes || !j.routes.length) throw new Error("no route");
      const best = j.routes[0];
      return { pts: best.geometry.coordinates.map(([lng, lat]) => [lat, lng]), miles: best.distance / MI,
               turns: countTurns(best),
               turnaround: pts.length === 3 && j.waypoints && j.waypoints[1] ? [j.waypoints[1].location[1], j.waypoints[1].location[0]] : null };
    } finally {
      clearTimeout(t);
    }
  }

  // Split a line at a fraction of its length: returns [before, after], both including the split point.
  function splitAt(pts, frac) {
    const total = lineMiles(pts);
    let goal = total * frac;
    for (let i = 1; i < pts.length; i++) {
      const d = dist(pts[i - 1], pts[i]);
      if (goal <= d) {
        const t = d ? goal / d : 0;
        const p = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
        return [[...pts.slice(0, i), p], [p, ...pts.slice(i)], i];
      }
      goal -= d;
    }
    return [pts, [pts[pts.length - 1]], pts.length - 1];
  }

  // ---------- street safety ----------
  // The server sends counts of violent incidents in the last 12 months per ~200 m cell (Philadelphia only).
  // A route's score is the average count in the cells it passes through, against the area's average.
  function safetyIndex(grid) {
    if (!grid || !grid.available || !grid.cells) return null;
    const k = 1 / grid.cell, m = new Map();
    grid.cells.forEach(([la, ln, n]) => m.set(`${Math.round(la * k)},${Math.round(ln * k)}`, n));
    return { at: ([la, ln]) => m.get(`${Math.round(la * k)},${Math.round(ln * k)}`) || 0, baseline: Math.max(grid.baseline || 0, 0.01) };
  }
  function riskOf(pts, idx) {
    if (!idx || pts.length < 2) return null;
    let sum = 0, n = 0;
    for (let f = 0; f <= 1.0001; f += 0.01) { sum += idx.at(along(pts, f)); n++; }
    return sum / n / idx.baseline;           // 1 = the area's average
  }
  const riskLabel = (r) => r === null || r === undefined ? null
    : r < 0.75 ? "fewer recent incidents than nearby streets"
    : r <= 1.25 ? "about average for nearby streets" : "more recent incidents than nearby streets";

  // Lower is better: few turns per mile, close to the planned distance, and quieter streets when data exists.
  function score(got, target, risk) {
    const err = Math.abs(got.miles - target) / target;
    return got.turns / Math.max(got.miles, 0.5) + Math.max(0, err - 0.08) * 10 + (risk === null ? 0 : risk * 1.2);
  }

  const shapeCache = new Map();
  async function pickShape(start, end, miles, idx) {
    const key = JSON.stringify([start, end, Math.round(miles * 2) / 2, !!idx]);
    if (shapeCache.has(key)) return shapeCache.get(key);
    let best = null;
    for (const shape of shapes(start, end)) {
      try {
        const got = await osrm(waypoints(start, end, miles / STREET_FACTOR, shape));
        const s = score(got, miles, riskOf(got.pts, idx));
        if (!best || s < best.s) best = { shape, s };
      } catch (e) {
        if (!best) throw e;                       // the router is down: stop trying shapes
      }
    }
    const shape = best ? best.shape : end ? { kind: "detour", side: 90 } : { kind: "outback", bearing: 45 };
    shapeCache.set(key, shape);
    return shape;
  }

  // One group's route. Returns {pts, miles, street, turns, risk, turnaround}.
  async function route(start, end, miles, shape, idx) {
    const key = JSON.stringify([start, end, miles, shape, !!idx]);
    if (cache.has(key)) return cache.get(key);
    let straight = miles / STREET_FACTOR;
    let best = null;
    if (!routerDown) {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const got = await osrm(waypoints(start, end, straight, shape));
          if (!best || Math.abs(got.miles - miles) < Math.abs(best.miles - miles)) best = got;
          if (Math.abs(got.miles - miles) / miles < 0.06) break;
          straight *= miles / got.miles;          // a correction pass or two gets most routes within a few percent
        }
      } catch (e) {
        routerDown = true;
        console.warn("Street routing unavailable, drawing approximate shapes.", e);
      }
    }
    const out = best ? { ...best, street: true, risk: riskOf(best.pts, idx) } : (() => {
      const pts = waypoints(start, end, miles, shape);
      return { pts, miles: lineMiles(pts), street: false, turns: null, risk: null, turnaround: null };
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
    // Standard OpenStreetMap tiles: free, no key, attribution required. Dark mode is a CSS filter (styles.css).
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    return map;
  }

  function pin(target, latlng, label, kind) {   // target: a map or a layer group
    const icon = L.divIcon({ className: `pin pin-${kind}`, html: `<span>${kind === "finish" ? "🏁" : "●"}</span>`,
                             iconSize: [30, 30], iconAnchor: [15, 15] });
    return L.marker(latlng, { icon, title: label, keyboard: false }).addTo(target).bindTooltip(label);
  }

  // Draw every group's route. Returns {layers, routes} so the replay can move dots along them.
  // safetyGrid: what /api/clubs/<slug>/safety returned, or null.
  async function drawPlan(map, plan, onNote, safetyGrid) {
    const layers = L.layerGroup().addTo(map);
    if (!plan || !plan.start) return { layers, routes: [] };
    const start = [plan.start.lat, plan.start.lng];
    const end = plan.route && plan.route.type === "point" && plan.route.end ? [plan.route.end.lat, plan.route.end.lng] : null;
    const idx = safetyIndex(safetyGrid);
    pin(layers, start, `Start: ${plan.start.name}`, "start");
    if (end) pin(layers, end, `Finish: ${plan.route.end.name}`, "finish");
    const bounds = L.latLngBounds([start, ...(end ? [end] : [])]);
    // Every group runs the same simple shape, so groups share the same streets and differ only in how far they go.
    let shape = end ? { kind: "detour", side: 90 } : { kind: "outback", bearing: 45 };
    const longest = Math.max(...plan.groups.map((g) => g.miles), 0.5);
    if (!routerDown) {
      try { shape = await pickShape(start, end, longest, idx); }
      catch (e) { routerDown = true; console.warn("Street routing unavailable, drawing approximate shapes.", e); }
    }
    const together = plan.route && plan.route.style === "together" && plan.groups.length > 1;
    if (together) return drawTogether(map, plan, layers, start, end, idx, bounds, onNote, safetyGrid);
    const staggered = plan.route && plan.route.style === "staggered";
    const routes = [];
    let shared = null;                               // staggered start: one route, every group runs it
    for (let i = 0; i < plan.groups.length; i++) {   // one at a time, to be polite to the free router
      const g = plan.groups[i];
      const r = staggered ? (shared = shared || await route(start, end, g.miles, shape, idx)) : await route(start, end, g.miles, shape, idx);
      routes.push({ group: g, i, pts: r.pts, miles: r.miles, color: groupColor(i), street: r.street,
                    turns: r.turns, risk: r.risk, riskLabel: riskLabel(r.risk), turnaround: r.turnaround });
      r.pts.forEach((p) => bounds.extend(p));
    }
    // Longest first and widest, so groups that share streets show as nested stripes.
    const order = [...routes].sort((a, b) => b.miles - a.miles);
    order.forEach((r, k) => {
      const w = Math.max(3, 11 - k * 2);
      const line = L.polyline(r.pts, { color: r.color, weight: w, opacity: 0.9, dashArray: r.street ? null : "8 8" }).addTo(layers);
      const bits = [`Group ${r.group.id}: ${r.group.miles} mi plan`];
      if (r.street) bits.push(`${r.miles.toFixed(1)} mi on these streets`, `${r.turns} turns`);
      else bits.push("sketch");
      if (r.riskLabel) bits.push(r.riskLabel);
      line.bindTooltip(bits.join(", "));
      if (r.turnaround) {
        const icon = L.divIcon({ className: "turn-flag", html: `<span style="background:${r.color}">${r.group.id}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
        L.marker(r.turnaround, { icon, keyboard: false }).addTo(layers).bindTooltip(`Group ${r.group.id} turns around here`);
      }
    });
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
    const sketched = routes.some((r) => !r.street);
    if (onNote) onNote((sketched ? "Street routing couldn't be reached, so routes are sketched as straight lines (dashed). " : "")
      + (staggered ? "Staggered start: every group runs this same route. The slowest group leaves first and each group starts at its own time, so all groups finish together. "
                   + (idx ? "The route avoids streets with more violent incidents in the last 12 months (Philadelphia police data)." : (safetyGrid && safetyGrid.note) || "")
      : sketched ? "" : `Routes keep to long straight streets with few turns${end ? "" : "; each group turns around at its numbered flag"}. `
        + (idx ? "They also avoid streets with more violent incidents in the last 12 months (Philadelphia police data)."
               : (safetyGrid && safetyGrid.note) || "No street safety data here.")));
    return { layers, routes, staggered };
  }

  // "Run together": every group runs one shared route, the slowest group's distance. The first stretch has no
  // splits so the club starts as one pack. Each faster group leaves the shared route at its numbered flag for a
  // short out-and-back of exactly its extra distance, then rejoins, so everyone still finishes together.
  async function drawTogether(map, plan, layers, start, end, idx, bounds, onNote, safetyGrid) {
    const PACK = 0.3;                                         // no splits in the first 30% of the shared route
    const baseMiles = Math.min(...plan.groups.map((g) => g.miles));
    let shape = end ? { kind: "detour", side: 90 } : { kind: "outback", bearing: 45 };
    if (!routerDown) {
      try { shape = await pickShape(start, end, baseMiles, idx); }
      catch (e) { routerDown = true; console.warn("Street routing unavailable, drawing approximate shapes.", e); }
    }
    const main = await route(start, end, baseMiles, shape, idx);
    main.pts.forEach((p) => bounds.extend(p));
    const order = plan.groups.map((g, i) => ({ g, i, extra: g.miles - baseMiles })).filter((x) => x.extra > 0.1)
      .sort((a, b) => a.extra - b.extra);
    const spurs = new Map();
    for (let k = 0; k < order.length; k++) {
      const { g, i, extra } = order[k];
      const frac = order.length === 1 ? 0.5 : PACK + 0.05 + (k / (order.length - 1)) * (0.65 - PACK - 0.05);
      const [before, after, at] = splitAt(main.pts, frac);
      const here = before[before.length - 1];
      const ahead = main.pts[Math.min(at, main.pts.length - 1)];
      const side = (k % 2 ? -90 : 90) + (dist(here, ahead) > 0.005 ? bearing(here, ahead) : 0);
      const spur = await route(here, null, extra, { kind: "outback", bearing: side }, idx);
      spur.pts.forEach((p) => bounds.extend(p));
      spurs.set(i, { here, spur, pts: [...before, ...spur.pts.slice(1), ...after.slice(1)] });
    }
    const routes = plan.groups.map((g, i) => {
      const s = spurs.get(i);
      const pts = s ? s.pts : main.pts;
      const street = main.street && (!s || s.spur.street);
      return { group: g, i, pts, miles: lineMiles(pts), color: groupColor(i), street,
               turns: street ? main.turns + (s ? s.spur.turns : 0) : null, risk: riskOf(pts, idx),
               riskLabel: riskLabel(riskOf(pts, idx)), turnaround: s ? s.spur.turnaround : null, split: s ? s.here : null };
    });
    // The shared route in the color of the group that runs only that, drawn wide; add-ons on top in each group's color.
    const baseGroup = routes.find((r) => !spurs.has(r.i)) || routes[0];
    L.polyline(main.pts, { color: "#1f3a5f", weight: 12, opacity: 0.25 }).addTo(layers);
    L.polyline(main.pts, { color: baseGroup.color, weight: 6, opacity: 0.95, dashArray: main.street ? null : "8 8" }).addTo(layers)
      .bindTooltip(`Shared route: ${baseMiles} mi${main.street ? `, ${main.turns} turns` : " (sketch)"}. Everyone runs this together.`);
    routes.filter((r) => spurs.has(r.i)).forEach((r) => {
      const s = spurs.get(r.i);
      L.polyline(s.spur.pts, { color: r.color, weight: 5, opacity: 0.95, dashArray: s.spur.street ? null : "6 6" }).addTo(layers)
        .bindTooltip(`Group ${r.group.id} add-on: ${(r.group.miles - baseMiles).toFixed(2).replace(/0$/, "")} mi out and back, then rejoin`);
      const icon = L.divIcon({ className: "turn-flag split-flag", html: `<span style="background:${r.color}">${r.group.id}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
      L.marker(s.here, { icon, keyboard: false }).addTo(layers).bindTooltip(`Group ${r.group.id} splits off here and comes back here`);
      if (s.spur.turnaround) {
        const t = L.divIcon({ className: "turn-flag", html: `<span style="background:${r.color}">↺</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
        L.marker(s.spur.turnaround, { icon: t, keyboard: false }).addTo(layers).bindTooltip(`Group ${r.group.id} turns back here`);
      }
    });
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
    if (onNote) onNote((routes.some((r) => !r.street) ? "Street routing couldn't be reached, so routes are sketched (dashed). " : "")
      + "Run together: everyone starts as one pack on the shared route. Faster groups split off at their numbered flag "
      + "for a short out-and-back and rejoin, so all groups finish together. "
      + (idx ? "Routes avoid streets with more violent incidents in the last 12 months (Philadelphia police data)."
             : (safetyGrid && safetyGrid.note) || ""));
    return { layers, routes, together: true, baseMiles };
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
        runners.push({ dot, pts: r.pts, off: r.group.start_offset || 0, minutes: r.group.minutes * (1 + (k % 3 - 1) * 0.012) });
      });
    });
    const runMinutes = Math.max(...drawn.routes.map((r) => (r.group.start_offset || 0) + r.group.minutes), 1) * 1.03;
    const t0 = performance.now();
    let raf;
    const frame = (now) => {
      const m = Math.min(runMinutes, ((now - t0) / 1000 / seconds) * runMinutes);
      runners.forEach((r) => r.dot.setLatLng(along(r.pts, (m - r.off) / r.minutes)));   // waits at the start until its group's time
      onTick(m, m >= runMinutes);
      if (m < runMinutes) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return { stop() { cancelAnimationFrame(raf); map.removeLayer(dots); } };
  }

  return { makeMap, pin, drawPlan, replay, groupColor, hasLeaflet, dist, riskLabel };
})();
