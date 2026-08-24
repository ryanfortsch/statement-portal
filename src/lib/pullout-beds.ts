import type { SupabaseClient } from '@supabase/supabase-js';
import { ACTIVE_WORK_SLIP_STATUSES } from './work-types';

/**
 * Pullout beds: the property fact, the live guest request, and the card
 * text the inspection walk shows for both.
 *
 * Six homes sleep extra guests on a pullout sofa. The sheets for it are
 * never in the linen closet -- 3 South keeps them in the drawers under the
 * TV, 16 Waterman in the second-floor closet on the way out to the deck --
 * so whoever preps the home has to already know, or the guest who asked
 * for the pullout finds a bare mattress.
 *
 * Two halves:
 *
 *   - the STANDING half. `properties.has_pullout_bed` puts a "Pullout Bed
 *     + Linens" card on every inspection at that home, carrying the linen
 *     location. When we don't have the location on file the card says so
 *     and asks the inspector to record it, which is how the gap closes.
 *
 *   - the REQUESTED half. When a guest asks for the pullout to be made up
 *     and we say yes, stay-concierge opens a prep work slip on the
 *     property (same path as an approved pack-n-play promise -- see
 *     /api/work-slips, from_guest_request_key), and the guest-message
 *     miner opens one from a live thread (from_guest_message_key). The
 *     slip IS the request, so the card reads work slips rather than
 *     inventing a second request store.
 *
 *     Guest origin is required, not just pullout wording. The board
 *     already carries office-side pullout slips -- "Complete bedding for
 *     full size pull out" at 79 Main, "Add linens for sleeper sofa" at 53
 *     Rocky Neck Downstairs (that one minted from a guest REVIEW, which is
 *     someone reporting a gap, not someone asking us to make a bed). A
 *     card that told an inspector "a guest asked for this" on the strength
 *     of one of those would be lying to them, so only the two
 *     guest-ask columns count.
 *
 * The result is frozen onto the inspection's ordered_cards at Start (the
 * moment the inspector taps into the walk), so a walk in progress can't
 * shift under the inspector mid-deck.
 */

/** Fixed id of the shared "Pullout Bed + Linens" item (seeded in
 *  20260824f_pullout_bed_inspection_card.sql). */
export const PULLOUT_BED_ITEM_ID = '00000000-0000-0000-0000-000000000201';

/**
 * Does this text talk about the pullout BED? Covers how guests, the
 * concierge, and operators actually write it -- "pullout", "pull-out
 * couch", "sleeper sofa", "sofa bed", "futon.
 *
 * A bare "pull out" needs a bed word after it, because homes are full of
 * pull-out things that are not beds: 21 Horton's KB alone has a "pull-out
 * cabinet" for the trash and a "pull-out fridge". Written solid
 * ("pullout") it is always the bed -- nobody writes "pullout cabinet".
 *
 * Kept in sync with the same pattern in stay-concierge's
 * src/gear_requests.py, which is what turns a guest's ask into the slip
 * this reads.
 */
export const PULLOUT_RE =
  /\bpullouts?\b|pull[\s-]?outs?\s+(?:sofa|couch|bed|sleeper|sectional)|(?:make|made|making)\s+up\s+(?:the\s+)?pull[\s-]?out|sleeper\s*(?:sofa|couch|sectional)|sofa[\s-]?bed|couch[\s-]?bed|\bfuton\b/i;

export type PulloutRequest = {
  slipId: string;
  /** The slip's action_summary when it has one, else its title. */
  ask: string;
  /** Date the prep is due (usually the day before check-in), if set. */
  scheduledDate: string | null;
};

export type PulloutContext = {
  hasPullout: boolean;
  /** Where the sheets live, or null when nobody has recorded it yet. */
  linensLocation: string | null;
  requests: PulloutRequest[];
};

type PropertyPulloutRow = {
  has_pullout_bed: boolean | null;
  pullout_linens_location: string | null;
};

type SlipRow = {
  id: string;
  title: string | null;
  description: string | null;
  action_summary: string | null;
  scheduled_date: string | null;
  snoozed_until: string | null;
};

/**
 * Everything the pullout card needs for one property. Never throws: a
 * missing column or a dead query degrades to "no pullout here", which
 * costs a card, not a walk.
 */
export async function loadPulloutContext(
  sb: SupabaseClient,
  propertyId: string,
): Promise<PulloutContext> {
  const empty: PulloutContext = { hasPullout: false, linensLocation: null, requests: [] };
  if (!propertyId) return empty;

  const { data, error } = await sb
    .from('properties')
    .select('has_pullout_bed, pullout_linens_location')
    .eq('id', propertyId)
    .maybeSingle();
  if (error || !data) return empty;

  const prop = data as PropertyPulloutRow;
  if (prop.has_pullout_bed !== true) return empty;

  return {
    hasPullout: true,
    linensLocation: prop.pullout_linens_location?.trim() || null,
    requests: await loadPulloutRequests(sb, propertyId),
  };
}

/**
 * Live guest asks for the pullout on this property: a slip that came from
 * a guest (an approved reply's promise, or a mined guest message) and is
 * about the pullout.
 *
 * Scoped to slips that are still open work -- a done or dismissed slip is
 * an ask somebody already handled, and a snoozed one is prep for a stay
 * weeks out (the concierge snoozes a future check-in's slip until a week
 * before, see /api/work-slips), neither of which belongs on today's card.
 */
async function loadPulloutRequests(
  sb: SupabaseClient,
  propertyId: string,
): Promise<PulloutRequest[]> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb
    .from('work_slips')
    .select('id, title, description, action_summary, scheduled_date, snoozed_until')
    .eq('property_id', propertyId)
    .in('status', ACTIVE_WORK_SLIP_STATUSES)
    .or('from_guest_request_key.not.is.null,from_guest_message_key.not.is.null');
  if (error || !data) return [];

  return (data as SlipRow[])
    .filter((s) => !(s.snoozed_until && s.snoozed_until > todayIso))
    .filter((s) => PULLOUT_RE.test(`${s.title ?? ''} ${s.action_summary ?? ''} ${s.description ?? ''}`))
    .map((s) => ({
      slipId: s.id,
      ask: (s.action_summary?.trim() || s.title?.trim() || 'Guest asked for the pullout bed.').slice(0, 300),
      scheduledDate: s.scheduled_date,
    }));
}

/**
 * The per-inspection note the card carries, or null when there is no
 * pullout here. Written for someone standing in the home with a phone: the
 * request first (it is the thing that changes what they do), then where
 * the sheets are. `level` is 'alert' only when a guest is actually
 * waiting on the bed -- a card that shouts every visit stops being read.
 */
export function pulloutCardNote(
  ctx: PulloutContext,
): { note: string; level: 'info' | 'alert' } | null {
  if (!ctx.hasPullout) return null;

  const lines: string[] = [];
  if (ctx.requests.length > 0) {
    lines.push(
      ctx.requests.length === 1
        ? 'A guest asked for the pullout bed to be made up. Make it up before you leave.'
        : `${ctx.requests.length} guests have asked for the pullout bed to be made up. Make it up before you leave.`,
    );
    for (const r of ctx.requests) lines.push(`· ${r.ask}`);
  }
  lines.push(
    ctx.linensLocation
      ? `Sheets: ${ctx.linensLocation}`
      : 'Sheets: not recorded yet. Note where you find them so the next person knows.',
  );
  return { note: lines.join('\n'), level: ctx.requests.length > 0 ? 'alert' : 'info' };
}
