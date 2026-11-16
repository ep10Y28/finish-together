# Finish Together

**A run club's AI captain.** Runners check in and chat about tonight's group run. A small team of agents sorts them into pace groups and plans each group's loops so that **every group, fast or slow, gets back to the bar at the same time.** When someone joins late or drops out, the agents re-plan on their own.

MGT 409 (AI Foundations for Managers) final project.

---

## Run it (about 3 minutes)

You need Python 3.10 or newer.

```bash
git clone <this repo's URL>
cd finish-together
python3 -m pip install -r requirements.txt
```

Add a key. Copy `.env.example` to `.env` and fill in **one** of the two keys. The app looks for `.env` in this folder first, then in the folder one level up.

```bash
cp .env.example .env
# then edit .env:  PORTKEY_API_KEY=your-course-key
```

Start it:

```bash
python3 run.py
```

Open **http://localhost:8000** and press **Play the evening** to watch a scripted night unfold: runners check in, someone brings a friend, someone tries a prompt-injection attack, someone drops out, and the agents re-plan each time.

- **No key?** The app still runs in **demo mode**: the agents fall back to plain rules, and the badge at the top says so.
- **Port busy?** `python3 run.py --port 8001`
- **Start a fresh evening:** press **Reset**, or `python3 run.py --reset`
- **Self-check:** `python3 scripts/smoke_test.py` should print `OK`.

## What you see

| Panel | What it shows |
|---|---|
| **Tonight's feed** | Check-ins, group chat, the Concierge's replies, the Captain's plans and nudges. Pick who you are, tap *I'm in / Maybe / Out*, or just type: "in for 5 at 9:30, bringing a friend". |
| **The plan** | One card per pace group with its loops, distance and return time, plus a lane chart: faster groups run farther, everyone finishes together. |
| **Agents at work** | A live trace of every model call and tool call, with tokens and cost per agent against tonight's token budget. |

## The agents

| Agent | Job | Tools |
|---|---|---|
| **Concierge** | Reads one runner's chat message and turns it into a check-in; answers "who's going?" | `check_in`, `who_is_coming` (public fields only) |
| **Group Planner** | Sorts the runners who are in into pace groups. No one runs alone. | `make_groups(max_spread)` |
| **Route Builder** | Picks loops for each group so all groups get back at the same time. | `build_routes(target_minutes)`, `swap_loops`, `verify_plan` |
| **Captain** (orchestrator) | Decides whether a change needs a new plan, asks the other two, settles conflicts, posts the plan and nudges maybes. | `ask_group_planner`, `ask_route_builder`, `post_plan`, `nudge_maybe_runners`, `skip_replan` |

The agents decide; plain Python does the math (`app/tools.py`). The model never computes a distance or a finish time, so the plan's numbers are always right and token use stays low.

Model: `gpt-6-luna` through Portkey with the course key (header `x-portkey-api-key` only), or your own `OPENAI_API_KEY`.

## Safety

- **Prompt injection:** messages are screened before they reach a model (`app/safety.py`), and the Concierge has no tool that can see anyone's phone number, so even a missed attack has nothing to leak.
- **Leaks:** anything shaped like a phone number or email is scrubbed from agent replies.
- **Bad math:** every plan is re-checked by `verify_plan`; a plan whose numbers don't add up, or whose groups come back more than 6 minutes apart, is rejected and rebuilt.
- **Overspending:** a per-evening token budget, a cap on re-plans, a cap on tool steps per agent, and a per-runner chat rate limit. When the budget runs out, the agents finish with rules instead of model calls.
- **Cheap by design:** the Captain skips re-planning when nobody's in-or-out status changed.

Every block and fallback shows up in the *Agents at work* panel.

## Tokenomics

Every model call is logged with its token counts and cost (`events` table in `finish_together.db`). Prices per million tokens are set in `app/config.py`.

## Data

`data/runners.json` (24 made-up runners), `data/routes.json` (7 loops from the start, demo distances, not a surveyed map), `data/opening.json` (check-ins already in when the evening opens) and `data/sim_script.json` (the scripted evening). No real people's data.

## Layout

```
run.py               start the app
app/main.py          FastAPI routes
app/agents.py        the four agents
app/llm.py           agent loop, token logging, budget
app/tools.py         grouping, routing and verification math
app/safety.py        injection screen, scrubbing, rate limit
app/db.py            SQLite storage
app/config.py        settings, .env lookup, prices, limits
web/                 the page (HTML, CSS, JS; no build step)
data/                demo data
scripts/smoke_test.py
```
