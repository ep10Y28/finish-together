"""Safety layer: checks on what comes in and what goes out.

1. Prompt injection: flagged before it reaches a model, and the Concierge has no tool
   that can see private fields, so even a missed attack has nothing to leak.
2. Leaks: anything that looks like a phone number or email is scrubbed from agent replies.
3. Spam and runaway cost: a per-runner chat limit and a message length cap.
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


def check_incoming(runner_id, text):
    """Returns (ok, reason). Logs every block so the report can show the defenses working."""
    if len(text) > config.MAX_MESSAGE_CHARS:
        db.log_event("Safety", "blocked", {"runner": runner_id, "why": "message too long"})
        return False, f"Messages are capped at {config.MAX_MESSAGE_CHARS} characters."
    now = time.time()
    q = _recent[runner_id]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= config.CHAT_LIMIT_PER_MINUTE:
        db.log_event("Safety", "blocked", {"runner": runner_id, "why": "rate limit"})
        return False, "Easy there. Give it a minute before the next message."
    q.append(now)
    low = text.lower()
    for p in INJECTION_PATTERNS:
        if re.search(p, low):
            db.log_event("Safety", "blocked", {"runner": runner_id, "why": "possible prompt injection",
                                               "pattern": p, "text": text[:200]})
            return False, ("I can only help with tonight's run: checking in, pace, distance and "
                           "who's going. I can't share anyone's contact details.")
    return True, ""


def scrub_outgoing(agent, text):
    cleaned = PHONE.sub("[hidden]", text)
    cleaned = EMAIL.sub("[hidden]", cleaned)
    if cleaned != text:
        db.log_event("Safety", "scrubbed", {"agent": agent, "why": "contact details removed from reply"})
    return cleaned
