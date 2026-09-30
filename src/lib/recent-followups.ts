import type { MessageOutcomeCarrier } from './message-outcomes';
export type RecentFollowup = { id: string; who: string; property: string; sourceText: string; resolvedAt: string; replyStatus: string } & MessageOutcomeCarrier;
type RecentSource = MessageOutcomeCarrier & {id:string; status:string; resolved_at:string|null; created_at:string};
export function recentFollowups(rows:RecentSource[]):RecentFollowup[] {
  return rows.filter(r => r.outcomes && (r.outcomes.work.length || r.outcomes.notes.length || r.outcomes.error)).map(r => {
    const row = r as RecentSource & {guest_first?:string; owner_name?:string; cleaner_name?:string; contractor_name?:string; property_name?:string; listing_name?:string; guest_text?:string; owner_text?:string; cleaner_text_english?:string; cleaner_text?:string; contractor_text?:string};
    return {id:r.id, who:row.guest_first || row.owner_name || row.cleaner_name || row.contractor_name || 'Message', property:row.property_name || row.listing_name || '', sourceText:row.guest_text || row.owner_text || row.cleaner_text_english || row.cleaner_text || row.contractor_text || '', resolvedAt:r.resolved_at || r.created_at, replyStatus:r.status, outcomes:r.outcomes};
  });
}
