"""Deterministic planning tools. The agents decide; these do the math.

Keeping the arithmetic out of the model makes the finish times trustworthy
and keeps token use low.

A club sets its run either by time ("45 minutes for everyone") or by distance
("5 miles for the middle group"). Either way the tools turn it into one target
time, and every pace group gets a distance that brings it back to the start at
that time: faster groups run farther.
"""
import math
import statistics

from . import config

STEP = config.ROUTE_STEP_MILES


def fmt_pace(p):
    m = int(p)
    s = round((p - m) * 60)
    if s == 60:
        m, s = m + 1, 0
    return f"{m}:{s:02d}"


def clock(minutes_after_start, run_time="18:30"):
    h, m = map(int, run_time.split(":"))
    total = h * 60 + m + round(minutes_after_start)
    hh, mm = divmod(total % (24 * 60), 60)
    suffix = "PM" if hh >= 12 else "AM"
    hh12 = hh - 12 if hh > 12 else (12 if hh == 0 else hh)
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


STREET_FACTOR = 1.25     # streets are longer than a straight line; the map shows the real distance


def straight_miles(a_lat, a_lng, b_lat, b_lng):
    r = 3958.8
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def is_point_to_point(club):
    return club.get("end_lat") is not None and club.get("end_lng") is not None


def min_miles(club):
    """Shortest distance any group can run. A loop can be as short as we like (1 mile floor);
    a point-to-point run has to at least reach the finish."""
    if not is_point_to_point(club):
        return 1.0
    d = straight_miles(club["start_lat"], club["start_lng"], club["end_lat"], club["end_lng"]) * STREET_FACTOR
    return max(1.0, math.ceil(d / STEP) * STEP)


def target_minutes(groups, club):
    """Turn the club's setting into one target time for everyone.

    time:      the club runs for N minutes.
    distance:  the middle pace group runs N miles; everyone else runs for the same time.
    """
    mode = club.get("target_mode") or "time"
    value = float(club.get("target_value") or config.DEFAULT_TARGET_MINUTES)
    if mode == "distance" and groups:
        mid = statistics.median_low([g["pace"] for g in groups])
        t = value * mid
    else:
        t = value
    return int(max(15, min(150, round(t))))


def _quarter(miles, floor=1.0):
    return max(floor, round(miles / STEP) * STEP)


def _with_route(group, miles, run_time):
    miles = round(float(miles), 2)
    minutes = round(miles * group["pace"], 1)
    g = dict(group)
    g.update({"miles": miles, "minutes": minutes, "back_at": clock(minutes, run_time)})
    return g


def _target_info(club, minutes, note=None):
    return {"mode": club.get("target_mode") or "time", "value": club.get("target_value"), "minutes": minutes,
            "note": note}


def _route_info(club):
    if is_point_to_point(club):
        return {"type": "point", "min_miles": min_miles(club),
                "end": {"name": club.get("end_name") or "Finish", "lat": club["end_lat"], "lng": club["end_lng"]}}
    return {"type": "loop", "min_miles": 1.0, "end": None}


def build_routes(groups, club):
    """Give every group a distance so that all groups get back at about the same time."""
    run_time = club.get("run_time", "18:30")
    if not groups:
        return {"groups": [], "target_minutes": None, "spread_minutes": 0, "conflicts": [],
                "target": _target_info(club, None), "run_time": run_time, "back_at": None,
                "route": _route_info(club)}
    target = target_minutes(groups, club)
    floor = min_miles(club)
    note = None
    slowest = max(g["pace"] for g in groups)
    if floor * slowest > target:
        # The finish is too far for the slowest group to reach in time: stretch the run for everyone.
        new = int(math.ceil(floor * slowest))
        note = (f"The finish is about {floor:g} miles away, so the run was stretched from {target} to "
                f"{new} minutes for the slowest group to make it.")
        target = new
    planned = [_with_route(g, _quarter(target / g["pace"], floor), run_time) for g in groups]
    return finish(planned, target, club, note)


def finish(planned, target, club, note=None):
    run_time = club.get("run_time", "18:30")
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
        "target": _target_info(club, target, note),
        "run_time": run_time,
        "route": _route_info(club),
        "back_at": clock(statistics.median(times), run_time),
        "spread_minutes": round(max(times) - min(times), 1),
        "conflicts": conflicts,
    }


def set_group_miles(plan, group_id, miles, club):
    """Let the Route Builder hand-set one group's distance, then re-check the math."""
    miles = float(miles)
    if not 1 <= miles <= 20:
        return None, "miles must be between 1 and 20"
    if miles < min_miles(club):
        return None, f"the finish is {min_miles(club):g} miles away; no group can run less than that"
    if not any(g["id"] == group_id for g in plan["groups"]):
        return None, f"no group {group_id}"
    groups = [(_with_route(g, _quarter(miles, min_miles(club)), club.get("run_time", "18:30"))
               if g["id"] == group_id else g) for g in plan["groups"]]
    return finish(groups, plan["target_minutes"], club, (plan.get("target") or {}).get("note")), None


def verify_plan(plan, tolerance_minutes=config.MAX_FINISH_SPREAD):
    """Recompute every number. Rejects a plan whose numbers don't add up
    or whose groups would come back too far apart."""
    errors = []
    floor = (plan.get("route") or {}).get("min_miles", 1.0)
    for g in plan.get("groups", []):
        if g["miles"] < floor:
            errors.append(f"Group {g['id']}: {g['miles']} mi can't reach the finish ({floor} mi away)")
        if not 1 <= g["miles"] <= 20:
            errors.append(f"Group {g['id']}: {g['miles']} mi is outside 1 to 20 miles")
        real_min = round(g["miles"] * g["pace"], 1)
        if abs(real_min - g["minutes"]) > 0.5:
            errors.append(f"Group {g['id']}: says {g['minutes']} min, math says {real_min}")
    if plan.get("groups") and plan.get("spread_minutes", 0) > tolerance_minutes:
        errors.append(f"Groups come back {plan['spread_minutes']} min apart, limit is {tolerance_minutes}")
    return {"ok": not errors, "errors": errors}
