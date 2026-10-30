import 'server-only';
import { listCleanerApprovals, listContractorApprovals } from './stay-concierge';
import { draftValidity } from './draft-validity';

/** Read the canonical draft after authentication; never trust a browser's age
 * or text. Scheduled sends must still mean the same day when they go out. */
export async function checkTeamDraftTiming(audience: 'cleaner' | 'contractor', id: string, sendAt?: string): Promise<string | undefined> {
  const result = audience === 'cleaner' ? await listCleanerApprovals() : await listContractorApprovals();
  if (!result.ok) return 'Could not check the current draft. Refresh and try again.';
  const draft = result.data.approvals.find(a => a.id === id);
  if (!draft) return 'This draft is no longer waiting. Refresh the queue.';
  const target = sendAt ? new Date(sendAt) : new Date();
  if (Number.isNaN(target.getTime()) || (sendAt && target.getTime() <= Date.now())) return 'Choose a future send time.';
  const text = draft.draft + ('draft_english' in draft && !draft.draft_translating ? `\n${draft.draft_english}` : '');
  return draftValidity({ createdAt: draft.created_at, text }, target).blocked;
}
