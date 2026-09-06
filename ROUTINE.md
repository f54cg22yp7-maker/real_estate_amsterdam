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

Scheduled run of the Pand listings job. Work in /home/user/real_estate_amsterdam and follow these steps in order; do not ask questions, use the defaults established in this conversation.

1. `git pull`.
2. Gmail: search_threads with query `subject:(nieuwe woning OR nieuwe woningen) zoekopdracht newer_than:2d` (page size 50), get_thread each result in PLAIN_TEXT, and write inbox/ingest.json with one {"token","email_sent"} per listing. Then run `python3 pipeline/job.py ingest inbox/ingest.json`.
3. For every entry in new_listings.json write a one-sentence buyer summary (ownership and leasehold end, size, floor, bedrooms, outdoor space, energy label, VvE, price per m², one qualitative hook from the description) into summaries.json and run `python3 pipeline/job.py summaries summaries.json`.
4. `python3 pipeline/job.py refresh --max 30` so statuses stay current.
5. Viewing requests: run `python3 pipeline/job.py outbox`. For every email in outbox.json, send it with Gmail send_message (to, cc, subject, body exactly as composed), then run `python3 pipeline/job.py outbox-sent <request_id> gmail`. If sending fails, leave the request unsent and report it.
6. Weekly nudge: run `python3 pipeline/job.py weekly`. If weekly.json is not null, send it with Gmail send_message (to, subject, body) and run `python3 pipeline/job.py weekly-sent <key>`.
7. `python3 pipeline/job.py shortlist`; if docs/shortlist.csv changed, commit it to main with message "Update shortlist" and push.
8. Finish with a short report: new listings, status changes, emails sent, failures. If a host is unreachable, name it and stop.
