import { NextResponse } from 'next/server';
import { isOwnerSession } from '@/lib/helm-access-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { auditProductionBookings } from '@/lib/channex-bookings/audit';
import { BookingAuditError } from '@/lib/channex-bookings/reconciliation';
import { ChannexRuntimeError } from '@/lib/channex-production-runtime';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const headers = { 'Cache-Control': 'private, no-store' };
/** Manual owner diagnostic. Not allowlisted in proxy, not scheduled. */
export async function GET() {
  if (!await isOwnerSession()) return NextResponse.json({ error: 'Owners only' }, { status: 403, headers });
  try {
    const report = await auditProductionBookings(process.env, async (name, args) => {
      const { data, error } = await supabaseAdmin.rpc(name, args);
      return { data, error };
    });
    return NextResponse.json(report, { headers });
  } catch (e) {
    const code = e instanceof BookingAuditError || e instanceof ChannexRuntimeError ? e.code : 'AUDIT_FAILED';
    return NextResponse.json({ ok: false, code, completeCoverage: false, readyForCutover: false }, { status: 503, headers });
  }
}
