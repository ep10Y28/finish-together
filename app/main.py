"""FastAPI backend: serves the page and the JSON the page polls."""
import json
import threading
import time

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import agents, config, db, tools

app = FastAPI(title="Finish Together")


def open_evening():
    """Fresh evening: clear tonight's data, load the opening check-ins, post the first plan."""
    db.init(reset=True)
    opening = json.loads((config.DATA_DIR / "opening.json").read_text())
    for c in opening["checkins"]:
        db.upsert_checkin(c["runner_id"], c["status"], guests=c.get("guests", 0))
    db.add_message("Captain",
                   f"Tonight's run: {tools.clock(0)} from {tools.START}. "
                   "Tell me if you're in, how far and how fast, and I'll make sure every group "
                   "gets back at the same time.", "plan")
    agents._last_signature["value"] = None
    state = {"groups": [], "plan": None, "verified": False, "posted": False}
    agents.rule_captain(state, "Opening plan")
    agents._last_signature["value"] = agents.in_signature()


@app.on_event("startup")
def startup():
    db.init()
    if not db.latest_plan():
        open_evening()


class Chat(BaseModel):
    runner_id: int
    text: str


class CheckIn(BaseModel):
    runner_id: int
    status: str
    miles: float | None = None
    pace: str | None = None
    guests: int = 0


@app.get("/api/state")
def state(after_msg: int = 0, after_event: int = 0):
    return {
        "mode": config.MODE,
        "model": config.PORTKEY_MODEL if config.MODE == "portkey" else config.OPENAI_MODEL,
        "start": tools.START,
        "roster": db.public_roster(),
        "checkins": db.checkins(),
        "plan": db.latest_plan(),
        "messages": db.messages(after_msg),
        "events": db.events(after_event),
        "tokens": db.token_totals(),
        "limits": {"run_token_budget": config.RUN_TOKEN_BUDGET,
                   "max_replans": config.MAX_REPLANS_PER_RUN,
                   "price_in_per_m": config.PRICE_INPUT_PER_M,
                   "price_out_per_m": config.PRICE_OUTPUT_PER_M},
    }


@app.post("/api/chat")
def chat(body: Chat):
    if not db.runner(body.runner_id):
        raise HTTPException(404, "unknown runner")
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "empty message")
    reply = agents.concierge(body.runner_id, text)
    return {"reply": reply}


@app.post("/api/checkin")
def checkin(body: CheckIn):
    me = db.runner(body.runner_id)
    if not me or body.status not in ("in", "maybe", "out"):
        raise HTTPException(400, "bad check-in")
    db.upsert_checkin(body.runner_id, body.status, body.miles, agents.parse_pace(body.pace), body.guests)
    label = {"in": "is in", "maybe": "is a maybe", "out": "is out tonight"}[body.status]
    db.add_message(me["name"], f"{me['name'].split()[0]} {label}.", "checkin", runner_id=body.runner_id)
    threading.Thread(target=agents.captain, args=(f"{me['name']} tapped {body.status}",), daemon=True).start()
    return {"ok": True}


@app.post("/api/replan")
def replan():
    threading.Thread(target=agents.captain, args=("Manual re-plan", True), daemon=True).start()
    return {"ok": True}


_sim = {"running": False}


@app.post("/api/simulate")
def simulate():
    if _sim["running"]:
        return {"ok": False, "why": "already running"}
    steps = json.loads((config.DATA_DIR / "sim_script.json").read_text())["steps"]

    def go():
        _sim["running"] = True
        try:
            for s in steps:
                agents.concierge(s["runner_id"], s["text"])
                time.sleep(3.5 if config.MODE == "demo" else 1.0)
                with agents._captain_lock:   # let the Captain finish before the next message
                    pass
        finally:
            _sim["running"] = False

    threading.Thread(target=go, daemon=True).start()
    return {"ok": True, "steps": len(steps)}


@app.post("/api/reset")
def reset():
    open_evening()
    return {"ok": True}


@app.get("/api/loops")
def loops():
    return tools.loop_library()


app.mount("/static", StaticFiles(directory=config.WEB_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(config.WEB_DIR / "index.html")
