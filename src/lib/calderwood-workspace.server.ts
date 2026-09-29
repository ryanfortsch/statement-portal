import 'server-only';
import { selectAllPaged } from './paged-select';
import { supabaseAdmin as sb, isServiceConfigured } from '@/lib/supabase-admin';
import { CALDERWOOD_ID, type WorkspaceData, type WorkspaceBooking, type GuestySnapshot, type CalendarBlock, type WorkspaceFeed } from './calderwood-workspace';

export async function loadCalderwoodWorkspace(): Promise<WorkspaceData> {
  const data: WorkspaceData = {
    asOf: new Date().toISOString(), configured: isServiceConfigured, property: null,
    bookings: [], guesty: [], blocks: [], feeds: [],
    sources: { property: null, bookings: null, guesty: null, blocks: null, feeds: null },
  };
  if (!isServiceConfigured) {
    for (const key of Object.keys(data.sources) as (keyof WorkspaceData['sources'])[]) data.sources[key] = 'Database connection unavailable';
    return data;
  }
  async function read<T>(table: string, columns: string, order: string): Promise<T[]> {
    return selectAllPaged<T>(async (from, to) => {
      const result = await sb.from(table).select(columns).eq('property_id', CALDERWOOD_ID).order(order).range(from, to);
      if (result.error) throw new Error('Source query failed');
      return { data: result.data as T[], error: null };
    }, { pageSize: 500 });
  }

  const results = await Promise.allSettled([
    sb.from('properties').select('id,name,address').eq('id', CALDERWOOD_ID).maybeSingle().then(result => {
      if (result.error || !result.data) throw new Error('Property unavailable');
      return result.data;
    }),
    read<WorkspaceBooking>('bookings', 'id,property_id,channel,source,external_booking_id,external_confirmation_code,check_in,check_out,status,guest_name,num_guests,gross_amount,cleaning_fee,taxes,payout,currency,duplicate_of,updated_at,last_seen_at', 'id'),
    read<GuestySnapshot>('guesty_reservations', 'guesty_reservation_id,property_id,guest_name,confirmation_code,check_in,check_out,channel,status,synced_at', 'guesty_reservation_id'),
    read<CalendarBlock>('property_calendar_blocks', 'property_id,date,synced_at', 'date'),
    read<WorkspaceFeed>('channel_listings', 'id,channel,is_active,ical_import_enabled,last_imported_at,last_import_status', 'id'),
  ]);
  const [property, bookings, guesty, blocks, feeds] = results;
  if (property.status === 'fulfilled') data.property = property.value; else data.sources.property = 'Property record unavailable';
  if (bookings.status === 'fulfilled') data.bookings = bookings.value; else data.sources.bookings = 'Helm reservations unavailable';
  if (guesty.status === 'fulfilled') data.guesty = guesty.value; else data.sources.guesty = 'Guesty reservation copies unavailable';
  if (blocks.status === 'fulfilled') data.blocks = blocks.value; else data.sources.blocks = 'Guesty calendar blocks unavailable';
  if (feeds.status === 'fulfilled') data.feeds = feeds.value; else data.sources.feeds = 'Calendar feed status unavailable';
  // Each failed source is discarded in full: a partial page must not look complete.
  return data;
}
