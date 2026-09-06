# One-time setup (owner actions)

## 1. Network allowlist for the "Real estate" environment  (done)

`move.nl`, `*.move.nl`, `images.realworks.nl`, plus your Supabase project host `<project-ref>.supabase.co`.

## 2. Supabase

1. Supabase dashboard > your project > **SQL editor** > paste the whole of `supabase/schema.sql` > Run.
   The file is idempotent: every statement is `create ... if not exists` / `drop policy if exists`, so
   running it again never deletes data. Re-run it whenever the file changes (v2 added the viewings,
   evaluations, viewing_requests, viewing_photos and app_events tables, the `listed_since` column and
   the `viewing-photos` storage bucket).
2. **Project settings > API**: copy the **Project URL** and the **anon / publishable** key.
   Paste both into `docs/config.js`. The anon key is designed to be public; access is controlled by the
   row-level-security policies in the schema.

## 3. GitHub Pages

Repository > **Settings > Pages** > Source: *Deploy from a branch* > Branch `main`, folder `/docs` > Save.
App URL: `https://f54cg22yp7-maker.github.io/real_estate_amsterdam/`
On each iPhone: open in Safari > Share > **Add to Home Screen**.

## 4. Google Sheet (personal account)

Sharing from the corporate Drive is blocked, so create the sheet yourself, once, in the Google account
you want it in (davit.ierusalimski@gmail.com):

1. Open https://sheets.new while signed in to that account, name it "Pand shortlist".
2. In cell A1 paste:
   `=IMPORTDATA("https://f54cg22yp7-maker.github.io/real_estate_amsterdam/shortlist.csv")`
3. Share it with luisgerardo.mtz@gmail.com.

The sheet refreshes itself about hourly from the CSV the job publishes. Columns: rank, match, davit,
luis, affinity (0-100, closeness to what you both liked), viewing stage and date, each person's
post-viewing verdict and average score, then the facts, summary and the listing link.
Ranking: matches first, then affinity descending.

## 5. Weekly viewing request (how it flows)

1. Every Saturday the job emails both of you a nudge and the app opens the **Weekly pick** on first
   launch that weekend (also reachable any time from the Viewings tab).
2. Tick the apartments to view (matches are pre-ticked, aim for about 5), optionally type your
   availability, then either **Send request from Pand** (queued; the job emails Dames van Vermeer from
   davit.ierusalimski@gmail.com within 3 hours, cc Aranka, Luis and your Outlook) or **Send from my
   phone** (opens Mail with the same text so it goes from your Outlook address).
3. Those listings move to **Requested**. When the agent confirms, open the listing, set the date under
   Viewing and save: it moves to **Scheduled**.
4. At the viewing open the listing > **Start viewing evaluation**: slide the 1-5 scores per category,
   tick the checklist, pick a verdict, add notes and photos. Each of you scores separately; the other
   person's marks show as small dots. Saved live, and the listing moves to **Viewed**.

## 6. Login (Supabase Auth)

Run `supabase/schema.sql` again first (v3 adds the `profiles` table). Then in the Supabase dashboard:

1. **Authentication > URL configuration**: Site URL `https://f54cg22yp7-maker.github.io/real_estate_amsterdam/`
   and add the same URL under Redirect URLs.
2. **Authentication > Email templates > Magic Link**: add the line `Your code: {{ .Token }}` to the
   template body. Without it the email only contains a link; the link works too, but opens in Safari
   rather than in the home-screen app, so the 6-digit code is the smoother path on iPhone.
3. Optional, **Google**: Authentication > Providers > Google > enable, paste a Google OAuth client ID
   and secret from console.cloud.google.com (Credentials > OAuth client > Web application, with
   `https://swqhwoqgjgvzkdlrehjf.supabase.co/auth/v1/callback` as authorised redirect URI).
4. Optional, **Apple**: needs an Apple Developer account (paid) plus a Services ID and key;
   Authentication > Providers > Apple. Until enabled the Apple button shows "not enabled yet".

Who is who: the app maps the signed-in email to a person using `people[].emails` in `docs/config.js`
(Davit: davit.ierusalimski@gmail.com and davit.muradyan@outlook.com, Luis: luisgerardo.mtz@gmail.com).
Any other email is asked to pick a person once. Votes keep using the person name, so everything
already swiped stays attached.

"Continue without an account" keeps the old link-only behaviour on that phone.

## 6. Login (optional)

The app works without login: tap "Continue without an account" and pick who you are in settings.
Login adds identity and lets preferences follow you between phones.

Email code: Supabase only allows editing the email template once you send through your own mail
server. Authentication > Emails > "Set up SMTP": sender davit.ierusalimski@gmail.com, host
smtp.gmail.com, port 465, username the same Gmail, password a Google app password
(https://myaccount.google.com/apppasswords). Then Emails > Magic link or OTP > Source, add
`<p>Your code: {{ .Token }}</p>` under the sign-in link, Save.

Google sign-in:
1. https://console.cloud.google.com, new project "Pand".
2. APIs & Services > OAuth consent screen > External. App name Pand, your Gmail as contact.
   Test users: both Gmail addresses.
3. Credentials > Create credentials > OAuth client ID > Web application.
   Authorised JavaScript origin: https://f54cg22yp7-maker.github.io
   Authorised redirect URI: https://swqhwoqgjgvzkdlrehjf.supabase.co/auth/v1/callback
4. Supabase > Authentication > Sign In / Providers > Google: enable, paste Client ID and secret, Save.
5. Authentication > URL Configuration: Site URL and a Redirect URL both set to
   https://f54cg22yp7-maker.github.io/real_estate_amsterdam/

The app only shows the Google and Apple buttons once the provider is enabled in Supabase.
