"""The run calendar and the past-run log.

The Tonight page is always about one date: the club's next regular run. Check-ins, chat, the plan and
the agent trace belong to that date. When the date has passed (or the captain logs the run early), the run
is saved to the club's history with who ran, at what pace, the groups and the routes, and the page moves
on to the next date. Sign-ups made ahead of time on the calendar become that date's check-ins.
"""
import datetime as dt
import random
import threading
import time

from . import agents, db, tools

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
WEEKS_AHEAD = 8
_lock = threading.Lock()


def today():
    return dt.date.today()


def label(date_str):
    d = dt.date.fromisoformat(date_str)
    return f"{d.strftime('%a')}, {d.strftime('%b')} {d.day}"


def next_regular(club, on_or_after, skip_cancelled=True):
    """The first date on or after the given one that falls on the club's run day and isn't cancelled."""
    want = DAYS.index(club["run_day"])
    d = on_or_after + dt.timedelta(days=(want - on_or_after.weekday()) % 7)
    off = db.cancelled(club["id"]) if skip_cancelled else {}
    while d.isoformat() in off:
        d += dt.timedelta(days=7)
    return d.isoformat()


def current(club):
    """The date tonight's page is about. Moves on by itself once that date has passed."""
    with _lock:
        date = db.run_date(club["id"])
        if date is None:
            date = next_regular(club, today())
            db.set_run_date(club["id"], date)
        elif date < today().isoformat():
            date = _advance(club, date, log=True, why="auto")
        return date


def summary(club, date, plan):
    """What the log keeps for a run: who ran and how it went. Names are hidden from non-members on the way out."""
    groups = (plan or {}).get("groups") or []
    return {
        "label": label(date),
        "start_name": club["start_name"],
        "finish_name": agents.finish_name(club),
        "route_type": "point" if tools.is_point_to_point(club) else "loop",
        "target_label": agents.describe_target(club),
        "going": sum(g.get("headcount", len(g["members"])) for g in groups),
        "groups": len(groups),
        "back_at": (plan or {}).get("back_at"),
        "spread": (plan or {}).get("spread_minutes"),
        "miles": [g["miles"] for g in groups],
    }


def log_current(club, date):
    plan = db.latest_plan(club["id"])
    if not plan or not plan.get("groups"):
        return None
    plan = {k: v for k, v in plan.items() if k not in ("reason", "version")}
    s = summary(club, date, plan)
    t = db.token_totals(club["id"])["total"]
    s["tokens"], s["cost"] = int(t["tin"] + t["tout"]), round(t["cost"], 4)
    return db.add_past_run(club["id"], date, club["run_time"], s, plan)


def _advance(club, date, log=True, why="captain"):
    """Close the run on `date` and open the next one. Returns the new date."""
    if log:
        log_current(club, date)
    after = max(dt.date.fromisoformat(date) + dt.timedelta(days=1), today())
    new = next_regular(club, after)
    db.set_run_date(club["id"], new)
    opening = [(s["runner_id"], s["status"], s["guests"], s["miles"], s["pace"]) for s in db.signups(club["id"], new)
               if db.is_member(club["id"], s["runner_id"])]
    db.drop_signups(club["id"], new)
    open_run(club["id"], opening, new)
    return new


def advance(club, log=True, why="captain"):
    with _lock:
        date = db.run_date(club["id"]) or next_regular(club, today())
        return _advance(club, date, log, why)


def open_run(club_id, opening, date=None):
    """Fresh page for one run date: clear the last run's data, load check-ins, post the first plan."""
    club = db.club(club_id)
    db.reset_run(club_id)
    for rid, status, guests, miles, pace in opening:
        db.upsert_checkin(club_id, rid, status, miles, pace, guests=guests)
    when = f"{label(date)} at {tools.clock(0, club['run_time'])}" if date else tools.clock(0, club["run_time"])
    db.add_message(club_id, agents.DIRECTOR,
                   f"Next run: {when} from {club['start_name']}, {agents.describe_target(club)}. "
                   "Tell me if you're in, how far and how fast, and I'll make sure every group finishes at the same time.",
                   "plan")
    agents._last_signature.pop(club_id, None)
    state = {"groups": [], "plan": None, "verified": False, "posted": False}
    agents.rule_director(club_id, state, "Opening plan")
    agents._last_signature[club_id] = agents.in_signature(club_id)


def calendar(club, user_id=None, show_names=False):
    cur = current(club)
    off = db.cancelled(club["id"])
    by_date = {}
    for s in db.signups(club["id"]):
        by_date.setdefault(s["run_date"], []).append(s)
    checkins = db.checkins(club["id"])
    out = []
    d = dt.date.fromisoformat(next_regular(club, today(), skip_cancelled=False))
    for _ in range(WEEKS_AHEAD):
        iso = d.isoformat()
        rows = checkins if iso == cur else by_date.get(iso, [])
        mine = next((r for r in rows if user_id and r["runner_id"] == user_id), None)
        out.append({
            "date": iso, "label": label(iso), "time": tools.clock(0, club["run_time"]),
            "state": "cancelled" if iso in off else ("next" if iso == cur else "upcoming"),
            "note": off.get(iso) or "",
            "going": sum(1 + (r["guests"] or 0) for r in rows if r["status"] == "in"),
            "maybe": sum(1 for r in rows if r["status"] == "maybe"),
            "mine": {"status": mine["status"], "miles": mine["miles"], "pace": mine["pace"], "guests": mine["guests"]} if mine else None,
        })
        d += dt.timedelta(days=7)
    return {"current": cur, "current_label": label(cur), "dates": out}


def who(club, date):
    rows = db.checkins(club["id"]) if date == current(club) else db.signups(club["id"], date)
    return [{"id": r["runner_id"], "name": r["name"], "color": r["color"], "status": r["status"],
             "pace": r["pace"], "miles": r["miles"], "guests": r["guests"] or 0} for r in rows]


def seed_history(club, weeks=4, ahead=3):
    """Demo data: a few past runs with plans built by the same math, and some sign-ups for coming weeks."""
    members = [m for m in db.members(club["id"])]
    cur = current(club)
    first = dt.date.fromisoformat(cur)
    for k in range(weeks, 0, -1):
        date = (first - dt.timedelta(days=7 * k)).isoformat()
        rnd = random.Random(f"{club['slug']}-{date}")
        going = rnd.sample(members, k=min(len(members), rnd.randint(9, 14)))
        rows = [{"runner_id": m["id"], "name": m["name"], "color": m["color"], "status": "in",
                 "pace": round(m["pace"] + rnd.choice([-0.5, -0.25, 0, 0, 0.25, 0.5]), 2),
                 "miles": m["usual_miles"], "guests": 1 if rnd.random() < 0.1 else 0} for m in going]
        plan = tools.build_routes(tools.make_groups(rows), club)
        plan["start"] = {"name": club["start_name"], "lat": club["start_lat"], "lng": club["start_lng"]}
        s = summary(club, date, plan)
        at = dt.datetime.combine(dt.date.fromisoformat(date), dt.time(21, 0)).timestamp()
        db.add_past_run(club["id"], date, club["run_time"], s, plan, at)
    for k in range(1, ahead + 1):
        date = (first + dt.timedelta(days=7 * k)).isoformat()
        rnd = random.Random(f"{club['slug']}-ahead-{date}")
        for m in rnd.sample(members, k=min(len(members), rnd.randint(4, 8))):
            db.upsert_signup(club["id"], date, m["id"], rnd.choice(["in", "in", "in", "maybe"]))
