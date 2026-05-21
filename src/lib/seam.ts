/**
 * Seam smart-lock API client + ingest pipeline.
 *
 * Seam (https://seam.co) is a universal lock API. Rising Tide's Schlage
 * Encode locks connect through it, and Seam reports per-device battery
 * level plus low-battery webhooks. We turn that into:
 *   - lock_battery_status rows (read by the Operations turnover pipeline)
 *   - a high-priority maintenance work slip when a mapped lock goes low.
 *
 * Auth: API key via `Authorization: Bearer <key>`.
 * Webhooks: delivered through Svix; verified with the standard Svix
 *   scheme (svix-id / svix-timestamp / svix-signature, secret `whsec_...`).
 *
 * Everything here is env-guarded: with no SEAM_API_KEY the REST calls
 * throw a clear error and the routes no-op, so the feature stays dark
 * until the locks are connected.
 */

import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ACTIVE_WORK_SLIP_STATUSES } from './work-types';

const SEAM_API = 'https://connect.getseam.com';

/** Battery at or below this percent is "bring batteries" territory. */
export const BATTERY_LOW_THRESHOLD = 20;

/** System sentinel for the NOT NULL created_by_email on auto-slips. */
const LOCK_BOT_EMAIL = 'locks@helm.system';

// ── Types ───────────────────────────────────────────────────────────

export type SeamBatteryStatus = 'full' | 'good' | 'low' | 'critical' | 'unknown';

export type SeamDevice = {
  device_id: string;
  device_type?: string;
  connected_account_id?: string;
  workspace_id?: string;
  properties?: {
    online?: boolean;
    name?: string;
    manufacturer?: string;
    battery_level?: number; // 0..1
    battery?: { level?: number; status?: SeamBatteryStatus };
    model?: { display_name?: string; manufacturer_display_name?: string };
  };
};

export type SeamWebhookEvent = {
  event_id?: string;
  event_type: string;
  workspace_id?: string;
  created_at?: string;
  device_id?: string;
  connected_account_id?: string;
  battery_level?: number; // 0..1, present on battery events
  battery_status?: SeamBatteryStatus;
};

/** Provider-shape-agnostic device snapshot the ingest pipeline consumes. */
export type NormalizedDevice = {
  deviceId: string;
  name: string | null;
  manufacturer: string | null;
  connectedAccountId: string | null;
  online: boolean | null;
  batteryPct: number | null; // 0..100
  batteryStatus: SeamBatteryStatus;
};

// ── Pure battery helpers ────────────────────────────────────────────

/** Seam reports battery as a 0..1 float; we store a 0..100 integer. */
export function pctFromLevel(level: number | null | undefined): number | null {
  if (level == null || !Number.isFinite(level)) return null;
  return Math.max(0, Math.min(100, Math.round(level * 100)));
}

function deriveStatus(pct: number | null): SeamBatteryStatus {
  if (pct == null) return 'unknown';
  if (pct <= 10) return 'critical';
  if (pct <= BATTERY_LOW_THRESHOLD) return 'low';
  if (pct <= 50) return 'good';
  return 'full';
}

/**
 * The threshold check used by both the ingest pipeline (slip creation)
 * and the Operations turnover chip. Prefer the numeric percent; fall
 * back to Seam's status enum when no level is reported.
 */
export function isLowBattery(pct: number | null, status: SeamBatteryStatus): boolean {
  if (pct != null) return pct <= BATTERY_LOW_THRESHOLD;
  return status === 'low' || status === 'critical';
}

export function normalizeFromDevice(d: SeamDevice): NormalizedDevice {
  const props = d.properties ?? {};
  const level = props.battery?.level ?? props.battery_level ?? null;
  const pct = pctFromLevel(level);
  const rawStatus = props.battery?.status;
  return {
    deviceId: d.device_id,
    name: props.name ?? props.model?.display_name ?? null,
    manufacturer: props.manufacturer ?? props.model?.manufacturer_display_name ?? null,
    connectedAccountId: d.connected_account_id ?? null,
    online: props.online ?? null,
    batteryPct: pct,
    batteryStatus: rawStatus && rawStatus !== 'unknown' ? rawStatus : deriveStatus(pct),
  };
}

export function normalizeFromEvent(ev: SeamWebhookEvent): NormalizedDevice | null {
  if (!ev.device_id) return null;
  const pct = pctFromLevel(ev.battery_level);
  return {
    deviceId: ev.device_id,
    name: null,
    manufacturer: null,
    connectedAccountId: ev.connected_account_id ?? null,
    online: null,
    batteryPct: pct,
    batteryStatus: ev.battery_status && ev.battery_status !== 'unknown' ? ev.battery_status : deriveStatus(pct),
  };
}

// ── REST client ─────────────────────────────────────────────────────

export function seamConfigured(): boolean {
  return !!process.env.SEAM_API_KEY;
}

function apiKey(): string {
  const k = process.env.SEAM_API_KEY || '';
  if (!k) throw new Error('SEAM_API_KEY is not set');
  return k;
}

async function seamGet<T>(path: string): Promise<T> {
  const res = await fetch(`${SEAM_API}${path}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Seam ${path} failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function listDevices(): Promise<SeamDevice[]> {
  const res = await seamGet<{ devices: SeamDevice[] }>('/devices/list');
  return res.devices ?? [];
}

export async function getDevice(deviceId: string): Promise<SeamDevice | null> {
  const res = await seamGet<{ device: SeamDevice }>(
    `/devices/get?device_id=${encodeURIComponent(deviceId)}`,
  );
  return res.device ?? null;
}

// ── Webhook signature verification (Svix scheme) ────────────────────
//
// Seam delivers webhooks via Svix. The signed content is
//   `${svix-id}.${svix-timestamp}.${rawBody}`
// HMAC-SHA256'd with the base64-decoded secret (the part after the
// `whsec_` prefix), base64-encoded. The svix-signature header is a
// space-separated list of `v1,<sig>` entries; a match on any is valid.

const REPLAY_WINDOW_SEC = 5 * 60;

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

export function verifySeamWebhook(
  headers: {
    svixId: string | null;
    svixTimestamp: string | null;
    svixSignature: string | null;
  },
  rawBody: string,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): SignatureCheck {
  const { svixId, svixTimestamp, svixSignature } = headers;
  if (!secret) return { ok: false, reason: 'SEAM_WEBHOOK_SECRET not set' };
  if (!svixId || !svixTimestamp || !svixSignature) {
    return { ok: false, reason: 'missing svix-id / svix-timestamp / svix-signature header' };
  }

  const ts = parseInt(svixTimestamp, 10);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'invalid svix-timestamp' };
  if (Math.abs(nowSec - ts) > REPLAY_WINDOW_SEC) {
    return { ok: false, reason: 'timestamp outside replay window' };
  }

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent, 'utf8')
    .digest('base64');

  // svix-signature: "v1,<sig> v1,<sig2> ...". Compare against each.
  const provided = svixSignature.split(' ');
  for (const entry of provided) {
    const sig = entry.includes(',') ? entry.split(',')[1] : entry;
    if (sig.length !== expected.length) continue;
    if (crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expected, 'utf8'))) {
      return { ok: true };
    }
  }
  return { ok: false, reason: 'no matching signature' };
}

// ── Ingest pipeline (shared by webhook + sync) ──────────────────────

export type IngestResult = {
  deviceId: string;
  propertyId: string | null;
  batteryPct: number | null;
  batteryStatus: SeamBatteryStatus;
  registered: boolean;
  batteryRecorded: boolean;
  low: boolean;
  slipId: string | null;
};

/**
 * Auto-register the device, record its latest battery, and open a slip
 * if a mapped lock has crossed into low battery. Idempotent and
 * latest-wins; safe to call from both the live webhook and the backfill
 * sync. The caller supplies a service-role (or permissive-RLS) client.
 */
export async function ingestDeviceBattery(
  supabase: SupabaseClient,
  nd: NormalizedDevice,
): Promise<IngestResult> {
  const nowIso = new Date().toISOString();

  // 1. Auto-register (or touch) the device. Only send metadata we
  //    actually know so a battery-only webhook event never nulls out the
  //    name/manufacturer a prior sync discovered. property_id is never in
  //    this payload, so an existing mapping is preserved and new rows
  //    default to null (unmapped).
  const registryPayload: Record<string, unknown> = {
    device_id: nd.deviceId,
    last_seen_at: nowIso,
  };
  if (nd.name != null) registryPayload.display_name = nd.name;
  if (nd.manufacturer != null) registryPayload.manufacturer = nd.manufacturer;
  if (nd.connectedAccountId != null) registryPayload.connected_account_id = nd.connectedAccountId;

  const reg = await supabase
    .from('lock_devices')
    .upsert(registryPayload, { onConflict: 'device_id' });
  if (reg.error) throw new Error(`lock_devices upsert failed: ${reg.error.message}`);

  // 2. Resolve the current property mapping + active flag.
  const { data: dev } = await supabase
    .from('lock_devices')
    .select('property_id, active')
    .eq('device_id', nd.deviceId)
    .maybeSingle();
  const propertyId = (dev?.property_id as string | null) ?? null;
  const active = (dev?.active as boolean | undefined) ?? true;

  const low = isLowBattery(nd.batteryPct, nd.batteryStatus);

  // 3. Record telemetry. Skip when we learned nothing about the battery
  //    (e.g. a non-battery event that fell through to the event fallback)
  //    so we don't clobber a good prior reading with nulls.
  let batteryRecorded = false;
  if (nd.batteryPct != null || nd.batteryStatus !== 'unknown') {
    const statusPayload: Record<string, unknown> = {
      device_id: nd.deviceId,
      property_id: propertyId,
      battery_pct: nd.batteryPct,
      battery_status: nd.batteryStatus,
      checked_at: nowIso,
      source: 'seam',
      updated_at: nowIso,
    };
    if (nd.online != null) statusPayload.is_online = nd.online;
    const stat = await supabase
      .from('lock_battery_status')
      .upsert(statusPayload, { onConflict: 'device_id' });
    if (stat.error) throw new Error(`lock_battery_status upsert failed: ${stat.error.message}`);
    batteryRecorded = true;
  }

  // 4. Open a maintenance slip if a mapped, active lock is low.
  let slipId: string | null = null;
  if (propertyId && active && low) {
    slipId = await reconcileBatterySlip(supabase, {
      deviceId: nd.deviceId,
      propertyId,
      pct: nd.batteryPct,
      status: nd.batteryStatus,
      deviceName: nd.name,
    });
  }

  return {
    deviceId: nd.deviceId,
    propertyId,
    batteryPct: nd.batteryPct,
    batteryStatus: nd.batteryStatus,
    registered: !reg.error,
    batteryRecorded,
    low,
    slipId,
  };
}

type ReconcileArgs = {
  deviceId: string;
  propertyId: string;
  pct: number | null;
  status: SeamBatteryStatus;
  deviceName: string | null;
};

/**
 * Ensure exactly one open "replace batteries" slip exists for this lock.
 * Returns the new slip id, or null when one was already active (or a
 * concurrent insert won the race). After the batteries are replaced and
 * the slip closed, a later low-battery event opens a fresh one.
 */
export async function reconcileBatterySlip(
  supabase: SupabaseClient,
  args: ReconcileArgs,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('work_slips')
    .select('id')
    .eq('from_lock_device_id', args.deviceId)
    .in('status', ACTIVE_WORK_SLIP_STATUSES)
    .limit(1);
  if (existing && existing.length > 0) return null;

  const { data: prop } = await supabase
    .from('properties')
    .select('name')
    .eq('id', args.propertyId)
    .maybeSingle();
  const propertyName = (prop?.name as string | undefined) ?? args.propertyId;
  const pctLabel =
    args.pct != null ? `${args.pct}%` : args.status === 'critical' ? 'critical' : 'low';
  const lockLabel = args.deviceName ?? 'smart lock';

  const insert = await supabase
    .from('work_slips')
    .insert({
      property_id: args.propertyId,
      title: `${propertyName}: Replace smart lock batteries`,
      description: [
        `Smart lock battery is low (${pctLabel}). Bring replacement batteries on the next turnover.`,
        '',
        `Lock: ${lockLabel}`,
        `Seam device: ${args.deviceId}`,
        'Auto-created from Seam low-battery telemetry. Close this slip once the batteries are replaced.',
      ].join('\n'),
      action_summary: `Bring batteries for the ${lockLabel} (battery ${pctLabel}).`,
      category: 'maintenance',
      priority: 'high',
      status: 'open',
      from_lock_device_id: args.deviceId,
      created_by_email: LOCK_BOT_EMAIL,
    })
    .select('id')
    .single();

  if (insert.error) {
    // Partial unique index race: another path opened the active slip first.
    if (insert.error.code === '23505') return null;
    throw new Error(`work_slips insert failed: ${insert.error.message}`);
  }
  return (insert.data as { id: string }).id;
}
