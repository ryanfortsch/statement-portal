-- Fleet-wide CREATIVE keypad code (5555) convergence marker.
--
-- Mirrors the existing cleaner_access_code_id / inspector_access_code_id
-- columns: the daily Seam sync stamps the Seam access_code_id of this lock's
-- creative PIN here once it is confirmed on the device. The shoot brief only
-- shows the creative code for a home whose lock carries this stamp; every
-- other home falls back to that listing's own guest code or the lockbox.
--
-- Nullable + no backfill: an unstamped row simply means "not converged yet",
-- which is exactly the conservative state the brief should read.
alter table public.lock_devices
  add column if not exists creative_access_code_id text;

comment on column public.lock_devices.creative_access_code_id is
  'Seam access_code_id of the fleet-wide creative PIN on this lock. Set by ensureCreativeCode on the daily Seam sync; null means the creative code is not (yet) on this device.';
