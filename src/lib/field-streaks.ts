/**
 * Streak bonuses for field contractors: work 5 days in a row and the day-5
 * packet earns a $50 bonus; make it 10 and day 10 adds $100. Past 10 the cycle
 * restarts (day 15 pays $50 again, day 20 pays $100), so sustained work keeps
 * paying. Deliberately quiet in the product: the award lands as the packet's
 * ordinary bonus (bonus_cents + reason), one line on the profile, one email to
 * the office. No ladders, no badges.
 *
 * A "worked day" is a distinct packet visit_date (any trade) that reached
 * submitted or approved. Awards happen at submit time; the streak_awards
 * UNIQUE(contractor_id, cycle_start, milestone) row is the idempotency guard,
 * so resubmits and second same-day packets can never double-award.
 */
import { fieldDb } from '@/lib/field-db';

const DAY_MS = 86_400_000;
const CYCLE_DAYS = 10;
const MILESTONES: Record<number, number> = { 5: 5000, 10: 10000 }; // cycle day -> cents

export type StreakAward = {
  days: number; // raw streak length on award day (e.g. 15)
  milestone: 5 | 10; // position within the 10-day cycle
  bonusCents: number;
};

export type StreakInfo = {
  /** Consecutive worked days ending today or yesterday (a streak is still
   *  alive the morning after; it breaks once a full day passes unworked). */
  days: number;
  /** Days until the next milestone in the current cycle, with its payout. */
  nextIn: number;
  nextBonusCents: number;
};

function todayET(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}
function shiftDate(d: string, days: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Distinct worked days (visit_date of submitted/approved packets), descending. */
async function workedDays(contractorId: string): Promise<string[]> {
  const { data } = await fieldDb()
    .from('inspection_packets')
    .select('visit_date')
    .eq('awarded_contractor_id', contractorId)
    .in('status', ['submitted', 'approved'])
    .order('visit_date', { ascending: false })
    .limit(400);
  const seen = new Set<string>();
  for (const r of (data ?? []) as { visit_date: string }[]) seen.add(r.visit_date);
  return [...seen].sort().reverse();
}

/** Length of the consecutive run ending exactly at `endDay` (0 if unworked). */
function runEndingAt(days: string[], endDay: string): number {
  const set = new Set(days);
  if (!set.has(endDay)) return 0;
  let n = 0;
  let d = endDay;
  while (set.has(d)) {
    n++;
    d = shiftDate(d, -1);
  }
  return n;
}

/**
 * Called from submitPacket AFTER the status flips to submitted. Checks whether
 * this packet's visit day lands on a streak milestone and, if so, awards the
 * bonus onto THIS packet. Returns the award (for the office email) or null.
 * Never throws to the caller's detriment: callers wrap in try/catch so a
 * streak hiccup can never block a submit.
 */
export async function maybeAwardStreakBonus(packetId: string): Promise<StreakAward | null> {
  const { data: pData } = await fieldDb()
    .from('inspection_packets')
    .select('id, status, visit_date, awarded_contractor_id, bonus_cents, bonus_reason')
    .eq('id', packetId)
    .maybeSingle();
  const packet = pData as {
    id: string;
    status: string;
    visit_date: string;
    awarded_contractor_id: string | null;
    bonus_cents: number;
    bonus_reason: string | null;
  } | null;
  if (!packet || packet.status !== 'submitted' || !packet.awarded_contractor_id) return null;

  const days = await workedDays(packet.awarded_contractor_id);
  const streak = runEndingAt(days, packet.visit_date);
  if (streak < 5) return null;

  // Position within the repeating 10-day cycle; only days 5 and 10 pay.
  const cyclePos = ((streak - 1) % CYCLE_DAYS) + 1;
  const cents = MILESTONES[cyclePos];
  if (!cents) return null;
  const cycleStart = shiftDate(packet.visit_date, -(cyclePos - 1));

  // Idempotency: the UNIQUE constraint decides. A duplicate insert (resubmit,
  // second packet the same day) errors with 23505 and we quietly do nothing.
  const { error: awardErr } = await fieldDb().from('streak_awards').insert({
    contractor_id: packet.awarded_contractor_id,
    cycle_start: cycleStart,
    milestone: cyclePos,
    streak_days: streak,
    bonus_cents: cents,
    packet_id: packet.id,
    visit_date: packet.visit_date,
  });
  if (awardErr) return null;

  // Ride the packet's ordinary bonus so payout, receipts, cards, and the
  // operator's approve screen all carry it with no new plumbing. Append to any
  // operator-set bonus rather than clobbering it.
  const label = `${streak}-day streak bonus`;
  await fieldDb()
    .from('inspection_packets')
    .update({
      bonus_cents: (packet.bonus_cents || 0) + cents,
      bonus_reason: packet.bonus_reason ? `${packet.bonus_reason}; ${label}` : label,
      updated_at: new Date().toISOString(),
    })
    .eq('id', packet.id);

  await fieldDb()
    .from('packet_events')
    .insert({
      packet_id: packet.id,
      contractor_id: packet.awarded_contractor_id,
      event_type: 'streak_bonus',
      payload: { streak_days: streak, milestone: cyclePos, bonus_cents: cents },
    })
    .then(
      () => {},
      () => {},
    );

  return { days: streak, milestone: cyclePos as 5 | 10, bonusCents: cents };
}

/** Current streak for the profile note: the run ending today, or the still-alive
 *  run ending yesterday. Null when there's no streak of 2+ going. */
export async function getStreakInfo(contractorId: string): Promise<StreakInfo | null> {
  const days = await workedDays(contractorId);
  if (days.length === 0) return null;
  const today = todayET();
  const n = runEndingAt(days, today) || runEndingAt(days, shiftDate(today, -1));
  if (n < 2) return null;
  const cyclePos = ((n - 1) % CYCLE_DAYS) + 1;
  const next = cyclePos < 5 ? 5 : cyclePos < 10 ? 10 : 15; // 15 = next cycle's day 5
  const nextBonusCents = next === 10 ? 10000 : 5000;
  return { days: n, nextIn: next - cyclePos, nextBonusCents };
}
