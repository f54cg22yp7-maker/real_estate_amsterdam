"""Parse a Dames van Vermeer / move.nl 'nieuwe woningen' alert email into listings.

Input: the plain-text body of one email (as returned by the Gmail connector).
Output: a list of dicts, one per listing, keyed by the stable move.nl object id.

Usage:
    python3 pipeline/parse_email.py < body.txt
"""
import base64
import json
import re
import sys

URL_RE = re.compile(r"<(https://move\.nl/exchange-object/([A-Za-z0-9_-]+)/[^>]*)>")
HEAD_RE = re.compile(r"^\[(.+?),\s*(\d{4}\s?[A-Z]{2})\s+Amsterdam\]")
PRICE_RE = re.compile(r"Vraagprijs:\s*€\s*([\d.]+),-\s*(kosten koper|k\.k\.|vrij op naam|v\.o\.n\.)?", re.I)
SPEC_RE = re.compile(r"^(?P<type>[^|<]+?)\s*\|\s*(?P<m2>\d+)\s*m²\s*\|\s*(?P<rooms>\d+)\s*kamers?(?:\s*\((?P<beds>\d+)\s*slaapkamers?\))?")
SENT_RE = re.compile(r"^Sent:\s*(.+)$", re.M)


def object_id(token: str) -> str:
    """Decode the base64 token to 'ExchangeObject:6878421|hash' and return the numeric id."""
    pad = "=" * (-len(token) % 4)
    try:
        decoded = base64.urlsafe_b64decode(token + pad).decode("utf-8", "replace")
    except Exception:
        return token
    m = re.match(r"ExchangeObject:(\d+)", decoded)
    return m.group(1) if m else token


def parse(body: str) -> list[dict]:
    sent = SENT_RE.search(body)
    lines = [ln.strip() for ln in body.splitlines()]
    listings, cur = [], None
    for ln in lines:
        h = HEAD_RE.match(ln)
        if h:
            u = URL_RE.search(ln)
            token = u.group(2) if u else ""
            cur = {
                "id": object_id(token),
                "street": h.group(1).strip(),
                "postcode": h.group(2).replace(" ", ""),
                "city": "Amsterdam",
                "url": u.group(1) if u else None,
                "email_sent": sent.group(1).strip() if sent else None,
            }
            listings.append(cur)
            continue
        if cur is None:
            continue
        p = PRICE_RE.search(ln)
        if p and "price" not in cur:
            cur["price"] = int(p.group(1).replace(".", ""))
            cur["price_terms"] = (p.group(2) or "").lower() or None
            continue
        s = SPEC_RE.match(ln)
        if s and "m2" not in cur:
            cur["type"] = s.group("type").strip()
            cur["m2"] = int(s.group("m2"))
            cur["rooms"] = int(s.group("rooms"))
            cur["bedrooms"] = int(s.group("beds")) if s.group("beds") else None
    for l in listings:
        if l.get("price") and l.get("m2"):
            l["price_per_m2"] = round(l["price"] / l["m2"])
        l["address"] = f'{l["street"]}, {l["postcode"][:4]} {l["postcode"][4:]} Amsterdam'
    return listings


if __name__ == "__main__":
    print(json.dumps(parse(sys.stdin.read()), indent=2, ensure_ascii=False))
