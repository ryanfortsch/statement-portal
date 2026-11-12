import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { getGuestyToken } from '@/lib/guesty-client';
import { verifyDormantProductionStorage } from '@/lib/channex-production-runtime';
import { MessagePreparationError, type PreparationDeps } from './preparation';
import { MESSAGE_RULE_FIELDS } from './preparation-rules';
import { CLEANER_REMINDER_RECIPIENT_FIELDS } from '@/lib/cleaner-reminder-link';
import { MESSAGE_SCHEDULE_LEDGER_FIELDS } from './schedule-plan';
import { readMessageAccess } from '@/lib/property-access';

export function messagePreparationDeps(): PreparationDeps {
  return {
    verifyDormant: () => verifyDormantProductionStorage(async (name, args) => {
      const { data, error } = await supabaseAdmin.rpc(name, args); return { data, error };
    }), token: getGuestyToken,
    context: async () => {
      const [snapshot, property, rules, mirror, access, locks, bookings, cleanerRecipients, ledger] = await Promise.all([
        supabaseAdmin.rpc('helm_channex_booking_audit_snapshot', {}),
        supabaseAdmin.from('properties').select('id,name,wifi_name,automations_enabled').eq('id', '65_calderwood').single(),
        supabaseAdmin.from('message_automations').select(MESSAGE_RULE_FIELDS)
          .or('property_id.is.null,property_id.eq.65_calderwood').order('id').limit(201),
        selectAllPaged((from, to) => supabaseAdmin.from('guesty_reservations')
          .select('guesty_reservation_id,property_id,listing_id,confirmation_code,check_in,check_out,channel,status')
          .eq('property_id', '65_calderwood').order('guesty_reservation_id').range(from, to), { pageSize: 500, maxRows: 5000 }),
        readMessageAccess('65_calderwood'),
        supabaseAdmin.from('lock_devices').select('device_id').eq('property_id', '65_calderwood').eq('active', true).limit(1),
        selectAllPaged((from, to) => supabaseAdmin.from('bookings')
          .select('id,property_id,check_in,check_out,status,guest_name').eq('property_id', '65_calderwood')
          .in('status', ['confirmed', 'completed']).order('id').range(from, to), { pageSize: 500, maxRows: 5000 }),
        selectAllPaged(async (from, to) => {
          const result = await supabaseAdmin.from('cleaner_schedule_recipients')
            .select(CLEANER_REMINDER_RECIPIENT_FIELDS)
            .or('property_ids.cs.{65_calderwood},region.eq.bridgeport_ct')
            .order('phone').range(from, to);
          if (!Array.isArray(result.data)) throw new MessagePreparationError('PREPARATION_READ_FAILED');
          return result;
        }, { pageSize: 100, maxRows: 200 }),
        selectAllPaged(async (from, to) => {
          const result = await supabaseAdmin.from('automation_sends').select(MESSAGE_SCHEDULE_LEDGER_FIELDS)
            .eq('property_id', '65_calderwood').order('id').range(from, to);
          if (!Array.isArray(result.data)) throw new MessagePreparationError('PREPARATION_READ_FAILED');
          return result;
        }, { pageSize: 500, maxRows: 5000 }),
      ]);
      if (snapshot.error || property.error || rules.error || !rules.data || locks.error || !locks.data)
        throw new MessagePreparationError('PREPARATION_READ_FAILED');
      const { id, name, wifi_name } = property.data;
      return { canonical: snapshot.data, automationsEnabled: property.data.automations_enabled, rules: rules.data, mirror, ledger,
        renderInputs: { property: { id, name, wifi_name }, access, lockMapped: locks.data.length > 0, bookings, cleanerRecipients } };
    },
  };
}
