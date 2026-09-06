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
from pipeline.affinity import profile as aff_profile, score as aff_score  # noqa: E402
from datetime import timedelta, date  # noqa: E402
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


def sb_get(table, params, optional=False):
    r = requests.get(f"{SB_URL}/rest/v1/{table}", headers=H, params=params, timeout=60)
    if optional and r.status_code == 404:
        print(f"  note: table {table} missing, run supabase/schema.sql (treating as empty)")
        return []
    r.raise_for_status()
    return r.json()


def sb_upsert(table, rows, on_conflict="id"):
    if not rows:
        return
    h = dict(H, Prefer="resolution=merge-duplicates,return=minimal")
    keys = sorted({k for row in rows for k in row})          # PostgREST bulk upsert needs identical keys
    rows = [{k: row.get(k) for k in keys} for row in rows]
    r = requests.post(f"{SB_URL}/rest/v1/{table}", headers=h, params={"on_conflict": on_conflict}, data=json.dumps(rows), timeout=120)
    if r.status_code == 400 and ('"42703"' in r.text or '"PGRST204"' in r.text):
        # Column missing in the database (older schema): drop it and retry once.
        m = re.search(r"column \w+\.(\w+) does not exist|Could not find the '(\w+)' column", r.text)
        if m:
            col = m.group(1) or m.group(2)
            print(f"  note: column {col} missing in DB, skipping it (run supabase/schema.sql to add)")
            rows = [{k: v for k, v in row.items() if k != col} for row in rows]
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
            cache = os.path.join(ROOT, "inbox", "cache", f"{oid}.json")
            if os.path.exists(cache):
                e = json.load(open(cache, encoding="utf-8"))
            else:
                e = enrich(c["url"])
                os.makedirs(os.path.dirname(cache), exist_ok=True)
                json.dump(e, open(cache, "w", encoding="utf-8"), ensure_ascii=False)
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
    json.dump({"new": new_out, "failures": failures}, open(os.path.join(ROOT, "new_listings.json"), "w"), ensure_ascii=False, indent=1)
    sb_upsert("listings", rows)
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


AGENT = {
    "to": ["info@damesvanvermeer.nl"],
    "cc": ["aranka@damesvanvermeer.nl", "luisgerardo.mtz@gmail.com", "davit.muradyan@outlook.com"],
    "greeting": "Hi Eline, Aranka,",
}
NUDGE_TO = ["davit.ierusalimski@gmail.com", "luisgerardo.mtz@gmail.com"]
APP_URL = "https://f54cg22yp7-maker.github.io/real_estate_amsterdam/"


def sb_patch(table, params, data):
    r = requests.patch(f"{SB_URL}/rest/v1/{table}", headers=dict(H, Prefer="return=minimal"), params=params,
                       data=json.dumps(data), timeout=60)
    r.raise_for_status()


def lease_until(l):
    lease = l.get("leasehold") or {}
    return next((str(v)[:10] for k, v in lease.items() if "afgekocht" in k.lower()), "")


def ownership_line(l):
    o = (l.get("ownership") or "").lower()
    if o.startswith("freehold"):
        return "Eigen grond (freehold, no ground lease)"
    if o.startswith("leasehold"):
        u = lease_until(l)
        if "eeuwig" in u.lower():
            return "Erfpacht (leasehold), bought off in perpetuity"
        return f"Erfpacht (leasehold), paid until {u[:4]}" if u else "Erfpacht (leasehold), terms to confirm"
    return "Ownership to confirm"


def cmd_shortlist():
    ls = {l["id"]: l for l in sb_get("listings", {"select": "*"})}
    vs = sb_get("votes", {"select": "*"})
    vw = {v["listing_id"]: v for v in sb_get("viewings", {"select": "*"}, optional=True)}
    ev = {}
    for e in sb_get("evaluations", {"select": "listing_id,who,verdict,scores"}, optional=True):
        ev.setdefault(e["listing_id"], {})[e["who"]] = e
    by = {}
    for v in vs:
        by.setdefault(v["listing_id"], {})[v["who"]] = v
    people = ["davit", "luis"]
    liked = [ls[i] for i, votes in by.items() if i in ls and any(v["vote"] == "yes" for v in votes.values())]
    prof = aff_profile(liked)
    pref_rows = sb_get("app_events", {"select": "data", "key": "eq.couple_prefs"})
    prefs = (pref_rows[0].get("data") if pref_rows else None) or None
    out = []
    for lid, votes in by.items():
        l = ls.get(lid)
        if not l:
            continue
        likes = [w for w, v in votes.items() if v["vote"] == "yes"]
        if not likes:
            continue
        match = len(likes) == len(people)
        aff = aff_score(l, prof, prefs) or 0
        evs = ev.get(lid, {})
        def avg(e):
            sc = [v for v in (e.get("scores") or {}).values() if isinstance(v, (int, float))]
            return round(sum(sc) / len(sc), 1) if sc else ""
        out.append({
            "rank": 0,
            "match": "YES" if match else "",
            "davit": (votes.get("davit") or {}).get("vote", ""),
            "luis": (votes.get("luis") or {}).get("vote", ""),
            "affinity": aff,
            "viewing": (vw.get(lid) or {}).get("stage", ""),
            "viewing_date": ((vw.get(lid) or {}).get("scheduled_at") or "")[:16].replace("T", " "),
            "davit_verdict": (evs.get("davit") or {}).get("verdict", ""), "davit_score": avg(evs.get("davit", {})),
            "luis_verdict": (evs.get("luis") or {}).get("verdict", ""), "luis_score": avg(evs.get("luis", {})),
            "address": l.get("address"), "area": l.get("postcode"), "price": l.get("price"), "m2": l.get("m2"),
            "price_per_m2": l.get("price_per_m2"), "rooms": l.get("rooms"), "bedrooms": l.get("bedrooms"),
            "floor": l.get("floor"), "build_year": l.get("build_year"), "energy_label": l.get("energy_label"),
            "ownership": l.get("ownership"), "leasehold_until": lease_until(l), "vve_monthly": l.get("vve_monthly"),
            "outdoor": l.get("outdoor"), "status": l.get("status"), "summary": l.get("summary"), "url": l.get("url"),
            "last_vote": max(v["at"] for v in votes.values())[:16].replace("T", " "),
        })
    out.sort(key=lambda r: (r["match"] != "YES", -r["affinity"], r["last_vote"]))
    for i, r in enumerate(out, 1):
        r["rank"] = i
    path = os.path.join(ROOT, "docs", "shortlist.csv")
    cols = ["rank", "match", "davit", "luis", "affinity", "viewing", "viewing_date", "davit_verdict", "davit_score",
            "luis_verdict", "luis_score", "address", "area", "price", "m2", "price_per_m2", "rooms", "bedrooms", "floor",
            "build_year", "energy_label", "ownership", "leasehold_until", "vve_monthly", "outdoor", "status", "summary",
            "url", "last_vote"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader(); w.writerows(out)
    print(f"shortlist rows: {len(out)} -> docs/shortlist.csv")


def next_week_slots(today=None):
    """Wednesday afternoon, Friday morning, Friday afternoon of the following week, as text."""
    today = today or date.today()
    monday = today + timedelta(days=(7 - today.weekday()))  # next Monday
    wed, fri = monday + timedelta(days=2), monday + timedelta(days=4)
    f = lambda d: d.strftime("%A %-d %B")
    return f"{f(wed)} in the afternoon, or {f(fri)} in the morning or afternoon"


def cmd_outbox():
    """Compose the viewing-request emails for unsent viewing_requests -> outbox.json (the session sends them)."""
    reqs = sb_get("viewing_requests", {"select": "*", "sent_at": "is.null", "order": "created_at.asc"}, optional=True)
    if not reqs:
        print("outbox: nothing to send"); json.dump([], open(os.path.join(ROOT, "outbox.json"), "w")); return
    ls = {l["id"]: l for l in sb_get("listings", {"select": "*"})}
    mails = []
    for r in reqs:
        ids = [i for i in r["listing_ids"] if i in ls]
        if not ids:
            sb_patch("viewing_requests", {"id": f"eq.{r['id']}"}, {"error": "no listings"}); continue
        week = datetime.now(timezone.utc).isocalendar()[1]
        lines = []
        for i in ids:
            l = ls[i]
            lines.append(f"{l['address']}\n{l['url']}\n€ {l['price']:,}".replace(",", ".") + f",- k.k. · {l.get('m2')} m² · {ownership_line(l)}")
        avail = (r.get("availability") or "").strip()
        avail_line = avail if avail else f"For viewings we are available {next_week_slots()}. If none of those work we can usually be flexible, just let us know what is possible."
        body = (f"{AGENT['greeting']}\n\nHope all is well! We went through this week's listings and would like to view the following "
                f"{'one' if len(ids) == 1 else str(len(ids))}:\n\n" + "\n\n".join(lines) +
                f"\n\n{avail_line}\n\nThanks in advance!\n\nBest,\nDavit & Luis")
        mails.append({"request_id": r["id"], "to": AGENT["to"], "cc": AGENT["cc"], "subject": f"Week {week} listings: viewing request",
                      "body": body, "listing_ids": ids})
    json.dump(mails, open(os.path.join(ROOT, "outbox.json"), "w"), ensure_ascii=False, indent=1)
    print(f"outbox: {len(mails)} email(s) composed -> outbox.json")


def cmd_outbox_sent(request_id, via="gmail"):
    now = datetime.now(timezone.utc).isoformat()
    sb_patch("viewing_requests", {"id": f"eq.{request_id}"}, {"sent_at": now, "sent_via": via, "error": None})
    r = sb_get("viewing_requests", {"select": "listing_ids", "id": f"eq.{request_id}"})
    ids = r[0]["listing_ids"] if r else []
    if ids:
        sb_patch("viewings", {"listing_id": f"in.({','.join(ids)})", "stage": "eq.requested"}, {"updated_at": now})
    print(f"marked {request_id} sent via {via} ({len(ids)} listings)")


def cmd_weekly():
    """Saturday nudge: list this week's likes; write weekly.json for the session to email, unless already sent this ISO week."""
    now = datetime.now(timezone.utc)
    key = f"nudge-{now.isocalendar()[0]}-W{now.isocalendar()[1]:02d}"
    if now.weekday() != 5:
        print("weekly: not Saturday, skip"); json.dump(None, open(os.path.join(ROOT, "weekly.json"), "w")); return
    if sb_get("app_events", {"select": "key", "key": f"eq.{key}"}, optional=True):
        print("weekly: nudge already sent this week"); json.dump(None, open(os.path.join(ROOT, "weekly.json"), "w")); return
    since = (now - timedelta(days=7)).isoformat()
    vs = sb_get("votes", {"select": "listing_id,who,vote,at", "vote": "eq.yes", "at": f"gte.{since}"})
    ids = sorted({v["listing_id"] for v in vs})
    ls = {l["id"]: l for l in sb_get("listings", {"select": "id,address,price,m2,url,status", "id": f"in.({','.join(ids)})"})} if ids else {}
    allv = sb_get("votes", {"select": "listing_id,who,vote", "listing_id": f"in.({','.join(ids)})"}) if ids else []
    both = {i for i in ids if sum(1 for v in allv if v["listing_id"] == i and v["vote"] == "yes") == 2}
    lines = [f"- {ls[i]['address']} · € {ls[i]['price']:,}".replace(",", ".") + f" · {ls[i].get('m2')} m²" + (" · MATCH" if i in both else "") for i in ids if i in ls]
    mail = {"key": key, "to": NUDGE_TO, "subject": f"Pand weekly pick: {len(ids)} liked this week" if ids else "Pand weekly pick: nothing new this week",
            "body": ("Hi both,\n\n" + (f"{len(ids)} listing(s) got a like this week ({len(both)} match). Open Pand, tap Viewings and choose which ones to request:\n\n" + "\n".join(lines) if ids else "No new likes this week. Keep swiping, new listings arrive every few hours.") + f"\n\n{APP_URL}\n")}
    json.dump(mail, open(os.path.join(ROOT, "weekly.json"), "w"), ensure_ascii=False, indent=1)
    print(f"weekly: nudge composed ({len(ids)} likes, {len(both)} matches) -> weekly.json")


def cmd_weekly_sent(key):
    sb_upsert("app_events", [{"key": key, "at": datetime.now(timezone.utc).isoformat()}], on_conflict="key")
    print("weekly: logged", key)


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
    elif a[0] == "outbox": cmd_outbox()
    elif a[0] == "outbox-sent": cmd_outbox_sent(a[1], a[2] if len(a) > 2 else "gmail")
    elif a[0] == "weekly": cmd_weekly()
    elif a[0] == "weekly-sent": cmd_weekly_sent(a[1])
    elif a[0] == "stats": cmd_stats()
    else: print(__doc__); sys.exit(1)
