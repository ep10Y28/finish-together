"""Settings for Finish Together.

Only two secrets are ever read from the environment, as the course requires:
PORTKEY_API_KEY (course key, model gpt-6-luna) or OPENAI_API_KEY (your own key).
Everything else lives here so the grader never has to set anything else.
"""
from pathlib import Path
import os

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent          # the repo folder
DATA_DIR = ROOT / "data"
WEB_DIR = ROOT / "web"
DB_PATH = ROOT / "finish_together.db"

# The course rule: look for .env in the repo folder first, then one level up.
for candidate in (ROOT / ".env", ROOT.parent / ".env"):
    if candidate.exists():
        load_dotenv(candidate, override=False)
        ENV_FILE = str(candidate)
        break
else:
    ENV_FILE = None

PORTKEY_API_KEY = os.getenv("PORTKEY_API_KEY", "").strip()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()

# Course setup: Portkey's OpenAI-compatible endpoint, key only in the
# x-portkey-api-key header (no Authorization header).
PORTKEY_BASE = "https://api.portkey.ai/v1"
PORTKEY_MODEL = os.getenv("PORTKEY_MODEL", "").strip() or "gpt-6-luna"

OPENAI_BASE = "https://api.openai.com/v1"
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "").strip() or "gpt-6-luna"

# gpt-6-luna won't take tool calls on chat completions while it reasons, so the agents use the
# Responses API (reasoning kept, set low) and fall back to chat completions with reasoning off.
# Optional, not secret: API_STYLE=responses or chat in .env pins one style.
API_STYLE = os.getenv("API_STYLE", "auto").strip().lower()
REASONING_EFFORT = "low"

if PORTKEY_API_KEY:
    MODE = "portkey"
elif OPENAI_API_KEY:
    MODE = "openai"
else:
    MODE = "demo"   # no key: agents fall back to rule-based logic so the app still runs

# Prices in US dollars per 1M tokens. Used for the cost meter and the report.
# Confirm these against the course's posted gpt-6-luna prices before quoting them.
PRICE_INPUT_PER_M = 1.25
PRICE_OUTPUT_PER_M = 10.00

# Safety and spending limits
RUN_TOKEN_BUDGET = 150_000      # all agents combined, per run (one evening); the scripted demo evening uses about 60,000
MAX_REPLANS_PER_RUN = 12        # the Run Director stops re-planning after this
MAX_TOOL_STEPS = 8              # per agent call, stops loops
CHAT_LIMIT_PER_MINUTE = 6       # per runner
MAX_MESSAGE_CHARS = 400

MAX_NAME_CHARS = 40
MAX_CLUB_FIELD_CHARS = 80

# Planning rules
MAX_PACE_SPREAD = 0.9           # minutes per mile inside one pace group
MIN_GROUP_SIZE = 2              # no one runs alone
ROUTE_STEP_MILES = 0.25         # group distances are rounded to quarter miles
MAX_FINISH_SPREAD = 6           # minutes; a plan whose groups come back further apart is rejected
DEFAULT_TARGET_MINUTES = 45

# App Admin and the Improvement Scout
APP_ADMIN_IDS = {25}            # demo App Admin: Rae Simmons (also Last Lap's captain)
SCOUT_EVERY_MINUTES = 30        # the Scout also runs on demand from the Admin page
SCOUT_TOKEN_BUDGET = 30_000     # per day, separate from the clubs' run budgets
