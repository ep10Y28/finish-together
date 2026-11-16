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
}

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
      h("span", {}, c.tonight.groups ? `${c.tonight.going} going · ${c.tonight.groups} groups · finish ${c.tonight.back_at}` : "No plan yet")));
}

// ---------------------------------------------------------------- map picker (start and finish)
function mapPicker(initial, onChange) {
  // initial: {start:[lat,lng], end:[lat,lng]|null}. onChange({start, end, routeType}).
  const state = { start: initial.start, end: initial.end, mode: "start", routeType: initial.end ? "point" : "loop" };
  const box = h("div", { class: "map picker-map" });
  const help = h("div", { class: "small muted" });
  const which = h("div", { class: "seg" });
  const typeSeg = h("div", { class: "seg" });
  const search = h("input", { type: "search", placeholder: "Search a place, e.g. Rittenhouse Square", "aria-label": "Search a place" });
  const markers = {};
  let map = null;
  const sync = () => {
    which.replaceChildren(
      h("button", { type: "button", class: state.mode === "start" ? "on" : "", onclick: () => { state.mode = "start"; sync(); } }, "Place start"),
      state.routeType === "point" ? h("button", { type: "button", class: state.mode === "end" ? "on" : "", onclick: () => { state.mode = "end"; sync(); } }, "Place finish") : null);
    typeSeg.replaceChildren(
      h("button", { type: "button", class: state.routeType === "loop" ? "on" : "", onclick: () => { state.routeType = "loop"; state.end = null; state.mode = "start"; sync(); } }, "Loop back to start"),
      h("button", { type: "button", class: state.routeType === "point" ? "on" : "", onclick: () => {
        state.routeType = "point";
        if (!state.end) state.end = [state.start[0] + 0.01, state.start[1] + 0.012];
        state.mode = "end"; sync();
      } }, "Separate finish"));
    help.textContent = `Tap the map to place the ${state.mode === "start" ? "start" : "finish"}.`;
    if (map) {
      for (const k of ["start", "end"]) { if (markers[k]) { map.removeLayer(markers[k]); markers[k] = null; } }
      markers.start = FT_MAP.pin(map, state.start, "Start", "start");
      if (state.routeType === "point" && state.end) markers.end = FT_MAP.pin(map, state.end, "Finish", "finish");
    }
    onChange({ start: state.start, end: state.routeType === "point" ? state.end : null, routeType: state.routeType });
  };
  const wrap = h("div", { class: "picker" }, h("div", { class: "label" }, "Route"), typeSeg, which,
    h("div", { class: "search-row" }, search, h("button", { class: "btn", type: "button", onclick: () => findPlace() }, "Find")),
    box, help);
  search.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); findPlace(); } });
  async function findPlace() {
    const q = search.value.trim();
    if (!q || !map) return;
    try {
      // OpenStreetMap's free place search: one request per search, as its usage policy asks.
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`);
      const j = await r.json();
      if (!j.length) { toast("No place found. Try other words, or tap the map."); return; }
      const p = [+j[0].lat, +j[0].lon];
      state[state.mode] = p;
      map.setView(p, 15);
      sync();
      wrap.dispatchEvent(new CustomEvent("placename", { detail: { which: state.mode, name: (j[0].name || j[0].display_name || "").split(",")[0] } }));
    } catch { toast("Place search isn't reachable right now. Tap the map instead."); }
  }
  setTimeout(() => {
    map = FT_MAP.makeMap(box, state.start, 14);
    wrap._map = map;
    if (!map) return;
    map.on("click", (e) => { state[state.mode] = [e.latlng.lat, e.latlng.lng]; sync(); });
    sync();
    if (state.end) map.fitBounds([state.start, state.end], { padding: [40, 40], maxZoom: 15 });
  }, 30);
  sync();
  return wrap;
}

function targetPicker(mode, value) {
  const st = { mode };
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
      hint.textContent = "The middle pace group runs this far. Faster groups run farther, slower groups less, and everyone finishes together.";
    } else {
      Object.assign(input, { min: 15, max: 150, step: 5 }); unit.textContent = "minutes";
      hint.textContent = "Everyone runs for this long. Faster groups cover more ground.";
    }
  };
  input.value = value;
  sync();
  return { node: h("div", { class: "target" }, h("div", { class: "label" }, "Tonight's run"), seg, h("div", { class: "with-unit" }, input, unit), hint),
           value: () => ({ target_mode: st.mode, target_value: +input.value }) };
}

// ---------------------------------------------------------------- start a club
function newClubSheet() {
  if (!ME) { accountSheet(); return; }
  let pick = { start: [39.9526, -75.1652], end: null, routeType: "loop" };
  const f = {
    name: h("input", { required: true, maxlength: 60, placeholder: "Club name" }),
    city: h("input", { required: true, maxlength: 60, placeholder: "City" }),
    start_name: h("input", { required: true, maxlength: 60, placeholder: "Where you meet, e.g. City Hall" }),
    end_name: h("input", { maxlength: 60, placeholder: "Where you finish" }),
    run_day: h("select", {}, DAYS.map((d) => h("option", { value: d, selected: d === "Wednesday" }, d))),
    run_time: h("input", { type: "time", value: "18:30", required: true }),
  };
  const endLabel = h("label", { hidden: true }, "Finish name", f.end_name);
  const picker = mapPicker(pick, (p) => { pick = p; endLabel.hidden = p.routeType !== "point"; });
  picker.addEventListener("placename", (e) => { const t = e.detail.which === "end" ? f.end_name : f.start_name; if (!t.value) t.value = e.detail.name; });
  const target = targetPicker("time", 45);
  const form = h("form", { class: "form", onsubmit: async (e) => {
    e.preventDefault();
    try {
      const body = { name: f.name.value, city: f.city.value, start_name: f.start_name.value,
        start_lat: pick.start[0], start_lng: pick.start[1], run_day: f.run_day.value, run_time: f.run_time.value,
        route_type: pick.routeType, ...target.value() };
      if (pick.routeType === "point") Object.assign(body, { end_name: f.end_name.value || "Finish", end_lat: pick.end[0], end_lng: pick.end[1] });
      const r = await api("/api/clubs", { method: "POST", body });
      closeSheet();
      toast("Club created. You're its captain.");
      location.hash = `#/club/${r.club.slug}/club`;
    } catch (err) { toast(err.message); }
  } },
    h("label", {}, "Club name", f.name), h("label", {}, "City", f.city),
    h("label", {}, "Meeting point name", f.start_name), endLabel,
    picker,
    h("div", { class: "row2" }, h("label", {}, "Day", f.run_day), h("label", {}, "Start time", f.run_time)),
    target.node,
    h("button", { class: "btn primary block", type: "submit" }, "Create club"));
  openSheet("Start a club", form);
  sheetMap = { remove() { if (picker._map) picker._map.remove(); } };
}

// ---------------------------------------------------------------- page: one club
function clubPage(slug, tab) {
  const view = $("view");
  let club = null, lastMsg = 0, lastEvent = 0, planKey = null, drawn = null, playing = null, latest = null, alive = true;
  let planMap = null, settingsMap = null, drawSeq = 0;

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
    h("div", { class: "map-wrap" }, mapBox, replayClock),
    h("div", { class: "map-bar" }, replayBtn, mapNote),
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
      try { await api(`/api/clubs/${slug}/reset`, { method: "POST" }); lastMsg = lastEvent = 0; planKey = null; messages.replaceChildren(); events.replaceChildren(); poll(); }
      catch (e) { toast(e.message); }
    } }, "Reset"));
  const agentsLocked = h("div", { class: "locked", hidden: true }, "The agent trace is visible to members.");
  const pAgents = h("section", { class: "panel p-agents" },
    h("div", { class: "panel-head" }, h("h2", {}, "Agents at work"), h("span", { class: "muted small" }, "live trace")),
    capControls,
    h("div", { class: "meter" },
      h("div", { class: "meter-row" }, h("div", {}, tok.total, h("label", {}, "tokens")), h("div", {}, tok.cost, h("label", {}, "cost tonight"))),
      h("div", { class: "bar" }, budgetFill), budgetLabel, byAgent),
    agentsLocked, events);

  // Club panel
  const pClub = h("section", { class: "panel p-club" });

  body.append(pChat, pPlan, pAgents, pClub);
  view.replaceChildren(h("div", { class: "club-page" }, head, tabs, body));

  function drawTabs() {
    const t = (id, label, extra) => h("button", {
      role: "tab", class: `tab ${extra || ""} ${tab === id ? "on" : ""}`, "aria-selected": tab === id ? "true" : "false",
      onclick: () => {
        history.replaceState(null, "", `#/club/${slug}/${id}`);
        tab = id; body.className = `club-body tab-${id}`; drawTabs();
        setTimeout(() => { if (planMap) planMap.invalidateSize(); if (settingsMap) settingsMap.invalidateSize(); }, 60);
        if (id === "chat") messages.scrollTop = messages.scrollHeight;
      } }, label);
    const n = club && club.pending ? club.pending.length : 0;
    tabs.replaceChildren(t("plan", "Tonight"), t("chat", "Chat", "mobile-only"), t("agents", "Agents", "mobile-only"),
      t("club", n ? `Club (${n})` : "Club"));
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
        h("span", { class: "chip" }, `${club.run_day}s ${club.start_clock}`),
        h("span", { class: "chip" }, `Start: ${club.start_name}`),
        h("span", { class: "chip" }, club.route_type === "point" ? `Finish: ${club.finish_name}` : "Loop back to start"),
        h("span", { class: "chip" }, club.target_mode === "distance" ? `${club.target_value} mi, middle group` : `${club.target_value} min`)));
    capControls.hidden = !me.is_captain;
    drawTabs();
    drawClubTab();
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
    sections.push(h("div", { class: "card" }, h("h2", {}, "Members"),
      me.is_member
        ? h("div", { class: "member-list" }, club.member_list.map((m) =>
            h("div", { class: "member" }, avatar(m.name, m.color), h("span", { class: "grow" }, m.name),
              h("span", { class: "muted small" }, `${fmtPace(m.pace)}/mi`), m.role === "captain" ? h("span", { class: "pill cap" }, "Captain") : null)))
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

  function settingsCard() {
    let pick = { start: [club.start_lat, club.start_lng], end: club.route_type === "point" ? [club.end_lat, club.end_lng] : null, routeType: club.route_type };
    const f = {
      start_name: h("input", { value: club.start_name, maxlength: 60, required: true }),
      end_name: h("input", { value: club.end_name || "", maxlength: 60, placeholder: "e.g. Boathouse Row" }),
      run_day: h("select", {}, DAYS.map((d) => h("option", { value: d, selected: d === club.run_day }, d))),
      run_time: h("input", { type: "time", value: club.run_time, required: true }),
    };
    const endLabel = h("label", { hidden: club.route_type !== "point" }, "Finish name", f.end_name);
    const picker = mapPicker(pick, (p) => { pick = p; endLabel.hidden = p.routeType !== "point"; });
    picker.addEventListener("placename", (e) => { (e.detail.which === "end" ? f.end_name : f.start_name).value = e.detail.name; });
    setTimeout(() => (settingsMap = picker._map), 80);
    const target = targetPicker(club.target_mode, club.target_value);
    return h("div", { class: "card" }, h("h2", {}, "Run settings"),
      h("p", { class: "muted small" }, "Changes go to the Run Director, which re-plans tonight's groups and posts the update."),
      h("form", { class: "form", onsubmit: async (e) => {
        e.preventDefault();
        const body = { start_name: f.start_name.value, start_lat: pick.start[0], start_lng: pick.start[1],
          run_day: f.run_day.value, run_time: f.run_time.value, route_type: pick.routeType, ...target.value() };
        if (pick.routeType === "point") Object.assign(body, { end_name: f.end_name.value || "Finish", end_lat: pick.end[0], end_lng: pick.end[1] });
        try { await api(`/api/clubs/${slug}`, { method: "PATCH", body }); toast("Saved. The Run Director is updating the plan."); planKey = null; await loadClub(); poll(); }
        catch (err) { toast(err.message); }
      } },
        h("label", {}, "Meeting point name", f.start_name), endLabel, picker,
        h("div", { class: "row2" }, h("label", {}, "Day", f.run_day), h("label", {}, "Start time", f.run_time)),
        target.node,
        h("button", { class: "btn primary block", type: "submit" }, "Save and re-plan")));
  }

  // ------------- check-in sheet: today's pace, distance, guests, and the pace board
  function checkinSheet() {
    if (!club || !club.me.is_member) { toast("Join the club to check in."); return; }
    const mine = latest && latest.my_checkin;
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
    openSheet("Check in for tonight", h("form", { class: "form checkin", onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api(`/api/clubs/${slug}/checkin`, { method: "POST", body: { status: st.status, pace: fmtPace(st.pace), miles: st.miles, guests: st.guests } });
        closeSheet(); toast("Checked in. The Run Director is updating the plan."); poll();
      } catch (err) { toast(err.message); }
    } },
      statusSeg,
      h("div", { class: "row2" },
        h("div", {}, h("div", { class: "label" }, "Today's pace (min/mi)"), stepper(paceOut, 1 / 6, () => st.pace, (v) => (st.pace = clampPace(v)), "pace")),
        h("div", {}, h("div", { class: "label" }, "Miles you'd like"), stepper(milesOut, 0.5, () => st.miles, (v) => (st.miles = Math.min(20, Math.max(0.5, v))), "miles"))),
      h("div", { class: "row-inline" }, h("div", { class: "label" }, "Friends coming"), stepper(guestsOut, 1, () => st.guests, (v) => (st.guests = Math.min(4, Math.max(0, v))), "friends")),
      h("p", { class: "muted small" }, `Your usual: ${fmtPace(ME.pace)}/mi, ${ME.usual_miles} mi. Faster or slower today is fine.`),
      board, preview,
      h("button", { class: "btn primary block", type: "submit" }, "Save check-in")));
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
    mapNote.textContent = "Drawing routes…";
    let d;
    try { d = await FT_MAP.drawPlan(planMap, plan, (n) => (mapNote.textContent = n)); }
    catch (e) {   // e.g. the page was left while routes were still drawing
      if (alive && seq === drawSeq) { console.warn("Map drawing stopped:", e); mapNote.textContent = "The map couldn't draw this plan. The groups below are still right."; }
      return;
    }
    if (seq !== drawSeq || !alive) { if (alive && planMap) planMap.removeLayer(d.layers); return; }   // a newer plan arrived meanwhile
    drawn = d;
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
      race.appendChild(h("div", { class: "lane" }, h("div", {}, `Group ${g.id} · ${g.miles} mi`), h("div", { class: "track" }, fill), h("div", { class: "flag" }, g.back_at)));
      requestAnimationFrame(() => (fill.style.width = `${(g.miles / maxMiles) * 100}%`));
    });
    if (!groups.length) { groupsBox.replaceChildren(h("div", { class: "empty" }, "No groups yet. Check in to get things going.")); return; }
    groupsBox.replaceChildren(...groups.map((g, i) => h("div", { class: "group", style: `--g:${FT_MAP.groupColor(i)}` },
      h("div", { class: "group-top" },
        h("div", {}, h("div", { class: "group-title" }, `Group ${g.id}: ${g.pace_label}`),
          h("div", { class: "small muted" }, `${g.headcount} runners · ${g.miles} miles · about ${Math.round(g.minutes)} min`)),
        h("div", { class: "group-back" }, g.back_at)),
      h("div", { class: "members" }, g.members.flatMap((m) => [avatar(m.name, m.color, "xs"), ...Array.from({ length: m.guests || 0 }, () => avatar("+ 1", "#b8b1a7", "xs"))])),
      ...((plan.conflicts || []).filter((c) => c.group === g.id).map((c) => h("div", { class: "conflict" }, `${c.name} wanted ${c.wanted_miles} mi; the Run Director's post has an option for them.`))))));
  }

  function renderTokens(s) {
    const t = s.tokens.total;
    const total = (t.tin || 0) + (t.tout || 0);
    tok.total.textContent = total.toLocaleString();
    tok.cost.textContent = `$${(t.cost || 0).toFixed(4)}`;
    const pct = Math.min(100, (total / s.limits.run_token_budget) * 100);
    budgetFill.style.width = `${pct}%`;
    budgetFill.style.background = pct > 85 ? "var(--safety)" : pct > 60 ? "var(--maybe)" : "var(--in)";
    budgetLabel.textContent = `${pct.toFixed(1)}% of tonight's ${s.limits.run_token_budget.toLocaleString()}-token budget`;
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
    myStatus.textContent = c ? `You: ${c.status === "in" ? `in, ${c.miles} mi at ${fmtPace(c.pace)}/mi` : c.status === "maybe" ? "maybe" : "out tonight"}` : "You haven't checked in.";
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
