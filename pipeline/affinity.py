"""Affinity: how close a listing is to what the pair wants. Mirrors docs/affinity.js exactly. Returns 0..100.

Two signals: explicit couple preferences (questionnaire in the app, stored in app_events key
'couple_prefs') and a profile learned from every 'yes' vote.
  final = explicit                         if prefs set and fewer than 5 likes
        = 0.6 * explicit + 0.4 * learned   if prefs set and >= 5 likes
        = learned                          if no prefs
"""
import re
import sys
import os
from statistics import median

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _has_outdoor(l):
    o = (l.get("outdoor") or "").lower()
    return bool(o) and o not in ("none", "no outdoor space", "—")


def _own_good(l):
    o = (l.get("ownership") or "").lower()
    if o.startswith("freehold"):
        return True
    return any("eeuwig" in str(v).lower() for v in (l.get("leasehold") or {}).values())


def _label_rank(l):
    x = (l.get("energy_label") or "").upper()
    return 1 if x.startswith("A") else 2 if x.startswith("B") else 3 if x.startswith("C") else 4 if x else 0


def _is_ground(l):
    return bool(re.search(r"ground|begane|garden|tuin|benedenwoning", f"{l.get('type') or ''} {l.get('floor') or ''}", re.I))


def _is_top(l):
    return bool(re.search(r"penthouse|top|bovenste", f"{l.get('type') or ''} {l.get('floor') or ''}", re.I))


def _district(name):
    return re.split(r" \(|/", name or "")[0].strip()


def _feat_text(l):
    return " ".join(f"{k} {v}" for k, v in (l.get("features") or {}).items()).lower()


def _has_lift(l):
    t = _feat_text(l)
    return bool(re.search(r"\blift\b|elevator", t)) and not re.search(r"geen lift|no lift", t)


def _has_parking(l):
    t = _feat_text(l)
    return bool(re.search(r"parkeer|parking|garage", t)) and not re.search(r"geen parkeer|no parking", t)


ANCHORS = {"centraal": (52.3791, 4.9003), "zuidas": (52.3380, 4.8730), "amstel": (52.3467, 4.9175), "sloterdijk": (52.3887, 4.8380),
           "sciencepark": (52.3546, 4.9530), "leidseplein": (52.3641, 4.8829), "museumplein": (52.3580, 4.8810), "westerpark": (52.3865, 4.8760),
           "oosterpark": (52.3600, 4.9200), "vondelpark": (52.3579, 4.8686)}


def km_to(l, key):
    import math
    a = ANCHORS.get(key)
    if not a or not l.get("lat") or not l.get("lng"):
        return None
    d_lat, d_lng = math.radians(l["lat"] - a[0]), math.radians(l["lng"] - a[1])
    h = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(a[0])) * math.cos(math.radians(l["lat"])) * math.sin(d_lng / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


_AREAS = None


def area_of(l):
    """Neighbourhood name for a postcode, same table as docs/areas.js."""
    global _AREAS
    if _AREAS is None:
        _AREAS = {}
        path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "areas.js")
        try:
            for m in re.finditer(r'"?(\d{4})"?\s*:\s*"([^"]+)"', open(path, encoding="utf-8").read()):
                _AREAS[m.group(1)] = m.group(2)
        except OSError:
            pass
    return _AREAS.get((l.get("postcode") or "")[:4], "")


def profile(liked):
    liked = [l for l in liked if l]
    if not liked:
        return None
    pc4 = {}
    for l in liked:
        k = (l.get("postcode") or "")[:4]
        if k:
            pc4[k] = pc4.get(k, 0) + 1
    m2 = [l["m2"] for l in liked if l.get("m2")]
    ppm = [l["price_per_m2"] for l in liked if l.get("price_per_m2")]
    beds = [l["bedrooms"] for l in liked if l.get("bedrooms") is not None]
    n = len(liked)
    return {"n": n, "pc4": pc4, "m2": median(m2) if m2 else None, "ppm": median(ppm) if ppm else None,
            "beds": median(beds) if beds else None, "outdoor": sum(_has_outdoor(l) for l in liked) / n,
            "own": sum(_own_good(l) for l in liked) / n, "label": sum(1 for l in liked if 0 < _label_rank(l) <= 2) / n}


def learned(l, p):
    if not p:
        return None
    s = 0.0
    k4 = (l.get("postcode") or "")[:4]
    same = p["pc4"].get(k4, 0)
    near = sum(v for k, v in p["pc4"].items() if k[:3] == k4[:3]) - same
    s += 25 * min(1.0, (same + near * 0.4) / max(1.0, p["n"] * 0.25))
    s += 20 * (1.0 if _own_good(l) else 1 - p["own"])
    if p["m2"] and l.get("m2"):
        s += 15 * max(0.0, 1 - abs(l["m2"] - p["m2"]) / max(20.0, p["m2"] * 0.35))
    if p["ppm"] and l.get("price_per_m2"):
        s += 10 * max(0.0, 1 - abs(l["price_per_m2"] - p["ppm"]) / max(500.0, p["ppm"] * 0.25))
    s += 15 * (1.0 if _has_outdoor(l) else 1 - p["outdoor"])
    s += 10 * (1.0 if 0 < _label_rank(l) <= 2 else 1 - p["label"])
    if p["beds"] is not None and l.get("bedrooms") is not None:
        s += 5 * (1.0 if l["bedrooms"] >= p["beds"] else 0.5)
    return min(100.0, s)


BASE = {"location": 25, "price": 15, "size": 15, "outdoor": 15, "ownership": 10, "energy": 8, "bedrooms": 6, "floor": 3, "era": 3,
        "ppm": 6, "anchor": 8, "lift": 4, "parking": 4}


def explicit(l, q):
    if not q:
        return None
    c = {}
    area, areas = area_of(l), q.get("areas") or []
    c["location"] = 0.7 if not areas else 1.0 if area in areas else 0.55 if any(_district(a) == _district(area) for a in areas) else 0.2
    b, price = q.get("budget"), l.get("price")
    c["price"] = 0.7 if not b or not price else 1.0 if price <= b else max(0.0, 1 - (price / b - 1) / 0.15)
    mm, m2 = q.get("min_m2"), l.get("m2")
    c["size"] = 0.7 if not mm or not m2 else 1.0 if m2 >= mm else max(0.0, 1 - (mm - m2) / (0.3 * mm))
    o = q.get("outdoor")
    c["outdoor"] = (1.0 if _has_outdoor(l) else 0.0) if o == "must" else (1.0 if _has_outdoor(l) else 0.5) if o == "nice" else 0.8
    ow = q.get("ownership")
    c["ownership"] = (1.0 if _own_good(l) else 0.1) if ow == "only" else (1.0 if _own_good(l) else 0.5) if ow == "prefer" else 0.8
    r, en = _label_rank(l), q.get("energy")
    c["energy"] = (1.0 if 0 < r <= 2 else 0.5 if r == 3 else 0.2) if en == "AB" else (1.0 if 0 < r <= 3 else 0.4) if en == "C" else 0.8
    mb, beds = q.get("min_bedrooms"), l.get("bedrooms")
    c["bedrooms"] = 0.7 if not mb or beds is None else 1.0 if beds >= mb else 0.3
    f = q.get("floor")
    c["floor"] = (1.0 if _is_ground(l) else 0.4) if f == "ground" else (0.4 if _is_ground(l) else 1.0) if f == "upper" else (1.0 if _is_top(l) else 0.6) if f == "top" else 0.8
    try:
        y = int(str(l.get("build_year") or 0)[:4])
    except ValueError:
        y = 0
    era = q.get("era")
    c["era"] = (1.0 if y and y < 1945 else 0.5) if era == "prewar" else (1.0 if y >= 1990 else 0.5) if era == "modern" else 0.8
    mp, ppm = q.get("max_ppm"), l.get("price_per_m2")
    c["ppm"] = 0.7 if not mp or not ppm else 1.0 if ppm <= mp else max(0.0, 1 - (ppm / mp - 1) / 0.2)
    d = km_to(l, q["anchor"]) if q.get("anchor") else None
    mk = q.get("max_km") or 5
    c["anchor"] = 0.7 if d is None else 1.0 if d <= mk else max(0.0, 1 - (d - mk) / mk)
    lf = q.get("lift")
    c["lift"] = (1.0 if _has_lift(l) else 0.1) if lf == "need" else (1.0 if _has_lift(l) else 0.6) if lf == "nice" else 0.8
    pk = q.get("parking")
    c["parking"] = (1.0 if _has_parking(l) else 0.1) if pk == "need" else (1.0 if _has_parking(l) else 0.6) if pk == "nice" else 0.8
    w = dict(BASE)
    for i, k in enumerate((q.get("priorities") or [])[:3]):
        if k in w:
            w[k] *= [1.6, 1.35, 1.15][i]
    tot = sum(w.values())
    s = sum(w[k] * c[k] for k in w) / tot * 100
    if q.get("max_vve") and l.get("vve_monthly") and l["vve_monthly"] > q["max_vve"]:
        s *= 0.85
    return s


def has_prefs(q):
    return bool(q) and any(k not in ("updated_by", "updated_at") and v not in (None, "", "any") and not (isinstance(v, list) and not v) for k, v in q.items())


def score(l, p, q=None):
    e = explicit(l, q) if has_prefs(q) else None
    g = learned(l, p)
    if e is None and g is None:
        return None
    if e is None:
        return int(round(g))
    if g is None or not p or p["n"] < 5:
        return int(round(e))
    return int(round(0.6 * e + 0.4 * g))
