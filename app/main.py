"""FastAPI backend: serves the page and the JSON the page polls.

Who you are is sent in the X-User-Id header. This is a demo sign-in (pick a
person, or sign up as a new one); a real deployment would put a proper login
in front of it. Every rule below is still enforced on the server: only
approved members can chat, check in or see who is running, and only a club's
captain can approve members or change the run.
"""
import json
import re
import threading
import time

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import agents, config, crime, db, safety, scout, tools

app = FastAPI(title="Finish Together")

SEED = json.loads((config.DATA_DIR / "clubs.json").read_text())["clubs"]
SEED_BY_SLUG = {c["slug"]: c for c in SEED}
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
HHMM = r"([01]\d|2[0-3]):[0-5]\d"


# ----------------------------------------------------------------- setup

def open_evening(club_id):
    """Fresh evening for one club: clear tonight's data, load the opening check-ins, post the first plan."""
    club = db.club(club_id)
    db.reset_run(club_id)
    for rid, status, guests in SEED_BY_SLUG.get(club["slug"], {}).get("opening", []):
        if db.is_member(club_id, rid):
            db.upsert_checkin(club_id, rid, status, guests=guests)
    db.add_message(club_id, agents.DIRECTOR,
                   f"Tonight's run: {tools.clock(0, club['run_time'])} from {club['start_name']}, "
                   f"{agents.describe_target(club)}. Tell me if you're in, how far and how fast, "
                   "and I'll make sure every group finishes at the same time.", "plan")
    agents._last_signature.pop(club_id, None)
    state = {"groups": [], "plan": None, "verified": False, "posted": False}
    agents.rule_director(club_id, state, "Opening plan")
    agents._last_signature[club_id] = agents.in_signature(club_id)


def seed():
    for c in SEED:
        cid = db.add_club(c, c["captain"])
        for rid in c["members"]:
            db.set_membership(cid, rid, "member", "approved")
        for rid, note in c.get("pending", []):
            db.set_membership(cid, rid, "member", "pending", note)
        open_evening(cid)


@app.on_event("startup")
def startup():
    db.init()
    if not db.clubs():
        seed()
    scout.start_timer()


# ----------------------------------------------------------------- helpers

def me(x_user_id):
    if not x_user_id:
        return None
    try:
        return db.runner(int(x_user_id))
    except ValueError:
        return None


def need_me(x_user_id):
    u = me(x_user_id)
    if not u:
        raise HTTPException(401, "Sign in or sign up first.")
    return u


def need_club(slug):
    c = db.club(slug)
    if not c:
        raise HTTPException(404, "No such club.")
    return c


def need_member(club, user):
    if not db.is_member(club["id"], user["id"]):
        raise HTTPException(403, "Only approved members can do that. Ask to join and the club captain will review it.")


def need_captain(club, user):
    if not db.is_captain(club["id"], user["id"]):
        raise HTTPException(403, "Only this club's captain can do that.")


def screen(label, text, max_chars, club_id=None):
    ok, why = safety.check_field(label, text, max_chars, club_id)
    if not ok:
        raise HTTPException(400, why)
    return (text or "").strip()


def public_plan(plan, show_names):
    """Non-members see the routes and group sizes, not who is running."""
    if not plan or show_names:
        return plan
    p = dict(plan)
    p["groups"] = [dict(g, members=[{"id": None, "name": "Runner", "color": "#9a948b", "guests": 0}
                                    for _ in g["members"]]) for g in plan["groups"]]
    p["conflicts"] = []
    return p


def describe(c):
    caps = db.captains(c["id"])
    return {**c, "captain": " and ".join(x["name"] for x in caps[:2]) + (f" +{len(caps) - 2}" if len(caps) > 2 else "") if caps else None,
            "target_label": agents.describe_target(c),
            "start_clock": tools.clock(0, c["run_time"]),
            "finish_name": agents.finish_name(c),
            "route_type": "point" if tools.is_point_to_point(c) else "loop"}


def club_view(club, user):
    mine = db.membership(club["id"], user["id"]) if user else None
    is_member = bool(mine and mine["status"] == "approved")
    is_cap = bool(is_member and mine["role"] == "captain")
    out = describe(club)
    out["me"] = {"status": mine["status"] if mine else None, "role": mine["role"] if mine else None,
                 "is_member": is_member, "is_captain": is_cap}
    out["member_list"] = db.members(club["id"]) if is_member else []
    out["pending"] = db.members(club["id"], "pending") if is_cap else []
    return out


# ----------------------------------------------------------------- people

class SignUp(BaseModel):
    name: str
    pace: str
    usual_miles: float = 4


@app.get("/api/people")
def people():
    """For the demo sign-in picker. Public fields only."""
    return {"people": db.public_roster(), "mode": config.MODE,
            "model": config.PORTKEY_MODEL if config.MODE == "portkey" else config.OPENAI_MODEL}


@app.get("/api/me")
def whoami(x_user_id: str | None = Header(None)):
    u = me(x_user_id)
    return {"me": u, "memberships": db.my_memberships(u["id"]) if u else [],
            "is_admin": bool(u and u["id"] in config.APP_ADMIN_IDS)}


@app.post("/api/signup")
def signup(body: SignUp):
    name = screen("Name", body.name, config.MAX_NAME_CHARS)
    if not re.fullmatch(r"[A-Za-zÀ-ÿ' .-]{2,40}", name):
        raise HTTPException(400, "Use letters, spaces, apostrophes or hyphens for your name.")
    try:
        pace = agents.parse_pace(body.pace)
    except (ValueError, TypeError):
        raise HTTPException(400, "Pace should look like 9:30 (minutes per mile).")
    if not pace or not 1 <= body.usual_miles <= 20:
        raise HTTPException(400, "Pace and usual distance are needed (1 to 20 miles).")
    rid = db.add_runner(name, pace, float(body.usual_miles))
    return {"me": db.runner(rid)}


# ----------------------------------------------------------------- clubs

class ClubFields(BaseModel):
    name: str | None = None
    city: str | None = None
    blurb: str | None = None
    start_name: str | None = None
    start_lat: float | None = None
    start_lng: float | None = None
    route_type: str | None = None          # "loop" or "point"
    end_name: str | None = None
    end_lat: float | None = None
    end_lng: float | None = None
    run_day: str | None = None
    run_time: str | None = None
    target_mode: str | None = None         # "time" or "distance"
    target_value: float | None = None
    schedule: list[dict] | None = None


def _point(lat, lng, what):
    if lat is None or lng is None or not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(400, f"Pick the {what} on the map.")
    return round(lat, 6), round(lng, 6)


def clean_settings(fields, club=None):
    """Validate a captain's settings. Text fields get the same injection screen as chat."""
    cid = club["id"] if club else None
    out = {}
    for k in ("name", "city", "blurb", "start_name", "end_name"):
        if fields.get(k) is not None:
            limit = 200 if k == "blurb" else config.MAX_CLUB_FIELD_CHARS
            label = k.replace("_", " ").capitalize()
            out[k] = screen(label, fields[k], limit, cid)
            if k != "blurb" and len(out[k]) < 2:
                raise HTTPException(400, f"{label} is too short.")
    if fields.get("start_lat") is not None or fields.get("start_lng") is not None:
        out["start_lat"], out["start_lng"] = _point(fields.get("start_lat"), fields.get("start_lng"),
                                                    "meeting point")
    rt = fields.get("route_type")
    if rt is not None and rt not in ("loop", "point"):
        raise HTTPException(400, "Choose a loop or a separate finish.")
    if rt == "loop":
        out["end_name"] = out["end_lat"] = out["end_lng"] = None
    elif rt == "point" or fields.get("end_lat") is not None:
        out["end_lat"], out["end_lng"] = _point(fields.get("end_lat"), fields.get("end_lng"), "finish")
        out.setdefault("end_name", (club or {}).get("end_name") or "Finish")
        start = (out.get("start_lat", (club or {}).get("start_lat")), out.get("start_lng", (club or {}).get("start_lng")))
        if None not in start:
            far = tools.straight_miles(start[0], start[1], out["end_lat"], out["end_lng"])
            if far > 10:
                raise HTTPException(400, "The finish is more than 10 miles from the start. Pick a closer one.")
    if fields.get("run_day") is not None:
        if fields["run_day"] not in DAYS:
            raise HTTPException(400, "Pick a day of the week.")
        out["run_day"] = fields["run_day"]
    if fields.get("run_time") is not None:
        if not re.fullmatch(HHMM, fields["run_time"]):
            raise HTTPException(400, "Start time should look like 18:30.")
        out["run_time"] = fields["run_time"]
    mode = fields.get("target_mode")
    if mode is not None and mode not in ("time", "distance"):
        raise HTTPException(400, "Choose distance or time.")
    if mode is not None:
        out["target_mode"] = mode
    if fields.get("target_value") is not None:
        v = float(fields["target_value"])
        m = mode or (club["target_mode"] if club else "time")
        if m == "time" and not 15 <= v <= 150:
            raise HTTPException(400, "A timed run should be 15 to 150 minutes.")
        if m == "distance" and not 1 <= v <= 20:
            raise HTTPException(400, "A distance should be 1 to 20 miles.")
        out["target_value"] = v
    if fields.get("schedule") is not None:
        sched = []
        for s in fields["schedule"][:6]:
            day, t = s.get("day"), s.get("time", "")
            if day not in DAYS or not re.fullmatch(HHMM, t or ""):
                raise HTTPException(400, "Each schedule line needs a day and a time like 18:30.")
            sched.append({"day": day, "time": t, "what": screen("Schedule note", s.get("what", ""), 80, cid)})
        out["schedule"] = sched
    return out


@app.get("/api/clubs")
def list_clubs(x_user_id: str | None = Header(None)):
    u = me(x_user_id)
    mine = {m["club_id"]: m for m in (db.my_memberships(u["id"]) if u else [])}
    out = []
    for c in db.clubs():
        plan = db.latest_plan(c["id"])
        m = mine.get(c["id"])
        out.append({**describe(c),
                    "tonight": {"groups": len(plan["groups"]) if plan else 0,
                                "going": sum(g["headcount"] for g in plan["groups"]) if plan else 0,
                                "back_at": plan.get("back_at") if plan else None},
                    "my_status": m["status"] if m else None, "my_role": m["role"] if m else None})
    return {"clubs": out}


@app.post("/api/clubs")
def create_club(body: ClubFields, x_user_id: str | None = Header(None)):
    u = need_me(x_user_id)
    fields = clean_settings(body.model_dump(exclude_none=True))
    for k in ("name", "city", "start_name", "start_lat", "start_lng"):
        if k not in fields:
            raise HTTPException(400, f"{k.replace('_', ' ').capitalize()} is needed.")
    c = {"run_day": "Wednesday", "run_time": "18:30", "target_mode": "time", "target_value": 45,
         "blurb": "", **fields}
    c["slug"] = db.slugify(c["name"])
    c["color"] = db.COLORS[len(db.clubs()) % len(db.COLORS)]
    c["schedule"] = c.get("schedule") or [{"day": c["run_day"], "time": c["run_time"],
                                           "what": "Finish-together group run"}]
    cid = db.add_club(c, u["id"])
    open_evening(cid)
    return {"club": club_view(db.club(cid), u)}


@app.get("/api/clubs/{slug}")
def get_club(slug: str, x_user_id: str | None = Header(None)):
    return {"club": club_view(need_club(slug), me(x_user_id))}


class Join(BaseModel):
    note: str = ""


@app.post("/api/clubs/{slug}/join")
def join(slug: str, body: Join, x_user_id: str | None = Header(None)):
    u, c = need_me(x_user_id), need_club(slug)
    m = db.membership(c["id"], u["id"])
    if m and m["status"] == "approved":
        return {"status": "approved"}
    note = screen("Note", body.note, 200, c["id"])
    db.set_membership(c["id"], u["id"], "member", "pending", note)
    db.log_event(c["id"], "Club", "join", {"runner": u["name"], "status": "pending"})
    return {"status": "pending"}


class Decision(BaseModel):
    decision: str


@app.post("/api/clubs/{slug}/requests/{runner_id}")
def decide(slug: str, runner_id: int, body: Decision, x_user_id: str | None = Header(None)):
    u, c = need_me(x_user_id), need_club(slug)
    need_captain(c, u)
    m = db.membership(c["id"], runner_id)
    if not m or m["status"] != "pending":
        raise HTTPException(404, "No pending request from that runner.")
    if body.decision not in ("approve", "decline"):
        raise HTTPException(400, "Decision must be approve or decline.")
    status = "approved" if body.decision == "approve" else "declined"
    db.set_membership(c["id"], runner_id, "member", status, m["note"])
    r = db.runner(runner_id)
    db.log_event(c["id"], "Club", "join", {"runner": r["name"], "status": status, "by": u["name"]})
    if status == "approved":
        db.add_message(c["id"], agents.DIRECTOR,
                       f"Welcome {r['name'].split()[0]}, {u['name'].split()[0]} just approved you. "
                       "Tell me if you're in tonight and how far you'd like to go.", "chat", to_runner=runner_id)
    return {"status": status}


class MemberAction(BaseModel):
    action: str     # make_captain, remove_captain or remove


@app.post("/api/clubs/{slug}/members/{runner_id}")
def manage_member(slug: str, runner_id: int, body: MemberAction, x_user_id: str | None = Header(None)):
    """Captains only: make someone a captain, step a captain down, or remove someone from the club.
    A club always keeps at least one captain."""
    u, c = need_me(x_user_id), need_club(slug)
    need_captain(c, u)
    m = db.membership(c["id"], runner_id)
    if not m or m["status"] != "approved":
        raise HTTPException(404, "That person isn't a member of this club.")
    r = db.runner(runner_id)
    first, by = r["name"].split()[0], u["name"].split()[0]
    last_captain = m["role"] == "captain" and db.captain_count(c["id"]) <= 1
    if body.action == "make_captain":
        db.set_membership(c["id"], runner_id, "captain", "approved", m["note"])
        db.add_message(c["id"], agents.DIRECTOR, f"{by} made {first} a captain of {c['name']}.", "chat")
    elif body.action == "remove_captain":
        if last_captain:
            raise HTTPException(400, "A club needs at least one captain. Make someone else a captain first.")
        db.set_membership(c["id"], runner_id, "member", "approved", m["note"])
    elif body.action == "remove":
        if last_captain:
            raise HTTPException(400, "A club needs at least one captain. Make someone else a captain before removing this one.")
        was_running = db.remove_member(c["id"], runner_id)
        db.add_message(c["id"], agents.DIRECTOR, f"{first} is no longer a member of {c['name']}.", "plan")
        if was_running:
            agents.start_director(c["id"], f"{r['name']} was removed from the club")
    else:
        raise HTTPException(400, "Unknown action.")
    db.log_event(c["id"], "Club", "member", {"runner": r["name"], "action": body.action, "by": u["name"]})
    return {"club": club_view(db.club(c["id"]), u)}


@app.patch("/api/clubs/{slug}")
def update_club(slug: str, body: ClubFields, x_user_id: str | None = Header(None)):
    u, c = need_me(x_user_id), need_club(slug)
    need_captain(c, u)
    fields = clean_settings(body.model_dump(exclude_none=True), c)
    if not fields:
        return {"club": club_view(c, u)}
    db.update_club(c["id"], fields)
    new = db.club(c["id"])
    what = []
    if "start_lat" in fields or "start_name" in fields:
        what.append(f"meeting point is {new['start_name']}")
    if "end_lat" in fields or "end_name" in fields:
        what.append(f"finish is {agents.finish_name(new)}" if tools.is_point_to_point(new)
                    else "the run is a loop again")
    if "target_mode" in fields or "target_value" in fields:
        what.append(f"the run is {agents.describe_target(new)}")
    if "run_time" in fields:
        what.append(f"start time is {tools.clock(0, new['run_time'])}")
    if what:
        db.add_message(c["id"], agents.DIRECTOR, f"{u['name'].split()[0]} changed tonight's run: "
                       + "; ".join(what) + ". Updating the plan.", "plan")
        agents.start_director(c["id"], f"Captain changed the run ({'; '.join(what)})")
    return {"club": club_view(new, u)}


# ----------------------------------------------------------------- tonight's run

@app.get("/api/clubs/{slug}/state")
def state(slug: str, after_msg: int = 0, after_event: int = 0, x_user_id: str | None = Header(None)):
    c = need_club(slug)
    u = me(x_user_id)
    member = bool(u and db.is_member(c["id"], u["id"]))
    checkins = db.checkins(c["id"])
    return {
        "mode": config.MODE,
        "model": config.PORTKEY_MODEL if config.MODE == "portkey" else config.OPENAI_MODEL,
        "member": member,
        "counts": {"in": sum(1 + (x["guests"] or 0) for x in checkins if x["status"] == "in"),
                   "maybe": sum(1 for x in checkins if x["status"] == "maybe")},
        "my_checkin": next((x for x in checkins if u and x["runner_id"] == u["id"]), None),
        "pace_board": pace_board(checkins) if member else [],
        "plan": public_plan(db.latest_plan(c["id"]), member),
        "messages": db.messages(c["id"], after_msg) if member else [],
        "events": db.events(c["id"], after_event) if member else [],
        "tokens": db.token_totals(c["id"]),
        "limits": {"run_token_budget": config.RUN_TOKEN_BUDGET,
                   "max_replans": config.MAX_REPLANS_PER_RUN,
                   "price_in_per_m": config.PRICE_INPUT_PER_M,
                   "price_out_per_m": config.PRICE_OUTPUT_PER_M},
    }


def pace_board(checkins):
    """How many people are going at each pace today, in 30-second bands, to help others pick."""
    bands = {}
    for x in checkins:
        if x["status"] != "in":
            continue
        lo = int(x["pace"] * 2) / 2
        b = bands.setdefault(lo, {"from": tools.fmt_pace(lo), "to": tools.fmt_pace(lo + 0.49), "going": 0})
        b["going"] += 1 + (x["guests"] or 0)
    return [bands[k] for k in sorted(bands)]


class Chat(BaseModel):
    text: str


class CheckIn(BaseModel):
    status: str
    miles: float | None = None
    pace: str | None = None
    guests: int = 0


@app.post("/api/clubs/{slug}/chat")
def chat(slug: str, body: Chat, x_user_id: str | None = Header(None)):
    u, c = need_me(x_user_id), need_club(slug)
    need_member(c, u)
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "Empty message.")
    return {"reply": agents.concierge(c["id"], u["id"], text)}


@app.post("/api/clubs/{slug}/checkin")
def checkin(slug: str, body: CheckIn, x_user_id: str | None = Header(None)):
    u, c = need_me(x_user_id), need_club(slug)
    need_member(c, u)
    if body.status not in ("in", "maybe", "out"):
        raise HTTPException(400, "Status must be in, maybe or out.")
    try:
        pace = agents.parse_pace(body.pace)
    except (ValueError, TypeError):
        raise HTTPException(400, "Pace should look like 9:30.")
    db.upsert_checkin(c["id"], u["id"], body.status, body.miles, pace, max(0, min(body.guests, 4)))
    label = {"in": "is in", "maybe": "is a maybe", "out": "is out tonight"}[body.status]
    db.add_message(c["id"], u["name"], f"{u['name'].split()[0]} {label}.", "checkin", runner_id=u["id"])
    agents.start_director(c["id"], f"{u['name']} tapped {body.status}")
    return {"ok": True}


@app.post("/api/clubs/{slug}/replan")
def replan(slug: str, x_user_id: str | None = Header(None)):
    u, c = need_me(x_user_id), need_club(slug)
    need_captain(c, u)
    agents.start_director(c["id"], "Captain asked for a fresh plan", True)
    return {"ok": True}


_sim_running = set()


@app.post("/api/clubs/{slug}/simulate")
def simulate(slug: str, x_user_id: str | None = Header(None)):
    u, c = need_me(x_user_id), need_club(slug)
    need_captain(c, u)
    if c["id"] in _sim_running:
        return {"ok": False, "why": "already running"}
    steps = db.club_script(c["id"])

    def go():
        _sim_running.add(c["id"])
        try:
            for rid, text in steps:
                if db.is_member(c["id"], rid):
                    agents.concierge(c["id"], rid, text)
                time.sleep(3.5 if config.MODE == "demo" else 1.0)
                with agents.director_lock(c["id"]):   # let the Run Director finish before the next message
                    pass
        finally:
            _sim_running.discard(c["id"])

    threading.Thread(target=go, daemon=True).start()
    return {"ok": True, "steps": len(steps)}


@app.post("/api/clubs/{slug}/reset")
def reset(slug: str, x_user_id: str | None = Header(None)):
    u, c = need_me(x_user_id), need_club(slug)
    need_captain(c, u)
    open_evening(c["id"])
    return {"ok": True}


# ----------------------------------------------------------------- street safety data for routes

@app.get("/api/clubs/{slug}/safety")
def safety_grid(slug: str):
    """Violent-incident counts per small cell around the start (Philadelphia only). Counts only, no incident details."""
    c = need_club(slug)
    return crime.grid(c["start_lat"], c["start_lng"])


# ----------------------------------------------------------------- runner feedback

TOPICS = ["Routes", "Groups and pace", "Timing", "Safety", "The app", "Something else"]


class Feedback(BaseModel):
    rating: int | None = None
    topic: str = "Something else"
    text: str = ""


@app.post("/api/clubs/{slug}/feedback")
def give_feedback(slug: str, body: Feedback, x_user_id: str | None = Header(None)):
    u, c = need_me(x_user_id), need_club(slug)
    need_member(c, u)
    if body.rating is not None and not 1 <= body.rating <= 5:
        raise HTTPException(400, "Rating is 1 to 5.")
    if body.topic not in TOPICS:
        raise HTTPException(400, "Pick a topic.")
    text = screen("Feedback", body.text, 500, c["id"])
    text = safety.scrub_outgoing(c["id"], "Feedback", text)    # no phone numbers or emails stored
    if body.rating is None and not text:
        raise HTTPException(400, "Add a rating or a few words.")
    db.add_feedback(c["id"], u["id"], body.rating, body.topic, text)
    return {"ok": True}


@app.get("/api/clubs/{slug}/feedback")
def club_feedback(slug: str, x_user_id: str | None = Header(None)):
    """Members see what their club has said (first names only) and which fixes the App Admin approved."""
    u, c = need_me(x_user_id), need_club(slug)
    need_member(c, u)
    fb = db.feedback(c["id"], limit=40)
    rated = [f["rating"] for f in fb if f["rating"]]
    return {"topics": TOPICS,
            "average": round(sum(rated) / len(rated), 1) if rated else None,
            "count": len(fb),
            "items": [{"first": (f["runner"] or "Runner").split()[0], "rating": f["rating"], "topic": f["topic"],
                       "text": f["text"], "at": f["created_at"], "mine": f["runner_id"] == u["id"]} for f in fb],
            "changing": [{"title": p["title"], "status": p["status"]} for p in db.proposals("approved")][:8]}


class ClientError(BaseModel):
    page: str = ""
    message: str = ""


@app.post("/api/client-error")
def client_error(body: ClientError):
    """The page reports its own script errors so the Improvement Scout can see them."""
    if len(db.client_errors(time.time() - 3600)) < 50:     # a small cap against floods
        db.add_client_error(body.page, body.message)
    return {"ok": True}


# ----------------------------------------------------------------- App Admin and the Improvement Scout

def need_admin(x_user_id):
    u = need_me(x_user_id)
    if u["id"] not in config.APP_ADMIN_IDS:
        raise HTTPException(403, "Only the App Admin can do that.")
    return u


@app.get("/api/admin")
def admin_home(x_user_id: str | None = Header(None)):
    need_admin(x_user_id)
    fb = db.feedback(limit=200)
    rated = [f["rating"] for f in fb if f["rating"]]
    return {"proposals": db.proposals(),
            "feedback": {"count": len(fb), "average": round(sum(rated) / len(rated), 1) if rated else None,
                         "recent": [{"club": f["club"], "first": (f["runner"] or "Runner").split()[0], "rating": f["rating"],
                                     "topic": f["topic"], "text": f["text"], "at": f["created_at"]} for f in fb[:20]]},
            "scout": {"last_run": scout.last_run(), "every_minutes": config.SCOUT_EVERY_MINUTES,
                      "tokens_today": db.scout_tokens_today(), "budget": config.SCOUT_TOKEN_BUDGET,
                      "mode": "model" if config.MODE != "demo" else "rules"}}


@app.post("/api/admin/scout")
def admin_run_scout(x_user_id: str | None = Header(None)):
    need_admin(x_user_id)
    return scout.run_scout("on demand")


class AdminDecision(BaseModel):
    decision: str
    note: str = ""


@app.post("/api/admin/proposals/{pid}")
def admin_decide(pid: int, body: AdminDecision, x_user_id: str | None = Header(None)):
    need_admin(x_user_id)
    status = {"approve": "approved", "deny": "denied", "reopen": "pending"}.get(body.decision)
    if not status:
        raise HTTPException(400, "Decision is approve, deny or reopen.")
    note = screen("Note", body.note, 300)
    db.decide_proposal(pid, status, note)
    return {"proposals": db.proposals()}


@app.get("/api/admin/export")
def admin_export(what: str = "approved", x_user_id: str | None = Header(None)):
    """approved: a Markdown to-do list for a developer. feedback: a CSV of runner feedback (first names only)."""
    need_admin(x_user_id)
    if what == "feedback":
        lines = ["club,first_name,rating,topic,feedback,date"]
        for f in db.feedback(limit=10000):
            cells = [f["club"] or "", (f["runner"] or "Runner").split()[0], str(f["rating"] or ""), f["topic"] or "",
                     f["text"] or "", time.strftime("%Y-%m-%d", time.localtime(f["created_at"]))]
            lines.append(",".join('"' + x.replace('"', '""') + '"' for x in cells))
        return PlainTextResponse("\n".join(lines) + "\n", media_type="text/csv")
    out = ["# Finish Together: approved improvements", "",
           "Proposed by the Improvement Scout, approved by the App Admin. Nothing here has been changed in the app yet.", ""]
    for p in db.proposals("approved"):
        out += [f"- [ ] **{p['title']}** ({p['severity']}, {p['kind']})",
                f"  - Evidence: {p['evidence']}", f"  - Suggested change: {p['suggestion']}"]
        if p["admin_note"]:
            out.append(f"  - Admin note: {p['admin_note']}")
    return PlainTextResponse("\n".join(out) + "\n", media_type="text/markdown")


# ----------------------------------------------------------------- page

app.mount("/static", StaticFiles(directory=config.WEB_DIR), name="static")


@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(config.WEB_DIR / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/")
def index():
    return FileResponse(config.WEB_DIR / "index.html")
