"""Deterministic planning tools. The agents decide; these do the math.

Keeping the arithmetic out of the model makes the finish times trustworthy
and keeps token use low.
"""
import itertools
import json
import statistics

from . import config

_ROUTES = json.loads((config.DATA_DIR / "routes.json").read_text())
LOOPS = _ROUTES["loops"]
START = _ROUTES["start"]
LOOP_BY_ID = {l["id"]: l for l in LOOPS}


def fmt_pace(p):
    m = int(p)
    s = round((p - m) * 60)
    if s == 60:
        m, s = m + 1, 0
    return f"{m}:{s:02d}"


def clock(minutes_after_start):
    h, m = map(int, config.RUN_START.split(":"))
    total = h * 60 + m + round(minutes_after_start)
    hh, mm = divmod(total, 60)
    suffix = "PM" if hh >= 12 else "AM"
    hh12 = hh - 12 if hh > 12 else hh
    return f"{hh12}:{mm:02d} {suffix}"


def _headcount(c):
    return 1 + int(c.get("guests") or 0)


def make_groups(checkins, max_spread=config.MAX_PACE_SPREAD):
    """Cluster runners who said yes into pace groups. No one runs alone."""
    max_spread = max(0.4, min(float(max_spread), 1.5))
    going = sorted([c for c in checkins if c["status"] == "in"], key=lambda c: c["pace"])
    groups = []
    for c in going:
        if groups and c["pace"] - groups[-1][0]["pace"] <= max_spread:
            groups[-1].append(c)
        else:
            groups.append([c])

    # Merge groups that are too small into the nearest group by pace.
    changed = True
    while changed and len(groups) > 1:
        changed = False
        for i, g in enumerate(groups):
            if sum(_headcount(c) for c in g) < config.MIN_GROUP_SIZE:
                if i == 0:
                    j = 1
                elif i == len(groups) - 1:
                    j = i - 1
                else:
                    left = g[0]["pace"] - groups[i - 1][-1]["pace"]
                    right = groups[i + 1][0]["pace"] - g[-1]["pace"]
                    j = i - 1 if left <= right else i + 1
                groups[j] = sorted(groups[j] + g, key=lambda c: c["pace"])
                groups.pop(i)
                changed = True
                break

    out = []
    for i, g in enumerate(groups):
        group_pace = max(c["pace"] for c in g)          # the group runs at its slowest member's pace
        out.append({
            "id": i + 1,
            "pace": round(group_pace, 2),
            "pace_label": f"{fmt_pace(g[0]['pace'])}-{fmt_pace(group_pace)}/mi",
            "members": [{"id": c["runner_id"], "name": c["name"], "color": c.get("color"),
                         "miles": c["miles"], "pace": c["pace"], "guests": c.get("guests") or 0}
                        for c in g],
            "headcount": sum(_headcount(c) for c in g),
            "wanted_miles": round(statistics.median(c["miles"] for c in g), 1),
        })
    return out


def _best_combo(ideal_miles):
    best = None
    for n in range(1, 5):
        for combo in itertools.combinations_with_replacement(LOOPS, n):
            miles = sum(l["miles"] for l in combo)
            score = abs(miles - ideal_miles) + 0.04 * n
            if best is None or score < best[0]:
                best = (score, combo, miles)
    return list(best[1]), round(best[2], 2)


def default_target(groups):
    natural = [g["wanted_miles"] * g["pace"] for g in groups]
    t = statistics.median(natural)
    return int(max(25, min(80, round(t / 5) * 5)))


def build_routes(groups, target_minutes=None):
    """Give every group loops so that all groups get back at about the same time."""
    if not groups:
        return {"groups": [], "target_minutes": None, "spread_minutes": 0, "conflicts": []}
    target = int(target_minutes) if target_minutes else default_target(groups)
    target = max(20, min(100, target))
    planned = []
    for g in groups:
        loops, miles = _best_combo(target / g["pace"])
        planned.append(_with_route(g, [l["id"] for l in loops]))
    return finish(planned, target)


def _with_route(group, loop_ids):
    loops = [LOOP_BY_ID[i] for i in loop_ids if i in LOOP_BY_ID]
    miles = round(sum(l["miles"] for l in loops), 2)
    minutes = round(miles * group["pace"], 1)
    g = dict(group)
    g.update({
        "loops": [{"id": l["id"], "name": l["name"], "miles": l["miles"]} for l in loops],
        "miles": miles,
        "minutes": minutes,
        "back_at": clock(minutes),
    })
    return g


def finish(planned, target):
    times = [g["minutes"] for g in planned]
    conflicts = []
    for g in planned:
        for m in g["members"]:
            if abs(m["miles"] - g["miles"]) >= 1.5:
                conflicts.append({"runner_id": m["id"], "name": m["name"], "group": g["id"],
                                  "wanted_miles": m["miles"], "group_miles": g["miles"]})
    return {
        "groups": planned,
        "target_minutes": target,
        "back_at": clock(statistics.median(times)),
        "spread_minutes": round(max(times) - min(times), 1),
        "conflicts": conflicts,
    }


def swap_loops(plan, group_id, loop_ids):
    """Let the Route Builder hand-pick loops for one group, then re-check the math."""
    bad = [i for i in loop_ids if i not in LOOP_BY_ID]
    if bad:
        return None, f"Unknown loop ids: {bad}"
    groups = [(_with_route(g, loop_ids) if g["id"] == group_id else g) for g in plan["groups"]]
    return finish(groups, plan["target_minutes"]), None


def verify_plan(plan, tolerance_minutes=6):
    """Recompute every number from the loop library. Rejects a plan whose numbers don't add up
    or whose groups would come back too far apart."""
    errors = []
    for g in plan.get("groups", []):
        real_miles = round(sum(LOOP_BY_ID[l["id"]]["miles"] for l in g["loops"]), 2)
        if abs(real_miles - g["miles"]) > 0.01:
            errors.append(f"Group {g['id']}: says {g['miles']} mi, loops add up to {real_miles} mi")
        real_min = round(real_miles * g["pace"], 1)
        if abs(real_min - g["minutes"]) > 0.5:
            errors.append(f"Group {g['id']}: says {g['minutes']} min, math says {real_min}")
    if plan.get("groups") and plan.get("spread_minutes", 0) > tolerance_minutes:
        errors.append(f"Groups come back {plan['spread_minutes']} min apart, limit is {tolerance_minutes}")
    return {"ok": not errors, "errors": errors}


def loop_library():
    return LOOPS
