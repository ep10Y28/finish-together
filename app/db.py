"""SQLite storage. One file, created and seeded on first start.

People sign up once (runners table) and join clubs (memberships). Each club's
captain approves or declines who joins. Check-ins, chat, plans and the agent
trace all belong to one club's run.
"""
import json
import re
import sqlite3
import threading
import time
from contextlib import contextmanager

from . import config

_lock = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS runners (
  id INTEGER PRIMARY KEY, name TEXT, pace REAL, usual_miles REAL,
  color TEXT, phone TEXT, bio TEXT, created_at REAL
);
CREATE TABLE IF NOT EXISTS clubs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, name TEXT, city TEXT, blurb TEXT,
  color TEXT, start_name TEXT, start_lat REAL, start_lng REAL,
  end_name TEXT, end_lat REAL, end_lng REAL,          -- all NULL means the run is a loop
  run_day TEXT, run_time TEXT,
  target_mode TEXT, target_value REAL, schedule_json TEXT, script_json TEXT, created_at REAL
);
CREATE TABLE IF NOT EXISTS memberships (
  club_id INTEGER, runner_id INTEGER, role TEXT, status TEXT, note TEXT, updated_at REAL,
  PRIMARY KEY (club_id, runner_id)
);
CREATE TABLE IF NOT EXISTS checkins (
  club_id INTEGER, runner_id INTEGER, status TEXT, miles REAL, pace REAL,
  guests INTEGER DEFAULT 0, note TEXT, updated_at REAL,
  PRIMARY KEY (club_id, runner_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, club_id INTEGER, runner_id INTEGER, author TEXT,
  kind TEXT, text TEXT, to_runner INTEGER, created_at REAL
);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT, club_id INTEGER, plan_json TEXT, reason TEXT, created_at REAL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, club_id INTEGER, agent TEXT, kind TEXT, detail TEXT,
  tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, cost REAL DEFAULT 0,
  created_at REAL
);
"""

COLORS = ["#e4572e", "#17bebb", "#d9a21b", "#76b041", "#7d5ba6", "#3a86ff",
          "#ff006e", "#fb5607", "#8338ec", "#06a77d", "#118ab2", "#c2185b"]


@contextmanager
def conn():
    with _lock:
        c = sqlite3.connect(config.DB_PATH)
        c.row_factory = sqlite3.Row
        try:
            yield c
            c.commit()
        finally:
            c.close()


def rows(sql, args=()):
    with conn() as c:
        return [dict(r) for r in c.execute(sql, args).fetchall()]


def run(sql, args=()):
    with conn() as c:
        cur = c.execute(sql, args)
        return cur.lastrowid


def init(reset: bool = False):
    """Create tables. Returns True when the database was empty (the caller then seeds the clubs)."""
    if reset and config.DB_PATH.exists():
        config.DB_PATH.unlink()
    with conn() as c:
        c.executescript(SCHEMA)
        empty = c.execute("SELECT COUNT(*) FROM runners").fetchone()[0] == 0
        if empty:
            runners = json.loads((config.DATA_DIR / "runners.json").read_text())
            now = time.time()
            c.executemany(
                "INSERT INTO runners VALUES (:id,:name,:pace,:usual_miles,:color,:phone,:bio,:created_at)",
                [dict(r, created_at=now) for r in runners],
            )
    return empty


# ---------- people ----------

PUBLIC = "id, name, pace, usual_miles, color, bio"


def public_roster():
    """Public fields only. Phone numbers never leave this module."""
    return rows(f"SELECT {PUBLIC} FROM runners ORDER BY name")


def runner(runner_id):
    r = rows(f"SELECT {PUBLIC} FROM runners WHERE id=?", (runner_id,))
    return r[0] if r else None


def add_runner(name, pace, usual_miles):
    n = rows("SELECT COUNT(*) AS n FROM runners")[0]["n"]
    return run("INSERT INTO runners (name,pace,usual_miles,color,phone,bio,created_at) VALUES (?,?,?,?,?,?,?)",
               (name, pace, usual_miles, COLORS[n % len(COLORS)], None, "New member", time.time()))


# ---------- clubs and memberships ----------

def slugify(name):
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "club"
    base, i = s, 2
    while rows("SELECT 1 FROM clubs WHERE slug=?", (s,)):
        s, i = f"{base}-{i}", i + 1
    return s


def add_club(c, captain_id):
    cid = run(
        """INSERT INTO clubs (slug,name,city,blurb,color,start_name,start_lat,start_lng,end_name,end_lat,
           end_lng,run_day,run_time,target_mode,target_value,schedule_json,script_json,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (c["slug"], c["name"], c["city"], c.get("blurb", ""), c.get("color", "#e4572e"), c["start_name"],
         c["start_lat"], c["start_lng"], c.get("end_name"), c.get("end_lat"), c.get("end_lng"), c["run_day"], c["run_time"], c["target_mode"], c["target_value"],
         json.dumps(c.get("schedule", [])), json.dumps(c.get("script", [])), time.time()))
    set_membership(cid, captain_id, "captain", "approved")
    return cid


def _club_row(r):
    if not r:
        return None
    r = dict(r)
    r["schedule"] = json.loads(r.pop("schedule_json") or "[]")
    r["has_script"] = bool(json.loads(r.pop("script_json") or "[]"))
    r["members"] = rows("SELECT COUNT(*) AS n FROM memberships WHERE club_id=? AND status='approved'",
                        (r["id"],))[0]["n"]
    return r


def club(slug_or_id):
    col = "id" if isinstance(slug_or_id, int) else "slug"
    r = rows(f"SELECT * FROM clubs WHERE {col}=?", (slug_or_id,))
    return _club_row(r[0]) if r else None


def club_script(club_id):
    r = rows("SELECT script_json FROM clubs WHERE id=?", (club_id,))
    return json.loads(r[0]["script_json"] or "[]") if r else []


def clubs():
    return [_club_row(r) for r in rows("SELECT * FROM clubs ORDER BY id")]


CLUB_FIELDS = {"name", "city", "blurb", "start_name", "start_lat", "start_lng", "end_name", "end_lat",
               "end_lng", "run_day", "run_time",
               "target_mode", "target_value", "schedule"}


def update_club(club_id, fields):
    sets, args = [], []
    for k, v in fields.items():
        if k not in CLUB_FIELDS:
            continue
        if k == "schedule":
            k, v = "schedule_json", json.dumps(v)
        sets.append(f"{k}=?")
        args.append(v)
    if sets:
        run(f"UPDATE clubs SET {', '.join(sets)} WHERE id=?", (*args, club_id))


def set_membership(club_id, runner_id, role, status, note=""):
    run("""INSERT INTO memberships (club_id,runner_id,role,status,note,updated_at) VALUES (?,?,?,?,?,?)
           ON CONFLICT(club_id,runner_id) DO UPDATE SET role=excluded.role, status=excluded.status,
             note=excluded.note, updated_at=excluded.updated_at""",
        (club_id, runner_id, role, status, note, time.time()))


def membership(club_id, runner_id):
    if runner_id is None:
        return None
    r = rows("SELECT * FROM memberships WHERE club_id=? AND runner_id=?", (club_id, runner_id))
    return r[0] if r else None


def is_member(club_id, runner_id):
    m = membership(club_id, runner_id)
    return bool(m and m["status"] == "approved")


def is_captain(club_id, runner_id):
    m = membership(club_id, runner_id)
    return bool(m and m["status"] == "approved" and m["role"] == "captain")


def captain_of(club_id):
    r = rows("""SELECT r.id, r.name FROM memberships m JOIN runners r ON r.id=m.runner_id
                WHERE m.club_id=? AND m.role='captain' AND m.status='approved' LIMIT 1""", (club_id,))
    return r[0] if r else None


def members(club_id, status="approved"):
    return rows("""SELECT r.id, r.name, r.pace, r.usual_miles, r.color, m.role, m.note, m.updated_at
                   FROM memberships m JOIN runners r ON r.id=m.runner_id
                   WHERE m.club_id=? AND m.status=? ORDER BY m.role='captain' DESC, r.name""",
                (club_id, status))


def my_memberships(runner_id):
    return rows("SELECT club_id, role, status FROM memberships WHERE runner_id=?", (runner_id,))


# ---------- tonight's run: check-ins, messages, plans, events ----------

def reset_run(club_id):
    for t in ("checkins", "messages", "plans", "events"):
        run(f"DELETE FROM {t} WHERE club_id=?", (club_id,))


def upsert_checkin(club_id, runner_id, status, miles=None, pace=None, guests=0, note=""):
    base = runner(runner_id)
    if not base:
        raise ValueError("unknown runner")
    miles = miles if miles else base["usual_miles"]
    pace = pace if pace else base["pace"]
    run(
        """INSERT INTO checkins (club_id,runner_id,status,miles,pace,guests,note,updated_at)
           VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(club_id,runner_id) DO UPDATE SET status=excluded.status, miles=excluded.miles,
             pace=excluded.pace, guests=excluded.guests, note=excluded.note,
             updated_at=excluded.updated_at""",
        (club_id, runner_id, status, float(miles), float(pace), int(guests or 0), note or "", time.time()),
    )


def checkins(club_id):
    return rows(
        """SELECT c.*, r.name, r.color FROM checkins c JOIN runners r ON r.id=c.runner_id
           WHERE c.club_id=? ORDER BY c.pace""", (club_id,))


def add_message(club_id, author, text, kind="chat", runner_id=None, to_runner=None):
    return run(
        "INSERT INTO messages (club_id,runner_id,author,kind,text,to_runner,created_at) VALUES (?,?,?,?,?,?,?)",
        (club_id, runner_id, author, kind, text, to_runner, time.time()),
    )


def messages(club_id, after_id=0):
    return rows("SELECT * FROM messages WHERE club_id=? AND id>? ORDER BY id", (club_id, after_id))


def nudged(club_id):
    return {r["to_runner"] for r in rows("SELECT to_runner FROM messages WHERE club_id=? AND kind='nudge'",
                                         (club_id,))}


def save_plan(club_id, plan, reason):
    run("INSERT INTO plans (club_id,plan_json,reason,created_at) VALUES (?,?,?,?)",
        (club_id, json.dumps(plan), reason, time.time()))


def latest_plan(club_id):
    r = rows("SELECT * FROM plans WHERE club_id=? ORDER BY id DESC LIMIT 1", (club_id,))
    if not r:
        return None
    p = json.loads(r[0]["plan_json"])
    p["reason"] = r[0]["reason"]
    p["version"] = plan_count(club_id)
    return p


def plan_count(club_id):
    return rows("SELECT COUNT(*) AS n FROM plans WHERE club_id=?", (club_id,))[0]["n"]


def log_event(club_id, agent, kind, detail, tokens_in=0, tokens_out=0, cost=0.0):
    if not isinstance(detail, str):
        detail = json.dumps(detail)
    run(
        """INSERT INTO events (club_id,agent,kind,detail,tokens_in,tokens_out,cost,created_at)
           VALUES (?,?,?,?,?,?,?,?)""",
        (club_id, agent, kind, detail[:4000], tokens_in, tokens_out, cost, time.time()),
    )


def events(club_id, after_id=0):
    return rows("SELECT * FROM events WHERE club_id=? AND id>? ORDER BY id", (club_id, after_id))


def token_totals(club_id=None):
    where, args = ("WHERE club_id=?", (club_id,)) if club_id is not None else ("", ())
    by_agent = rows(
        f"""SELECT agent, SUM(tokens_in) AS tin, SUM(tokens_out) AS tout, SUM(cost) AS cost,
                  SUM(CASE WHEN kind='llm' THEN 1 ELSE 0 END) AS calls
           FROM events {where} GROUP BY agent""", args)
    total = rows(f"SELECT COALESCE(SUM(tokens_in),0) AS tin, COALESCE(SUM(tokens_out),0) AS tout, "
                 f"COALESCE(SUM(cost),0) AS cost FROM events {where}", args)[0]
    return {"by_agent": by_agent, "total": total}
