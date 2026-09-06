"""Affinity: how close a listing is to what the pair has liked so far.

Mirrors docs/affinity.js exactly; keep the two in sync. Returns 0..100.
Profile is built from every 'yes' vote (both people). Components and weights:
  area         25  share of likes in the same postcode-4 (plus neighbours by prefix-3)
  ownership    20  freehold or leasehold bought off, if likes prefer that
  size         15  distance of m2 from the liked median
  price_m2     10  distance of price/m2 from the liked median
  outdoor      15  has outdoor space, if likes mostly do
  energy       10  label A/B if likes are mostly A/B
  bedrooms      5  bedrooms >= liked median
"""
from statistics import median


def _has_outdoor(l):
    o = (l.get("outdoor") or "").lower()
    return bool(o) and o not in ("none", "no outdoor space", "—")


def _own_good(l):
    o = (l.get("ownership") or "").lower()
    if o.startswith("freehold"):
        return True
    lease = l.get("leasehold") or {}
    return any("eeuwig" in str(v).lower() for v in lease.values())


def _label_good(l):
    return (l.get("energy_label") or "").upper().startswith(("A", "B"))


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
    return {
        "n": n, "pc4": pc4,
        "m2": median(m2) if m2 else None, "ppm": median(ppm) if ppm else None,
        "beds": median(beds) if beds else None,
        "outdoor": sum(_has_outdoor(l) for l in liked) / n,
        "own": sum(_own_good(l) for l in liked) / n,
        "label": sum(_label_good(l) for l in liked) / n,
    }


def score(l, p):
    if not p:
        return None
    s = 0.0
    k4 = (l.get("postcode") or "")[:4]
    same = p["pc4"].get(k4, 0)
    near = sum(v for k, v in p["pc4"].items() if k[:3] == k4[:3]) - same
    s += 25 * min(1.0, (same * 1.0 + near * 0.4) / max(1.0, p["n"] * 0.25))
    s += 20 * (1.0 if _own_good(l) else (1 - p["own"]))
    if p["m2"] and l.get("m2"):
        s += 15 * max(0.0, 1 - abs(l["m2"] - p["m2"]) / max(20.0, p["m2"] * 0.35))
    if p["ppm"] and l.get("price_per_m2"):
        s += 10 * max(0.0, 1 - abs(l["price_per_m2"] - p["ppm"]) / max(500.0, p["ppm"] * 0.25))
    s += 15 * (1.0 if _has_outdoor(l) else (1 - p["outdoor"]))
    s += 10 * (1.0 if _label_good(l) else (1 - p["label"]))
    if p["beds"] is not None and l.get("bedrooms") is not None:
        s += 5 * (1.0 if l["bedrooms"] >= p["beds"] else 0.5)
    return int(round(min(100.0, s)))
