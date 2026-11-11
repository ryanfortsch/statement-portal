import { NextResponse } from 'next/server';
import { isOwnerSession } from '@/lib/helm-access-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { getGuestyToken } from '@/lib/guesty-client';
import { verifyDormantProductionStorage, ChannexRuntimeError } from '@/lib/channex-production-runtime';
import { auditMessageHandoff } from '@/lib/channex-bookings/message-audit';
import { MessageHandoffError } from '@/lib/channex-bookings/message-identity';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const headers = { 'Cache-Control': 'private, no-store' };
/** Manual owner read; not allowlisted in proxy and not scheduled. */
export async function GET() {
  if (!await isOwnerSession()) return NextResponse.json({ error: 'Owners only' }, { status: 403, headers });
  try {
    const result = await auditMessageHandoff(process.env, {
      verifyDormant: () => verifyDormantProductionStorage(async (name, args) => {
        const { data, error } = await supabaseAdmin.rpc(name, args); return { data, error };
      }),
      token: getGuestyToken,
      context: async () => {
        const [{ data: canonical, error }, property, mirror] = await Promise.all([
          supabaseAdmin.rpc('helm_channex_booking_audit_snapshot', {}),
          supabaseAdmin.from('properties').select('automations_enabled').eq('id', '65_calderwood').single(),
          selectAllPaged((from, to) => supabaseAdmin.from('guesty_reservations')
            .select('guesty_reservation_id,property_id,listing_id,confirmation_code,check_in,check_out,channel,status')
            .eq('property_id', '65_calderwood').order('guesty_reservation_id').range(from, to),
          { pageSize: 500, maxRows: 5000 }),
        ]);
        if (error || property.error) throw new MessageHandoffError('HANDOFF_READ_FAILED');
        return { canonical, mirror, automationsEnabled: property.data.automations_enabled };
      },
    });
    return NextResponse.json(result, { headers });
  } catch (e) {
    const code = e instanceof MessageHandoffError || e instanceof ChannexRuntimeError ? e.code : 'HANDOFF_READ_FAILED';
    return NextResponse.json({ ok: false, code, readyForAutomaticMessaging: false, messagesSent: 0 }, { status: 503, headers });
  }
}
