#!/usr/bin/env node
/**
 * The locked booking writer must refuse a double-booking under contention.
 *
 * helm_create_booking (supabase/migrations/20260926200000_helm_pms_plumbing.sql)
 * takes pg_advisory_xact_lock('helm_bookings:<property_id>') and checks the
 * overlap inside the lock, so two writers racing for the same nights on the
 * same home serialize and exactly one wins; the loser gets SQLSTATE P0002
 * 'booking_overlap' with the winner in the detail. This harness proves that
 * against a linked database by firing two concurrent RPC calls for the same
 * nights on a throwaway property and asserting one 2xx and one P0002.
 *
 * Writes only to a property it creates (id zz_overlap_check_<stamp>,
 * is_active false, kind 'managed') and removes it afterwards, bookings and
 * booking_events cascading with it. It never touches a real home.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the
 * environment or .env.local. Without them it prints a skip line and exits 0
 * so a CI box without secrets does not fail.
 *
 *   node scripts/helm_booking_overlap_check.mjs
 *   node scripts/helm_booking_overlap_check.mjs --keep      (leave the throwaway rows for inspection)
 */
import { readFileSync, existsSync } from 'node:fs';

function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  }
}

loadEnv();
const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!url || !key) {
  console.log('skip: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not both set (env or .env.local)');
  process.exit(0);
}

const keep = process.argv.includes('--keep');
const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
};

const stamp = Date.now().toString(36);
const propertyId = `zz_overlap_check_${stamp}`;
const CHECK_IN = '2031-01-10';
const CHECK_OUT = '2031-01-14';

let failures = 0;
const check = (label, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${extra ? `: ${extra}` : ''}`);
};

async function rest(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: { ...headers, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json, text };
}

async function createThrowawayProperty() {
  const r = await rest(
    'POST',
    'properties',
    {
      id: propertyId,
      name: `Overlap check ${stamp}`,
      address: '0 Nowhere Lane',
      city: 'Nowhere',
      is_active: false,
      kind: 'managed',
      owner_last: 'Check',
      owner_full: 'Overlap Check',
      owner_greeting: 'Check',
      management_fee_pct: 0,
      calendar_authority: 'helm',
    },
    { Prefer: 'return=minimal' },
  );
  if (!r.ok) throw new Error(`could not create throwaway property: ${r.status} ${r.text}`);
}

async function cleanup() {
  if (keep) {
    console.log(`\n(kept) property ${propertyId} and its bookings are still there for inspection`);
    return;
  }
  // bookings and booking_events cascade from properties; delete explicitly
  // first anyway so a partial cascade never leaves a stray row.
  await rest('DELETE', `bookings?property_id=eq.${encodeURIComponent(propertyId)}`);
  const r = await rest('DELETE', `properties?id=eq.${encodeURIComponent(propertyId)}`);
  if (!r.ok) console.log(`  warn  cleanup of ${propertyId} returned ${r.status}: ${r.text}`);
}

function createBookingRpc(label) {
  return rest('POST', 'rpc/helm_create_booking', {
    p_property_id: propertyId,
    p_channel: 'manual',
    p_source: 'manual',
    p_status: 'confirmed',
    p_check_in: CHECK_IN,
    p_check_out: CHECK_OUT,
    p_fields: { guest_name: `Overlap check ${label}`, notes: 'scripts/helm_booking_overlap_check.mjs' },
    p_actor: 'overlap-check',
    p_allow_overlap: false,
  });
}

console.log(`\n=== helm_create_booking under contention (${propertyId}) ===\n`);

let exitCode = 0;
try {
  await createThrowawayProperty();

  // Fire both at once. Node issues them on separate connections; PostgREST
  // runs them in separate transactions; the advisory lock serializes them.
  const [a, b] = await Promise.all([createBookingRpc('A'), createBookingRpc('B')]);

  const wins = [a, b].filter((r) => r.ok);
  const overlaps = [a, b].filter((r) => !r.ok && r.json && r.json.code === 'P0002');
  const other = [a, b].filter((r) => !r.ok && !(r.json && r.json.code === 'P0002'));

  check('exactly one create succeeded', wins.length === 1, `${wins.length} succeeded (${a.status}, ${b.status})`);
  check('exactly one create was refused with P0002 booking_overlap', overlaps.length === 1, `${overlaps.length} refused`);
  check('no other failure mode', other.length === 0, other.map((r) => `${r.status} ${r.text.slice(0, 200)}`).join(' | '));

  if (overlaps.length === 1) {
    let detail = null;
    try {
      detail = JSON.parse(overlaps[0].json.details);
    } catch {
      detail = null;
    }
    const winner = wins[0] && (Array.isArray(wins[0].json) ? wins[0].json[0] : wins[0].json);
    check('the refusal names the winning row', !!detail && !!winner && detail.booking_id === winner.id,
      detail ? `detail ${detail.booking_id} vs winner ${winner ? winner.id : 'none'}` : 'no JSON detail');
    check('the refusal carries the winner\'s nights', !!detail && detail.check_in === CHECK_IN && detail.check_out === CHECK_OUT);
  }

  // The lock held: the table agrees with the responses.
  const rows = await rest('GET', `bookings?property_id=eq.${encodeURIComponent(propertyId)}&select=id,status,check_in,check_out,external_confirmation_code`);
  const confirmed = (rows.json || []).filter((r) => r.status === 'confirmed');
  check('exactly one confirmed row holds the nights', confirmed.length === 1, `${confirmed.length} confirmed rows`);

  // A third, non-overlapping create must still go through (the lock is per
  // property, not a global refusal).
  const c = await rest('POST', 'rpc/helm_create_booking', {
    p_property_id: propertyId,
    p_channel: 'manual',
    p_source: 'manual',
    p_status: 'confirmed',
    p_check_in: CHECK_OUT,
    p_check_out: '2031-01-16',
    p_fields: { guest_name: 'Overlap check C (same-day turnover)' },
    p_actor: 'overlap-check',
    p_allow_overlap: false,
  });
  check('a same-day turnover (check-in on the other stay\'s check-out) is not an overlap', c.ok, `${c.status} ${c.ok ? '' : c.text.slice(0, 200)}`);

  // And an inquiry over the taken nights is accepted: inquiries never hold.
  const inq = await rest('POST', 'rpc/helm_create_booking', {
    p_property_id: propertyId,
    p_channel: 'direct',
    p_source: 'direct_booking',
    p_status: 'inquiry',
    p_check_in: CHECK_IN,
    p_check_out: CHECK_OUT,
    p_fields: { guest_name: 'Overlap check inquiry' },
    p_actor: 'overlap-check',
    p_allow_overlap: false,
  });
  check('an inquiry over the taken nights is accepted (inquiries never hold dates)', inq.ok, `${inq.status} ${inq.ok ? '' : inq.text.slice(0, 200)}`);

  const events = await rest('GET', `booking_events?select=kind&booking_id=in.(${(rows.json || []).map((r) => r.id).join(',')})`);
  check('every surviving row has a created event', Array.isArray(events.json) && events.json.length >= confirmed.length, `${Array.isArray(events.json) ? events.json.length : 'n/a'} events`);
} catch (err) {
  failures++;
  console.log(`  FAIL  ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await cleanup();
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  exitCode = 1;
} else {
  console.log('\nall checks passed: the advisory lock serialized the race and exactly one create won');
}
process.exit(exitCode);
