// Shared synthetic schema for local PostgreSQL verifiers. No connection creation.
// Real canonical DDL/RPC bodies; peripheral tables remain minimal test fixtures.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
export async function installBookingInventoryFixture(db) {
  const root = new URL('../', import.meta.url);
  const read = path => readFileSync(new URL(path, root), 'utf8');
  const initial = read('supabase/migrations/20260507b_create_channels.sql');
  const plumbing = read('supabase/migrations/20260926200000_helm_pms_plumbing.sql');
  const capture = read('docs/guesty-exit/staging-storage/booking-inventory-events.sql');
  // Load repository enum/table definitions and the actual, unmodified canonical
  // RPC bodies. Peripheral tables are minimal fixtures, not substitutes for RPCs.
  const section = (s, from, to) => {
    const start = s.indexOf(from), end = s.indexOf(to, start);
    assert.ok(start >= 0 && end > start, `Missing schema section: ${from}`);
    return s.slice(start, end);
  };
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.property_calendar_days(id integer primary key);
    create table public.guests(id uuid primary key);`);
  await db.exec(section(read('supabase/migrations/20260430_create_properties.sql'),
    'create table public.properties (', '-- Index for'));
  await db.exec(section(plumbing, 'create table if not exists public.regions', '-- ── 2.'));
  await db.exec(section(initial, 'create type public.booking_channel', '-- ─── channel_listings'));
  await db.exec(section(initial, 'create table public.channel_listings (', '-- ─── bookings'));
  await db.exec(section(initial, 'create table public.bookings', 'create index idx_bookings_property'));
  await db.exec('alter table public.bookings add column duplicate_of uuid;');
  await db.exec(section(plumbing, 'alter table public.bookings\n', '-- ── 5.'));
  await db.exec(`create table public.automation_sends (booking_id uuid, status text, error text, updated_at timestamptz);`);
  await db.exec(section(plumbing, 'create or replace function public.helm_row_conflicts(', '-- ── 12.'));
  await db.exec(section(plumbing, 'create table if not exists public.property_rate_plans', '-- Quote-side jurisdiction'));
  await db.exec(read('supabase/migrations/20260916120000_property_rental_periods.sql'));
  await db.exec(capture);
  return { capture };
}
