/**
 * The Guest reviews lens's words (2026-10-30), pure and under test: what a
 * host-review card and a review-reply card say, which verbs they carry, and
 * when they are due.
 *
 * The concierge files the cards (host_reviews.py, review_replies.py) and
 * records every decision in its own ledgers. Helm's one door for a decision
 * on a card that nothing sends is Mark handled with a reason, so on these
 * cards the REASON is the choice, and the strings below are a contract with
 * host_reviews.record_outcome: "Let it post" and "Skip" are the no, anything
 * else (Stopped, Posted) is the yes. Change one side, change the other.
 */

import type { HostReviewCard, ReviewReplyCard } from './stay-concierge';
import { shortDay, stars } from './review-ask-state.ts';

export const STOP_DONE = 'Stopped in Guesty';
export const STOP_SKIP = 'Let it post';
export const POST_DONE = 'Posted on the channel';
export const POST_SKIP = 'Skip, no review';
export const HOST_REVIEW_STOP_REASONS = [STOP_DONE, STOP_SKIP] as const;
export const HOST_REVIEW_POST_REASONS = [POST_DONE, POST_SKIP] as const;
export const REPLY_REASONS = ['Replied on the channel', 'Removal requested', 'Leave it'] as const;

export type DueTone = 'due' | 'late' | 'calm';

export type HostReviewFace = {
  /** "Stop Guesty's auto review" or "Our review of Ann". */
  title: string;
  /** The clock, in one line. */
  due: string;
  dueTone: DueTone;
  /** Why this card exists, and what the thread said about the guest. */
  context: string;
  /** The page outside Helm where the hand action happens. */
  link: { href: string; label: string } | null;
  /** The verb labels. */
  done: string;
  skip: string;
};

const CHANNEL_WORDS: Record<string, string> = {
  airbnb2: 'Airbnb',
  airbnb: 'Airbnb',
  homeaway2: 'Vrbo',
  vrbo: 'Vrbo',
  bookingcom: 'Booking.com',
  'booking.com': 'Booking.com',
};

export function channelWord(module: string): string {
  const m = (module ?? '').trim().toLowerCase();
  return CHANNEL_WORDS[m] ?? ((module ?? '').trim() || 'the channel');
}

function dayBefore(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function dueTone(dueBy: string, today: string): DueTone {
  if (!dueBy) return 'due';
  if (today > dueBy) return 'late';
  if (today === dueBy) return 'due';
  return 'calm';
}

export function hostReviewFace(card: HostReviewCard, guestFirst: string, today: string): HostReviewFace {
  const who = (guestFirst ?? '').trim() || 'the guest';
  const channel = channelWord(card.channel);
  if (card.stage === 'stop') {
    const night = card.fires_at ? dayBefore(card.fires_at) : card.due_by;
    const tone = dueTone(card.due_by || night, today);
    const when = night ? `after midnight ${shortDay(night)}` : 'soon';
    return {
      title: "Stop Guesty's auto review",
      due:
        tone === 'late'
          ? `Guesty's 5-star review was due ${when}; check the reservation, it may already be up`
          : `Guesty posts a 5-star review of ${who} on ${channel} ${when}${tone === 'due' ? ', tonight' : ''}`,
      dueTone: tone === 'calm' ? 'due' : tone,
      context: `Red: ${card.reason || 'the stay went badly'}. Stopping it holds back Airbnb's "write a review" nudge and keeps the one host review for us to write on day 13.`,
      link: card.guesty_url ? { href: card.guesty_url, label: 'Open in Guesty' } : null,
      done: 'Stopped',
      skip: 'Let it post',
    };
  }
  const conduct =
    card.conduct === 'concern'
      ? `Their conduct in the thread read as a concern: ${card.conduct_reason || 'see the thread'}.`
      : card.conduct === 'fine'
        ? `Their conduct in the thread read as fine${card.conduct_reason ? `: ${card.conduct_reason}` : ''}. The stay went badly for them, not because of them.`
        : 'Their conduct could not be read from the thread. Edit the draft before posting.';
  const tone = dueTone(card.due_by, today);
  return {
    title: `Our review of ${who}`,
    due:
      tone === 'late'
        ? `The window closed ${shortDay(card.window_closes)}; the channel may no longer take a review`
        : `Post on ${channel} by ${shortDay(card.due_by)}${tone === 'due' ? ', today' : ''} · window closes ${shortDay(card.window_closes)}, when both reviews publish`,
    dueTone: tone,
    context: `Red: ${card.reason || 'the stay went badly'}. ${conduct}`,
    link: card.channel_url ? { href: card.channel_url, label: `Open on ${channel}` } : null,
    done: 'Posted',
    skip: 'Skip',
  };
}

export type ReviewReplyFace = {
  title: string;
  /** The stars, or "Rated below five" when the feed gave no number. */
  rating: string;
  grounds: string;
  /** The thread or the text supports a removal request. */
  contestable: boolean;
  policy: { href: string; label: string } | null;
  /** Guesty's reply endpoint covers this channel. */
  canPost: boolean;
};

export function reviewReplyFace(card: ReviewReplyCard, guestFirst: string): ReviewReplyFace {
  const who = (guestFirst ?? '').trim() || 'The guest';
  const channel = channelWord(card.channel);
  const contestable = (card.grounds ?? []).length > 0;
  return {
    title: `${who}'s review on ${channel}`,
    rating: card.stars != null ? `${stars(card.stars)} ${card.stars}` : 'Rated below five',
    grounds: card.grounds_line || (contestable ? 'Possible removal grounds found.' : 'No removal grounds found; reply and move on.'),
    contestable,
    policy: contestable && card.policy_url ? { href: card.policy_url, label: 'Airbnb reviews policy' } : null,
    canPost: !!card.can_post,
  };
}

/** The lens's standing rules in three sentences, from the concierge's own
 *  numbers so the page never states a delay the listings no longer have. */
export function reviewLensRules(settings: {
  auto_review_delay_days?: number;
  host_review_post_day?: number;
  host_review_cards?: boolean;
}): string[] {
  const delay = settings.auto_review_delay_days ?? 0;
  const postDay = settings.host_review_post_day ?? 13;
  const lines = [
    delay > 0
      ? `Guesty's Auto reviews posts a 5-star review of every Airbnb and Vrbo guest ${delay} day${delay === 1 ? '' : 's'} after checkout, with nobody in the loop.`
      : "Guesty's Auto reviews posts a 5-star review of every Airbnb and Vrbo guest a few days after checkout, with nobody in the loop.",
    `A stay the review engine reads as red gets a card here to stop that review in Guesty, then our own review of the guest to post by hand on day ${postDay}, drafted from the thread.`,
    'A public review under five stars gets a drafted reply, posted onto the review through Guesty on approve, with the removal grounds the thread supports, if any.',
  ];
  if (settings.host_review_cards === false) lines.push('Host-review cards are switched off in the concierge right now.');
  return lines;
}
