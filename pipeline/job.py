"""Scheduled job: ingest alert emails, enrich listings, upsert to Supabase, refresh statuses,
publish the shortlist CSV.

Subcommands (run from the repo root):
  ingest  <files...>      Email bodies (.txt) and/or JSON lists of {url|token, email_sent}.
                          Parses, dedupes against the DB, enriches new listings, upserts them,
                          and writes new_listings.json (id, address, description) for summaries.
  summaries <json>        Apply {"<id>": "<one sentence>"} to the summary column.
  refresh [--max N]       Re-enrich the N (default 40) least-recently-enriched non-final listings
                          so status (under offer / sold) and price stay current.
  shortlist               Write docs/shortlist.csv (all listings with votes, matches first).
  stats                   Print counts.

Config: reads docs/config.js for the Supabase URL and publishable key (no secrets involved).
"""
import csv
import glob
import json
import os
import re
import sys
from datetime import datetime, timezone

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from pipeline.parse_email import parse as parse_email, object_id  # noqa: E402
from pipeline.enrich import enrich  # noqa: E402
from pipeline.summary import summary as fallback_summary, outdoor  # noqa: E402

cfg = open(os.path.join(ROOT, "docs", "config.js"), encoding="utf-8").read()
SB_URL = re.search(r'supabaseUrl:\s*"([^"]+)"', cfg).group(1)
SB_KEY = re.search(r'supabaseKey:\s*"([^"]+)"', cfg).group(1)
H = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}", "Content-Type": "application/json"}
FINAL = {"sold", "withdrawn", "rented"}
COLS = ["id", "url", "status", "address", "street", "postcode", "lat", "lng", "price", "m2", "price_per_m2",
        "rooms", "bedrooms", "type", "build_year", "energy_label", "ownership", "leasehold", "vve_monthly",
        "floor", "outdoor", "photo", "photos", "summary", "description_en", "features", "email_date",
        "enriched_at", "updated_at", "listed_since"]


def sb_get(table, params):
    r = requests.get(f"{SB_URL}/rest/v1/{table}", headers=H, params=params, timeout=60)
    r.raise_for_status()
    return r.json()


def sb_upsert(table, rows, on_conflict="id"):
    if not rows:
        return
    h = dict(H, Prefer="resolution=merge-duplicates,return=minimal")
    r = requests.post(f"{SB_URL}/rest/v1/{table}", headers=h, params={"on_conflict": on_conflict}, data=json.dumps(rows), timeout=120)
    if r.status_code >= 300:
        raise RuntimeError(f"upsert {table} failed {r.status_code}: {r.text[:300]}")


def to_row(e: dict, email_date=None, keep_summary=None) -> dict:
    row = {k: e.get(k) for k in COLS if k in e}
    row["leasehold"] = e.get("leasehold_details")
    row["features"] = e.get("features_en")
    row["outdoor"] = outdoor(e)
    row["summary"] = keep_summary or fallback_summary(dict(e, outdoor=row["outdoor"]))
    row["updated_at"] = datetime.now(timezone.utc).isoformat()
    if email_date:
        row["email_date"] = email_date
    for k in ("listed_since",):
        if row.get(k) and not re.match(r"\d{4}-\d{2}-\d{2}$", str(row[k])):
            row.pop(k)
    return {k: v for k, v in row.items() if k in COLS}


def parse_sent(s):
    """'Friday, August 28, 2026 4:00:29 p.m. (UTC+01:00) ...' -> ISO. Best effort."""
    if not s:
        return None
    m = re.match(r"\w+, (\w+ \d+, \d{4}) (\d+:\d+:\d+) ([ap])\.?m\.?", s)
    if not m:
        return None
    try:
        dt = datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}M", "%B %d, %Y %I:%M:%S %p")
        return dt.replace(tzinfo=timezone(__import__('datetime').timedelta(hours=1))).isoformat()
    except ValueError:
        return None


def cmd_ingest(files):
    cands = {}
    for pattern in files:
        for f in glob.glob(pattern):
            txt = open(f, encoding="utf-8").read()
            if f.endswith(".json"):
                for it in json.loads(txt):
                    url = it.get("url") or f'https://move.nl/exchange-object/{it["token"]}/overzicht'
                    oid = object_id(url.split("/exchange-object/")[1].split("/")[0])
                    cands.setdefault(oid, {"url": url, "email_sent": it.get("email_sent") or it.get("date")})
            else:
                for l in parse_email(txt):
                    cands.setdefault(l["id"], {"url": l["url"], "email_sent": l.get("email_sent")})
    print(f"candidates: {len(cands)}")
    if not cands:
        return
    existing = {r["id"] for r in sb_get("listings", {"select": "id", "id": f'in.({",".join(cands)})'})}
    new_ids = [i for i in cands if i not in existing]
    print(f"already known: {len(existing)}, new: {len(new_ids)}")
    rows, new_out, failures = [], [], []
    for oid in new_ids:
        c = cands[oid]
        try:
            e = enrich(c["url"])
            e["id"] = oid
            ed = parse_sent(c.get("email_sent")) or c.get("email_sent")
            rows.append(to_row(e, email_date=ed if ed and re.match(r"\d{4}-", str(ed)) else None))
            new_out.append({"id": oid, "address": e.get("address"), "price": e.get("price"), "m2": e.get("m2"),
                            "ownership": e.get("ownership"), "leasehold": e.get("leasehold_details"),
                            "description_en": e.get("description_en"), "fallback_summary": rows[-1]["summary"]})
            print("  +", oid, e.get("address"), e.get("status"))
        except Exception as ex:
            failures.append({"id": oid, "url": c["url"], "error": str(ex)})
            print("  ! failed", oid, ex)
    sb_upsert("listings", rows)
    json.dump({"new": new_out, "failures": failures}, open(os.path.join(ROOT, "new_listings.json"), "w"), ensure_ascii=False, indent=1)
    print(f"upserted {len(rows)}, failures {len(failures)} -> new_listings.json")


def cmd_summaries(path):
    m = json.load(open(path, encoding="utf-8"))
    rows = [{"id": k, "summary": v.strip()} for k, v in m.items() if v and v.strip()]
    for r in rows:
        resp = requests.patch(f"{SB_URL}/rest/v1/listings", headers=dict(H, Prefer="return=minimal"), params={"id": f"eq.{r['id']}"},
                              data=json.dumps({"summary": r["summary"]}), timeout=60)
        resp.raise_for_status()
    print(f"summaries applied: {len(rows)}")


def cmd_refresh(max_n=40):
    rows = sb_get("listings", {"select": "id,url,status,summary,enriched_at", "order": "enriched_at.asc.nullsfirst", "limit": str(max_n)})
    rows = [r for r in rows if r.get("status") not in FINAL]
    out, changed = [], 0
    for r in rows:
        try:
            e = enrich(r["url"]); e["id"] = r["id"]
            row = to_row(e, keep_summary=r.get("summary"))
            if row.get("status") != r.get("status"):
                changed += 1; print("  status", r["id"], r.get("status"), "->", row.get("status"))
            out.append(row)
        except Exception as ex:
            print("  ! refresh failed", r["id"], ex)
    sb_upsert("listings", out)
    print(f"refreshed {len(out)}, status changes {changed}")


def cmd_shortlist():
    ls = {l["id"]: l for l in sb_get("listings", {"select": "*"})}
    vs = sb_get("votes", {"select": "*"})
    by = {}
    for v in vs:
        by.setdefault(v["listing_id"], {})[v["who"]] = v
    people = sorted({v["who"] for v in vs} | {"davit", "luis"})
    out = []
    for lid, votes in by.items():
        l = ls.get(lid)
        if not l:
            continue
        likes = [w for w, v in votes.items() if v["vote"] == "yes"]
        if not likes:
            continue
        lease = l.get("leasehold") or {}
        until = next((v for k, v in lease.items() if "afgekocht" in k.lower()), "")
        out.append({
            "match": "YES" if len(likes) == len(people) else "",
            "liked_by": ", ".join(sorted(likes)),
            **{f"{p}_vote": (votes.get(p) or {}).get("vote", "") for p in people},
            "address": l.get("address"), "area": l.get("postcode"), "price": l.get("price"), "m2": l.get("m2"),
            "price_per_m2": l.get("price_per_m2"), "rooms": l.get("rooms"), "bedrooms": l.get("bedrooms"),
            "floor": l.get("floor"), "build_year": l.get("build_year"), "energy_label": l.get("energy_label"),
            "ownership": l.get("ownership"), "leasehold_until": until, "vve_monthly": l.get("vve_monthly"),
            "outdoor": l.get("outdoor"), "status": l.get("status"), "listed_since": l.get("listed_since"),
            "summary": l.get("summary"), "url": l.get("url"),
            "last_vote": max(v["at"] for v in votes.values()),
        })
    out.sort(key=lambda r: (r["match"] != "YES", r["last_vote"]), reverse=False)
    out.sort(key=lambda r: r["match"] != "YES")
    path = os.path.join(ROOT, "docs", "shortlist.csv")
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()) if out else ["match", "address"])
        w.writeheader(); w.writerows(out)
    print(f"shortlist rows: {len(out)} -> docs/shortlist.csv")


def cmd_stats():
    ls = sb_get("listings", {"select": "id,status"}); vs = sb_get("votes", {"select": "listing_id,who,vote"})
    from collections import Counter
    print("listings:", len(ls), dict(Counter(l["status"] for l in ls)))
    print("votes:", len(vs), dict(Counter((v["who"], v["vote"]) for v in vs)))


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a: print(__doc__); sys.exit(1)
    if a[0] == "ingest": cmd_ingest(a[1:])
    elif a[0] == "summaries": cmd_summaries(a[1])
    elif a[0] == "refresh": cmd_refresh(int(a[a.index("--max") + 1]) if "--max" in a else 40)
    elif a[0] == "shortlist": cmd_shortlist()
    elif a[0] == "stats": cmd_stats()
    else: print(__doc__); sys.exit(1)
