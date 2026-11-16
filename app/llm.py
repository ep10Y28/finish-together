"""A small agent loop on the chat-completions API with tool calling.

Written by hand (no agent framework) so that every model call is logged with its
token counts and cost, and so the spending limits sit in one place.
"""
import json

import httpx

from . import config, db


class BudgetExceeded(Exception):
    pass


def spent_tokens(club_id):
    t = db.token_totals(club_id)["total"]
    return int(t["tin"]) + int(t["tout"])


def _request(messages, tools):
    body = {"model": config.PORTKEY_MODEL if config.MODE == "portkey" else config.OPENAI_MODEL,
            "messages": messages}
    if tools:
        body["tools"] = tools
    if config.MODE == "portkey":
        url = config.PORTKEY_URL
        headers = {"x-portkey-api-key": config.PORTKEY_API_KEY, "Content-Type": "application/json"}
    else:
        url = config.OPENAI_URL
        headers = {"Authorization": f"Bearer {config.OPENAI_API_KEY}", "Content-Type": "application/json"}
    r = httpx.post(url, headers=headers, json=body, timeout=60)
    r.raise_for_status()
    return r.json()


def cost_of(tin, tout):
    return tin / 1e6 * config.PRICE_INPUT_PER_M + tout / 1e6 * config.PRICE_OUTPUT_PER_M


def run_agent(club_id, agent, system, user, tools, handlers):
    """Run one agent until it answers without calling a tool.

    club_id: whose run this is (the token budget is per club, per evening).
    tools: OpenAI-style tool schemas. handlers: name -> python function(**args) -> result.
    Returns the agent's final text.
    """
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    for step in range(config.MAX_TOOL_STEPS):
        if spent_tokens(club_id) >= config.RUN_TOKEN_BUDGET:
            db.log_event(club_id, agent, "guard", f"Token budget of {config.RUN_TOKEN_BUDGET:,} reached; stopped.")
            raise BudgetExceeded(agent)
        data = _request(messages, tools)
        usage = data.get("usage") or {}
        tin, tout = int(usage.get("prompt_tokens", 0)), int(usage.get("completion_tokens", 0))
        msg = data["choices"][0]["message"]
        calls = msg.get("tool_calls") or []
        db.log_event(club_id, agent, "llm",
                     {"step": step + 1, "tool_calls": [c["function"]["name"] for c in calls],
                      "said": (msg.get("content") or "")[:300]},
                     tin, tout, cost_of(tin, tout))
        if not calls:
            return msg.get("content") or ""
        messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
        for c in calls:
            name = c["function"]["name"]
            try:
                args = json.loads(c["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            fn = handlers.get(name)
            if fn is None:
                result = {"error": f"no such tool {name}"}
            else:
                try:
                    result = fn(**args)
                except Exception as e:  # tool errors go back to the model, not to the user
                    result = {"error": str(e)}
            db.log_event(club_id, agent, "tool", {"tool": name, "args": args, "result": _short(result)})
            messages.append({"role": "tool", "tool_call_id": c["id"],
                             "content": json.dumps(result, default=str)[:6000]})
    db.log_event(club_id, agent, "guard", f"Stopped after {config.MAX_TOOL_STEPS} steps.")
    return ""


def _short(x):
    s = json.dumps(x, default=str)
    return s if len(s) < 600 else s[:600] + "..."


def tool(name, description, properties=None, required=None):
    return {"type": "function", "function": {
        "name": name, "description": description,
        "parameters": {"type": "object", "properties": properties or {}, "required": required or []}}}
