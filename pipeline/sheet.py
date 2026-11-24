"""Read the shared Google Sheet of listings (must be shared as "Anyone with the link: Viewer").

Usage:
    python3 pipeline/sheet.py peek     Print the column layout without printing cell contents.
    python3 pipeline/sheet.py plan     Print value vocabularies and how the sheet overlaps with Pand.
    python3 pipeline/sheet.py ingest [--min-fit N] [--max N] [--dry-run]
                                       Add rows that are new to Pand; keep sheet-sourced listings in step.
"""
import collections
import csv
import io
import re
import sys
import unicodedata
from urllib.parse import urlparse

import requests

SHEET_ID = "116C81VkkXDaPFvNsM6btoCUeOn5-Sz0C8MReSPzOL9Q"
CSV_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv"

ORDINALS = {"1e": "eerste", "2e": "tweede", "3e": "derde", "4e": "vierde"}
ROMAN = {"i": "1", "ii": "2", "iii": "3", "iv": "4", "v": "5"}
GROUND = {"hs", "huis", "bg", "h"}
NOISE = {"hoog", "hg", "etage", "verdieping"}


def addr_key(street):
    """Normalise 'Wodanstraat 12-I', 'Wodanstraat 12 1' and 'wodanstraat 12-1' to one key, so the
    same apartment is recognised whichever site or spelling it arrives with."""
    s = unicodedata.normalize("NFKD", street or "").encode("ascii", "ignore").decode().lower()
    s = re.split(r",|\b\d{4}\s?[a-z]{2}\b", s)[0]           # drop ', 1076 CD Amsterdam'
    out, seen_number = [], False
    for tok in re.sub(r"[^a-z0-9]+", " ", s).split():
        if not seen_number and tok in ORDINALS:
            out.append(ORDINALS[tok]); continue
        m = re.fullmatch(r"(\d+)([a-z]+)", tok)
        for part in ([m.group(1), m.group(2)] if m else [tok]):
            if seen_number:
                if part in NOISE:
                    continue
                part = "h" if part in GROUND else ROMAN.get(part, part)
            if part.isdigit():
                seen_number = True
            out.append(part)
    return " ".join(out)


def fetch_rows(gid=None):
    r = requests.get(CSV_URL + (f"&gid={gid}" if gid else ""), timeout=60)
    if "text/csv" not in r.headers.get("content-type", ""):
        raise RuntimeError(f"sheet is not readable as CSV (HTTP {r.status_code}, {r.headers.get('content-type')}); "
                           "share it as 'Anyone with the link: Viewer'")
    r.encoding = "utf-8"
    return list(csv.reader(io.StringIO(r.text)))


def fetch_dicts():
    rows = fetch_rows()
    header = [h.strip() for h in rows[0]]
    return [dict(zip(header, (c.strip() for c in r))) for r in rows[1:] if any(c.strip() for c in r)]


def shape(v):
    """Describe a cell without revealing it."""
    v = v.strip()
    if not v:
        return "empty"
    if re.match(r"https?://", v):
        u = urlparse(v)
        return f"url({u.netloc}/{u.path.strip('/').split('/')[0]}/…)"
    if re.fullmatch(r"[€$]?\s*[\d.,\s]+(m2|m²|%)?", v):
        return f"number-like({len(v)} chars)"
    if re.fullmatch(r"\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}.*", v):
        return "date-like"
    return f"text({len(v)} chars)"


def peek():
    rows = fetch_rows()
    print(f"rows: {len(rows)} (including header), columns: {max(len(r) for r in rows) if rows else 0}")
    if not rows:
        return
    header, data = rows[0], rows[1:]
    for i, name in enumerate(header):
        vals = [r[i] for r in data if i < len(r) and r[i].strip()]
        shapes = sorted({shape(v) for v in vals[:50]})[:4]
        print(f"  col {i + 1}: {name!r} · filled {len(vals)}/{len(data)} · {', '.join(shapes) or 'empty'}")


def plan():
    import os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from pipeline.job import sb_get
    rows = fetch_dicts()
    print(f"sheet rows: {len(rows)}")
    for col in ("Status", "Area preference", "Fit score", "Stadsdeel", "Energy label", "Ownership", "Floor", "Listed since",
                "Year built", "VvE monthly €", "Date first seen", "Last checked", "Outdoor space"):
        c = collections.Counter(r.get(col, "")[:40] for r in rows)
        print(f"  {col}: {len(c)} distinct · " + " | ".join(f"{k!r}×{n}" for k, n in c.most_common(9)))
    print("  url hosts:", dict(collections.Counter(urlparse(r.get("Listing URL", "")).netloc for r in rows)))
    print("  other-url hosts:", dict(collections.Counter(urlparse(u.strip()).netloc for r in rows for u in r.get("Other URLs", "").split("|") if u.strip()).most_common(8)))
    keys = collections.Counter(addr_key(r.get("Address", "")) for r in rows)
    print(f"  distinct address keys: {len(keys)} · duplicated within sheet: {sum(1 for n in keys.values() if n > 1)}")
    pand = sb_get("listings", {"select": "id,street,status"})
    votes = sb_get("votes", {"select": "listing_id,who,vote"})
    by_key = {addr_key(l["street"]): l for l in pand}
    voted = collections.defaultdict(dict)
    for v in votes:
        voted[v["listing_id"]][v["who"]] = v["vote"]
    known = [r for r in rows if addr_key(r.get("Address", "")) in by_key]
    new = [r for r in rows if addr_key(r.get("Address", "")) not in by_key]
    print(f"pand listings: {len(pand)} · sheet rows already in Pand: {len(known)} · new to Pand: {len(new)}")
    print("  new by status:", dict(collections.Counter(r.get("Status", "") for r in new)))
    print("  new by fit score:", dict(sorted(collections.Counter(r.get("Fit score", "") for r in new).items())))
    print("  new by area preference:", dict(collections.Counter(r.get("Area preference", "") for r in new)))
    print("  known, voted by someone:", sum(1 for r in known if voted.get(by_key[addr_key(r['Address'])]["id"])))
    for r in rows[:2] + new[:2]:
        print("  sample:", {k: (v[:60] + "…" if len(v) > 60 else v) for k, v in r.items() if k != "Notes / red flags"})
    for l in pand[:3]:
        print("  pand key sample:", repr(l["street"]), "->", repr(addr_key(l["street"])))


UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
      "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
OG_RE = re.compile(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']|<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']', re.I)


def geocode(address):
    """Street address in Amsterdam -> (postcode, lat, lng) via the Dutch national address service."""
    r = requests.get("https://api.pdok.nl/bzk/locatieserver/search/v3_1/free",
                     params={"q": f"{address} Amsterdam", "fq": "type:adres", "rows": 1, "fl": "weergavenaam,postcode,centroide_ll,score"}, timeout=30)
    r.raise_for_status()
    docs = r.json().get("response", {}).get("docs", [])
    if not docs:
        return None
    d = docs[0]
    m = re.match(r"POINT\(([\d.]+) ([\d.]+)\)", d.get("centroide_ll", ""))
    return {"name": d.get("weergavenaam"), "postcode": d.get("postcode"), "lng": float(m.group(1)) if m else None, "lat": float(m.group(2)) if m else None}


MONTHS = {"januari": 1, "january": 1, "februari": 2, "february": 2, "maart": 3, "march": 3, "april": 4, "mei": 5, "may": 5,
          "juni": 6, "june": 6, "juli": 7, "july": 7, "augustus": 8, "august": 8, "september": 9, "oktober": 10,
          "october": 10, "november": 11, "december": 12}
BLANK = {"", "-", "—", "not stated", "unknown", "n/a", "none"}
BUURTJE_IMG_RE = re.compile(r'(?:https://buurtje\.nl)?(/afbeeldingen/woningen/[^"\'\s)>,]+\.(?:webp|jpe?g|png))')


def num(v):
    """'650,000' -> 650000, '191.50' -> 191, 'not stated' -> None."""
    m = re.search(r"\d[\d.,]*", v or "")
    if not m:
        return None
    t = m.group(0).rstrip(".,")
    if re.fullmatch(r"\d{1,3}([.,]\d{3})+", t):
        return int(re.sub(r"[.,]", "", t))
    return int(re.split(r"[.,]", t)[0])


def parse_date(v):
    v = (v or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        return v
    m = re.match(r"(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", v)
    if m and m.group(2).lower() in MONTHS:
        return f"{m.group(3)}-{MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}"
    return None


def clean(v, limit=None):
    v = (v or "").strip()
    if v.lower() in BLANK:
        return None
    return v[:limit].rstrip() if limit else v


def ownership(v):
    """Sheet wording -> (Pand ownership value, leasehold details)."""
    t = clean(v)
    if not t:
        return None, None
    low = t.lower()
    if low.startswith("freehold") or "eigen grond" in low or "volle eigendom" in low:
        return "freehold (eigen grond)", None
    if "erfpacht" in low or "leasehold" in low:
        details = {"Erfpacht": t}
        m = re.search(r"afgekocht tot (\d{1,2})-(\d{1,2})-(\d{4})", low)
        if "eeuwigdurend afgekocht" in low:
            details["Afgekocht tot"] = "Eeuwigdurend"
        elif m:
            details["Afgekocht tot"] = f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
        return "leasehold (erfpacht)", details
    return t, None


def photos_for(urls):
    """Photos from the listing's buurtje.nl page (Funda refuses automated reads); falls back to any
    page that exposes a preview image."""
    fallback = None
    for u in sorted(urls, key=lambda u: "buurtje.nl" not in u):
        if not any(h in u for h in ("buurtje.nl", "huispedia.nl")):
            continue
        try:
            r = requests.get(u, headers={"User-Agent": UA, "Accept-Language": "nl,en"}, timeout=30)
        except requests.RequestException:
            continue
        if r.status_code != 200:
            continue
        m = OG_RE.search(r.text)
        og = (m.group(1) or m.group(2)) if m else None
        if "buurtje.nl" in u and og:
            slug = re.sub(r"-[0-9a-f]{6,}\.\w+$", "", og.rsplit("/", 1)[-1])
            gallery = ["https://buurtje.nl" + p for p in BUURTJE_IMG_RE.findall(r.text)]
            gallery = [g for g in gallery if g.rsplit("/", 1)[-1].startswith(slug)]
            return list(dict.fromkeys([og] + gallery))[:30]
        fallback = fallback or og
    return [fallback] if fallback else []


def to_listing(row, key):
    import hashlib
    from datetime import datetime, timezone
    from pipeline.summary import summary as fallback_summary
    price, m2, fit = num(row.get("Asking price €")), num(row.get("Living area m²")), num(row.get("Fit score")) or 0
    own, lease = ownership(row.get("Ownership"))
    street = row["Address"].strip()
    geo = None
    try:
        geo = geocode(street)
    except Exception as ex:
        print("   geocode failed:", street, str(ex)[:80])
    if geo and addr_key(geo.get("name") or "").split(" ")[0] != key.split(" ")[0]:
        geo = None                                             # the service answered with another street
    geo = geo or {}
    urls = [row.get("Listing URL", "")] + [u.strip() for u in row.get("Other URLs", "").split("|") if u.strip()]
    photos = photos_for(urls)
    first = parse_date(row.get("Date first seen")) or datetime.now(timezone.utc).date().isoformat()
    now = datetime.now(timezone.utc).isoformat()
    notes = clean(row.get("Notes / red flags"))
    e = {
        "id": "s" + hashlib.sha1(key.encode()).hexdigest()[:12],
        "url": row.get("Listing URL") or (urls[1] if len(urls) > 1 else ""),
        "status": "available",
        "street": street,
        "postcode": geo.get("postcode"),
        "address": f'{street}, {geo["postcode"][:4]} {geo["postcode"][4:]} Amsterdam' if geo.get("postcode") else f"{street}, Amsterdam",
        "lat": geo.get("lat"), "lng": geo.get("lng"),
        "price": price, "m2": m2,
        "price_per_m2": num(row.get("Price per m²")) or (round(price / m2) if price and m2 else None),
        "rooms": num(row.get("Rooms")), "bedrooms": num(row.get("Bedrooms")),
        "type": "apartment",
        "build_year": clean(row.get("Year built")),
        "energy_label": clean(row.get("Energy label")),
        "ownership": own, "leasehold": lease,
        "vve_monthly": num(row.get("VvE monthly €")),
        "floor": clean(row.get("Floor"), 40),
        "outdoor": clean(row.get("Outdoor space"), 90) or "None",
        "photo": photos[0] if photos else None, "photos": photos,
        "description_en": f"Notes and red flags: {notes}" if notes else None,
        "features": {k: v for k, v in {
            "Neighbourhood": clean(row.get("Neighbourhood")), "District": clean(row.get("Stadsdeel")),
            "Area preference": clean(row.get("Area preference")), "Sheet fit score": f"{fit} / 5" if fit else None,
            "Ownership as listed": clean(row.get("Ownership"), 160), "Outdoor as listed": clean(row.get("Outdoor space"), 200),
            "Listed since": clean(row.get("Listed since")), "Agent": clean(row.get("Agent")),
            "Source": urlparse(row.get("Listing URL", "")).netloc.replace("www.", "") or None,
            "Other links": clean(row.get("Other URLs"), 400),
        }.items() if v},
        "listed_since": parse_date(row.get("Listed since")),
        # Newest day first in the deck; within a day, the higher sheet score first.
        "first_seen": f"{first}T{10 + min(fit, 9):02d}:00:00+00:00",
        "email_date": f"{first}T12:00:00+00:00",
        "enriched_at": now, "updated_at": now,
    }
    e["summary"] = fallback_summary(dict(e, leasehold_details=lease))
    return e


def ingest(min_fit=1, max_new=250, dry=False):
    """Add sheet rows that are new to Pand. A row is matched to an existing listing by address, so an
    apartment that is already in Pand (and any vote on it) is never duplicated or shown again."""
    import os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from pipeline.job import sb_get, sb_patch, sb_upsert
    rows = fetch_dicts()
    pand = sb_get("listings", {"select": "id,street,status,price"})
    by_key = {addr_key(l["street"]): l for l in pand}
    sheet_keys, new, back, repriced, low = set(), [], 0, 0, 0
    for row in rows:
        key = addr_key(row.get("Address", ""))
        if not key or not row.get("Listing URL"):
            continue
        sheet_keys.add(key)
        known = by_key.get(key)
        if known:
            if known["id"].startswith("s") and not dry:            # keep sheet-sourced listings in step with the sheet
                patch = {}
                if known["status"] == "withdrawn":
                    patch["status"] = "available"; back += 1
                price = num(row.get("Asking price €"))
                if price and price != known["price"]:
                    m2 = num(row.get("Living area m²"))
                    patch.update(price=price, price_per_m2=round(price / m2) if m2 else None); repriced += 1
                if patch:
                    sb_patch("listings", {"id": f'eq.{known["id"]}'}, patch)
            continue
        if (num(row.get("Fit score")) or 0) < min_fit:
            low += 1; continue
        new.append((key, row))
    print(f"sheet rows {len(rows)} · already in Pand {len(rows) - len(new) - low} · below fit {min_fit}: {low} · new {len(new)}")

    mine = [l for l in pand if l["id"].startswith("s") and l["status"] == "available"]
    gone = [l for l in mine if addr_key(l["street"]) not in sheet_keys]
    if gone and len(gone) <= max(5, len(mine) // 2):               # a half-empty sheet is a mistake, not a market crash
        print(f"no longer in the sheet, hiding: {len(gone)}")
        if not dry:
            sb_patch("listings", {"id": f'in.({",".join(l["id"] for l in gone)})'}, {"status": "withdrawn"})
    elif gone:
        print(f"! {len(gone)} of {len(mine)} sheet listings missing; sheet looks truncated, hiding nothing")

    batch, added, no_photo, no_geo = [], 0, 0, 0
    for key, row in new[:max_new]:
        e = to_listing(row, key)
        no_photo += not e["photo"]; no_geo += e["lat"] is None
        if added == 0 and e["photo"]:
            try:
                t = requests.get(e["photo"], headers={"User-Agent": UA, "Referer": "https://f54cg22yp7-maker.github.io/"}, timeout=30)
                print(f"photo check from the app's origin: HTTP {t.status_code} {t.headers.get('content-type')} · gallery {len(e['photos'])}")
            except requests.RequestException as ex:
                print("photo check failed:", str(ex)[:80])
        added += 1
        batch.append(e)
        if len(batch) == 40 and not dry:
            sb_upsert("listings", batch); batch = []
    if batch and not dry:
        sb_upsert("listings", batch)
    print(f"{'would add' if dry else 'added'} {added} · without photo {no_photo} · without map position {no_geo} · "
          f"left for next run {max(0, len(new) - max_new)} · back on market {back} · repriced {repriced}")


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["ingest"]:
        ingest(min_fit=int(a[a.index("--min-fit") + 1]) if "--min-fit" in a else 1,
               max_new=int(a[a.index("--max") + 1]) if "--max" in a else 250, dry="--dry-run" in a)
    elif a == ["peek"]:
        peek()
    elif a == ["plan"]:
        plan()
    else:
        print(__doc__); sys.exit(1)
