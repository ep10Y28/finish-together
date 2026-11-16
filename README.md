# Finish Together

**Run clubs where every pace group finishes at the same time.** Runners check in for the club's next run, pick the pace they want that day and chat about joining. A small team of AI agents sorts them into pace groups and gives each group a route on a real map, so that **fast and slow groups all reach the finish together.** When someone joins late or drops out, the agents re-plan on their own.

MGT 409 (AI Foundations for Managers) final project.

---

## Run it (about 3 minutes)

You need Python 3.10 or newer.

```bash
git clone https://github.com/ep10Y28/finish-together.git
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

Open **http://localhost:8000**. You start signed in as Rae Simmons, captain of Last Lap Run Club in Philadelphia. Open the **Agents** panel and press **Play the evening** to watch a scripted night: runners check in at different paces, someone brings a friend, someone tries a prompt-injection attack, someone drops out, and the agents re-plan each time. Then press **▶ Watch the run** on the map.

- **No key?** The app still runs in **demo mode**: the agents fall back to plain rules, and the badge at the top says *No AI key · rules only*. In demo mode the Concierge only follows simple check-ins like "in, 5 miles at 9:30, bringing a friend"; with the key it reads any phrasing, remembers the conversation and asks when it isn't sure.
- **Port busy?** `python3 run.py --port 8001`
- **Start over:** `python3 run.py --reset` (or **Reset** in the Agents panel for tonight's run only)
- **Self-check:** `python3 scripts/smoke_test.py` should print `OK`.
- **"Model call failed" in the Agents panel?** `python3 scripts/check_model.py` makes one plain call and one tool call in each API style and prints what the model service says (never your key).
- **Token counts for the report:** after *Play the evening*, `python3 scripts/token_report.py` prints tokens and cost per agent.
- **On your phone:** `python3 run.py --host 0.0.0.0`, then open the address it prints on a phone on the same Wi-Fi. On iPhone use Share → *Add to Home Screen*; on Android, Chrome's menu → *Add to Home screen*. It opens full screen like an app.
- **The map** needs an internet connection (map tiles and street routing are free OpenStreetMap services). Without one, everything else still works and routes are sketched as dashed lines.

## What you can do

| Who | What |
|---|---|
| **Anyone** | Browse clubs on a map, see each club's schedule, meeting point, finish and tonight's routes. Sign up with a name, usual pace and usual distance. Ask to join a club. Names, chat and the agent trace stay hidden until you're a member. |
| **Members** | Check in for the next run: *I'm in / Maybe / Out*, or sign up for a later date on the **Calendar**, **today's pace** (faster or slower than usual is fine), distance and friends coming. The check-in screen shows **the paces people already picked** and which group your pace would join. Or just chat: "in for 5 at 9:30, bringing a friend". Tap a pace group on the Tonight page to see who's in it, with full names, today's pace and distance, and friends coming. |
| **Club captain** (a person) | Approves or declines join requests. Sets the meeting point and, if the run doesn't loop back, a **separate finish**, right on the Next run map (**Edit next run**, which also holds the distance or time target and the **route style**) or in the Club tab: tap the map or search a place, then **Save and re-plan**. Chooses a **distance** target (the middle group runs about this far) or a **time** target (everyone runs this long). Start and finish are both on screen at once, and place names are suggested as you type, even when they're a little off ("Philadelphia Art Museum Steps" finds the Philadelphia Museum of Art). Taps a member's name (Club tab or a pace group) to **make them a captain**, take the role away, or **remove them** after a confirm step; a club always keeps at least one captain, and a removed runner drops out of tonight's plan, which the Run Director rebuilds. On the **Calendar**, cancels a date (check-ins move to the following run) or brings it back, and can log the next run early. Can start a new club. |
| **App Admin** (Rae in the demo) | Opens **Admin** at the top right: the Improvement Scout's proposals to **approve or deny** with a note, every piece of runner feedback, and downloads of the approved to-do list (Markdown) and the feedback (CSV). |

Demo sign-in: tap your name at the top right to be anyone. The three seeded clubs (Philadelphia, New Haven, Chicago) and all 44 people are made up.

## The screens

On a phone, tabs: **Tonight** (finish time, map, groups), **Chat**, **Agents**, **Club**. On a wide screen, chat, plan and agents sit side by side.

| Part | What it shows |
|---|---|
| **Next run** | The date and time of the club's next run, when everyone finishes, how many are going, a map with each group's route on real streets from the start to the finish, a lane chart (faster groups run farther, everyone finishes together) and one card per pace group. **▶ Watch the run** moves each runner's dot along their group's route. |
| **Chat** | Check-ins, group chat, the Concierge's replies, the Run Director's plans and nudges. |
| **Agents** | A live trace of every model call and tool call, with tokens and cost per agent against tonight's token budget. Captains get *Play the evening*, *Re-plan* and *Reset*. |
| **Calendar** | The next eight run dates on a month grid and a list: tap one to see who's signed up and sign up ahead (your sign-up becomes your check-in when that date is next). Below it, **Past runs**: every run is saved the day after (or when the captain logs it) with who ran, at what pace, the groups, the finish time and the routes on a map. |
| **Feedback** | A star rating, a topic and a comment after the run, then *What runners are saying* and *What's changing* (fixes the App Admin approved). |
| **Club** | About and schedule, join requests (captain), run settings with the map picker (captain), members. |

## The agents

| Agent | Job | Tools |
|---|---|---|
| **Concierge** | Understands what a runner means in chat, the way a clubmate would ("would love to do a 9:30 pace tonight, bringing a friend", "actually make it 6", "can my roommate come?"), updates their check-in, answers questions, and asks a short question when it can't tell | `check_in`, `who_is_coming` (public fields only) |
| **Group Planner** | Sorts the runners who are in into pace groups by the pace they picked today. No one runs alone. | `make_groups(max_spread)` |
| **Route Builder** | Gives each group a distance so every group reaches the finish at the target time, and checks the result. For a point-to-point run, no group may run less than the walk from start to finish. | `build_routes`, `set_group_miles`, `verify_plan` |
| **Improvement Scout** (on demand and every 30 minutes) | Reads runner feedback, check-ins the Concierge couldn't follow, blocked messages, model errors, budget stops, rejected plans and page errors, and files bug and experience fixes for the App Admin to approve or deny. It **cannot change code, settings or data, or deploy anything**: its only tool writes a proposal. | `propose` |
| **Run Director** (orchestrator) | Decides whether a change needs a new plan, asks the other two, settles conflicts, posts the plan and nudges maybes. | `ask_group_planner`, `ask_route_builder`, `post_plan`, `nudge_maybe_runners`, `skip_replan` |

The agents decide; plain Python does the math (`app/tools.py`). The model never computes a distance or a finish time, so the plan's numbers are always right and token use stays low. The map then draws each group's distance as a route on real streets (`web/routes.js`). Routes favor **straight lines and few turns**: the app tries several route shapes (out-and-back on eight headings, or for a separate finish an overshoot, a backtrack or a side detour), scores each by turns per mile, distance error and street safety, and gives every group the same shape, each turning at its own numbered flag. A captain can switch the route style to **Run together**: everyone runs one shared route (the slowest group's distance) and starts as one pack; each faster group splits off at its numbered flag for a short out-and-back of exactly its extra distance and rejoins, so all groups still finish together. Or to **Staggered start**: everyone meets at the start and runs the same route and distance; the slowest group leaves first and each faster group gets its own start time (shown on its group card and in the Run Director's post), so all groups finish together.

Model: `gpt-6-luna` through Portkey with the course key (header `x-portkey-api-key` only), or your own `OPENAI_API_KEY`. gpt-6-luna won't take tool calls on chat completions while it reasons, so the agents use the **Responses API** with reasoning set low, and switch to chat completions with reasoning off if the Responses API refuses a request. To pin one, add `API_STYLE=responses` or `API_STYLE=chat` to `.env` (not a secret).

## Safety and privacy

- **Prompt injection:** chat messages, names, join notes and club settings are screened before they reach a model or the page (`app/safety.py`). The Concierge has no tool that can see anyone's phone number, so even a missed attack has nothing to leak.
- **Leaks:** anything shaped like a phone number or email is scrubbed from agent replies.
- **Who sees what:** the server checks membership on every request. Non-members see routes and group sizes, never names, chat or the agent trace. Only the club's captain can approve members or change the run.
- **Location:** Finish Together never tracks anyone. *Watch the run* is a simulation drawn from the plan. The only places stored are the club's meeting point and finish, which the captain chooses.
- **Bad math:** every plan is re-checked by `verify_plan`; a plan whose numbers don't add up, whose groups finish more than 6 minutes apart, or whose groups can't reach the finish is rejected and rebuilt. If the finish is too far for the slowest group in the time set, the target is stretched and the plan says why.
- **Overspending:** a per-evening token budget, a cap on re-plans, a cap on tool steps per agent, and a per-runner chat rate limit. When the budget runs out, the agents finish with rules instead of model calls.
- **Cheap by design:** the Run Director skips re-planning when nobody's in-or-out status, pace or the club's settings changed.

- **Street safety (Philadelphia):** routes are steered away from streets with more recent violent incidents, counted per block-sized cell from the city's public incident data over the last year. The route card says how a route compares with nearby streets. This has a fairness cost: incident data reflects where police record crime, not only where it happens, and steering runners away can mark whole neighborhoods as places to avoid. So it is one factor among turns and distance, it is never shown as a "bad neighborhood" label, and it covers Philadelphia only.
- **Improvement Scout:** proposes, never acts. Feedback text is screened for injection before it is stored, quoted only as evidence, and stripped of phone numbers and emails. The Scout has its own daily token budget, and only the App Admin can run it or approve anything.
- **Member controls:** only captains can promote or remove members (checked on the server), removal needs a confirm step, and the last captain can't step down or leave.

Every block and fallback shows up in the *Agents* panel.

## Tokenomics

Every model call is logged with its token counts and cost (`events` table in `finish_together.db`). Prices per million tokens are set in `app/config.py`.

## Data and map sources

- `data/clubs.json`: three made-up clubs with meeting points, schedules, opening check-ins and the scripted evening.
- `data/runners.json`: 44 made-up people with fake 555 phone numbers. No real people's data.
- Map: [Leaflet](https://leafletjs.com) (included in `web/vendor/`), map tiles from the standard OpenStreetMap tile server, walking routes from the OpenStreetMap foot router at routing.openstreetmap.de, place suggestions from [Photon](https://photon.komoot.io) (OpenStreetMap data). All free, no keys.
- Street safety: Philadelphia Police Department crime incidents on [OpenDataPhilly](https://opendataphilly.org/datasets/crime-incidents/), read through the city's Carto SQL API on first use and cached for a week in `data/cache/` (not committed). If it can't be reached, routes are planned without it and the map says so.

## Layout

```
run.py               start the app (--port, --host, --reset)
app/main.py          FastAPI routes, membership and captain checks
app/agents.py        the four agents
app/llm.py           agent loop, token logging, budget
app/scout.py         the Improvement Scout and its schedule
app/runs.py          run calendar, sign-ups ahead, past-run log
app/crime.py         street safety grid from Philadelphia incident data
app/tools.py         grouping, distance and verification math
app/safety.py        injection screen, scrubbing, rate limit
app/db.py            SQLite storage
app/config.py        settings, .env lookup, prices, limits
web/                 the page: HTML, CSS, JS, map code, icons, manifest (no build step)
data/                demo clubs and people
scripts/smoke_test.py
```
