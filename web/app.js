// Finish Together front end: polls the backend and renders feed, plan and agent trace.
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text; // textContent only: chat text is never parsed as HTML
  return n;
};

let lastMsg = 0, lastEvent = 0, roster = [], byId = {}, planVersion = null;

const initials = (name) => name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
const fmtPace = (p) => { const m = Math.floor(p); const s = Math.round((p - m) * 60); return `${m}:${String(s).padStart(2, "0")}`; };
const agentClass = (a) => "a-" + a.replace(/\s+/g, "-");

function avatar(name, color) {
  const a = el("div", "avatar", initials(name));
  a.style.background = color || "#888";
  a.title = name;
  return a;
}

function renderMessage(m) {
  const box = $("messages");
  if (m.kind === "checkin") {
    box.appendChild(el("div", "msg checkin", m.text));
    return;
  }
  const kindClass = m.author === "Captain" ? (m.kind === "nudge" ? "nudge" : "captain")
    : m.author === "Concierge" ? "concierge" : "chat";
  const row = el("div", `msg ${kindClass}`);
  const r = m.runner_id ? byId[m.runner_id] : null;
  const color = r ? r.color : m.author === "Captain" ? "#1f3a5f" : "#17a2a0";
  row.appendChild(avatar(m.author === "Captain" ? "C P" : m.author === "Concierge" ? "C O" : m.author, color));
  const b = el("div", "bubble");
  const who = el("div", "who", m.author);
  if (m.to_runner && byId[m.to_runner]) {
    who.appendChild(el("span", "tag", m.kind === "nudge" ? `nudge to ${byId[m.to_runner].name}` : `to ${byId[m.to_runner].name.split(" ")[0]}`));
  } else if (m.author === "Captain") {
    who.appendChild(el("span", "tag", "agent"));
  }
  b.appendChild(who);
  b.appendChild(el("div", "", m.text));
  row.appendChild(b);
  box.appendChild(row);
}

function renderPlan(plan, checkins) {
  const going = checkins.filter((c) => c.status === "in");
  const maybe = checkins.filter((c) => c.status === "maybe");
  $("statIn").textContent = going.reduce((n, c) => n + 1 + (c.guests || 0), 0);
  $("statMaybe").textContent = maybe.length;
  const groups = (plan && plan.groups) || [];
  $("statGroups").textContent = groups.length;
  $("statSpread").textContent = plan ? Math.round(plan.spread_minutes) : 0;
  $("backAt").textContent = plan && plan.back_at && groups.length ? plan.back_at : "--:--";
  $("heroSub").textContent = groups.length
    ? `${plan.target_minutes} minutes for everyone. Faster groups run farther, so nobody waits.`
    : "Waiting for check-ins.";
  $("planMeta").textContent = plan ? `v${plan.version} · ${plan.reason}` : "";
  if (plan && plan.version === planVersion) return;
  planVersion = plan ? plan.version : null;

  const race = $("race"); race.replaceChildren();
  const maxMiles = Math.max(1, ...groups.map((g) => g.miles));
  groups.forEach((g) => {
    const lane = el("div", "lane");
    lane.appendChild(el("div", "", `Group ${g.id} · ${g.miles} mi`));
    const track = el("div", "track"); const fill = el("div", "fill");
    track.appendChild(fill); lane.appendChild(track);
    lane.appendChild(el("div", "flag", g.back_at));
    race.appendChild(lane);
    requestAnimationFrame(() => (fill.style.width = `${(g.miles / maxMiles) * 100}%`));
  });

  const box = $("groups"); box.replaceChildren();
  if (!groups.length) { box.appendChild(el("div", "empty", "No groups yet. Check in to get things going.")); return; }
  groups.forEach((g) => {
    const card = el("div", "group");
    const top = el("div", "group-top");
    const t = el("div");
    t.appendChild(el("div", "group-title", `Group ${g.id}: ${g.pace_label}`));
    t.appendChild(el("div", "small muted", `${g.headcount} runners · ${g.miles} miles · about ${Math.round(g.minutes)} min`));
    top.appendChild(t);
    top.appendChild(el("div", "group-back", `back ${g.back_at}`));
    card.appendChild(top);
    const loops = el("div", "loops");
    g.loops.forEach((l) => loops.appendChild(el("span", "loop", `${l.name} · ${l.miles} mi`)));
    card.appendChild(loops);
    const mem = el("div", "members");
    g.members.forEach((m) => {
      mem.appendChild(avatar(m.name, m.color));
      for (let i = 0; i < (m.guests || 0); i++) mem.appendChild(avatar("+ 1", "#b8b1a7"));
    });
    card.appendChild(mem);
    (plan.conflicts || []).filter((c) => c.group === g.id).forEach((c) => {
      card.appendChild(el("div", "conflict", `${c.name} wanted ${c.wanted_miles} mi; the Captain's announcement has an option for them.`));
    });
    box.appendChild(card);
  });
}

function describeEvent(e) {
  let d; try { d = JSON.parse(e.detail); } catch { d = e.detail; }
  if (typeof d === "string") return d;
  switch (e.kind) {
    case "llm": return `model call ${d.step}${d.tool_calls.length ? " → " + d.tool_calls.join(", ") : " → answered"} · ${e.tokens_in + e.tokens_out} tokens`;
    case "tool": return `${d.tool}(${Object.keys(d.args || {}).map((k) => `${k}=${JSON.stringify(d.args[k])}`).join(", ")})`;
    case "checkin": return `check-in saved: ${d.runner} is ${d.status}${d.miles ? `, ${d.miles} mi` : ""}${d.guests ? `, +${d.guests}` : ""}`;
    case "start": return `reacting: ${d.reason}`;
    case "skip": return `kept the plan: ${d.why}`;
    case "blocked": return `blocked a message from runner ${d.runner}: ${d.why}`;
    case "scrubbed": return `removed contact details from ${d.agent}'s reply`;
    case "rejected": return `plan rejected by the math check: ${d.errors.join("; ")}`;
    case "rules":
      if (d.groups !== undefined) return `made ${d.groups} pace groups`;
      if (d.target_minutes !== undefined) return `routes for ${d.target_minutes} min, groups ${d.spread_minutes} min apart, verified ${d.verified ? "✓" : "✗"}`;
      return d.note + (d.text ? `: “${d.text}”` : "");
    case "nudge": return `nudged ${d.sent} maybe runner(s)`;
    default: return JSON.stringify(d);
  }
}

function renderEvent(e) {
  const row = el("div", `ev ${e.kind}`);
  row.appendChild(el("div", `agent ${agentClass(e.agent)}`, e.agent));
  row.appendChild(el("div", "what", describeEvent(e)));
  const box = $("events");
  box.appendChild(row);
}

function renderTokens(tokens, limits) {
  const t = tokens.total;
  const total = (t.tin || 0) + (t.tout || 0);
  $("tokTotal").textContent = total.toLocaleString();
  $("tokCost").textContent = `$${(t.cost || 0).toFixed(4)}`;
  const pct = Math.min(100, (total / limits.run_token_budget) * 100);
  $("budgetFill").style.width = `${pct}%`;
  $("budgetFill").style.background = pct > 85 ? "var(--safety)" : pct > 60 ? "var(--maybe)" : "var(--in)";
  $("budgetLabel").textContent = `${pct.toFixed(1)}% of tonight's ${limits.run_token_budget.toLocaleString()}-token budget`;
  const tbl = $("byAgent"); tbl.replaceChildren();
  tokens.by_agent.filter((a) => a.calls > 0).forEach((a) => {
    const tr = el("tr");
    tr.appendChild(el("td", agentClass(a.agent), a.agent));
    tr.appendChild(el("td", "", `${a.calls} calls`));
    tr.appendChild(el("td", "", `${(a.tin + a.tout).toLocaleString()} tok`));
    tr.appendChild(el("td", "", `$${a.cost.toFixed(4)}`));
    tbl.appendChild(tr);
  });
}

function stickToBottom(box, fn) {
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  fn();
  if (atBottom) box.scrollTop = box.scrollHeight;
}

async function poll() {
  try {
    const s = await (await fetch(`/api/state?after_msg=${lastMsg}&after_event=${lastEvent}`)).json();
    if (!roster.length) {
      roster = s.roster; roster.forEach((r) => (byId[r.id] = r));
      const sel = $("who");
      roster.forEach((r) => { const o = el("option", "", `${r.name} (${fmtPace(r.pace)}/mi)`); o.value = r.id; sel.appendChild(o); });
      $("subtitle").textContent = `Tonight, 6:30 PM · ${s.start}`;
    }
    const live = s.mode !== "demo";
    $("mode").textContent = live ? `Live · ${s.model}` : "Demo mode · no key";
    $("mode").className = "badge" + (live ? " live" : "");
    stickToBottom($("messages"), () => s.messages.forEach(renderMessage));
    if (s.messages.length) lastMsg = s.messages[s.messages.length - 1].id;
    stickToBottom($("events"), () => s.events.forEach(renderEvent));
    if (s.events.length) lastEvent = s.events[s.events.length - 1].id;
    renderPlan(s.plan, s.checkins);
    renderTokens(s.tokens, s.limits);
  } catch (err) {
    console.error(err);
  }
}

async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  return r.json();
}

$("chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("chatInput").value.trim();
  if (!text) return;
  $("chatInput").value = "";
  await post("/api/chat", { runner_id: Number($("who").value), text });
  poll();
});
document.querySelectorAll(".chip").forEach((b) =>
  b.addEventListener("click", async () => {
    await post("/api/checkin", { runner_id: Number($("who").value), status: b.dataset.status });
    poll();
  }));
$("simulate").addEventListener("click", async (e) => {
  e.target.disabled = true;
  await post("/api/simulate");
  setTimeout(() => (e.target.disabled = false), 30000);
});
$("replan").addEventListener("click", () => post("/api/replan"));
$("reset").addEventListener("click", async () => {
  await post("/api/reset");
  lastMsg = 0; lastEvent = 0; planVersion = null;
  $("messages").replaceChildren(); $("events").replaceChildren();
  poll();
});

poll();
setInterval(poll, 1500);
