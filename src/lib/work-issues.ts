import type { WorkSlipRow } from './work-types';

export type LinkedIssueSummary = { linked_report_ids?: string[]; linked_people?: string[]; linked_statuses?: string[]; linked_waiting?: boolean };
export type WorkIssueLink = { report_id: string; issue_id: string };
export type IssueReport = Pick<WorkSlipRow, 'id' | 'property_id' | 'title' | 'description' | 'status' | 'location' | 'organize_group' | 'organize_group_label' | 'from_supply_key' | 'from_prep_rule_key' | 'from_guest_request_key' | 'created_at'>;
export function canLinkReport(s: IssueReport): boolean {
  return !s.from_supply_key && !s.from_prep_rule_key && !s.from_guest_request_key && s.status !== 'dismissed';
}
const STOP_WORDS = new Set('the a an at in on to for of and or is it needs need fix repair replace reported issue guest upstairs downstairs master bath bathroom with from'.split(' '));
function words(s: string) { return new Set(s.toLowerCase().match(/[a-z]{3,}/g)?.filter(w => !STOP_WORDS.has(w)) ?? []); }
/** Suggestions explain their evidence; none is a duplicate verdict or a write. */
export function relatedReportReason(a: IssueReport, b: IssueReport): string | null {
  if (a.id === b.id || a.property_id !== b.property_id || !canLinkReport(a) || !canLinkReport(b)) return null;
  if ((a.status === 'done') !== (b.status === 'done')) return null;
  if (a.organize_group && a.organize_group === b.organize_group) return `Grouped under ${a.organize_group_label || 'the same object'}`;
  const aw = words(a.title); const shared = [...words(b.title)].filter(w => aw.has(w));
  if (shared.length >= 2 || (shared.length >= 1 && a.location && b.location && a.location.toLowerCase() === b.location.toLowerCase())) return `Both mention ${shared.join(', ')}`;
  return null;
}

/** Collapse only explicitly linked reports, never model suggestions. If a
 * primary report is outside this read's filter, keep a visible member rather
 * than losing the issue. Urgency and due dates include every visible report. */
export function collapseWorkIssues<T extends { id: string; property_id: string | null; priority?: string | null; status?: string; assigned_to_email?: string | null; coordinator_email?: string | null; owner_status?: string | null; scheduled_date?: string | null; follow_up_date?: string | null; owner_action_required?: boolean }>(rows: T[], links: WorkIssueLink[]): (T & LinkedIssueSummary)[] {
  const byId = new Map(links.map(l => [l.report_id, l.issue_id]));
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.property_id}:${byId.get(row.id) ?? row.id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map(group => {
    const first = group.find(r => r.id === byId.get(r.id)) ?? group[0];
    if (group.length === 1) return first;
    const earliest = (key: 'scheduled_date' | 'follow_up_date') => group.map(r => r[key]).filter((d): d is string => !!d).sort()[0] ?? null;
    return { ...first, priority: group.some(r => r.priority === 'high') ? 'high' : first.priority,
      scheduled_date: earliest('scheduled_date'), follow_up_date: earliest('follow_up_date'),
      owner_action_required: group.some(r => r.owner_action_required), linked_report_ids: group.map(r => r.id),
      linked_people: [...new Set(group.flatMap(r => [r.assigned_to_email, r.coordinator_email]).filter((s): s is string => !!s))],
      linked_statuses: [...new Set(group.map(r => r.status).filter((s): s is string => !!s))],
      linked_waiting: group.some(r => r.status === 'blocked' || (r.owner_action_required && r.owner_status === 'sent')) } as T & LinkedIssueSummary;
  });
}
