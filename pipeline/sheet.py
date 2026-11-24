"""Read the shared Google Sheet of listings (must be shared as "Anyone with the link: Viewer").

Usage:
    python3 pipeline/sheet.py peek     Print the column layout without printing cell contents.
"""
import csv
import io
import re
import sys
from urllib.parse import urlparse

import requests

SHEET_ID = "116C81VkkXDaPFvNsM6btoCUeOn5-Sz0C8MReSPzOL9Q"
CSV_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv"


def fetch_rows(gid=None):
    r = requests.get(CSV_URL + (f"&gid={gid}" if gid else ""), timeout=60)
    if "text/csv" not in r.headers.get("content-type", ""):
        raise RuntimeError(f"sheet is not readable as CSV (HTTP {r.status_code}, {r.headers.get('content-type')}); "
                           "share it as 'Anyone with the link: Viewer'")
    r.encoding = "utf-8"
    return list(csv.reader(io.StringIO(r.text)))


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


if __name__ == "__main__":
    if sys.argv[1:] == ["peek"]:
        peek()
    else:
        print(__doc__); sys.exit(1)
