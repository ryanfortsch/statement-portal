# Perfection → Helm one-time data import

Pulls work slips and tasks out of the legacy Perfection (Lovable) Supabase
project and lands them in Helm's `work_slips`, `tasks`, and `task_comments`
tables. Run once to backfill. Idempotent on a `legacy_perfection_id` unique
column so a second run is safe.

## Why this is manual

Perfection's RLS blocks anon reads and Helm's Supabase access token doesn't
have admin rights on Perfection's project (`wjoxdiscgetdhnkqqrxa`). The
fastest path is dashboard exports.

## Step 1 — Export from Perfection's Supabase dashboard

Open the Perfection project in [Supabase](https://supabase.com/dashboard).
For each table below, click the table → click the three-dot menu next to
"Export" → choose **"Export data as JSON"**. Save the files into this
directory with these exact filenames:

- `properties.json`
- `work_slips.json`
- `tasks.json`
- `task_comments.json` (optional — only if you want to preserve
  conversation history on the tasks)

## Step 2 — Run the importer

From the Helm repo root:

```sh
node scripts/perfection-import/import.mjs
```

The script:

1. Reads the JSON files in this directory.
2. Builds a Perfection-property-UUID → Helm-slug map by matching on
   `properties.code`, then falling back to a normalized address match.
   Properties that can't be matched are reported and skipped.
3. Translates each work_slip and task into Helm's column shape. User
   UUIDs become `imported@perfection.legacy` placeholders unless mapped
   in `user-map.json` (see step 3).
4. Writes `inserts.sql` with the generated INSERTs (uses ON CONFLICT
   on `legacy_perfection_id` so re-runs upsert).

## Step 3 (optional) — Map Perfection users to Helm emails

The script will print every unique user UUID it encounters from
Perfection. If you want those attributed correctly in Helm
(`created_by_email`, `assigned_to_email`), create `user-map.json` here:

```json
{
  "44d6b9c0-...": "ryan@risingtidestr.com",
  "9c8e2451-...": "allie@risingtidestr.com",
  "1f3a8b2e-...": "dotti@risingtidestr.com"
}
```

Then re-run the importer.

## Step 4 — Apply the SQL to Helm

```sh
SUPABASE_ACCESS_TOKEN=<your-token> \
  supabase db query \
  --linked \
  --file scripts/perfection-import/inserts.sql
```

Or paste the SQL into Helm's Supabase SQL Editor. Either way works.

## What's NOT migrated

- `inspection_*` tables — Helm has its own inspection module already
  populated with active data.
- Photo uploads — would need a separate copy through Vercel Blob.
- Comments on work slips (Perfection didn't have them).
