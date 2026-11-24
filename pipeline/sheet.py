"""Read the shared Google Sheet of listings (must be shared as "Anyone with the link: Viewer").

Usage:
    python3 pipeline/sheet.py peek     Print the column layout without printing cell contents.
    python3 pipeline/sheet.py plan     Print value vocabularies and how the sheet overlaps with Pand.
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


def og_image(url):
    r = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "nl,en"}, timeout=30)
    m = OG_RE.search(r.text) if r.status_code == 200 else None
    imgs = len(re.findall(r"<img\b", r.text))
    return r.status_code, (m.group(1) or m.group(2)) if m else None, len(r.text), imgs


def probe():
    rows = fetch_dicts()
    for row in rows[:4] + rows[200:202]:
        print(row["Address"])
        try:
            print("   geocode:", geocode(row["Address"]))
        except Exception as ex:
            print("   geocode failed:", str(ex)[:120])
        urls = [row.get("Listing URL", "")] + [u.strip() for u in row.get("Other URLs", "").split("|") if u.strip()]
        for u in urls[:5]:
            try:
                code, img, size, imgs = og_image(u)
                print(f"   {urlparse(u).netloc}: HTTP {code}, {size} bytes, {imgs} img tags, og:image = {img[:110] if img else None}")
            except Exception as ex:
                print(f"   {urlparse(u).netloc}: failed {str(ex)[:100]}")


if __name__ == "__main__":
    if sys.argv[1:] == ["probe"]:
        probe()
    elif sys.argv[1:] == ["peek"]:
        peek()
    elif sys.argv[1:] == ["plan"]:
        plan()
    else:
        print(__doc__); sys.exit(1)
