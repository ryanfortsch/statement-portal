# Books Phase 3 — 1099 prep notes

> Living notes for the year-end 1099 build-out. Compiled from the
> 2026-06-09 QuickBooks Vendor Contact List exports (Rising Tide, Goose
> of Astoria, Goose of Calderwood). **No TINs in this file — those stay
> in the source spreadsheets and will be ingested via a small admin UI
> when Phase 3 lands.**

## Totals

| Entity                  | Vendors on file | Flagged "Track 1099 = Yes" |
| ----------------------- | --------------: | -------------------------: |
| Rising Tide STR LLC     |            ~134 |                         18 |
| Goose of Astoria LLC    |            ~167 |                          5 |
| Goose of Calderwood LLC |            ~140 |                          6 |

## TIN gaps (flagged 1099 = Yes, no TIN on file)

These four vendors are 1099-eligible per QB but the TIN field is blank,
which blocks an actual filing:

1. **Morris Home Services** — Rising Tide
2. **Paulo Ferrari Carpenter** — Rising Tide
3. **Supporting Strategies** — Rising Tide (the outgoing bookkeeper)
4. **A-Z Finish Carpentry LLC** — Goose of Calderwood (the 11 Rockholm
   reno contractor, ~$48k single project)

**Action:** Get W-9s from each before year-end. Until we have a TIN we
cannot issue a 1099-NEC.

## Likely flagging errors (cross-entity inconsistency)

Vendors that QB has flagged 1099 = Yes on one entity but No on another,
despite real spend on both:

| Vendor             | Flagged Yes on | Flagged No on (review)         |
| ------------------ | -------------- | ------------------------------ |
| Luana Martins      | RT + Calderwood | Astoria                       |
| Nicole Whitten     | Rising Tide    | Astoria + Calderwood           |
| Manuel Aca Tello   | Calderwood     | Rising Tide                    |
| Ian Drometer       | Rising Tide    | Astoria (no TIN there either)  |
| Owner — Susan Nolan | —              | Rising Tide (only owner unflagged) |

**Action:** Confirm with Ryan / Jim (CPA) at year-end. Helm's Phase 3
will surface vendors that crossed the $600 threshold but lack a flag.

## Dedup risk

- **Astoria: Cape Ann Elite + Rosa Binda** appear as two separate vendor
  rows with identical TIN. Without dedup we'd issue two 1099-NECs to the
  same recipient. Phase 3 reconciler must collapse by TIN, not by vendor
  name.

## Cross-entity duplicates (informational)

Vendors that appear across multiple LLCs — important because the $600
1099 threshold is per-entity, not aggregated:

| Vendor                | Entities                          |
| --------------------- | --------------------------------- |
| Cape Ann Elite        | RT + Astoria + Calderwood         |
| Tempus Fugit Law      | RT + Astoria                      |
| Lee & Crowley         | Astoria + Calderwood              |
| Pinebrook Landscaping | RT + Astoria                      |
| Luana Martins         | RT + Astoria + Calderwood         |
| Nicole Whitten        | RT + Astoria + Calderwood         |
| Manuel Aca Tello      | RT + Calderwood                   |
| Ian Drometer          | RT + Astoria                      |
| Tom Mackey Plumbing   | RT + Astoria + Calderwood         |
| Morris Home Services  | RT + Astoria                      |
| Tomer Handy Man       | RT + Astoria                      |
| Owen Brill            | RT + Astoria                      |

## What Phase 3 will build

1. A `vendors` table per entity with a separate `vendor_tins` table
   (RLS-locked to the service role; TIN field encrypted at rest).
2. An admin UI on `/books/[entity]` to ingest the Vendor Contact List
   XLSX directly — TINs never appear in chat or logs, only in the DB.
3. A year-end 1099 report: for each entity, vendors with summed
   `category_key IN ('property_cleaning', 'repairs_maintenance',
   'cleaning_operating', 'legal_accounting', ...)` payments > $600,
   joined to the TIN table, with a "ready to file" / "TIN missing" /
   "flagging gap" status per row.
4. Cross-entity dedup pass on TIN before listing.
5. Export to IRS-compatible CSV for the actual filing (manual upload
   to a 1099-NEC e-filer like Track1099 or Tax1099).
