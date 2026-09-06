# One-time setup (owner actions)

## 1. Network allowlist for the "Real estate" environment  (done)

`move.nl`, `*.move.nl`, `images.realworks.nl`, plus your Supabase project host `<project-ref>.supabase.co`.

## 2. Supabase

1. Supabase dashboard > your project > **SQL editor** > paste `supabase/schema.sql` > Run.
2. **Project settings > API**: copy the **Project URL** and the **anon / publishable** key.
   Paste both into `docs/config.js`. The anon key is designed to be public; access is controlled by the
   row-level-security policies in the schema.

## 3. GitHub Pages

Repository > **Settings > Pages** > Source: *Deploy from a branch* > Branch `main`, folder `/docs` > Save.
App URL: `https://f54cg22yp7-maker.github.io/real_estate_amsterdam/`
On each iPhone: open in Safari > Share > **Add to Home Screen**.
