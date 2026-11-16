"""Street safety data for route choice.

For a club in Philadelphia, the server downloads the last 12 months of violent
incidents (homicide, rape, robbery, aggravated assault) from the City of
Philadelphia's open crime data (OpenDataPhilly, Carto SQL API, no key) and counts
them in small cells of about 200 m. The map then prefers routes whose streets pass
through cells with fewer incidents.

Only counts per cell leave this file: no addresses, dates or incident details.
It is used to compare streets near one meeting point, never to label neighborhoods.
The download is cached in data/cache for a week. With no internet, or for a city
without open data here, routes are chosen on distance and turns alone and the page says so.
"""
import json
import time
import urllib.parse
import urllib.request
from datetime import date, timedelta

from . import config

CELL = 0.002                      # degrees, about 220 m north-south and 170 m east-west in Philadelphia
HALF_LAT, HALF_LNG = 0.06, 0.08   # area around the start: about 6.5 km by 6.8 km each way
CACHE_DIR = config.DATA_DIR / "cache"
MAX_AGE = 7 * 24 * 3600
PHILLY = (39.86, 40.14, -75.29, -74.95)   # rough city bounding box
SOURCE = "City of Philadelphia crime incidents (OpenDataPhilly), violent incidents in the last 12 months"
URL = "https://phl.carto.com/api/v2/sql"
VIOLENT_NAMES = ("Homicide - Criminal", "Rape", "Robbery Firearm", "Robbery No Firearm",
                 "Aggravated Assault Firearm", "Aggravated Assault No Firearm")


def in_philly(lat, lng):
    return PHILLY[0] <= lat <= PHILLY[1] and PHILLY[2] <= lng <= PHILLY[3]


def _sql(box, since, by_name):
    s, n, w, e = box
    k = round(1 / CELL)
    where = ("text_general_code IN (" + ",".join("'" + x.replace("'", "''") + "'" for x in VIOLENT_NAMES) + ")"
             if by_name else "ucr_general::int < 500")
    return (f"SELECT round(st_y(the_geom)::numeric*{k})/{k} AS lat, round(st_x(the_geom)::numeric*{k})/{k} AS lng, "
            f"count(*) AS n FROM incidents_part1_part2 WHERE dispatch_date_time >= '{since}' AND {where} "
            f"AND the_geom && ST_MakeEnvelope({w},{s},{e},{n},4326) GROUP BY 1,2")


def _download(box):
    since = (date.today() - timedelta(days=365)).isoformat()
    last = None
    for by_name in (False, True):          # the second form only if the first one errors
        url = URL + "?" + urllib.parse.urlencode({"q": _sql(box, since, by_name)})
        try:
            with urllib.request.urlopen(url, timeout=10) as r:
                rows = json.loads(r.read().decode())["rows"]
            return [[float(x["lat"]), float(x["lng"]), int(x["n"])] for x in rows if x["lat"] is not None]
        except Exception as e:             # network down, blocked or a schema change
            last = e
    raise last


def grid(lat, lng):
    """Incident counts per cell around a start point, or {available: False, note}."""
    if not in_philly(lat, lng):
        return {"available": False, "note": "No street safety data for this city yet, so routes are chosen on distance and turns."}
    clat, clng = round(lat / 0.02) * 0.02, round(lng / 0.02) * 0.02
    box = (round(clat - HALF_LAT, 3), round(clat + HALF_LAT, 3), round(clng - HALF_LNG, 3), round(clng + HALF_LNG, 3))
    path = CACHE_DIR / f"crime-phl-{clat:.2f}-{clng:.2f}.json"
    if path.exists() and time.time() - path.stat().st_mtime < MAX_AGE:
        return json.loads(path.read_text())
    try:
        cells = _download(box)
    except Exception:
        if path.exists():                  # an old download beats none
            return json.loads(path.read_text())
        return {"available": False, "note": "Street safety data couldn't be downloaded (no internet?), so routes are chosen on distance and turns."}
    lat_cells = round((box[1] - box[0]) / CELL) + 1
    lng_cells = round((box[3] - box[2]) / CELL) + 1
    out = {"available": True, "source": SOURCE, "cell": CELL, "box": box,
           "fetched": date.today().isoformat(),
           "baseline": sum(c[2] for c in cells) / (lat_cells * lng_cells),   # average incidents per cell, zeros included
           "cells": cells}
    CACHE_DIR.mkdir(exist_ok=True)
    path.write_text(json.dumps(out))
    return out
