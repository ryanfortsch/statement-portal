import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAllPaged, type PageResult } from './paged-select';
import type { WorkIssueLink, IssueReport } from './work-issues';

export async function loadWorkIssueLinks(db: SupabaseClient): Promise<WorkIssueLink[]> {
  return selectAllPaged<WorkIssueLink>((from, to) => db.from('work_issue_reports').select('report_id,issue_id').order('report_id').range(from, to) as unknown as PromiseLike<PageResult<WorkIssueLink>>);
}
export async function loadWorkIssueReports(db: SupabaseClient, propertyId: string): Promise<IssueReport[]> {
  return selectAllPaged<IssueReport>((from, to) => db.from('work_slips')
    .select('id,property_id,title,description,status,location,organize_group,organize_group_label,from_supply_key,from_prep_rule_key,from_guest_request_key,created_at')
    .eq('property_id', propertyId).order('id').range(from, to) as unknown as PromiseLike<PageResult<IssueReport>>);
}
