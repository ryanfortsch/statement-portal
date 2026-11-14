'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { isoDay, isPersonCheck, parseSiteRank } from '@/lib/partner-listing';
import { listPartnerHome, recordPartnerCheck, setPartnerSiteRank, unlistPartnerHome } from '@/lib/partner-listing-db';
import { isPartnerFeedChannel, parseFeedUrl } from '@/lib/partner-calendar';
import { addPartnerFeed, readPartnerFeed, listPartnerFeeds, removePartnerFeed, syncPartnerFeeds } from '@/lib/partner-calendar-db';
import { approveListingProposal, declineListingProposal } from '@/lib/partner-host-listing-db';

/**
 * The partner home panel's verbs (src/app/properties/[id]/PartnerHomePanel.tsx).
 * The setup work (the host's calendars, the walk, the insurance, the
 * agreement, the photos) is anyone's on the team; putting the home on
 * staycapeann.com, taking it off and choosing its place there are an
 * owner's. Each returns a result the buttons read back, never a throw.
 */
export type PartnerActionResult = { ok: true; note?: string } | { ok: false; error: string };

async function signedIn(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email ?? null;
}

function refresh(propertyId: string) {
  revalidatePath(`/properties/${propertyId}`);
  revalidatePath('/guests/requests');
}

export async function addPartnerFeedAction(propertyId: string, rawUrl: string, rawChannel: string): Promise<PartnerActionResult> {
  const by = await signedIn();
  if (!by) return { ok: false, error: 'Sign in again.' };
  const parsed = parseFeedUrl(rawUrl);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const channel = parsed.channel ?? (isPartnerFeedChannel(rawChannel) ? rawChannel : null);
  if (!channel) return { ok: false, error: 'Say where this calendar is from.' };
  const added = await addPartnerFeed(propertyId, parsed.url, channel, by);
  if (!added.ok) return { ok: false, error: added.reason };
  const feeds = await listPartnerFeeds(propertyId);
  const feed = feeds?.find((f) => f.id === added.id);
  const read = feed ? await readPartnerFeed(feed) : null;
  refresh(propertyId);
  if (read && !read.ok) return { ok: true, note: `Added, but it could not be read yet: ${read.error}. It is tried again every 30 minutes.` };
  const n = read?.holds ?? 0;
  return { ok: true, note: read?.ok ? `Added and read: ${n} ${n === 1 ? 'entry' : 'entries'} on the calendar.` : undefined };
}

export async function removePartnerFeedAction(propertyId: string, feedId: string): Promise<PartnerActionResult> {
  if (!(await signedIn())) return { ok: false, error: 'Sign in again.' };
  const r = await removePartnerFeed(propertyId, feedId);
  refresh(propertyId);
  return r.ok ? { ok: true } : { ok: false, error: r.reason };
}

export async function readPartnerFeedsAction(propertyId: string): Promise<PartnerActionResult> {
  if (!(await signedIn())) return { ok: false, error: 'Sign in again.' };
  const r = await syncPartnerFeeds({ propertyId });
  refresh(propertyId);
  if ('skipped' in r) return { ok: false, error: 'The calendars could not be read just now.' };
  const failed = r.results.filter((x) => !x.ok);
  return failed.length === 0 ? { ok: true } : { ok: false, error: failed.map((x) => x.error).join('; ') };
}

export async function recordPartnerCheckAction(propertyId: string, check: string, rawOn: string, rawExpires?: string): Promise<PartnerActionResult> {
  const by = await signedIn();
  if (!by) return { ok: false, error: 'Sign in again.' };
  if (!isPersonCheck(check)) return { ok: false, error: 'No such check.' };
  const clearing = rawOn === '';
  const on = clearing ? null : isoDay(rawOn);
  if (!clearing && !on) return { ok: false, error: 'Give the date as YYYY-MM-DD.' };
  let expires: string | null = null;
  if (check === 'insurance' && !clearing) {
    expires = isoDay(rawExpires ?? '');
    if (!expires) return { ok: false, error: 'Give the date the policy runs to, as YYYY-MM-DD.' };
    if (expires < (on as string)) return { ok: false, error: 'The policy ends before the day it was checked.' };
  }
  const r = await recordPartnerCheck(propertyId, check, on, by, { insuranceExpiresOn: expires });
  refresh(propertyId);
  return r.ok ? { ok: true } : { ok: false, error: r.reason };
}

/** Where the home sits on staycapeann.com. An owner's, like the listing switch. */
export async function setPartnerSiteRankAction(propertyId: string, raw: string): Promise<PartnerActionResult> {
  const by = await requireOwnerEmail();
  const parsed = parseSiteRank(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const r = await setPartnerSiteRank(propertyId, parsed.rank, by);
  refresh(propertyId);
  return r.ok ? { ok: true } : { ok: false, error: r.reason };
}

export async function listPartnerHomeAction(propertyId: string): Promise<PartnerActionResult> {
  const by = await requireOwnerEmail();
  const r = await listPartnerHome(propertyId, by);
  refresh(propertyId);
  return r.ok ? { ok: true, note: 'Listed. staycapeann.com shows it within a few minutes.' } : { ok: false, error: r.reason };
}

export async function unlistPartnerHomeAction(propertyId: string, reason: string): Promise<PartnerActionResult> {
  const by = await requireOwnerEmail();
  const r = await unlistPartnerHome(propertyId, by, reason);
  refresh(propertyId);
  return r.ok ? { ok: true, note: 'Taken off. New requests stop now, and the site drops the page within a few minutes.' } : { ok: false, error: r.reason };
}

/**
 * The host's listing change: Approve puts the changed words on
 * staycapeann.com through the listing editor's own writer and emails the
 * host; Decline emails them the reason. Anyone on the team, the same as the
 * Listing tab's editor (src/lib/partner-host-listing-db.ts).
 */
export async function approveListingChangeAction(propertyId: string, proposalId: string): Promise<PartnerActionResult> {
  const by = await signedIn();
  if (!by) return { ok: false, error: 'Sign in again.' };
  try {
    const r = await approveListingProposal(proposalId, propertyId, by);
    refresh(propertyId);
    return r.ok ? { ok: true, note: r.note } : { ok: false, error: r.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'The change could not be saved.' };
  }
}

export async function declineListingChangeAction(propertyId: string, proposalId: string, reason: string): Promise<PartnerActionResult> {
  const by = await signedIn();
  if (!by) return { ok: false, error: 'Sign in again.' };
  try {
    const r = await declineListingProposal(proposalId, propertyId, by, reason);
    refresh(propertyId);
    return r.ok ? { ok: true, note: r.note } : { ok: false, error: r.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'The answer could not be saved.' };
  }
}
