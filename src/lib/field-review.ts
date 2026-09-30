import { fieldDb } from '@/lib/field-db';
import { parseTrade, type ContractorTrade, type PacketRow } from '@/lib/field-types';

export type ReviewPacket = Pick<PacketRow, 'id' | 'title' | 'trade' | 'visit_date' | 'submitted_at' | 'awarded_contractor_id'>;

/** Shared by the badge and queue; no calendar/trade filter or historical row limit. */
export async function loadFieldReview(): Promise<ReviewPacket[]> {
  const packets: ReviewPacket[] = [];
  const size = 500;
  for (let offset = 0; ; offset += size) {
    const { data, error } = await fieldDb().from('inspection_packets')
      .select('id,title,trade,visit_date,submitted_at,awarded_contractor_id')
      .eq('status', 'submitted').order('submitted_at').order('id').range(offset, offset + size - 1);
    if (error) throw new Error('Could not load packets awaiting review');
    const rows = (data ?? []) as ReviewPacket[];
    packets.push(...rows);
    if (rows.length < size) return packets;
  }
}

export function fieldReviewCounts(packets: ReviewPacket[]): Record<ContractorTrade, number> {
  const counts = { inspection: 0, maintenance: 0, cleaning: 0, creative: 0 };
  for (const packet of packets) counts[parseTrade(packet.trade)]++;
  return counts;
}
