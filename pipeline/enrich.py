"""Enrich a listing from its move.nl landing page.

move.nl is a Next.js app that server-renders the full listing object into the
React Server Components payload (self.__next_f.push chunks). We pull that
object out and normalise the fields the swipe card needs. No browser required.

Usage:
    python3 pipeline/enrich.py <move.nl url> [...]      -> JSON array on stdout
    python3 pipeline/enrich.py --html page.html          -> parse a saved page
"""
import json
import re
import sys
from datetime import datetime

import requests

UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
      "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
CHUNK_RE = re.compile(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)')
OBJ_START = '{"__typename":"ExchangeObject"'

STATUS_MAP = {
    "BESCHIKBAAR": "available", "ONDER_BOD": "under offer", "ONDER_OPTIE": "under option",
    "VERKOCHT_ONDER_VOORBEHOUD": "sold subject to conditions", "VERKOCHT": "sold",
    "INGETROKKEN": "withdrawn", "VERHUURD": "rented",
}


def fetch(url: str, timeout: int = 30) -> str:
    r = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "nl,en"}, timeout=timeout)
    r.raise_for_status()
    return r.text


def rsc_payload(html: str) -> str:
    """Concatenate the RSC chunks, decoding them as JS string literals (keeps UTF-8 intact)."""
    return "".join(json.loads(m.group(1)) for m in CHUNK_RE.finditer(html))


def rsc_refs(payload: str) -> dict:
    """Map RSC reference ids to their text blobs. Rows look like `ac:T237a,<text>` where the
    hex length counts UTF-8 bytes, and a text row can be followed immediately (no newline)
    by another `id:T<len>,` row, so after consuming one we chain from its end."""
    refs, b = {}, payload.encode("utf-8")
    row = re.compile(rb'([0-9a-f]+):T([0-9a-f]+),')
    starts = [m.start() for m in re.finditer(rb'(?m)^[0-9a-f]+:T[0-9a-f]+,', b)]
    seen = set()
    for pos in starts:
        while pos not in seen:
            seen.add(pos)
            m = row.match(b, pos)
            if not m:
                break
            n = int(m.group(2), 16)
            refs["$" + m.group(1).decode()] = b[m.end(): m.end() + n].decode("utf-8", "replace")
            pos = m.end() + n
    return refs


def balanced_json(s: str, start: int) -> str:
    depth, i, in_str, esc = 0, start, False, False
    while i < len(s):
        c = s[i]
        if in_str:
            if esc: esc = False
            elif c == "\\": esc = True
            elif c == '"': in_str = False
        else:
            if c == '"': in_str = True
            elif c == "{": depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return s[start: i + 1]
        i += 1
    raise ValueError("unbalanced JSON")


def money(s: str | None) -> int | None:
    if not s: return None
    m = re.search(r"€\s*([\d.]+)", s)
    return int(m.group(1).replace(".", "")) if m else None


def kenmerken(obj: dict, key: str) -> dict:
    out = {}
    for sec in obj.get(key) or []:
        for k in sec.get("kenmerken") or []:
            out[f'{sec.get("name")} / {k.get("label")}'] = k.get("value")
    return out


def find(kv: dict, *labels: str) -> str | None:
    for full, v in kv.items():
        lab = full.split(" / ", 1)[-1].lower()
        if any(l.lower() == lab for l in labels):
            return v
    return None


def find_contains(kv: dict, *needles: str) -> dict:
    return {k: v for k, v in kv.items() if any(n.lower() in k.lower() for n in needles)}


def object_id_from_token(token: str) -> str:
    import base64
    pad = "=" * (-len(token) % 4)
    try:
        dec = base64.urlsafe_b64decode(token + pad).decode("utf-8", "replace")
        m = re.match(r"ExchangeObject:(\d+)", dec)
        return m.group(1) if m else token
    except Exception:
        return token


def parse_html(html: str, url: str | None = None) -> dict:
    payload = rsc_payload(html)
    i = payload.find(OBJ_START)
    if i < 0:
        raise ValueError("ExchangeObject not found in page")
    obj = json.loads(balanced_json(payload, i))
    refs = rsc_refs(payload)

    def deref(v):
        return refs.get(v, v) if isinstance(v, str) and v.startswith("$") else v

    addr = obj.get("address") or {}
    coords = addr.get("coordinates") or {}
    nl = kenmerken(obj, "kenmerkSections")
    en = kenmerken(obj, "kenmerkSectionsEnglish")
    photos = [p.get("image", {}).get("url") for p in (obj.get("hoofdfoto") or []) if p.get("image")]
    photos += [p.get("image", {}).get("url") for p in (obj.get("fotos") or obj.get("images") or []) if isinstance(p, dict) and p.get("image")]
    main_photo = photos[0] if photos else None
    if main_photo:
        main_photo = re.sub(r"height=\d+", "height=900", re.sub(r"width=\d+", "width=1200", main_photo))

    price = money((obj.get("koopPrice") or {}).get("formatMoneyLong"))
    m2 = obj.get("woonOppervlakte")
    ownership_nl = find(nl, "Eigendomssituatie") or ""
    leasehold_bits = find_contains(nl, "erfpacht", "canon", "afgekocht", "eigendomssituatie")
    is_leasehold = "erfpacht" in ownership_nl.lower() or any("erfpacht" in (v or "").lower() for v in leasehold_bits.values())

    street = f'{addr.get("street","")} {addr.get("nr","")}{(" " + addr["nrExtension"]) if addr.get("nrExtension") else ""}'.strip()
    listed = find(nl, "Aangeboden sinds")
    listed_iso = None
    if listed:
        try: listed_iso = datetime.strptime(listed, "%d-%m-%Y").date().isoformat()
        except ValueError: pass

    token = (url or obj.get("id") or "").split("/exchange-object/")[-1].split("/")[0] if url else obj.get("id", "")
    return {
        "id": object_id_from_token(token),
        "url": url,
        "status": STATUS_MAP.get(obj.get("status"), (obj.get("status") or "").lower()),
        "status_raw": obj.get("status"),
        "street": street,
        "postcode": (addr.get("zipCode") or "").replace(" ", ""),
        "city": addr.get("city"),
        "address": f'{street}, {addr.get("zipCode","")} {addr.get("city","")}',
        "lat": coords.get("latitude"),
        "lng": coords.get("longitude"),
        "price": price,
        "price_terms": "kosten koper" if "k.k" in ((obj.get("koopPrice") or {}).get("formatMoneyShort") or "") else None,
        "m2": m2,
        "price_per_m2": round(price / m2) if price and m2 else None,
        "rooms": obj.get("aantalKamers"),
        "bedrooms": obj.get("aantalSlaapkamers"),
        "type": (find(en, "Type of apartment") or obj.get("objectDetailedType") or "").lower(),
        "build_year": find(nl, "Bouwjaar"),
        "energy_label": find(nl, "Energieklasse", "Energielabel"),
        "vve_monthly": money(find(nl, "Bijdrage VVE p/m")),
        "vve_reserve_fund": find(nl, "Reservefonds"),
        "vve_maintenance_plan": find(nl, "Onderhoudsplan"),
        "ownership": "leasehold (erfpacht)" if is_leasehold else ("freehold (eigen grond)" if "volle eigendom" in ownership_nl.lower() else ownership_nl or None),
        "leasehold_details": leasehold_bits or None,
        "floor": find(en, "Located on"),
        "balcony": find(en, "Balcony"),
        "roof_terrace": find(en, "Roof terrace"),
        "garden": find(en, "Garden"),
        "outdoor_m2": find(en, "Building-related outdoor space"),
        "maintenance_inside": find(nl, "Onderhoud binnen"),
        "maintenance_outside": find(nl, "Onderhoud buiten"),
        "listed_since": listed_iso or listed,
        "photo": main_photo,
        "photos": photos[:12],
        "description_en": (deref(obj.get("aanbiedingsTekstEnglish")) or "").strip() or None,
        "description_nl": (deref(obj.get("aanbiedingsTekst")) or "").strip() or None,
        "features_en": en,
        "seller_agent": (obj.get("ownerOffice") or {}).get("bedrijfsNaam"),
        "enriched_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }


def enrich(url: str) -> dict:
    return parse_html(fetch(url), url)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["--html"]:
        print(json.dumps(parse_html(open(args[1], encoding="utf-8").read()), indent=2, ensure_ascii=False))
    else:
        out = []
        for u in args:
            try:
                out.append(enrich(u))
            except Exception as e:  # keep going; the job reports failures per listing
                out.append({"url": u, "error": str(e)})
        print(json.dumps(out, indent=2, ensure_ascii=False))
