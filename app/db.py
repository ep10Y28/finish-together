"""SQLite storage. One file, created and seeded on first start."""
import json
import sqlite3
import threading
import time
from contextlib import contextmanager

from . import config

_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS runners (
  id INTEGER PRIMARY KEY, name TEXT, pace REAL, usual_miles REAL,
  color TEXT, phone TEXT, bio TEXT
);
CREATE TABLE IF NOT EXISTS checkins (
  runner_id INTEGER PRIMARY KEY, status TEXT, miles REAL, pace REAL,
  guests INTEGER DEFAULT 0, note TEXT, updated_at REAL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, runner_id INTEGER, author TEXT,
  kind TEXT, text TEXT, to_runner INTEGER, created_at REAL
);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT, plan_json TEXT, reason TEXT, created_at REAL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT, kind TEXT, detail TEXT,
  tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, cost REAL DEFAULT 0,
  created_at REAL
);
"""


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


def init(reset: bool = False):
    if reset and config.DB_PATH.exists():
        config.DB_PATH.unlink()
    with conn() as c:
        c.executescript(SCHEMA)
        if c.execute("SELECT COUNT(*) FROM runners").fetchone()[0] == 0:
            runners = json.loads((config.DATA_DIR / "runners.json").read_text())
            c.executemany(
                "INSERT INTO runners VALUES (:id,:name,:pace,:usual_miles,:color,:phone,:bio)",
                runners,
            )


def rows(sql, args=()):
    with conn() as c:
        return [dict(r) for r in c.execute(sql, args).fetchall()]


def run(sql, args=()):
    with conn() as c:
        cur = c.execute(sql, args)
        return cur.lastrowid


# ---------- runners and check-ins ----------

def public_roster():
    """Public fields only. Phone numbers never leave this module."""
    return rows("SELECT id, name, pace, usual_miles, color, bio FROM runners ORDER BY name")


def runner(runner_id):
    r = rows("SELECT id, name, pace, usual_miles, color, bio FROM runners WHERE id=?", (runner_id,))
    return r[0] if r else None


def upsert_checkin(runner_id, status, miles=None, pace=None, guests=0, note=""):
    base = runner(runner_id)
    if not base:
        raise ValueError("unknown runner")
    miles = miles if miles else base["usual_miles"]
    pace = pace if pace else base["pace"]
    run(
        """INSERT INTO checkins (runner_id,status,miles,pace,guests,note,updated_at)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(runner_id) DO UPDATE SET status=excluded.status, miles=excluded.miles,
             pace=excluded.pace, guests=excluded.guests, note=excluded.note,
             updated_at=excluded.updated_at""",
        (runner_id, status, float(miles), float(pace), int(guests or 0), note or "", time.time()),
    )


def checkins():
    return rows(
        """SELECT c.*, r.name, r.color FROM checkins c JOIN runners r ON r.id=c.runner_id
           ORDER BY c.pace"""
    )


# ---------- messages, plans, events ----------

def add_message(author, text, kind="chat", runner_id=None, to_runner=None):
    return run(
        "INSERT INTO messages (runner_id,author,kind,text,to_runner,created_at) VALUES (?,?,?,?,?,?)",
        (runner_id, author, kind, text, to_runner, time.time()),
    )


def messages(after_id=0):
    return rows("SELECT * FROM messages WHERE id>? ORDER BY id", (after_id,))


def save_plan(plan, reason):
    run("INSERT INTO plans (plan_json,reason,created_at) VALUES (?,?,?)",
        (json.dumps(plan), reason, time.time()))


def latest_plan():
    r = rows("SELECT * FROM plans ORDER BY id DESC LIMIT 1")
    if not r:
        return None
    p = json.loads(r[0]["plan_json"])
    p["reason"] = r[0]["reason"]
    p["version"] = rows("SELECT COUNT(*) AS n FROM plans")[0]["n"]
    return p


def plan_count():
    return rows("SELECT COUNT(*) AS n FROM plans")[0]["n"]


def log_event(agent, kind, detail, tokens_in=0, tokens_out=0, cost=0.0):
    if not isinstance(detail, str):
        detail = json.dumps(detail)
    run(
        "INSERT INTO events (agent,kind,detail,tokens_in,tokens_out,cost,created_at) VALUES (?,?,?,?,?,?,?)",
        (agent, kind, detail[:4000], tokens_in, tokens_out, cost, time.time()),
    )


def events(after_id=0):
    return rows("SELECT * FROM events WHERE id>? ORDER BY id", (after_id,))


def token_totals():
    by_agent = rows(
        """SELECT agent, SUM(tokens_in) AS tin, SUM(tokens_out) AS tout, SUM(cost) AS cost,
                  SUM(CASE WHEN kind='llm' THEN 1 ELSE 0 END) AS calls
           FROM events GROUP BY agent"""
    )
    total = rows("SELECT COALESCE(SUM(tokens_in),0) AS tin, COALESCE(SUM(tokens_out),0) AS tout, "
                 "COALESCE(SUM(cost),0) AS cost FROM events")[0]
    return {"by_agent": by_agent, "total": total}
