-- Cleaner checkout schedule: the single source of truth for "what checks
-- out tomorrow, at what time" that the cleaning crew can actually trust.
--
-- The problem: cleaners work off Guesty, but Helm-side reality drifts from
-- it daily -- a late checkout agreed in guest messaging, a stay extension
-- collected by payment link that gets squared away in Guesty manually and
-- late. Rosa never has the full picture.
--
-- The shape: `bookings` (Guesty-synced) stays the base layer. A new
-- `checkout_adjustments` overlay records per-stay divergence Helm knows
-- about -- a new checkout TIME (late/early checkout) and/or a new checkout
-- DATE (extension/shortening) -- written by the operator from the schedule
-- page, or proposed by a miner that reads recent guest threads for agreed
-- changes. lib/checkout-schedule.ts merges base + overlay + per-property
-- default times into the effective schedule.
--
-- Delivery: a daily cron drafts a next-day digest SMS (one row per
-- service_date in `cleaner_schedule_digests`), the operator approves it on
-- /cleaner-messaging, and Helm sends it via Quo to every enabled row in
-- `cleaner_schedule_recipients`. Each recipient carries a portal token for
-- the public mobile schedule page (/clean/<token>), which renders LIVE data
-- so the link in an already-sent text never goes stale.
--
-- Recipients + tokens deliberately do NOT live on `cleaner_phones`: that
-- table still carries permissive anon RLS policies (pre-lockdown backlog),
-- and the portal token must not be anon-readable. All three new tables are
-- service-role only from birth.

-- Per-property default times, 24h HH:MM strings. NULL = never set: the
-- guesty sync fill-empties these from the listing's defaultCheckOutTime /
-- defaultCheckInTime (the true source, previously read by nothing in
-- Helm), and an operator edit on the schedule page sticks because the
-- sync only ever fills NULLs. Readers fall back to 10:00 / 16:00.
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS default_checkout_time TEXT,
  ADD COLUMN IF NOT EXISTS default_checkin_time TEXT;

-- Per-stay divergence from the Guesty-synced base. A stay is keyed
-- (property_id, stay_check_in) -- NEVER bookings.id, which holds duplicate
-- rows per stay (guesty_legacy + ical placeholders).
CREATE TABLE IF NOT EXISTS checkout_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id TEXT NOT NULL,
  stay_check_in DATE NOT NULL,
  -- What bookings.check_out said when this adjustment was written. If the
  -- live value moves (Guesty caught up, or the stay changed again) the UI
  -- flags the row for review instead of silently compounding.
  original_check_out DATE NOT NULL,
  -- At least one of the two override fields is set.
  adjusted_check_out DATE,          -- extension / early departure (new checkout DATE)
  adjusted_checkout_time TEXT,      -- late / early checkout (new TIME, HH:MM)
  note TEXT NOT NULL DEFAULT '',
  -- 'operator' rows are live immediately; 'miner' rows come from the
  -- guest-thread miner. High-confidence mined agreements auto-apply
  -- (status 'active'), lower confidence lands as 'proposed' for a
  -- one-tap apply on the digest card.
  source TEXT NOT NULL DEFAULT 'operator',   -- operator | miner
  miner_key TEXT UNIQUE,            -- guestmsg:<conversation_id>:<message_id>, miner idempotency
  evidence TEXT,                    -- verbatim quote from the thread
  confidence TEXT,                  -- high | medium | low (miner rows)
  status TEXT NOT NULL DEFAULT 'active',     -- proposed | active | dismissed | superseded
  created_by TEXT NOT NULL DEFAULT '',       -- operator email, or 'miner'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (adjusted_check_out IS NOT NULL OR adjusted_checkout_time IS NOT NULL),
  CHECK (source IN ('operator', 'miner')),
  CHECK (status IN ('proposed', 'active', 'dismissed', 'superseded'))
);

-- One live adjustment per stay; writers supersede the previous active row.
CREATE UNIQUE INDEX IF NOT EXISTS checkout_adjustments_one_active_per_stay
  ON checkout_adjustments(property_id, stay_check_in)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS checkout_adjustments_status_idx
  ON checkout_adjustments(status, stay_check_in);

-- Who receives the daily digest SMS, and their stable portal token for the
-- public mobile schedule page. Seeded from active cleaner_phones rows so no
-- phone numbers are committed here; Rosa starts enabled (she runs the
-- cleaning schedule), everyone else present but off until toggled on the
-- digest card.
CREATE TABLE IF NOT EXISTS cleaner_schedule_recipients (
  phone TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  portal_token TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO cleaner_schedule_recipients (phone, display_name, portal_token, enabled)
SELECT
  phone,
  display_name,
  substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 32),
  (display_name ILIKE 'rosa%')
FROM cleaner_phones
WHERE active
ON CONFLICT (phone) DO NOTHING;

-- One digest per service day. The cron builds/refreshes the pending row
-- the afternoon before; approval on /cleaner-messaging stores the final
-- (possibly operator-edited) body and the per-recipient send results.
CREATE TABLE IF NOT EXISTS cleaner_schedule_digests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_date DATE NOT NULL UNIQUE,
  -- pending -> sending (atomic operator claim, so two tabs can't
  -- double-text Rosa) -> sent. skipped = the day passed unapproved.
  -- "Send an update" after a schedule change re-sends from the sent
  -- state and appends a batch to sent_log.
  status TEXT NOT NULL DEFAULT 'pending',
  body TEXT NOT NULL,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {checkouts, sameDay, adjusted, proposed}
  built_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  sent_by TEXT,                              -- operator email
  sent_log JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{at, by, results: [{phone, name, ok, quo_message_id | error}]}]
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('pending', 'sending', 'sent', 'skipped'))
);

CREATE INDEX IF NOT EXISTS cleaner_schedule_digests_status_idx
  ON cleaner_schedule_digests(status, service_date);

-- Service-role only, like every new Helm table: RLS on, no policies.
ALTER TABLE checkout_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaner_schedule_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaner_schedule_digests ENABLE ROW LEVEL SECURITY;
