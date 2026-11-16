"""Print tokens and cost per agent for one club's current run, for the report's Tokenomics table.

Run from the repo folder after "Play the evening":  python3 scripts/token_report.py [club-slug]
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import config, db  # noqa: E402

slug = sys.argv[1] if len(sys.argv) > 1 else "last-lap"
club = db.club(slug)
if not club:
    sys.exit(f"No club called {slug}.")
t = db.token_totals(club["id"])
print(f"Model: {config.PORTKEY_MODEL if config.MODE == 'portkey' else config.OPENAI_MODEL if config.MODE == 'openai' else 'none (demo mode)'}")
print(f"{'Agent':<16}{'Calls':>7}{'Tokens in':>12}{'Tokens out':>12}{'Cost':>10}")
for a in sorted(t["by_agent"], key=lambda r: -(r["tin"] or 0)):
    if a["tin"] or a["tout"]:
        print(f"{a['agent']:<16}{a['calls'] or 0:>7}{a['tin'] or 0:>12,}{a['tout'] or 0:>12,}{a['cost'] or 0:>10.4f}")
tot = t["total"]
print(f"{'Total':<16}{'':>7}{tot['tin']:>12,}{tot['tout']:>12,}{tot['cost']:>10.4f}")
