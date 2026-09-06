# Scheduled job (Claude Routine, every 3 hours)

The Routine named "Amsterdam listings ingest" (cron `19 */3 * * *` UTC) wakes the long-running
Claude session that built this project, in the "Real estate" cloud environment, and sends it the
prompt below. It is bound to that session rather than starting a fresh one because only that
session carries the Gmail connector; a fresh-session Routine cannot read the mailbox.

If that session is ever archived or lost, recreate the Routine from a new session that has Gmail
attached (open claude.ai/code, start a session in the "Real estate" environment, ask it to create a
self-bound Routine with this prompt). To change the behaviour, edit the prompt in the Routine
(claude.ai/code, Routines) and keep this file in sync.

Runtime notes:
- `job.py ingest` caches each fetched listing under `inbox/cache/<id>.json` (gitignored) so a failed
  upsert does not refetch move.nl.
- If Supabase rejects a column (older schema), the job drops it and retries once; run
  `supabase/schema.sql` again in the SQL editor to add the missing column.

## Prompt

You are the scheduled ingestion job for the Amsterdam apartment swipe app.

Setup: work in the repository f54cg22yp7-maker/real_estate_amsterdam. If it is not checked out at
/home/user/real_estate_amsterdam, attach it with add_repo (push access) and clone it there. Then run
`git pull origin main` inside it. All commands below run from that directory.

1. Gmail: call search_threads with query
   `subject:(nieuwe woning OR nieuwe woningen) zoekopdracht newer_than:2d` (page size 50).
   For every thread returned, call get_thread with messageFormat PLAIN_TEXT.
2. In each email body, every listing starts with a line like `[Street 12 A, 1071 GG Amsterdam] <https://move.nl/exchange-object/<TOKEN>/overzicht?...>`.
   Collect the TOKEN (the segment between `/exchange-object/` and `/overzicht`) and the email's
   `Sent:` line. Write `inbox/ingest.json` as a JSON array of objects `{"token": TOKEN, "email_sent": SENT_LINE}`.
   One entry per listing; duplicates across emails are fine. Never write full email bodies into the repo.
3. Run `python3 pipeline/job.py ingest inbox/ingest.json`. It dedupes against the database, enriches
   new listings from their move.nl page, upserts them, and writes `new_listings.json`.
4. Read `new_listings.json`. For every entry under "new", write ONE English sentence of at most 35
   words that tells a buyer what matters most. Lead with the biggest risk or the biggest selling
   point, whichever is stronger: leasehold terms and end date, ground floor or busy road, renovation
   needed, no outdoor space, non-self-occupancy or age clause in the deed, monument status, weak VvE
   (no reserve fund or maintenance plan), then the standout positives (light, garden, park, canal).
   Use description_en and the fields provided. Save `summaries.json` as `{"<id>": "<sentence>"}` and
   run `python3 pipeline/job.py summaries summaries.json`.
5. Run `python3 pipeline/job.py refresh --max 30` so older listings pick up status changes.
6. Run `python3 pipeline/job.py shortlist`. If `docs/shortlist.csv` changed, commit it with the
   message "Update shortlist" and push to main.
7. Reply with a short report: new listings (street, price, ownership), status changes, and any
   failures from new_listings.json. If there were no new emails, say so in one line.

Never commit `inbox/`, `new_listings.json` or `summaries.json` (they are git-ignored).
If `pipeline/job.py` fails because a host is unreachable, report the host name and stop.
