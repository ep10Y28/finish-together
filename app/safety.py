"""Safety layer: checks on what comes in and what goes out.

1. Prompt injection: flagged before it reaches a model, and the Concierge has no tool
   that can see private fields, so even a missed attack has nothing to leak.
2. Leaks: anything that looks like a phone number or email is scrubbed from agent replies.
3. Spam and runaway cost: a per-runner chat limit and a message length cap.
4. Names, join notes and club settings get the same injection screen, because they
   end up inside agent prompts too.
"""
import re
import time
from collections import defaultdict, deque

from . import config, db

INJECTION_PATTERNS = [
    r"ignore (all |your |the |previous |prior )*(instructions|rules|prompt)",
    r"system prompt",
    r"you are now",
    r"developer mode",
    r"(phone|cell|number|address|email)s? (of|for) (everyone|all|every)",
    r"(show|list|give|send|dump).{0,30}(phone|numbers|emails|addresses|database|db)",
    r"(drop|delete) (table|the database)",
]
PHONE = re.compile(r"\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b")
EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b")

_recent = defaultdict(deque)


def check_incoming(club_id, runner_id, text):
    """Returns (ok, reason). Logs every block so the report can show the defenses working."""
    if len(text) > config.MAX_MESSAGE_CHARS:
        db.log_event(club_id, "Safety", "blocked", {"runner": runner_id, "why": "message too long"})
        return False, f"Messages are capped at {config.MAX_MESSAGE_CHARS} characters."
    now = time.time()
    q = _recent[runner_id]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= config.CHAT_LIMIT_PER_MINUTE:
        db.log_event(club_id, "Safety", "blocked", {"runner": runner_id, "why": "rate limit"})
        return False, "Easy there. Give it a minute before the next message."
    q.append(now)
    p = looks_like_injection(text)
    if p:
        db.log_event(club_id, "Safety", "blocked", {"runner": runner_id, "why": "possible prompt injection",
                                                    "pattern": p, "text": text[:200]})
        return False, ("I can only help with tonight's run: checking in, pace, distance and "
                       "who's going. I can't share anyone's contact details.")
    return True, ""


def looks_like_injection(text):
    low = (text or "").lower()
    return next((p for p in INJECTION_PATTERNS if re.search(p, low)), None)


def check_field(label, text, max_chars, club_id=None):
    """Screen a name, join note or club setting. Returns (ok, reason)."""
    text = (text or "").strip()
    if len(text) > max_chars:
        return False, f"{label} is capped at {max_chars} characters."
    p = looks_like_injection(text)
    if p:
        db.log_event(club_id, "Safety", "blocked", {"runner": None, "pattern": p, "text": text[:200],
                                                    "why": f"{label.lower()} looked like a prompt injection"})
        return False, f"That {label.lower()} can't be used. Please keep it to plain words."
    return True, ""


def scrub_outgoing(club_id, agent, text):
    cleaned = PHONE.sub("[hidden]", text)
    cleaned = EMAIL.sub("[hidden]", cleaned)
    if cleaned != text:
        db.log_event(club_id, "Safety", "scrubbed", {"agent": agent, "why": "contact details removed from reply"})
    return cleaned
