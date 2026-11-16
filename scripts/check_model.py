"""Check the model connection: python3 scripts/check_model.py

Makes a plain call and a tool call in each API style and prints what the service says.
It never prints your key. Use it when the app shows "Model call failed".
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config, llm  # noqa: E402

if config.MODE == "demo":
    sys.exit("No PORTKEY_API_KEY or OPENAI_API_KEY found in .env, so the app runs in demo mode.")
print(f"Mode: {config.MODE}, model: {llm._model()}, style setting: {config.API_STYLE}")
ping = llm.tool("ping", "Call this once, then say done.")
msgs = [{"role": "user", "content": "Call the ping tool once, then reply with the word done."}]
for style, fn in (("responses", llm._responses), ("chat", llm._chat)):
    for label, tools in (("plain", None), ("tool call", [ping])):
        try:
            out = fn(msgs if tools else [{"role": "user", "content": "Say hi in two words."}], tools)
            got = f"tool {out['calls'][0]['name']}" if out["calls"] else repr(out["text"][:40])
            print(f"OK    {style:9} {label:9} -> {got}, {out['tin']} in / {out['tout']} out tokens")
        except Exception as e:
            print(f"FAIL  {style:9} {label:9} -> {str(e)[:300]}")
