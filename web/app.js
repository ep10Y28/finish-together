// Finish Together front end. Plain JS, no build step.
// Pages: #/ (all clubs) and #/club/<slug>/<tab>. All text from users goes in with
// textContent, never as HTML.
"use strict";

// ---------------------------------------------------------------- small helpers
const $ = (id) => document.getElementById(id);
function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "style") n.style.cssText = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.appendChild(typeof kid === "string" || typeof kid === "number" ? document.createTextNode(String(kid)) : kid);
  }
  return n;
}
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: fine */ } },
};
const initials = (name) => (name || "?").split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
const fmtPace = (p) => { let m = Math.floor(p), s = Math.round((p - m) * 60); if (s === 60) { m++; s = 0; } return `${m}:${String(s).padStart(2, "0")}`; };
const parsePace = (t) => { const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(t || ""); return m ? +m[1] + +m[2] / 60 : null; };
const clockAt = (runTime, minutes) => {
  const [hh, mm] = (runTime || "18:30").split(":").map(Number);
  const t = hh * 60 + mm + Math.round(minutes);
  const H = Math.floor(t / 60) % 24, M = t % 60;
  return `${H % 12 || 12}:${String(M).padStart(2, "0")} ${H >= 12 ? "PM" : "AM"}`;
};
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function avatar(name, color, cls = "") {
  return h("span", { class: `avatar ${cls}`, style: `background:${color || "#9a948b"}`, title: name }, initials(name));
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

// ---------------------------------------------------------------- AI or rules badge
function setModeBadge(mode, model) {
  const b = $("mode");
  const live = mode !== "demo";
  b.textContent = live ? `AI on · ${model}` : "No AI key · rules only";
  b.title = live ? "The agents are using the AI model." : "No course key found, so the agents use simple rules. Add PORTKEY_API_KEY to .env and restart for real understanding.";
  b.className = "badge" + (live ? " live" : " demo");
}

// ---------------------------------------------------------------- API
let ME = null;
let PEOPLE = [];
async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (ME) headers["X-User-Id"] = String(ME.id);
  const r = await fetch(path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let data = {};
  try { data = await r.json(); } catch { /* empty */ }
  if (!r.ok) {
    const d = data.detail;
    throw new Error(typeof d === "string" ? d : Array.isArray(d) ? "Please check the form and try again." : `Something went wrong (${r.status}).`);
  }
  return data;
}

// The page reports its own script errors so the Improvement Scout can turn them into fixes.
let reportedErrors = 0;
function reportError(message) {
  if (reportedErrors++ > 5) return;
  fetch("/api/client-error", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ page: location.hash || "#/", message: String(message).slice(0, 400) }) }).catch(() => {});
}
window.addEventListener("error", (e) => reportError(e.message || "script error"));
window.addEventListener("unhandledrejection", (e) => reportError((e.reason && e.reason.message) || "unhandled promise rejection"));

// ---------------------------------------------------------------- bottom sheet
let sheetMap = null;
function openSheet(title, body) {
  $("sheetTitle").textContent = title;
  $("sheetBody").replaceChildren(body);
  $("sheet").hidden = false;
  document.body.classList.add("sheet-open");
  const first = body.querySelector("input, select, button");
  if (first && window.matchMedia("(pointer: fine)").matches) first.focus();
}
function closeSheet() {
  $("sheet").hidden = true;
  document.body.classList.remove("sheet-open");
  if (sheetMap) { sheetMap.remove(); sheetMap = null; }
}
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeSheet));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").hidden) closeSheet(); });

// ---------------------------------------------------------------- who you are (demo sign-in)
function setMe(person) {
  ME = person;
  if (person) store.set("ft_user", String(person.id));
  $("accountName").textContent = person ? person.name.split(" ")[0] : "Sign in";
  const a = $("accountAvatar");
  a.textContent = person ? initials(person.name) : "?";
  a.style.background = person ? person.color : "#9a948b";
  IS_ADMIN = false; $("adminLink").hidden = true;
  if (person) api("/api/me").then((r) => { if (ME && ME.id === person.id) { IS_ADMIN = !!r.is_admin; $("adminLink").hidden = !IS_ADMIN; } }).catch(() => {});
}
let IS_ADMIN = false;

function accountSheet() {
  const filter = h("input", { type: "search", placeholder: "Find a person", autocomplete: "off", "aria-label": "Find a person" });
  const list = h("div", { class: "people" });
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    list.replaceChildren(...PEOPLE.filter((p) => !q || p.name.toLowerCase().includes(q)).slice(0, 60).map((p) =>
      h("button", { type: "button", class: `person ${ME && ME.id === p.id ? "on" : ""}`, onclick: () => { setMe(p); closeSheet(); render(); } },
        avatar(p.name, p.color), h("span", { class: "grow" }, p.name), h("span", { class: "muted small" }, p.bio || ""))));
  };
  filter.addEventListener("input", draw);
  draw();
  const name = h("input", { required: true, maxlength: 40, placeholder: "Your name", autocomplete: "name" });
  const pace = h("input", { required: true, placeholder: "9:30", inputmode: "numeric", pattern: "\\d{1,2}:\\d{2}" });
  const miles = h("input", { required: true, type: "number", min: 1, max: 20, step: 0.5, value: 4, inputmode: "decimal" });
  const form = h("form", { class: "form", onsubmit: async (e) => {
    e.preventDefault();
    try {
      const r = await api("/api/signup", { method: "POST", body: { name: name.value, pace: pace.value, usual_miles: +miles.value } });
      PEOPLE.push(r.me);
      setMe(r.me);
      closeSheet();
      toast(`Welcome, ${r.me.name.split(" ")[0]}! Pick a club and ask to join.`);
      if (location.hash === "#/") render(); else location.hash = "#/";
    } catch (err) { toast(err.message); }
  } },
    h("label", {}, "Name", name),
    h("div", { class: "row2" }, h("label", {}, "Usual pace (min/mile)", pace), h("label", {}, "Usual miles", miles)),
    h("button", { class: "btn primary block", type: "submit" }, "Sign up"));
  openSheet("Who are you?", h("div", {},
    h("p", { class: "muted small" }, "Demo sign-in: pick anyone to see the app as them. Rae Simmons is a club captain."),
    filter, list, h("h3", {}, "New here?"), form));
}
$("account").addEventListener("click", accountSheet);

// ---------------------------------------------------------------- router
let stopClub = null;
window.addEventListener("hashchange", render);

function render() {
  if (stopClub) { stopClub(); stopClub = null; }
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "club" && parts[1]) clubPage(parts[1], parts[2] || "plan");
  else if (parts[0] === "admin") adminPage();
  else directory();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- page: all clubs
async function directory() {
  const view = $("view");
  const mapBox = h("div", { class: "map dir-map" });
  const list = h("div", { class: "club-list" }, h("div", { class: "muted" }, "Loading clubs…"));
  view.replaceChildren(h("section", { class: "page" },
    h("div", { class: "intro" },
      h("div", {},
        h("h1", {}, "Run together, finish together"),
        h("p", { class: "muted" }, "Find a club, check in for the next run, and the agents plan routes so every pace group finishes at the same time.")),
      h("button", { class: "btn primary", onclick: newClubSheet }, "Start a club")),
    mapBox, list));
  let data;
  try { data = await api("/api/clubs"); } catch (e) { list.replaceChildren(h("div", { class: "empty" }, e.message)); return; }
  list.replaceChildren(...data.clubs.map(clubCard));
  const map = FT_MAP.makeMap(mapBox, [39.5, -80], 4);
  if (map) {
    const pts = data.clubs.map((c) => {
      L.circleMarker([c.start_lat, c.start_lng], { radius: 9, color: "#fff", weight: 2, fillColor: c.color, fillOpacity: 1 })
        .addTo(map).bindTooltip(`${c.name} · ${c.city}`).on("click", () => (location.hash = `#/club/${c.slug}`));
      return [c.start_lat, c.start_lng];
    });
    if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 12 });
    stopClub = () => map.remove();
  }
}

function statusBadge(status, role) {
  if (role === "captain" && status === "approved") return h("span", { class: "pill cap" }, "Captain");
  if (status === "approved") return h("span", { class: "pill in" }, "Member");
  if (status === "pending") return h("span", { class: "pill maybe" }, "Requested");
  return null;
}

function clubCard(c) {
  return h("a", { class: "club-card", href: `#/club/${c.slug}`, style: `--club:${c.color}` },
    h("div", { class: "club-card-top" },
      h("div", {}, h("div", { class: "club-name" }, c.name), h("div", { class: "muted small" }, `${c.city} · captain ${c.captain || "?"}`)),
      statusBadge(c.my_status, c.my_role)),
    h("div", { class: "small" }, `${c.run_day}s ${c.start_clock} · ${c.start_name}${c.route_type === "point" ? ` → ${c.finish_name}` : " (loop)"}`),
    h("div", { class: "small muted" }, c.target_label),
    h("div", { class: "club-card-foot small" },
      h("span", {}, `${c.members} members`),
      h("span", {}, `${c.tonight.label}: ` + (c.tonight.groups ? `${c.tonight.going} going · ${c.tonight.groups} groups · finish ${c.tonight.back_at}` : "no plan yet"))));
}

// ---------------------------------------------------------------- place suggestions
// Suggestions while typing come from Photon (komoot's free OpenStreetMap search, made for search-as-you-type,
// no key). Near misses are tolerated: if the exact words find nothing, filler words like "steps" or
// "entrance" are dropped and then one word at a time, so "Philadelphia Art Museum Steps" still finds
// the Philadelphia Museum of Art. Results are biased toward the club's area.
const FILLER = /\b(steps?|the|of|at|by|near|entrance|front|corner|park(ing)? lot|area)\b/gi;
function queryVariants(q) {
  const out = [q];
  const lean = q.replace(FILLER, " ").replace(/\s+/g, " ").trim();
  if (lean && lean !== q) out.push(lean);
  const words = lean.split(" ");
  if (words.length > 2) for (let i = words.length - 1; i >= 0 && out.length < 6; i--) out.push(words.filter((_, k) => k !== i).join(" "));
  return [...new Set(out)];
}
async function suggestPlaces(q, near) {
  const bias = near ? `&lat=${near[0].toFixed(4)}&lon=${near[1].toFixed(4)}` : "";
  for (const v of queryVariants(q)) {
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(v)}&limit=5&lang=en${bias}`);
    if (!r.ok) throw new Error("search unavailable");
    const j = await r.json();
    const seen = new Set();
    const places = (j.features || []).map((f) => {
      const p = f.properties || {};
      const name = p.name || [p.housenumber, p.street].filter(Boolean).join(" ") || p.city || "Place";
      const where = [p.name ? p.street : null, p.city || p.county, p.state].filter(Boolean);
      return { name, label: [name, ...where.filter((x) => x !== name)].join(", "),
               at: [f.geometry.coordinates[1], f.geometry.coordinates[0]] };
    }).filter((x) => !seen.has(x.label) && seen.add(x.label));
    if (places.length) return { places, used: v };
  }
  return { places: [], used: q };
}

// A text field that names a place and suggests matches as you type. onPick({name, at}); onName(text).
function placeField(label, value, near, onPick, onName) {
  const input = h("input", { value: value || "", maxlength: 60, autocomplete: "off", placeholder: "Type a place, e.g. Philadelphia Museum of Art",
                             "aria-label": label, role: "combobox", "aria-expanded": "false", "aria-autocomplete": "list" });
  const list = h("ul", { class: "suggest", role: "listbox", hidden: true });
  let timer = null, seq = 0, items = [], active = -1;
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
  const pick = (pl) => { input.value = pl.name; close(); onPick(pl); };
  const paint = (note) => {
    list.replaceChildren(...items.map((pl, i) => h("li", { role: "option", class: i === active ? "on" : "", "aria-selected": i === active ? "true" : "false",
      onmousedown: (e) => { e.preventDefault(); pick(pl); } }, h("b", {}, pl.name), h("span", { class: "small muted" }, pl.label.slice(pl.name.length + 2)))),
      ...(note ? [h("li", { class: "note small muted" }, note)] : []));
    list.hidden = !items.length && !note;
    input.setAttribute("aria-expanded", list.hidden ? "false" : "true");
  };
  async function lookup() {
    const q = input.value.trim(), my = ++seq;
    if (q.length < 3) { items = []; close(); return; }
    try {
      const { places, used } = await suggestPlaces(q, near());
      if (my !== seq) return;
      items = places; active = places.length ? 0 : -1;
      paint(places.length ? (used !== q ? `Showing matches for “${used}”` : "") : "No matches. Try other words, or drag the pin on the map.");
    } catch { if (my === seq) { items = []; paint("Place search isn't reachable right now. Drag the pin on the map instead."); } }
  }
  input.addEventListener("input", () => { onName(input.value.trim()); clearTimeout(timer); timer = setTimeout(lookup, 300); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && items.length) { e.preventDefault(); active = (active + 1) % items.length; paint(); }
    else if (e.key === "ArrowUp" && items.length) { e.preventDefault(); active = (active - 1 + items.length) % items.length; paint(); }
    else if (e.key === "Enter") { e.preventDefault(); if (!list.hidden && items[active]) pick(items[active]); else { clearTimeout(timer); lookup(); } }
    else if (e.key === "Escape") close();
  });
  input.addEventListener("blur", () => setTimeout(close, 150));
  return { node: h("label", { class: "place-field" }, label, h("div", { class: "suggest-wrap" }, input, list)), input };
}

// ---------------------------------------------------------------- map picker (start and finish)
function mapPicker(initial, onChange) {
  // initial: {start:[lat,lng], end:[lat,lng]|null, startName, endName}. onChange({start, end, routeType, startName, endName}).
  const state = { start: initial.start, end: initial.end, routeType: initial.end ? "point" : "loop",
                  startName: initial.startName || "", endName: initial.endName || "" };
  const box = h("div", { class: "map picker-map" });
  const help = h("div", { class: "small muted" });
  const typeSeg = h("div", { class: "seg" });
  const markers = {};
  let map = null;
  const near = () => state.start;
  const emit = () => onChange({ start: state.start, end: state.routeType === "point" ? state.end : null, routeType: state.routeType,
                                startName: state.startName, endName: state.endName });
  const startField = placeField("Start (meeting point)", state.startName, near,
    (pl) => { state.start = pl.at; state.startName = pl.name; if (map) map.setView(pl.at, 15); drawPins(); emit(); },
    (name) => { state.startName = name; emit(); });
  const endField = placeField("Finish", state.endName, near,
    (pl) => { state.end = pl.at; state.endName = pl.name; if (map) map.setView(pl.at, 15); drawPins(); emit(); },
    (name) => { state.endName = name; emit(); });
  function pinAt(which) {
    const kind = which === "end" ? "finish" : "start";
    const icon = L.divIcon({ className: `pin pin-${kind}`, html: `<span>${kind === "finish" ? "🏁" : "●"}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
    return L.marker(state[which], { icon, draggable: true, title: kind === "finish" ? "Finish: drag to move" : "Start: drag to move" })
      .addTo(map).on("dragend", (e) => { const ll = e.target.getLatLng(); state[which] = [ll.lat, ll.lng]; emit(); });
  }
  function drawPins() {
    if (!map) return;
    for (const k of ["start", "end"]) { if (markers[k]) { map.removeLayer(markers[k]); markers[k] = null; } }
    markers.start = pinAt("start");
    if (state.routeType === "point" && state.end) markers.end = pinAt("end");
  }
  const sync = () => {
    typeSeg.replaceChildren(
      h("button", { type: "button", class: state.routeType === "loop" ? "on" : "", onclick: () => { state.routeType = "loop"; sync(); } }, "Loop back to start"),
      h("button", { type: "button", class: state.routeType === "point" ? "on" : "", onclick: () => {
        state.routeType = "point";
        if (!state.end) state.end = [state.start[0] + 0.01, state.start[1] + 0.012];
        sync();
        if (map) map.fitBounds([state.start, state.end], { padding: [40, 40], maxZoom: 15 });
      } }, "Separate finish"));
    endField.node.hidden = state.routeType !== "point";
    help.textContent = state.routeType === "point"
      ? "Pick each place from the suggestions, then drag the ● start or 🏁 finish pin to the exact spot. Tapping the map moves the nearer pin."
      : "Pick the place from the suggestions, then drag the pin to the exact spot, or tap the map to move it.";
    drawPins();
    emit();
  };
  const wrap = h("div", { class: "picker" }, h("div", { class: "label" }, "Route"), typeSeg, startField.node, endField.node, box, help);
  setTimeout(() => {
    map = FT_MAP.makeMap(box, state.start, 14);
    wrap._map = map;
    if (!map) return;
    map.on("click", (e) => {
      const p = [e.latlng.lat, e.latlng.lng];
      const which = state.routeType === "point" && state.end && FT_MAP.dist(p, state.end) < FT_MAP.dist(p, state.start) ? "end" : "start";
      state[which] = p; drawPins(); emit();
    });
    sync();
    if (state.routeType === "point" && state.end) map.fitBounds([state.start, state.end], { padding: [40, 40], maxZoom: 15 });
  }, 30);
  sync();
  return wrap;
}

function targetPicker(mode, value, style) {
  const st = { mode, style: style || "separate" };
  const input = h("input", { type: "number", required: true, inputmode: "decimal", "aria-label": "Distance or time" });
  const unit = h("span", { class: "unit" });
  const hint = h("div", { class: "small muted" });
  const seg = h("div", { class: "seg" });
  const sync = () => {
    seg.replaceChildren(
      h("button", { type: "button", class: st.mode === "distance" ? "on" : "", onclick: () => { if (st.mode !== "distance") input.value = 5; st.mode = "distance"; sync(); } }, "By distance"),
      h("button", { type: "button", class: st.mode === "time" ? "on" : "", onclick: () => { if (st.mode !== "time") input.value = 45; st.mode = "time"; sync(); } }, "By time"));
    if (st.mode === "distance") {
      Object.assign(input, { min: 1, max: 20, step: 0.5 }); unit.textContent = "miles";
      hint.textContent = st.style === "staggered"
        ? "Everyone runs this far. The slowest group starts first, so everyone finishes together."
        : "The middle pace group runs this far. Faster groups run farther, slower groups less, and everyone finishes together.";
    } else {
      Object.assign(input, { min: 15, max: 150, step: 5 }); unit.textContent = "minutes";
      hint.textContent = st.style === "staggered"
        ? "The slowest group runs for about this long. Everyone runs the same distance, and faster groups start later."
        : "Everyone runs for this long. Faster groups cover more ground.";
    }
  };
  input.value = value;
  sync();
  return { node: h("div", { class: "target" }, h("div", { class: "label" }, "Distance or time"), seg, h("div", { class: "with-unit" }, input, unit), hint),
           value: () => ({ target_mode: st.mode, target_value: +input.value }), setStyle: (v) => { st.style = v; sync(); } };
}

// ---------------------------------------------------------------- start a club
function newClubSheet() {
  if (!ME) { accountSheet(); return; }
  let pick = { start: [39.9526, -75.1652], end: null, routeType: "loop", startName: "", endName: "" };
  const f = {
    name: h("input", { required: true, maxlength: 60, placeholder: "Club name" }),
    city: h("input", { required: true, maxlength: 60, placeholder: "City" }),
    run_day: h("select", {}, DAYS.map((d) => h("option", { value: d, selected: d === "Wednesday" }, d))),
    run_time: h("input", { type: "time", value: "18:30", required: true }),
  };
  const picker = mapPicker(pick, (p) => { pick = p; });
  const target = targetPicker("time", 45);
  const form = h("form", { class: "form", onsubmit: async (e) => {
    e.preventDefault();
    try {
      if (!pick.startName) { toast("Name the meeting point."); return; }
      const body = { name: f.name.value, city: f.city.value, start_name: pick.startName,
        start_lat: pick.start[0], start_lng: pick.start[1], run_day: f.run_day.value, run_time: f.run_time.value,
        route_type: pick.routeType, ...target.value() };
      if (pick.routeType === "point") Object.assign(body, { end_name: pick.endName || "Finish", end_lat: pick.end[0], end_lng: pick.end[1] });
      const r = await api("/api/clubs", { method: "POST", body });
      closeSheet();
      toast("Club created. You're its captain.");
      location.hash = `#/club/${r.club.slug}/club`;
    } catch (err) { toast(err.message); }
  } },
    h("label", {}, "Club name", f.name), h("label", {}, "City", f.city),
    picker,
    h("div", { class: "row2" }, h("label", {}, "Day", f.run_day), h("label", {}, "Start time", f.run_time)),
    target.node,
    h("button", { class: "btn primary block", type: "submit" }, "Create club"));
  openSheet("Start a club", form);
  sheetMap = { remove() { if (picker._map) picker._map.remove(); } };
}

// ---------------------------------------------------------------- page: App Admin
// The Improvement Scout proposes fixes from feedback, errors and the agent trace. It can't change the app:
// the App Admin approves or denies each one here, and approved ones export as a to-do list for a developer.
async function adminPage() {
  const view = $("view");
  const page = h("section", { class: "page admin" }, h("div", { class: "muted" }, "Loading…"));
  view.replaceChildren(page);
  if (!ME) { page.replaceChildren(h("div", { class: "empty" }, "Sign in as the App Admin (Rae Simmons in the demo).")); return; }
  let filter = "pending", data;
  async function load() {
    try { data = await api("/api/admin"); } catch (e) { page.replaceChildren(h("div", { class: "empty" }, e.message, " ", h("a", { href: "#/" }, "Back to clubs"))); return; }
    draw();
  }
  async function download(what, filename) {
    const r = await fetch(`/api/admin/export?what=${what}`, { headers: { "X-User-Id": String(ME.id) } });
    if (!r.ok) { toast("Couldn't export."); return; }
    const url = URL.createObjectURL(await r.blob());
    const a = h("a", { href: url, download: filename }); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  async function decide(id, decision, note) {
    try { data.proposals = (await api(`/api/admin/proposals/${id}`, { method: "POST", body: { decision, note } })).proposals; draw(); }
    catch (e) { toast(e.message); }
  }
  function draw() {
    const sc = data.scout;
    const last = sc.last_run ? new Date(sc.last_run * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "not yet";
    const runBtn = h("button", { class: "btn primary", onclick: async () => {
      runBtn.disabled = true; runBtn.textContent = "Scouting…";
      try { const r = await api("/api/admin/scout", { method: "POST" }); toast(r.added ? `${r.added} new proposal${r.added > 1 ? "s" : ""}.` : "Nothing new to propose."); await load(); }
      catch (e) { toast(e.message); runBtn.disabled = false; runBtn.textContent = "Run the Scout now"; }
    } }, "Run the Scout now");
    const counts = { pending: 0, approved: 0, denied: 0 };
    data.proposals.forEach((p) => counts[p.status]++);
    const shown = data.proposals.filter((p) => filter === "all" || p.status === filter);
    const seg = h("div", { class: "seg" }, ...[["pending", `To review (${counts.pending})`], ["approved", `Approved (${counts.approved})`], ["denied", `Denied (${counts.denied})`], ["all", "All"]]
      .map(([v, l]) => h("button", { type: "button", class: filter === v ? "on" : "", onclick: () => { filter = v; draw(); } }, l)));
    const cards = shown.map((p) => {
      const note = h("input", { maxlength: 300, placeholder: "Note (optional)", value: p.admin_note || "", "aria-label": "Note" });
      return h("div", { class: `card proposal sev-${p.severity}` },
        h("div", { class: "proposal-top" }, h("span", { class: `pill sev ${p.severity}` }, p.severity), h("span", { class: "chip" }, p.kind),
          p.status !== "pending" ? h("span", { class: `pill ${p.status === "approved" ? "in" : ""}` }, p.status) : null),
        h("h3", {}, p.title),
        h("p", { class: "small" }, h("b", {}, "Evidence: "), p.evidence),
        h("p", { class: "small" }, h("b", {}, "Suggested change: "), p.suggestion),
        p.status === "pending"
          ? h("div", { class: "proposal-actions" }, note,
              h("button", { class: "btn", onclick: () => decide(p.id, "deny", note.value) }, "Deny"),
              h("button", { class: "btn primary", onclick: () => decide(p.id, "approve", note.value) }, "Approve"))
          : h("div", { class: "proposal-actions" }, p.admin_note ? h("span", { class: "muted small grow" }, `Note: ${p.admin_note}`) : h("span", { class: "grow" }),
              h("button", { class: "btn", onclick: () => decide(p.id, "reopen", p.admin_note || "") }, "Reopen")));
    });
    const fb = data.feedback;
    page.replaceChildren(
      h("div", { class: "intro" }, h("div", {}, h("h1", {}, "App Admin"),
        h("p", { class: "muted" }, "The Improvement Scout reads runner feedback, chat check-ins the Concierge couldn't follow, errors and the agent trace, and proposes fixes. It can only suggest: nothing changes in the app until you approve it and a developer builds it."))),
      h("div", { class: "card scout-card" },
        h("div", { class: "panel-head" }, h("h2", {}, "Improvement Scout"), runBtn),
        h("div", { class: "small muted" }, `Last run ${last} · runs every ${sc.every_minutes} minutes while the app is on · ${sc.mode === "model" ? "uses the AI model" : "no AI key, so it uses simple rules"} · ${sc.tokens_today.toLocaleString()} of ${sc.budget.toLocaleString()} tokens today`)),
      h("div", { class: "panel-head" }, h("h2", {}, "Proposals"), seg),
      cards.length ? h("div", { class: "proposals" }, cards) : h("p", { class: "muted" }, filter === "pending" ? "Nothing to review. Run the Scout, or wait for its next run." : "None here."),
      h("div", { class: "card" },
        h("div", { class: "panel-head" }, h("h2", {}, "Runner feedback"), h("span", { class: "muted small" }, fb.average ? `${fb.average} ★ average · ${fb.count} notes` : `${fb.count} notes`)),
        fb.recent.length ? h("ul", { class: "fb-list" }, fb.recent.map((f) => h("li", { class: "fb" },
          h("div", { class: "fb-top" }, h("b", {}, f.first), h("span", { class: "muted small" }, f.club || ""), f.rating ? h("span", { class: "fb-stars" }, "★".repeat(f.rating) + "☆".repeat(5 - f.rating)) : null, h("span", { class: "chip" }, f.topic)),
          f.text ? h("div", {}, f.text) : null))) : h("p", { class: "muted" }, "No feedback yet."),
        h("div", { class: "row2" },
          h("button", { class: "btn", onclick: () => download("feedback", "finish-together-feedback.csv") }, "Export feedback (CSV)"),
          h("button", { class: "btn", onclick: () => download("approved", "finish-together-approved-fixes.md") }, "Export approved fixes"))));
  }
  load();
}

// Route style: separate routes (default), run together (one shared route, faster groups add out-and-backs)
// or staggered start (same route and distance for everyone, the slowest group leaves first).
function stylePicker(value, onChange) {
  let v = value;
  const seg = h("div", { class: "seg" });
  const hint = h("div", { class: "small muted" });
  const paint = () => {
    seg.replaceChildren(...[["separate", "Separate routes"], ["together", "Run together"], ["staggered", "Staggered start"]].map(([k, label]) =>
      h("button", { type: "button", class: v === k ? "on" : "", "aria-pressed": v === k ? "true" : "false", onclick: () => { v = k; paint(); if (onChange) onChange(v); } }, label)));
    hint.textContent = {
      together: "Everyone starts as one pack on a shared route. Faster groups split off at a numbered flag for a short out-and-back and rejoin, so all groups finish together.",
      staggered: "Everyone runs the same route and distance. The slowest group leaves first and each faster group starts a few minutes later, so all groups finish together.",
    }[v] || "Each group runs the same simple shape and turns around at its own flag.";
  };
  paint();
  return { node: h("div", { class: "target" }, h("div", { class: "label" }, "Route style"), seg, hint), value: () => v };
}

// ---------------------------------------------------------------- page: one club
function clubPage(slug, tab) {
  const view = $("view");
  let club = null, lastMsg = 0, lastEvent = 0, planKey = null, drawn = null, playing = null, latest = null, alive = true;
  let planMap = null, settingsMap = null, editMap = null, drawSeq = 0;
  let runDate = null;

  const head = h("section", { class: "club-head" }, h("div", { class: "muted" }, "Loading…"));
  const tabs = h("nav", { class: "tabs", role: "tablist", "aria-label": "Club sections" });
  const body = h("div", { class: `club-body tab-${tab}` });

  // Plan panel
  const backAt = h("div", { class: "big" }, "--:--");
  const heroSub = h("div", { class: "hero-sub" });
  const stats = { in: h("span", {}, "0"), maybe: h("span", {}, "0"), groups: h("span", {}, "0"), spread: h("span", {}, "0") };
  const heroEyebrow = h("div", { class: "eyebrow" }, "Everyone finishes by");
  const targetNote = h("div", { class: "note", hidden: true });
  const mapBox = h("div", { class: "map plan-map" });
  const mapNote = h("div", { class: "small muted grow" });
  const replayClock = h("span", { class: "replay-clock", hidden: true });
  const replayBtn = h("button", { class: "btn", onclick: () => startReplay() }, "▶ Watch the run");
  const editBtn = h("button", { class: "btn", hidden: true, onclick: () => openEditor() }, "Edit next run");
  const mapWrap = h("div", { class: "map-wrap" }, mapBox, replayClock);
  const mapBar = h("div", { class: "map-bar" }, replayBtn, editBtn, mapNote);
  const editor = h("div", { class: "card route-editor", hidden: true });
  const race = h("div", { class: "race" });
  const groupsBox = h("div", { class: "groups" });
  const planMeta = h("span", { class: "muted small" });
  const pPlan = h("section", { class: "panel p-plan" },
    h("div", { class: "hero" },
      h("div", {}, heroEyebrow, backAt, heroSub),
      h("div", { class: "stats" },
        h("div", { class: "stat" }, stats.in, h("label", {}, "going")),
        h("div", { class: "stat" }, stats.maybe, h("label", {}, "maybe")),
        h("div", { class: "stat" }, stats.groups, h("label", {}, "groups")),
        h("div", { class: "stat" }, stats.spread, h("label", {}, "min apart")))),
    targetNote,
    mapWrap, mapBar, editor,
    h("div", { class: "panel-head" }, h("h2", {}, "The plan"), planMeta),
    race, groupsBox,
    h("p", { class: "small muted privacy" }, "Watch the run is a simulation drawn from the plan. Finish Together never tracks anyone's location."));

  // Chat panel
  const messages = h("div", { class: "messages" });
  const chatInput = h("input", { maxlength: 400, autocomplete: "off", enterkeyhint: "send", placeholder: "e.g. in for 5 at 9:30, bringing a friend", "aria-label": "Message" });
  const myStatus = h("div", { class: "my-status small" });
  const composer = h("div", { class: "composer" },
    h("div", { class: "composer-top" }, myStatus, h("button", { class: "btn primary", onclick: () => checkinSheet() }, "Check in")),
    h("form", { class: "chat-form", onsubmit: async (e) => {
      e.preventDefault();
      const text = chatInput.value.trim();
      if (!text) return;
      chatInput.value = "";
      try { await api(`/api/clubs/${slug}/chat`, { method: "POST", body: { text } }); poll(); } catch (err) { toast(err.message); }
    } }, chatInput, h("button", { class: "btn", type: "submit" }, "Send")));
  const chatLocked = h("div", { class: "locked", hidden: true });
  const demoNote = h("div", { class: "demo-note small", hidden: true },
    "No AI key: the Concierge only follows simple check-ins like “in, 5 miles at 9:30, bringing a friend”. Add the course key to .env and restart so it understands any phrasing.");
  const pChat = h("section", { class: "panel p-chat" },
    h("div", { class: "panel-head" }, h("h2", {}, "Chat and check-ins"), h("span", { class: "muted small" }, "members only")),
    messages, chatLocked, demoNote, composer);

  // Agents panel
  const tok = { total: h("span", {}, "0"), cost: h("span", {}, "$0.0000") };
  const budgetFill = h("div", { class: "budget-fill" });
  const budgetLabel = h("div", { class: "small muted" });
  const byAgent = h("table", { class: "by-agent" });
  const events = h("div", { class: "events" });
  const capControls = h("div", { class: "cap-controls", hidden: true },
    h("button", { class: "btn primary", onclick: async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try { await api(`/api/clubs/${slug}/simulate`, { method: "POST" }); toast("Playing a scripted evening. Watch the chat, the plan and this trace."); }
      catch (err) { toast(err.message); }
      setTimeout(() => (b.disabled = false), 30000);
    } }, "Play the evening"),
    h("button", { class: "btn", onclick: () => api(`/api/clubs/${slug}/replan`, { method: "POST" }).catch((e) => toast(e.message)) }, "Re-plan"),
    h("button", { class: "btn", onclick: async () => {
      try { await api(`/api/clubs/${slug}/reset`, { method: "POST" }); resetLive(); }
      catch (e) { toast(e.message); }
    } }, "Reset"));
  const agentsLocked = h("div", { class: "locked", hidden: true }, "The agent trace is visible to members.");
  const pAgents = h("section", { class: "panel p-agents" },
    h("div", { class: "panel-head" }, h("h2", {}, "Agents at work"), h("span", { class: "muted small" }, "live trace")),
    capControls,
    h("div", { class: "meter" },
      h("div", { class: "meter-row" }, h("div", {}, tok.total, h("label", {}, "tokens")), h("div", {}, tok.cost, h("label", {}, "cost this run"))),
      h("div", { class: "bar" }, budgetFill), budgetLabel, byAgent),
    agentsLocked, events);

  // Club panel
  const pClub = h("section", { class: "panel p-club" });
  const pFeedback = h("section", { class: "panel p-feedback" });
  const pRuns = h("section", { class: "panel p-runs" });

  body.append(pChat, pPlan, pAgents, pClub, pFeedback, pRuns);
  view.replaceChildren(h("div", { class: "club-page" }, head, tabs, body));

  function drawTabs() {
    const t = (id, label, extra) => h("button", {
      role: "tab", class: `tab ${extra || ""} ${tab === id ? "on" : ""}`, "aria-selected": tab === id ? "true" : "false",
      onclick: () => {
        history.replaceState(null, "", `#/club/${slug}/${id}`);
        tab = id; body.className = `club-body tab-${id}`; drawTabs();
        setTimeout(() => { if (planMap) planMap.invalidateSize(); if (settingsMap) settingsMap.invalidateSize(); }, 60);
        if (id === "chat") messages.scrollTop = messages.scrollHeight;
        if (id === "feedback") drawFeedback();
        if (id === "runs") drawRuns();
      } }, label);
    const n = club && club.pending ? club.pending.length : 0;
    tabs.replaceChildren(t("plan", "Next run"), t("chat", "Chat", "mobile-only"), t("agents", "Agents", "mobile-only"),
      t("runs", "Calendar"), t("club", n ? `Club (${n})` : "Club"), t("feedback", "Feedback"));
  }

  // ------------- header and club tab
  async function loadClub() {
    club = (await api(`/api/clubs/${slug}`)).club;
    document.documentElement.style.setProperty("--club", club.color);
    const me = club.me;
    let action;
    if (!ME) action = h("button", { class: "btn primary", onclick: accountSheet }, "Sign in to join");
    else if (me.is_member) action = statusBadge("approved", me.role);
    else if (me.status === "pending") action = h("span", { class: "pill maybe" }, "Waiting for the captain");
    else action = h("button", { class: "btn primary", onclick: joinSheet }, me.status === "declined" ? "Ask again" : "Ask to join");
    head.replaceChildren(
      h("div", { class: "club-head-top" },
        h("a", { class: "back", href: "#/", "aria-label": "All clubs" }, "‹ Clubs"),
        h("div", { class: "grow" }, h("h1", {}, club.name), h("div", { class: "muted small" }, `${club.city} · captain ${club.captain || "?"} · ${club.members} members`)),
        action),
      h("div", { class: "chips" },
        h("span", { class: "chip" }, `Next run: ${club.run_label}, ${club.start_clock}`),
        h("span", { class: "chip" }, `Start: ${club.start_name}`),
        h("span", { class: "chip" }, club.route_type === "point" ? `Finish: ${club.finish_name}` : "Loop back to start"),
        h("span", { class: "chip" }, club.target_mode === "distance" ? `${club.target_value} mi, middle group` : `${club.target_value} min`)));
    capControls.hidden = !me.is_captain;
    editBtn.hidden = !me.is_captain;
    if (!me.is_captain && !editor.hidden) closeEditor();
    drawTabs();
    drawClubTab();
    if (tab === "feedback") drawFeedback();
    if (tab === "runs") drawRuns();
  }

  // ------------- runner feedback: a post-run rating and a comment; the Improvement Scout reads these
  async function drawFeedback() {
    if (!club) return;
    if (!club.me.is_member) {
      pFeedback.replaceChildren(h("div", { class: "card" }, h("h2", {}, "Feedback"),
        h("p", { class: "muted" }, "Join the club to rate runs and tell us what to improve.")));
      return;
    }
    let data;
    try { data = await api(`/api/clubs/${slug}/feedback`); } catch (e) { pFeedback.replaceChildren(h("div", { class: "empty" }, e.message)); return; }
    const st = { rating: null, topic: data.topics[0] };
    const stars = h("div", { class: "stars", role: "radiogroup", "aria-label": "Rate your last run" });
    const topicSeg = h("div", { class: "chips pick" });
    const text = h("textarea", { rows: 3, maxlength: 500, placeholder: "What worked, what didn't, what you'd change" });
    const paint = () => {
      stars.replaceChildren(...[1, 2, 3, 4, 5].map((n) => h("button", { type: "button", role: "radio", "aria-checked": st.rating === n ? "true" : "false",
        "aria-label": `${n} out of 5`, class: st.rating && n <= st.rating ? "on" : "", onclick: () => { st.rating = n; paint(); } }, "★")));
      topicSeg.replaceChildren(...data.topics.map((t) => h("button", { type: "button", class: `chip ${st.topic === t ? "on" : ""}`, onclick: () => { st.topic = t; paint(); } }, t)));
    };
    paint();
    const form = h("form", { class: "form", onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api(`/api/clubs/${slug}/feedback`, { method: "POST", body: { rating: st.rating, topic: st.topic, text: text.value } });
        toast("Thanks! The App Admin reviews every idea.");
        drawFeedback();
      } catch (err) { toast(err.message); }
    } },
      h("div", { class: "label" }, "How was your last run?"), stars,
      h("div", { class: "label" }, "About"), topicSeg,
      h("label", {}, "Tell us more", text),
      h("button", { class: "btn primary block", type: "submit" }, "Send feedback"));
    const when = (t) => new Date(t * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const items = data.items.map((f) => h("li", { class: "fb" },
      h("div", { class: "fb-top" }, h("b", {}, f.mine ? "You" : f.first), f.rating ? h("span", { class: "fb-stars", "aria-label": `${f.rating} out of 5` }, "★".repeat(f.rating) + "☆".repeat(5 - f.rating)) : null,
        h("span", { class: "chip" }, f.topic), h("span", { class: "muted small" }, when(f.at))),
      f.text ? h("div", {}, f.text) : null));
    pFeedback.replaceChildren(
      h("div", { class: "card" }, h("h2", {}, "Feedback"),
        h("p", { class: "muted small" }, "Rate your last run and tell us what to fix. The Improvement Scout, an AI agent, reads every note and suggests changes; the App Admin decides what gets built."),
        form),
      h("div", { class: "card" }, h("div", { class: "panel-head" }, h("h2", {}, "What runners are saying"),
          h("span", { class: "muted small" }, data.average ? `${data.average} ★ average · ${data.count} notes` : `${data.count} notes`)),
        items.length ? h("ul", { class: "fb-list" }, items) : h("p", { class: "muted" }, "No feedback yet. Be the first.")),
      h("div", { class: "card" }, h("h2", {}, "What's changing"),
        data.changing.length ? h("ul", { class: "changing" }, data.changing.map((c) => h("li", {}, c.title)))
          : h("p", { class: "muted small" }, "Approved fixes show up here.")));
  }

  // ------------- calendar of coming runs (sign up ahead) and the log of past runs
  let runsData = null;
  async function drawRuns() {
    if (!club) return;
    try { runsData = await api(`/api/clubs/${slug}/runs`); } catch (e) { pRuns.replaceChildren(h("div", { class: "empty" }, e.message)); return; }
    const d = runsData;
    const byDate = Object.fromEntries(d.dates.map((x) => [x.date, x]));
    // Month grid from this week to the last date on the calendar
    const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    const now = new Date(); now.setHours(12, 0, 0, 0);
    const start = new Date(now); start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const last = new Date(d.dates[d.dates.length - 1].date + "T12:00:00");
    const cells = [];
    for (const x = new Date(start); x <= last || cells.length % 7; x.setDate(x.getDate() + 1)) {
      const key = iso(x), run = byDate[key], past = x < now && key !== iso(now);
      const day = x.getDate() === 1 || cells.length === 0 ? x.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : String(x.getDate());
      if (!run) { cells.push(h("div", { class: `cal-cell${past ? " past" : ""}` }, h("span", { class: "cal-num" }, day))); continue; }
      const mineIn = run.mine && run.mine.status !== "out";
      cells.push(h("button", { type: "button", class: `cal-cell run ${run.state}${mineIn ? " mine" : ""}`, "aria-label": `${run.label}: ${run.state === "cancelled" ? "cancelled" : `${run.going} going`}`,
        onclick: () => daySheet(run.date) },
        h("span", { class: "cal-num" }, day),
        h("span", { class: "cal-dot" }, run.state === "cancelled" ? "off" : mineIn ? "✓" : run.going ? String(run.going) : "")));
    }
    const status = (run) => run.state === "cancelled" ? h("span", { class: "pill out" }, "Cancelled")
      : run.mine ? h("span", { class: `pill ${run.mine.status}` }, run.mine.status === "in" ? "You're in" : run.mine.status === "maybe" ? "Maybe" : "You're out")
      : null;
    const list = d.dates.map((run) => h("button", { type: "button", class: `run-row ${run.state}`, onclick: () => daySheet(run.date) },
      h("div", { class: "grow" },
        h("div", {}, h("strong", {}, run.label), " ", h("span", { class: "muted small" }, run.time), run.state === "next" ? h("span", { class: "pill cap" }, "Next run") : null),
        h("div", { class: "muted small" }, run.state === "cancelled" ? (run.note || "No run this week") : `${run.going} going${run.maybe ? ` · ${run.maybe} maybe` : ""}`)),
      status(run), h("span", { class: "muted" }, "›")));
    const past = d.past.map((r) => h("button", { type: "button", class: "run-row", onclick: () => pastSheet(r.id) },
      h("div", { class: "grow" },
        h("div", {}, h("strong", {}, r.label), " ", h("span", { class: "muted small" }, clockAt(r.run_time, 0))),
        h("div", { class: "muted small" }, r.groups ? `${r.going} ran · ${r.groups} groups · back by ${r.back_at}, ${r.spread} min apart` : "No plan was made")),
      h("span", { class: "muted" }, "›")));
    pRuns.replaceChildren(
      h("div", { class: "card" },
        h("div", { class: "panel-head" }, h("h2", {}, "Coming up"), h("span", { class: "muted small" }, `${club.run_day}s at ${club.start_clock}`)),
        h("p", { class: "muted small" }, d.member ? "Tap a date to see who's going and sign up ahead. Your sign-up becomes your check-in when that date is the next run."
          : "Tap a date to see how many are going. Join the club to sign up."),
        h("div", { class: "cal-head" }, ...["M", "T", "W", "T", "F", "S", "S"].map((x) => h("span", {}, x))),
        h("div", { class: "cal-grid" }, cells),
        h("div", { class: "run-list" }, list)),
      h("div", { class: "card" },
        h("div", { class: "panel-head" }, h("h2", {}, "Past runs"), h("span", { class: "muted small" }, `${d.past.length} logged`)),
        h("p", { class: "muted small" }, "Each run is saved after its date passes: who ran, at what pace, the groups and the routes."),
        past.length ? h("div", { class: "run-list" }, past) : h("p", { class: "muted" }, "No runs logged yet.")));
  }

  async function daySheet(date) {
    let data;
    try { data = await api(`/api/clubs/${slug}/calendar/${date}`); } catch (e) { toast(e.message); return; }
    const day = data.day, isNext = day.state === "next";
    const parts = [
      h("div", { class: "chips" },
        h("span", { class: "chip" }, day.time),
        h("span", { class: "chip" }, `Start: ${club.start_name}`),
        h("span", { class: "chip" }, club.route_type === "point" ? `Finish: ${club.finish_name}` : "Loop back to start")),
      day.state === "cancelled"
        ? h("p", {}, h("strong", {}, "This run is cancelled."), day.note ? ` ${day.note}` : "")
        : h("p", { class: "muted small" }, `${day.going} going${day.maybe ? `, ${day.maybe} maybe` : ""}.${isNext ? " This is the next run, so check-ins go straight to the plan." : ""}`),
    ];
    if (data.member && day.state !== "cancelled") {
      parts.push(h("button", { class: "btn primary block", onclick: () => {
        closeSheet();
        if (isNext) checkinSheet(); else checkinSheet({ date, label: day.label, mine: day.mine });
      } }, day.mine ? (isNext ? "Change my check-in" : "Change my sign-up") : (isNext ? "Check in" : "Sign up")));
    }
    if (data.member) {
      const going = data.people.filter((p) => p.status !== "out");
      parts.push(h("h3", {}, isNext ? "Checked in" : "Signed up"),
        going.length ? h("div", { class: "member-list" }, going.map((p) => h("div", { class: "member" },
          avatar(p.name, p.color), h("span", { class: "grow" }, p.name, p.guests ? h("span", { class: "muted small" }, ` +${p.guests}`) : null),
          h("span", { class: "muted small" }, `${p.miles} mi at ${fmtPace(p.pace)}/mi`),
          p.status === "maybe" ? h("span", { class: "pill maybe" }, "Maybe") : null)))
          : h("p", { class: "muted" }, "No one yet."));
    }
    if (runsData && runsData.captain) {
      const note = h("input", { maxlength: 120, placeholder: "Optional note, e.g. track closed for a race" });
      const confirmBox = h("div", { class: "confirm", hidden: true },
        h("p", {}, isNext ? `Cancel the run on ${day.label}? Check-ins move to the following run, and the chat starts fresh.` : `Cancel the run on ${day.label}?`),
        h("label", {}, "Note for runners", note),
        h("button", { class: "btn danger block", onclick: () => changeDay(date, "cancel", note.value) }, "Yes, cancel this run"));
      const actions = [];
      if (day.state === "cancelled") actions.push(h("button", { class: "btn block", onclick: () => changeDay(date, "restore") }, "Bring this run back"));
      else {
        if (isNext) {
          const logBox = h("div", { class: "confirm", hidden: true },
            h("p", {}, `Save ${day.label} to Past runs now and open the next run? Check-ins and the chat start fresh. Runs are also saved by themselves the day after.`),
            h("button", { class: "btn primary block", onclick: () => finishRun() }, "Yes, log it"));
          actions.push(h("button", { class: "btn block", onclick: () => (logBox.hidden = false) }, "Log this run now"), logBox);
        }
        actions.push(h("button", { class: "btn danger-outline block", onclick: () => (confirmBox.hidden = false) }, "Cancel this run"));
      }
      parts.push(h("h3", {}, "Captain"), ...actions, confirmBox);
    }
    openSheet(day.label, h("div", { class: "day-sheet" }, ...parts));
  }

  async function changeDay(date, action, note = "") {
    try {
      await api(`/api/clubs/${slug}/calendar/${date}`, { method: "POST", body: { action, note } });
      closeSheet(); toast(action === "cancel" ? "Run cancelled." : "Run is back on the calendar.");
      await loadClub(); drawRuns(); resetLive();
    } catch (e) { toast(e.message); }
  }

  function resetLive() { lastMsg = lastEvent = 0; planKey = null; runDate = null; messages.replaceChildren(); events.replaceChildren(); poll(); }

  async function finishRun() {
    try {
      const r = await api(`/api/clubs/${slug}/finish`, { method: "POST" });
      closeSheet(); toast(r.logged ? `Saved to Past runs. Next run: ${r.next_label}.` : `No plan to save. Next run: ${r.next_label}.`);
      await loadClub(); drawRuns(); resetLive();
    } catch (e) { toast(e.message); }
  }

  let pastMap = null;
  async function pastSheet(id) {
    let r;
    try { r = (await api(`/api/clubs/${slug}/runs/${id}`)).run; } catch (e) { toast(e.message); return; }
    const box = h("div", { class: "map past-map" });
    const note = h("div", { class: "small muted" });
    const groups = (r.plan.groups || []).map((g) => h("div", { class: "past-group" },
      h("div", { class: "past-group-head" }, h("span", { class: "group-dot", style: `background:${FT_MAP.groupColor(g.id - 1)}` }),
        h("strong", {}, `Group ${g.id}`), h("span", { class: "muted small" }, ` ${g.pace_label} · ${g.miles} mi · back ${g.back_at}`)),
      h("div", { class: "small" }, g.members.map((m) => m.id ? `${m.name} (${fmtPace(m.pace)}${m.guests ? `, +${m.guests}` : ""})` : null).filter(Boolean).join(", ")
        || `${g.headcount} runners`)));
    openSheet(`${r.label} run`, h("div", { class: "past-sheet" },
      h("div", { class: "chips" },
        h("span", { class: "chip" }, `${r.going} ran`), h("span", { class: "chip" }, `${r.groups} groups`),
        r.back_at ? h("span", { class: "chip" }, `Back by ${r.back_at}`) : null,
        r.spread != null ? h("span", { class: "chip" }, `${r.spread} min apart`) : null,
        r.tokens ? h("span", { class: "chip" }, `${r.tokens.toLocaleString()} tokens`) : null),
      h("p", { class: "muted small" }, `${r.start_name}${r.route_type === "point" ? ` to ${r.finish_name}` : ", loop"} · ${r.target_label}`),
      box, note, ...groups));
    if (pastMap) { pastMap.remove(); pastMap = null; }
    if (!r.plan.start) return;
    pastMap = FT_MAP.makeMap(box, [r.plan.start.lat, r.plan.start.lng], 14);
    if (!pastMap) return;
    setTimeout(() => pastMap && pastMap.invalidateSize(), 80);
    try { await FT_MAP.drawPlan(pastMap, r.plan, (n) => (note.textContent = n)); } catch (e) { note.textContent = "The routes couldn't be drawn."; }
  }

  function joinSheet() {
    const note = h("textarea", { maxlength: 200, rows: 3, placeholder: "Optional: say hi, your usual pace, how you found us" });
    openSheet(`Join ${club.name}`, h("form", { class: "form", onsubmit: async (e) => {
      e.preventDefault();
      try { await api(`/api/clubs/${slug}/join`, { method: "POST", body: { note: note.value } }); closeSheet(); toast("Request sent. The club captain will review it."); loadClub(); }
      catch (err) { toast(err.message); }
    } }, h("p", { class: "muted small" }, `${club.captain || "The captain"} approves new members. Until then you can see the schedule and routes, but not the chat or who's running.`),
      note, h("button", { class: "btn primary block", type: "submit" }, "Send request")));
  }

  function drawClubTab() {
    const me = club.me;
    if (settingsMap) { settingsMap.remove(); settingsMap = null; }
    const sections = [
      h("div", { class: "card" }, h("h2", {}, "About"), h("p", {}, club.blurb || "No description yet."),
        h("h3", {}, "Schedule"),
        h("ul", { class: "schedule" }, (club.schedule || []).map((s) =>
          h("li", {}, h("strong", {}, `${s.day}s ${clockAt(s.time, 0)}`), " ", s.what)))),
    ];
    if (me.is_captain) sections.push(requestsCard(), settingsCard());
    sections.push(h("div", { class: "card" }, h("div", { class: "panel-head" }, h("h2", {}, "Members"),
        me.is_captain ? h("span", { class: "muted small" }, "Tap a name to make them a captain or remove them") : null),
      me.is_member
        ? h("div", { class: "member-list" }, club.member_list.map((m) =>
            h(me.is_captain ? "button" : "div", { class: `member${me.is_captain ? " tappable" : ""}`, ...(me.is_captain ? { type: "button", onclick: () => memberSheet(m.id) } : {}) },
              avatar(m.name, m.color), h("span", { class: "grow" }, m.name),
              h("span", { class: "muted small" }, `${fmtPace(m.pace)}/mi`), m.role === "captain" ? h("span", { class: "pill cap" }, "Captain") : null,
              me.is_captain ? h("span", { class: "muted" }, "›") : null)))
        : h("p", { class: "muted" }, `${club.members} members. Names are visible to members only.`)));
    pClub.replaceChildren(...sections);
  }

  function requestsCard() {
    const list = club.pending.length
      ? club.pending.map((p) => h("div", { class: "request" },
          avatar(p.name, p.color),
          h("div", { class: "grow" },
            h("div", {}, h("strong", {}, p.name), h("span", { class: "muted small" }, ` · usual ${fmtPace(p.pace)}/mi, ${p.usual_miles} mi`)),
            p.note ? h("div", { class: "small" }, `“${p.note}”`) : null),
          h("div", { class: "request-actions" },
            h("button", { class: "btn primary", onclick: () => decide(p, "approve") }, "Approve"),
            h("button", { class: "btn", onclick: () => decide(p, "decline") }, "Decline"))))
      : [h("p", { class: "muted" }, "No one is waiting.")];
    return h("div", { class: "card" }, h("h2", {}, "Join requests"), ...list);
  }
  async function decide(p, decision) {
    try {
      await api(`/api/clubs/${slug}/requests/${p.id}`, { method: "POST", body: { decision } });
      toast(`${p.name.split(" ")[0]} ${decision === "approve" ? "approved" : "declined"}.`);
      loadClub();
    } catch (e) { toast(e.message); }
  }

  const currentPick = () => ({ start: [club.start_lat, club.start_lng], end: club.route_type === "point" ? [club.end_lat, club.end_lng] : null,
    routeType: club.route_type, startName: club.start_name, endName: club.route_type === "point" ? (club.end_name || "") : "" });

  // ------------- captain: change the start and finish right on the Tonight map
  function openEditor() {
    if (!club || !club.me.is_captain) return;
    if (playing) { playing.stop(); playing = null; replayClock.hidden = true; replayBtn.disabled = false; }
    let pick = currentPick();
    const picker = mapPicker(pick, (p) => { pick = p; });
    picker.classList.add("big-picker");
    const target = targetPicker(club.target_mode, club.target_value, club.route_style);
    const style = stylePicker(club.route_style || "separate", (v) => target.setStyle(v));
    setTimeout(() => (editMap = picker._map), 80);
    const save = h("button", { class: "btn primary", type: "submit" }, "Save and re-plan");
    editor.replaceChildren(h("form", { class: "form", onsubmit: async (e) => {
      e.preventDefault();
      const body = { start_name: pick.startName || "Start", start_lat: pick.start[0], start_lng: pick.start[1], route_type: pick.routeType,
        route_style: style.value(), ...target.value() };
      if (pick.routeType === "point") Object.assign(body, { end_name: pick.endName || "Finish", end_lat: pick.end[0], end_lng: pick.end[1] });
      save.disabled = true;
      try {
        await api(`/api/clubs/${slug}`, { method: "PATCH", body });
        closeEditor();
        toast("Saved. The Run Director is updating the plan.");
        planKey = null; await loadClub(); poll();
      } catch (err) { save.disabled = false; toast(err.message); }
    } },
      h("div", { class: "panel-head" }, h("h2", {}, "Next run"), h("span", { class: "muted small" }, "Only you see this, as captain")),
      target.node,
      style.node,
      picker,
      h("div", { class: "row2" }, h("button", { class: "btn", type: "button", onclick: closeEditor }, "Cancel"), save)));
    mapWrap.hidden = true; mapBar.hidden = true; editor.hidden = false;
    editor.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function closeEditor() {
    if (editMap) { editMap.remove(); editMap = null; }
    editor.hidden = true; editor.replaceChildren();
    mapWrap.hidden = false; mapBar.hidden = false;
    setTimeout(() => planMap && planMap.invalidateSize(), 60);
  }

  function settingsCard() {
    let pick = currentPick();
    const f = {
      run_day: h("select", {}, DAYS.map((d) => h("option", { value: d, selected: d === club.run_day }, d))),
      run_time: h("input", { type: "time", value: club.run_time, required: true }),
    };
    const picker = mapPicker(pick, (p) => { pick = p; });
    setTimeout(() => (settingsMap = picker._map), 80);
    const target = targetPicker(club.target_mode, club.target_value);
    return h("div", { class: "card" }, h("h2", {}, "Run settings"),
      h("p", { class: "muted small" }, "Changes go to the Run Director, which re-plans the next run's groups and posts the update."),
      h("form", { class: "form", onsubmit: async (e) => {
        e.preventDefault();
        const body = { start_name: pick.startName || "Start", start_lat: pick.start[0], start_lng: pick.start[1],
          run_day: f.run_day.value, run_time: f.run_time.value, route_type: pick.routeType, ...target.value() };
        if (pick.routeType === "point") Object.assign(body, { end_name: pick.endName || "Finish", end_lat: pick.end[0], end_lng: pick.end[1] });
        try { await api(`/api/clubs/${slug}`, { method: "PATCH", body }); toast("Saved. The Run Director is updating the plan."); planKey = null; await loadClub(); poll(); }
        catch (err) { toast(err.message); }
      } },
        picker,
        h("div", { class: "row2" }, h("label", {}, "Day", f.run_day), h("label", {}, "Start time", f.run_time)),
        target.node,
        h("button", { class: "btn primary block", type: "submit" }, "Save and re-plan")));
  }

  // ------------- check-in sheet: today's pace, distance, guests, and the pace board
  function checkinSheet(ahead) {
    if (!club || !club.me.is_member) { toast("Join the club to check in."); return; }
    const mine = ahead ? ahead.mine : latest && latest.my_checkin;
    const st = {
      status: mine ? mine.status : "in",
      pace: mine ? mine.pace : ME.pace,
      miles: mine ? mine.miles : ME.usual_miles,
      guests: mine ? mine.guests : 0,
    };
    const paceOut = h("input", { class: "big-input", inputmode: "numeric", "aria-label": "Today's pace in minutes per mile" });
    const milesOut = h("input", { class: "big-input", type: "number", min: 0.5, max: 20, step: 0.5, inputmode: "decimal", "aria-label": "Miles you'd like" });
    const guestsOut = h("span", { class: "big-num", "aria-live": "polite" });
    const statusSeg = h("div", { class: "seg big" });
    const board = h("div", { class: "pace-board" });
    const preview = h("div", { class: "preview" });
    const stepper = (out, delta, get, set, label) => h("div", { class: "stepper" },
      h("button", { type: "button", "aria-label": `Less ${label}`, onclick: () => { set(get() - delta); sync(); } }, "−"), out,
      h("button", { type: "button", "aria-label": `More ${label}`, onclick: () => { set(get() + delta); sync(); } }, "+"));
    const clampPace = (p) => Math.min(16, Math.max(5, Math.round(p * 12) / 12));   // 5-second steps
    paceOut.addEventListener("change", () => { const p = parsePace(paceOut.value); if (p) st.pace = clampPace(p); else toast("Pace looks like 9:30."); sync(); });
    milesOut.addEventListener("change", () => { st.miles = Math.min(20, Math.max(0.5, +milesOut.value || st.miles)); sync(); });
    function sync() {
      statusSeg.replaceChildren(...[["in", "I'm in"], ["maybe", "Maybe"], ["out", "Out"]].map(([v, label]) =>
        h("button", { type: "button", class: `${v} ${st.status === v ? "on" : ""}`, "aria-pressed": st.status === v ? "true" : "false", onclick: () => { st.status = v; sync(); } }, label)));
      paceOut.value = fmtPace(st.pace);
      milesOut.value = st.miles;
      guestsOut.textContent = st.guests;
      if (ahead) {
        board.replaceChildren();
        preview.textContent = st.status === "out" ? "No problem. See you another week."
          : "The agents plan pace groups when this becomes the next run. Your sign-up becomes your check-in then, and you can change it any time.";
        return;
      }
      const bands = (latest && latest.pace_board) || [];
      const max = Math.max(1, ...bands.map((b) => b.going));
      const mineBand = Math.floor(st.pace * 2) / 2;
      board.replaceChildren(
        h("div", { class: "label" }, "Paces people picked for today"),
        ...(bands.length ? bands.map((b) => {
          const lo = parsePace(b.from);
          return h("button", { type: "button", class: `band ${Math.abs(lo - mineBand) < 0.01 ? "on" : ""}`, title: "Use this pace",
                               onclick: () => { st.pace = lo + 0.25; sync(); } },
            h("span", { class: "band-label" }, `${b.from}–${b.to}`),
            h("span", { class: "band-bar" }, h("span", { style: `width:${(b.going / max) * 100}%` })),
            h("span", { class: "band-n" }, `${b.going} going`));
        }) : [h("div", { class: "muted small" }, "No one has checked in yet. You set the tone.")]));
      const groups = (latest && latest.plan && latest.plan.groups) || [];
      const fit = groups.map((g) => ({ g, lo: Math.min(...g.members.map((m) => m.pace || g.pace)), hi: g.pace }))
        .sort((a, b) => Math.abs((a.lo + a.hi) / 2 - st.pace) - Math.abs((b.lo + b.hi) / 2 - st.pace))[0];
      preview.textContent = st.status !== "in"
        ? (st.status === "maybe" ? "The Run Director will nudge you if a group at your pace is going." : "No problem. See you next time.")
        : fit && Math.abs((fit.lo + fit.hi) / 2 - st.pace) <= 1.2
          ? `At ${fmtPace(st.pace)}/mi you'd likely join Group ${fit.g.id} (${fit.g.pace_label}, ${fit.g.headcount} people, ${fit.g.miles} mi). Groups are finalized after you check in.`
          : `At ${fmtPace(st.pace)}/mi you may start a new group. The Run Director makes sure no one runs alone.`;
    }
    sync();
    openSheet(ahead ? `Sign up for ${ahead.label}` : `Check in for ${club.run_label || "the next run"}`, h("form", { class: "form checkin", onsubmit: async (e) => {
      e.preventDefault();
      const body = { status: st.status, pace: fmtPace(st.pace), miles: st.miles, guests: st.guests };
      try {
        if (ahead) {
          await api(`/api/clubs/${slug}/calendar/${ahead.date}/signup`, { method: "POST", body });
          closeSheet(); toast(st.status === "out" ? "Got it, you're out that week." : `You're signed up for ${ahead.label}.`); drawRuns();
          return;
        }
        await api(`/api/clubs/${slug}/checkin`, { method: "POST", body });
        closeSheet(); toast("Checked in. The Run Director is updating the plan."); poll(); if (tab === "runs") drawRuns();
      } catch (err) { toast(err.message); }
    } },
      statusSeg,
      h("div", { class: "row2" },
        h("div", {}, h("div", { class: "label" }, ahead ? "Pace that day (min/mi)" : "Today's pace (min/mi)"), stepper(paceOut, 1 / 6, () => st.pace, (v) => (st.pace = clampPace(v)), "pace")),
        h("div", {}, h("div", { class: "label" }, "Miles you'd like"), stepper(milesOut, 0.5, () => st.miles, (v) => (st.miles = Math.min(20, Math.max(0.5, v))), "miles"))),
      h("div", { class: "row-inline" }, h("div", { class: "label" }, "Friends coming"), stepper(guestsOut, 1, () => st.guests, (v) => (st.guests = Math.min(4, Math.max(0, v))), "friends")),
      h("p", { class: "muted small" }, `Your usual: ${fmtPace(ME.pace)}/mi, ${ME.usual_miles} mi. Faster or slower today is fine.`),
      board, preview,
      h("button", { class: "btn primary block", type: "submit" }, ahead ? "Save sign-up" : "Save check-in")));
  }

  // ------------- live state
  function renderMessage(m) {
    if (m.kind === "checkin") { messages.appendChild(h("div", { class: "msg checkin" }, m.text)); return; }
    const isDir = m.author === "Run Director", isCon = m.author === "Concierge";
    const kind = isDir ? (m.kind === "nudge" ? "nudge" : "director") : isCon ? "concierge" : "chat";
    const person = m.runner_id ? PEOPLE.find((p) => p.id === m.runner_id) : null;
    const color = person ? person.color : isDir ? "#1f3a5f" : "#17a2a0";
    const target = m.to_runner ? PEOPLE.find((p) => p.id === m.to_runner) : null;
    messages.appendChild(h("div", { class: `msg ${kind} ${ME && m.runner_id === ME.id ? "mine" : ""}` },
      avatar(isDir ? "R D" : isCon ? "C O" : m.author, color),
      h("div", { class: "bubble" },
        h("div", { class: "who" }, m.author,
          target ? h("span", { class: "tag" }, m.kind === "nudge" ? `nudge to ${target.name.split(" ")[0]}` : `to ${target.name.split(" ")[0]}`)
            : isDir ? h("span", { class: "tag" }, "agent") : null),
        h("div", {}, m.text))));
  }

  function describeEvent(e) {
    let d; try { d = JSON.parse(e.detail); } catch { d = e.detail; }
    if (typeof d === "string") return d;
    switch (e.kind) {
      case "llm": return `model call ${d.step}${d.tool_calls.length ? " → " + d.tool_calls.join(", ") : " → answered"} · ${e.tokens_in + e.tokens_out} tokens`;
      case "tool": return `${d.tool}(${Object.keys(d.args || {}).map((k) => `${k}=${JSON.stringify(d.args[k])}`).join(", ")})`;
      case "checkin": return `check-in saved: ${d.runner} is ${d.status}${d.miles ? `, ${d.miles} mi` : ""}${d.pace ? ` at ${d.pace}` : ""}${d.guests ? `, +${d.guests}` : ""}`;
      case "start": return `reacting: ${d.reason}`;
      case "skip": return `kept the plan: ${d.why}`;
      case "blocked": return `blocked ${d.runner ? `a message from runner ${d.runner}` : "an input"}: ${d.why}`;
      case "scrubbed": return `removed contact details from ${d.agent}'s reply`;
      case "rejected": return `plan rejected by the math check: ${d.errors.join("; ")}`;
      case "join": return `${d.runner}: ${d.status === "pending" ? "asked to join" : d.status === "approved" ? `approved by ${d.by}` : `declined by ${d.by}`}`;
      case "rules":
        if (d.groups !== undefined) return `made ${d.groups} pace groups`;
        if (d.target_minutes !== undefined) return `routes for ${d.target_minutes} min, groups ${d.spread_minutes} min apart, verified ${d.verified ? "✓" : "✗"}`;
        return d.note + (d.text ? `: “${d.text}”` : "");
      case "nudge": return `nudged ${d.sent} maybe runner(s)`;
      default: return JSON.stringify(d);
    }
  }

  const stick = (box, fn) => { const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60; fn(); if (atBottom) box.scrollTop = box.scrollHeight; };

  let safetyGrid = null, safetyKey = null;
  async function loadSafety() {
    const key = `${club.start_lat},${club.start_lng}`;
    if (key === safetyKey) return safetyGrid;
    try { safetyGrid = await api(`/api/clubs/${slug}/safety`); } catch { safetyGrid = null; }
    safetyKey = key;
    return safetyGrid;
  }
  const addOn = (r) => String(Math.round((r.group.miles - drawn.baseMiles) * 100) / 100);
  function showRouteInfo() {
    if (!drawn) return;
    drawn.routes.forEach((r) => {
      const el = groupsBox.querySelector(`.group-route[data-g="${r.group.id}"]`);
      if (!el) return;
      const bits = [];
      if (drawn.together) bits.push(r.split ? `shared route, then a ${addOn(r)} mi add-on at flag ${r.group.id}` : "shared route only");
      if (r.street && r.turns !== null) bits.push(`${r.turns} ${r.turns === 1 ? "turn" : "turns"}${r.turnaround ? " plus the turnaround" : ""}`);
      if (r.riskLabel) bits.push(r.riskLabel);
      el.textContent = bits.length ? `Route: ${bits.join(" · ")}` : "";
      el.hidden = !bits.length;
    });
  }

  async function drawRoutes(plan) {
    const seq = ++drawSeq;
    if (!planMap) {
      const c = plan && plan.start ? [plan.start.lat, plan.start.lng] : [club.start_lat, club.start_lng];
      planMap = FT_MAP.makeMap(mapBox, c, 14);
      if (!planMap) { replayBtn.disabled = true; return; }
    }
    if (playing) { playing.stop(); playing = null; replayClock.hidden = true; replayBtn.disabled = false; }
    if (drawn) planMap.removeLayer(drawn.layers);
    drawn = null;
    if (!plan || !plan.groups.length) { mapNote.textContent = "Routes appear once people check in."; return; }
    mapNote.textContent = "Finding straight, safer routes…";
    let d;
    try { d = await FT_MAP.drawPlan(planMap, plan, (n) => (mapNote.textContent = n), await loadSafety()); }
    catch (e) {   // e.g. the page was left while routes were still drawing
      if (alive && seq === drawSeq) { console.warn("Map drawing stopped:", e); mapNote.textContent = "The map couldn't draw this plan. The groups below are still right."; }
      return;
    }
    if (seq !== drawSeq || !alive) { if (alive && planMap) planMap.removeLayer(d.layers); return; }   // a newer plan arrived meanwhile
    drawn = d;
    showRouteInfo();
  }

  function startReplay() {
    if (!drawn || !drawn.routes.length || !planMap) { toast("Routes are still drawing."); return; }
    if (playing) playing.stop();
    replayClock.hidden = false;
    replayBtn.disabled = true;
    const runTime = latest.plan.run_time;
    playing = FT_MAP.replay(planMap, drawn, latest.plan, (m, done) => {
      replayClock.textContent = `${clockAt(runTime, m)}${done ? " · everyone's in" : ""}`;
      if (done) replayBtn.disabled = false;
    });
  }

  function renderPlan(s) {
    const plan = s.plan;
    const groups = (plan && plan.groups) || [];
    stats.in.textContent = s.counts.in;
    stats.maybe.textContent = s.counts.maybe;
    stats.groups.textContent = groups.length;
    stats.spread.textContent = plan ? Math.round(plan.spread_minutes) : 0;
    backAt.textContent = plan && plan.back_at && groups.length ? plan.back_at : "--:--";
    const fin = plan && plan.route && plan.route.type === "point" ? plan.route.end.name : plan && plan.start ? plan.start.name : club.start_name;
    heroEyebrow.textContent = `Everyone at ${fin} by`;
    heroSub.textContent = groups.length
      ? `${plan.target_minutes} minutes for every group${plan.target && plan.target.mode === "distance" ? ` (the middle group runs about ${plan.target.value} mi)` : ""}. Faster groups run farther, so nobody waits.`
      : "Waiting for check-ins.";
    const note = plan && plan.target && plan.target.note;
    targetNote.hidden = !note;
    targetNote.textContent = note || "";
    planMeta.textContent = plan ? `v${plan.version} · ${plan.reason}` : "";

    const key = plan ? `${plan.version}|${plan.reason}|${JSON.stringify(plan.start)}|${JSON.stringify(plan.route)}|${s.member}` : "none";
    if (key === planKey) return;
    planKey = key;
    drawRoutes(plan);

    race.replaceChildren();
    const maxMiles = Math.max(1, ...groups.map((g) => g.miles));
    groups.forEach((g, i) => {
      const fill = h("div", { class: "fill", style: `background:${FT_MAP.groupColor(i)}` });
      race.appendChild(h("div", { class: "lane" }, h("div", {}, `Group ${g.id} · ${g.miles} mi${g.start_offset ? ` · starts ${g.starts_at}` : ""}`), h("div", { class: "track" }, fill), h("div", { class: "flag" }, g.back_at)));
      requestAnimationFrame(() => (fill.style.width = `${(g.miles / maxMiles) * 100}%`));
    });
    if (!groups.length) { groupsBox.replaceChildren(h("div", { class: "empty" }, "No groups yet. Check in to get things going.")); return; }
    const canOpen = !!s.member;
    groupsBox.replaceChildren(...groups.map((g, i) => h("div", { class: `group${canOpen ? " tappable" : ""}`, style: `--g:${FT_MAP.groupColor(i)}`,
        ...(canOpen ? { role: "button", tabindex: "0", "aria-label": `Group ${g.id}: see who's running`,
          onclick: () => groupSheet(g, i, plan),
          onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); groupSheet(g, i, plan); } } } : {}) },
      h("div", { class: "group-top" },
        h("div", {}, h("div", { class: "group-title" }, `Group ${g.id}: ${g.pace_label}`),
          h("div", { class: "small muted" }, `${g.headcount} runners · ${g.miles} miles · about ${Math.round(g.minutes)} min`),
          plan.route && plan.route.style === "staggered" ? h("div", { class: "group-start" }, `Starts ${g.starts_at}${g.start_offset ? "" : " (first off)"}`) : null),
        h("div", { class: "group-back" }, g.back_at)),
      h("div", { class: "members" }, g.members.flatMap((m) => [avatar(m.name, m.color, "xs"), ...Array.from({ length: m.guests || 0 }, () => avatar("+ 1", "#b8b1a7", "xs"))])),
      h("div", { class: "group-route small muted", "data-g": g.id, hidden: true }),
      canOpen ? h("div", { class: "group-more small" }, "See who's running ›") : null,
      ...((plan.conflicts || []).filter((c) => c.group === g.id).map((c) => h("div", { class: "conflict" }, `${c.name} wanted ${c.wanted_miles} mi; the Run Director's post has an option for them.`))))));
    showRouteInfo();
  }

  // Captains: make someone a captain, step a captain down, or remove someone from the club (with a confirm step).
  function memberSheet(id) {
    const m = club.member_list.find((x) => x.id === id);
    if (!m) { toast("That person isn't a member any more."); return; }
    const captains = club.member_list.filter((x) => x.role === "captain").length;
    const isCap = m.role === "captain", isMe = ME && ME.id === m.id, first = m.name.split(" ")[0];
    const act = async (action, done) => {
      try { club = (await api(`/api/clubs/${slug}/members/${m.id}`, { method: "POST", body: { action } })).club; closeSheet(); toast(done); planKey = null; await loadClub(); poll(); }
      catch (e) { toast(e.message); }
    };
    const actions = h("div", { class: "member-actions" });
    const paint = (confirming) => {
      const lastCap = isCap && captains <= 1;
      actions.replaceChildren(...(confirming ? [
        h("p", {}, `Remove ${m.name} from ${club.name}? They'll lose access to the chat and the plan, and they're taken out of the next run's groups. They can ask to join again later.`),
        h("div", { class: "row2" }, h("button", { class: "btn", type: "button", onclick: () => paint(false) }, "Cancel"),
          h("button", { class: "btn danger", type: "button", onclick: () => act("remove", `${first} was removed from the club.`) }, `Yes, remove ${first}`)),
      ] : [
        isCap
          ? h("button", { class: "btn block", type: "button", disabled: lastCap, onclick: () => act("remove_captain", isMe ? "You stepped down as captain." : `${first} is no longer a captain.`) },
              isMe ? "Step down as captain" : "Remove captain role")
          : h("button", { class: "btn primary block", type: "button", onclick: () => act("make_captain", `${first} is now a captain.`) }, `Make ${first} a captain`),
        h("button", { class: "btn danger-outline block", type: "button", disabled: lastCap, onclick: () => paint(true) }, isMe ? "Leave the club" : "Remove from club"),
        lastCap ? h("p", { class: "small muted" }, "A club needs at least one captain. Make someone else a captain first.") : null,
      ]));
    };
    paint(false);
    openSheet(m.name, h("div", { class: "member-sheet" },
      h("div", { class: "member-head" }, avatar(m.name, m.color),
        h("div", {}, h("div", { class: "person-name" }, m.name, isCap ? h("span", { class: "pill cap" }, "Captain") : null, isMe ? h("span", { class: "pill in" }, "You") : null),
          h("div", { class: "small muted" }, `Usually ${fmtPace(m.pace)}/mi, ${m.usual_miles} mi`))),
      actions));
  }

  // Members only: who is in a pace group, with full names and today's pace and distance (never contact details).
  function groupSheet(g, i, plan) {
    const usual = new Map(((club && club.member_list) || []).map((m) => [m.id, m]));
    const conflicts = (plan.conflicts || []).filter((c) => c.group === g.id);
    const rows = g.members.map((m) => {
      const u = usual.get(m.id);
      const tags = [];
      if (ME && m.id === ME.id) tags.push(h("span", { class: "pill in" }, "You"));
      if (u && u.role === "captain") tags.push(h("span", { class: "pill cap" }, "Captain"));
      const bits = [`Today ${fmtPace(m.pace)}/mi`, `wants ${m.miles} mi`];
      if (u && Math.abs(u.pace - m.pace) >= 1 / 12) bits.push(`usually ${fmtPace(u.pace)}`);
      const c = conflicts.find((x) => x.name === m.name);
      const cap = club && club.me.is_captain && m.id;
      return h("li", { class: `person-row${cap ? " tappable" : ""}`, ...(cap ? { role: "button", tabindex: "0", onclick: () => memberSheet(m.id),
          onkeydown: (e) => { if (e.key === "Enter") memberSheet(m.id); } } : {}) }, avatar(m.name, m.color),
        h("div", { class: "grow" },
          h("div", { class: "person-name" }, m.name, ...tags),
          h("div", { class: "small muted" }, bits.join(" · ")),
          m.guests ? h("div", { class: "small" }, `Bringing ${m.guests} ${m.guests === 1 ? "friend" : "friends"}`) : null,
          c ? h("div", { class: "small conflict-text" }, `Wanted ${c.wanted_miles} mi; the Run Director suggested an add-on.`) : null));
    });
    const guests = g.members.reduce((n, m) => n + (m.guests || 0), 0);
    openSheet(`Group ${g.id}: ${g.pace_label}`, h("div", { class: "group-sheet", style: `--g:${FT_MAP.groupColor(i)}` },
      h("div", { class: "fields" },
        h("div", {}, h("label", {}, "Runs"), h("b", {}, `${g.miles} mi`)),
        h("div", {}, h("label", {}, "Time"), h("b", {}, `about ${Math.round(g.minutes)} min`)),
        plan.route && plan.route.style === "staggered" ? h("div", {}, h("label", {}, "Starts"), h("b", {}, g.starts_at)) : null,
        h("div", {}, h("label", {}, "Finishes"), h("b", {}, g.back_at)),
        h("div", {}, h("label", {}, "People"), h("b", {}, `${g.headcount}${guests ? ` (${guests} guest${guests > 1 ? "s" : ""})` : ""}`))),
      (() => { const r = drawn && drawn.routes.find((x) => x.group.id === g.id);
        if (r && drawn.staggered) return h("p", { class: "small" }, `Route: the same route as every group, ${g.miles} mi. Meet at the start with everyone, set off at ${g.starts_at}, and finish together.`);
        if (r && drawn.together) return h("p", { class: "small" }, r.split
          ? `Route: runs the shared route with everyone, splits off at flag ${g.id} for a ${addOn(r)} mi out-and-back, then rejoins and finishes with the club.`
          : "Route: the shared route, start to finish. Faster groups split off for add-ons and come back to you.");
        if (!r || !r.street) return null;
        return h("p", { class: "small" }, `Route: ${r.miles.toFixed(1)} mi on the streets, ${r.turns} ${r.turns === 1 ? "turn" : "turns"}${r.turnaround ? ", turn around at the flag marked " + g.id : ""}${r.riskLabel ? `, ${r.riskLabel}` : ""}.`); })(),
      h("ul", { class: "person-list" }, rows),
      h("p", { class: "small muted" }, "Only club members see this. Phone numbers and emails are never shown.")));
  }

  function renderTokens(s) {
    const t = s.tokens.total;
    const total = (t.tin || 0) + (t.tout || 0);
    tok.total.textContent = total.toLocaleString();
    tok.cost.textContent = `$${(t.cost || 0).toFixed(4)}`;
    const pct = Math.min(100, (total / s.limits.run_token_budget) * 100);
    budgetFill.style.width = `${pct}%`;
    budgetFill.style.background = pct > 85 ? "var(--safety)" : pct > 60 ? "var(--maybe)" : "var(--in)";
    budgetLabel.textContent = `${pct.toFixed(1)}% of this run's ${s.limits.run_token_budget.toLocaleString()}-token budget`;
    byAgent.replaceChildren(...s.tokens.by_agent.filter((a) => a.calls > 0).map((a) =>
      h("tr", {}, h("td", { class: `a-${a.agent.replace(/\s+/g, "-")}` }, a.agent), h("td", {}, `${a.calls} calls`),
        h("td", {}, `${(a.tin + a.tout).toLocaleString()} tok`), h("td", {}, `$${a.cost.toFixed(4)}`))));
  }

  async function poll() {
    if (!alive || !club) return;
    let s;
    try { s = await api(`/api/clubs/${slug}/state?after_msg=${lastMsg}&after_event=${lastEvent}`); }
    catch (e) { console.error(e); return; }
    if (!alive) return;
    if (runDate && s.run_date !== runDate) { resetLive(); loadClub(); return; }   // the run moved on: start fresh
    runDate = s.run_date;
    latest = s;
    const live = s.mode !== "demo";
    setModeBadge(s.mode, s.model);
    demoNote.hidden = live || !s.member;
    chatLocked.hidden = s.member;
    composer.hidden = !s.member;
    agentsLocked.hidden = s.member;
    chatLocked.textContent = club.me.status === "pending"
      ? "Your request is with the club captain. The chat opens once you're approved."
      : "Join the club to see the chat and check in.";
    stick(messages, () => s.messages.forEach(renderMessage));
    if (s.messages.length) lastMsg = s.messages[s.messages.length - 1].id;
    stick(events, () => s.events.forEach((e) => events.appendChild(h("div", { class: `ev ${e.kind}` },
      h("div", { class: `agent a-${e.agent.replace(/\s+/g, "-")}` }, e.agent), h("div", { class: "what" }, describeEvent(e))))));
    if (s.events.length) lastEvent = s.events[s.events.length - 1].id;
    const c = s.my_checkin;
    myStatus.textContent = c ? `You: ${c.status === "in" ? `in, ${c.miles} mi at ${fmtPace(c.pace)}/mi` : c.status === "maybe" ? "maybe" : "out"}` : "You haven't checked in.";
    renderPlan(s);
    renderTokens(s);
  }

  drawTabs();
  loadClub().then(poll).catch((e) => head.replaceChildren(h("div", { class: "empty" }, e.message, " ", h("a", { href: "#/" }, "See all clubs"))));
  const timer = setInterval(poll, 2000);
  stopClub = () => {
    alive = false;
    clearInterval(timer);
    if (playing) playing.stop();
    if (planMap) planMap.remove();
    if (settingsMap) settingsMap.remove();
    if (editMap) editMap.remove();
    document.documentElement.style.removeProperty("--club");
  };
}

// ---------------------------------------------------------------- start
(async function boot() {
  try {
    const r = await api("/api/people");
    PEOPLE = r.people;
    setModeBadge(r.mode, r.model);
    const saved = Number(store.get("ft_user")) || 25;      // demo default: Rae, captain of Last Lap Run Club
    setMe(PEOPLE.find((p) => p.id === saved) || PEOPLE.find((p) => p.id === 25) || null);
  } catch (e) { toast("Can't reach the app server. Is python3 run.py running?"); }
  if (!location.hash || location.hash === "#") location.hash = "#/club/last-lap/plan";
  else render();
})();
