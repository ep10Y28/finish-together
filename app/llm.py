"""A small agent loop with tool calling, on the Responses API or chat completions.

Written by hand (no agent framework) so that every model call is logged with its
token counts and cost, and so the spending limits sit in one place.
"""
import json

import httpx

from . import config, db


class BudgetExceeded(Exception):
    pass


def spent_tokens(club_id):
    if club_id is None:                      # the Improvement Scout has its own daily budget
        return db.scout_tokens_today()
    t = db.token_totals(club_id)["total"]
    return int(t["tin"]) + int(t["tout"])


class ModelError(Exception):
    """The model service said no. The message carries its status and reason (never the key)."""


# gpt-6-luna through Portkey rejects tool calls on chat completions while reasoning is on
# (found in an earlier homework). Two styles work: the Responses API with reasoning, or chat
# completions with reasoning turned off. "auto" tries Responses first and remembers what worked.
_style = {"now": None}


def _styles():
    want = config.API_STYLE
    if want in ("responses", "chat"):
        return [want]
    first = _style["now"] or "responses"
    return [first, "chat" if first == "responses" else "responses"]


def _post(url, body):
    if config.MODE == "portkey":
        headers = {"x-portkey-api-key": config.PORTKEY_API_KEY, "Content-Type": "application/json"}
    else:
        headers = {"Authorization": f"Bearer {config.OPENAI_API_KEY}", "Content-Type": "application/json"}
    r = httpx.post(url, headers=headers, json=body, timeout=90)
    if r.status_code >= 400:
        raise ModelError(f"{r.status_code} from {url.split('/v1/')[-1]}: {r.text[:500]}")
    return r.json()


def _model():
    return config.PORTKEY_MODEL if config.MODE == "portkey" else config.OPENAI_MODEL


def _base():
    return config.PORTKEY_BASE if config.MODE == "portkey" else config.OPENAI_BASE


def _chat(messages, tools):
    body = {"model": _model(), "messages": messages, "reasoning_effort": "none"}
    if tools:
        body["tools"] = tools
    data = _post(_base() + "/chat/completions", body)
    msg = data["choices"][0]["message"]
    usage = data.get("usage") or {}
    calls = [{"id": c["id"], "name": c["function"]["name"], "arguments": c["function"].get("arguments") or "{}"}
             for c in (msg.get("tool_calls") or [])]
    return {"text": msg.get("content") or "", "calls": calls,
            "tin": int(usage.get("prompt_tokens", 0)), "tout": int(usage.get("completion_tokens", 0))}


def _to_input(messages):
    """Our chat-style history as Responses API input items."""
    items = []
    for m in messages:
        if m["role"] == "tool":
            items.append({"type": "function_call_output", "call_id": m["tool_call_id"], "output": m["content"]})
        elif m["role"] == "assistant":
            if m.get("content"):
                items.append({"role": "assistant", "content": m["content"]})
            for c in m.get("tool_calls") or []:
                items.append({"type": "function_call", "call_id": c["id"], "name": c["function"]["name"],
                              "arguments": c["function"].get("arguments") or "{}"})
        else:
            items.append({"role": m["role"], "content": m["content"]})
    return items


def _responses(messages, tools):
    body = {"model": _model(), "input": _to_input(messages), "reasoning": {"effort": config.REASONING_EFFORT}}
    if tools:
        body["tools"] = [{"type": "function", **t["function"]} for t in tools]
    data = _post(_base() + "/responses", body)
    text, calls = [], []
    for item in data.get("output") or []:
        if item.get("type") == "function_call":
            calls.append({"id": item.get("call_id") or item.get("id"), "name": item["name"],
                          "arguments": item.get("arguments") or "{}"})
        elif item.get("type") == "message":
            text += [c.get("text", "") for c in item.get("content") or [] if c.get("type") in ("output_text", "text")]
    if not text and isinstance(data.get("output_text"), str):
        text = [data["output_text"]]
    usage = data.get("usage") or {}
    return {"text": "".join(text), "calls": calls,
            "tin": int(usage.get("input_tokens", 0)), "tout": int(usage.get("output_tokens", 0))}


def _request(messages, tools):
    """One model call. Returns {"text", "calls": [{id, name, arguments}], "tin", "tout"}."""
    errors = []
    for style in _styles():
        try:
            out = (_responses if style == "responses" else _chat)(messages, tools)
            _style["now"] = style
            return out
        except ModelError as e:
            errors.append(str(e))
            if str(e)[:3] not in ("400", "404", "405", "422"):   # a refused request shape: try the other way
                break
    raise ModelError(" | ".join(errors))


def cost_of(tin, tout):
    return tin / 1e6 * config.PRICE_INPUT_PER_M + tout / 1e6 * config.PRICE_OUTPUT_PER_M


def run_agent(club_id, agent, system, user, tools, handlers, budget=None):
    """Run one agent until it answers without calling a tool.

    club_id: whose run this is (the token budget is per club, per evening).
    tools: OpenAI-style tool schemas. handlers: name -> python function(**args) -> result.
    Returns the agent's final text.
    """
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    for step in range(config.MAX_TOOL_STEPS):
        limit = budget or config.RUN_TOKEN_BUDGET
        if spent_tokens(club_id) >= limit:
            db.log_event(club_id, agent, "guard", f"Token budget of {limit:,} reached; stopped.")
            raise BudgetExceeded(agent)
        out = _request(messages, tools)
        tin, tout, calls = out["tin"], out["tout"], out["calls"]
        db.log_event(club_id, agent, "llm",
                     {"step": step + 1, "tool_calls": [c["name"] for c in calls], "said": out["text"][:300]},
                     tin, tout, cost_of(tin, tout))
        if not calls:
            return out["text"]
        messages.append({"role": "assistant", "content": out["text"] or None,
                         "tool_calls": [{"id": c["id"], "type": "function",
                                         "function": {"name": c["name"], "arguments": c["arguments"]}}
                                        for c in calls]})
        for c in calls:
            name = c["name"]
            try:
                args = json.loads(c["arguments"] or "{}")
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
