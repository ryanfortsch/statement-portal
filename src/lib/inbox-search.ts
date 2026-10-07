export const INBOX_AUDIENCES = ['guests', 'owners', 'cleaners', 'contractors'] as const;
export type InboxAudience = typeof INBOX_AUDIENCES[number];
export const INBOX_ROUTES: Record<InboxAudience, string> = { guests: '/messaging', owners: '/owner-messaging', cleaners: '/cleaner-messaging', contractors: '/contractor-messaging' };
export type InboxFilter = 'all' | 'review' | 'scheduled' | 'handled';
export type SearchableApproval = {
  id: string; status: string; conversation_id?: string; draft?: string; final_response?: string; created_at?: string; resolved_at?: string | null;
  guest_first?: string; guest_full?: string; listing_name?: string; listing_id?: string; guest_text?: string;
  owner_name?: string; owner_text?: string; cleaner_name?: string; cleaner_text?: string; cleaner_text_english?: string;
  contractor_name?: string; contractor_text?: string; property_name?: string; draft_english?: string;
};
export type InboxSearchRow = {
  key: string; audience: InboxAudience; name: string; property: string; text: string; reply: string;
  translation: string; status: string; filter: InboxFilter; at: string; href: string; active: boolean;
};
export type InboxSearchData = { rows: InboxSearchRow[]; unavailable: string[]; limited: string[] };

export function approvalSearchStatus(row: SearchableApproval, active: boolean): { status: string; filter: InboxFilter } {
  if (row.status === 'scheduled') return { status: 'Scheduled', filter: 'scheduled' };
  if (row.status === 'sending') return { status: 'Sending', filter: 'scheduled' };
  if (row.status === 'pending') return { status: row.draft?.trim() ? 'Draft ready' : 'Needs review', filter: 'review' };
  const handled: Record<string, string> = { approved: 'Sent', manual_sent: 'Marked handled', rejected: 'Skipped', no_reply_needed: 'No reply needed', courtesy_ack: 'No reply needed', marked_handled: 'Handled' };
  if (handled[row.status]) return { status: handled[row.status], filter: 'handled' };
  const other: Record<string, string> = { superseded: 'Replaced', auto_rejected_stale: 'Expired draft', expired: 'Expired draft', failed: 'Failed' };
  return { status: other[row.status] || 'Status unavailable', filter: active || row.status === 'failed' ? 'review' : 'all' };
}

export function approvalSearchRow(audience: InboxAudience, row: SearchableApproval, active: boolean): InboxSearchRow {
  const name = audience === 'guests' ? row.guest_full || row.guest_first : audience === 'owners' ? row.owner_name : audience === 'cleaners' ? row.cleaner_name : row.contractor_name;
  const text = audience === 'guests' ? row.guest_text : audience === 'owners' ? row.owner_text : audience === 'cleaners' ? row.cleaner_text : row.contractor_text;
  return { key: audience + ':' + row.id, audience, name: name || 'Unknown sender', property: row.property_name || row.listing_name || row.listing_id?.replace(/[-_]/g, ' ') || '', text: text || '', reply: row.final_response || row.draft || '', translation: [row.cleaner_text_english, row.draft_english].filter(Boolean).join(' '), ...approvalSearchStatus(row, active), at: row.resolved_at || row.created_at || '', active, href: INBOX_ROUTES[audience] + (active ? '#approval-' + encodeURIComponent(row.id) : '') };
}

/** Current queue wins over a stale recent snapshot; IDs only dedupe within one audience. */
export function mergeInboxSearch(rows: InboxSearchRow[]): InboxSearchRow[] {
  const byKey = new Map<string, InboxSearchRow>();
  for (const row of rows) if (!byKey.has(row.key) || row.active) byKey.set(row.key, row);
  return [...byKey.values()].sort((a, b) => Number(b.active) - Number(a.active) || b.at.localeCompare(a.at));
}
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function matchesInboxText(query: string, values: (string | undefined)[]) {
  const terms = normalize(query.trim()).split(/\s+/).filter(Boolean);
  const text = normalize(values.filter(Boolean).join(' '));
  return terms.every(term => text.includes(term));
}
export function searchInbox(rows: InboxSearchRow[], query: string, audience: InboxAudience | 'all', filter: InboxFilter) {
  return rows.filter(row => (audience === 'all' || row.audience === audience) && (filter === 'all' || row.filter === filter) && matchesInboxText(query, [row.name, row.property, row.text, row.reply, row.translation]));
}

export async function loadInboxSearch(load: (audience: InboxAudience, recent: boolean) => Promise<{ ok: true; data: { approvals: SearchableApproval[] } } | { ok: false }>): Promise<InboxSearchData> {
  const feeds = INBOX_AUDIENCES.flatMap(audience => [{ audience, recent: false }, { audience, recent: true }]);
  const results = await Promise.allSettled(feeds.map(feed => load(feed.audience, feed.recent)));
  const rows: InboxSearchRow[] = [], unavailable: string[] = [], limited: string[] = [];
  results.forEach((result, index) => {
    const feed = feeds[index];
    const label = feed.audience + (feed.recent ? ' recent activity' : ' current drafts');
    if (result.status === 'rejected' || !result.value.ok) { unavailable.push(label); return; }
    const approvals = result.value.data?.approvals;
    if (!Array.isArray(approvals) || approvals.some(row => !row || typeof row.id !== 'string' || typeof row.status !== 'string')) {
      unavailable.push(label); return;
    }
    if (feed.recent && approvals.length >= 50) limited.push(feed.audience);
    rows.push(...approvals.map(row => approvalSearchRow(feed.audience, row, !feed.recent)));
  });
  return { rows: mergeInboxSearch(rows), unavailable, limited };
}

/** Scheduled sends are already decided and must not inflate review counts. */
export function reviewCountsByConversation(rows: SearchableApproval[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.status === 'pending' && row.conversation_id)
      counts.set(row.conversation_id, (counts.get(row.conversation_id) || 0) + 1);
  }
  return counts;
}
