import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import {
  seamConfigured,
  listDevices,
  normalizeFromDevice,
  ingestDeviceBattery,
} from '@/lib/seam';
import { recordSyncFailure, recordSyncResult } from '@/lib/sync-status';

// Backfill / cold-start / cron-poll route. The webhook is the live path;
// this lists every Seam device and runs it through the same ingest
// pipeline. Use it to:
//   - seed the registry on first run (every device auto-registers here),
//   - recover from a missed webhook delivery,
//   - run on a daily cron as a safety net against telemetry drift.
//
// The response lists each device with its id, battery, and current
// property mapping so you can fill in lock_devices.property_id for any
// that still read "unmapped".

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';
const supabase = createClient(supabaseUrl, supabaseKey);

type DeviceSummary = {
  device_id: string;
  name: string | null;
  property_id: string | null;
  battery_pct: number | null;
  battery_status: string;
  low: boolean;
  slip_created: boolean;
};

export async function POST() {
  if (!seamConfigured()) {
    return NextResponse.json(
      { error: 'SEAM_API_KEY not set; connect Seam before syncing locks' },
      { status: 400 },
    );
  }

  try {
    const devices = await listDevices();

    const summary = {
      devices_seen: devices.length,
      battery_recorded: 0,
      unmapped: 0,
      low_count: 0,
      slips_created: 0,
      devices: [] as DeviceSummary[],
      errors: [] as string[],
    };

    for (const device of devices) {
      try {
        const nd = normalizeFromDevice(device);
        const res = await ingestDeviceBattery(supabase, nd);
        if (res.batteryRecorded) summary.battery_recorded += 1;
        if (!res.propertyId) summary.unmapped += 1;
        if (res.low) summary.low_count += 1;
        if (res.slipId) summary.slips_created += 1;
        summary.devices.push({
          device_id: res.deviceId,
          name: nd.name,
          property_id: res.propertyId,
          battery_pct: res.batteryPct,
          battery_status: res.batteryStatus,
          low: res.low,
          slip_created: !!res.slipId,
        });
      } catch (err) {
        summary.errors.push(
          `${device.device_id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Record sync_status here (innermost) so the manual /api/sync-seam button
    // and the cron wrapper at /api/cron/sync-seam both stamp the same source
    // key from the same code path. Per-device failures surface as a sync
    // failure on the daily brief instead of being buried in summary.errors.
    await recordSyncResult('seam', {
      processed: devices.length,
      failed: summary.errors.length,
      firstError: summary.errors[0],
      result: summary,
    });

    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error('sync-seam failed', err);
    await recordSyncFailure('seam', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
