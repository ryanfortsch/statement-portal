// Local canonical-schema subset, loaded from unmodified repository SQL sections.
// No connection creation, hosted access, customer seeds, or cutover function.
// This is NOT a replay of every migration or a snapshot of the hosted schema.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
export async function installBookingInventoryFixture(db) {
  const root = new URL('../', import.meta.url);
  const read = path => readFileSync(new URL(path, root), 'utf8');
  const migration = name => read(`supabase/migrations/${name}.sql`);
  const plumbing = migration('20260926200000_helm_pms_plumbing');
  const capture = read('docs/guesty-exit/staging-storage/booking-inventory-events.sql');
  const section = (s, from, to) => {
    const start = s.indexOf(from), end = to === undefined ? s.length : s.indexOf(to, start);
    assert.ok(start >= 0 && end > start, `Missing schema section: ${from}`);
    return s.slice(start, end);
  };
  // Model the service role's RLS bypass explicitly. It is not the table owner
  // and still needs the repository grants; anon/authenticated have no bypass.
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(section(migration('20260430_create_properties'),
    'create table public.properties (', '-- ─── Seed:'));
  await db.exec(migration('20260507b_create_channels'));
  await db.exec(migration('20260507c_channels_extras'));
  await db.exec(section(migration('20260518b_channels_calendar_phase1'),
    'alter table public.bookings', 'alter table public.inspection_plans'));
  const match = migration('20260527b_property_listing_match');
  await db.exec(section(match, 'alter table public.properties', '-- Backfill:'));
  await db.exec(section(match, 'create or replace function public.derive_listing_match()'));
  await db.exec(migration('20260721_property_calendar_days'));
  await db.exec(migration('20260916120000_property_rental_periods'));
  await db.exec(section(plumbing, 'create table if not exists public.regions', 'insert into public.regions'));
  // Only synthetic rows: satisfy the registry's cape_ann default FK without
  // loading the migration's business seeds or disabled fleet message templates.
  await db.exec("insert into public.regions(id,label,state,timezone,crew_label,tax_jurisdiction) values('cape_ann','Fixture','MA','America/New_York','Fixture','MA')");
  // Full definitions, indexes, constraints and policies for registry, channels,
  // guests, bookings/audit, rates, listing content and message scheduling.
  await db.exec(section(plumbing, 'alter table public.properties', '-- Fleet defaults, ALL DISABLED.'));
  await db.exec(section(plumbing, 'create table if not exists public.guest_threads', '-- ── 9.'));
  await db.exec(section(plumbing, 'create or replace function public.helm_row_conflicts(', '-- ── 12.'));
  // The unmodified trigger and RLS blocks refer to the real tables above.
  // Cleaner digests/reviews and flip_calendar_authority are deliberately absent.
  await db.exec(section(plumbing, '-- ── 13.'));
  await db.exec(section(migration('20260621c_rls_lockdown_audience_bookings'), '-- bookings (read'));
  await db.exec(capture);
  return { capture };
}
