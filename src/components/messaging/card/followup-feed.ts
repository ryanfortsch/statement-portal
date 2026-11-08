import 'server-only';
import {
  listRecentApprovals,
  listRecentOwnerApprovals,
  listRecentCleanerApprovals,
  listRecentContractorApprovals,
} from '@/lib/stay-concierge';
import { recentFollowups } from '@/lib/recent-followups';
import { CARD_AUDIENCE, type FollowupAudience, type FollowupFeed, type LedgerFollowup } from './decided-ledger';

const LOADERS = {
  guests: listRecentApprovals,
  owners: listRecentOwnerApprovals,
  cleaners: listRecentCleanerApprovals,
  contractors: listRecentContractorApprovals,
};

/** The past 7 days of resolved messages that filed work, notes or a
 *  schedule change, for the inboxes given. A failed read is an error, never
 *  an empty success. */
export async function loadFollowupFeed(audiences: FollowupAudience[]): Promise<FollowupFeed> {
  const results = await Promise.all(audiences.map((a) => LOADERS[a](168)));
  let error = false;
  const initial: LedgerFollowup[] = [];
  results.forEach((result, i) => {
    if (!result.ok) { error = true; return; }
    const audience = CARD_AUDIENCE[audiences[i]];
    for (const f of recentFollowups(result.data.approvals)) initial.push(audience ? { ...f, audience } : f);
  });
  return { audiences, initial, error };
}
