import { listRecentApprovals, listRecentOwnerApprovals, listRecentCleanerApprovals, listRecentContractorApprovals } from '@/lib/stay-concierge';
import { recentFollowups } from '@/lib/recent-followups';
import { RecentMessageOutcomes } from './RecentMessageOutcomes';
export async function RecentMessageOutcomesSection({audience}:{audience:'guests'|'owners'|'cleaners'|'contractors'}) {
  const load = {guests:listRecentApprovals, owners:listRecentOwnerApprovals, cleaners:listRecentCleanerApprovals, contractors:listRecentContractorApprovals}[audience];
  const result = await load(168);
  return <RecentMessageOutcomes audience={audience} initial={result.ok ? recentFollowups(result.data.approvals) : []} initialError={!result.ok} />;
}
