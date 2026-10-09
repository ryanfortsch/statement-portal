/**
 * I/O for the "owner block: clean after?" question. Reads the calendar
 * mirror for upcoming owner holds, joins the answers (owner_hold_decisions
 * and live checkout_cleaning_skips), and names the guest arriving on the
 * checkout day so the card can say what the stakes are. The decision itself
 * is written by decideOwnerHoldAction (src/app/turnovers/schedule/actions.ts).
 *
 * The rules are in owner-hold-questions-core.ts (pure, tested); this file is
 * only the database edge.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAllPaged } from '@/lib/paged-select';
import { addDays, todayET } from '@/lib/checkout-schedule';
import { ownerHoldCheckouts, type HeldNight } from '@/lib/owner-hold-checkouts';
import {
  ownerHoldQuestions,
  pendingOwnerHoldQuestions,
  stayKey,
  type LiveSkipRow,
  type OwnerHoldDecisionRow,
  type OwnerHoldQuestion,
} from '@/lib/owner-hold-questions-core';

/** How far ahead to ask. The Guesty mirror is synced 45 days out. */
const LOOKAHEAD_DAYS = 45;
/** How far back a hold may have started and still be running. */
const LOOKBACK_DAYS = 60;

export type OwnerHoldQuestionCard = OwnerHoldQuestion & {
  propertyName: string;
  /** Default checkout time, HH:MM, for "the crew is sent at". */
  checkoutTime: string;
  /** The guest checking in on the checkout day, if any. */
  arrivingGuest: string | null;
};

export type OwnerHoldQuestions = {
  today: string;
  cards: OwnerHoldQuestionCard[];
  pending: OwnerHoldQuestionCard[];
};

export async function loadOwnerHoldQuestions(supabase: SupabaseClient): Promise<OwnerHoldQuestions> {
  const today = todayET();
  const horizon = addDays(today, LOOKAHEAD_DAYS);

  const [nights, propsRes] = await Promise.all([
    selectAllPaged<HeldNight>((fromIdx, toIdx) =>
      supabase
        .from('property_calendar_days')
        .select('property_id, date, block_type, block_reason, block_note, block_start')
        .not('block_type', 'is', null)
        .gte('date', addDays(today, -LOOKBACK_DAYS))
        .lte('date', horizon)
        .order('property_id', { ascending: true })
        .order('date', { ascending: true })
        .range(fromIdx, toIdx),
    ),
    supabase.from('properties').select('id, name, is_active, kind, default_checkout_time'),
  ]);
  if (propsRes.error) throw new Error(`properties read: ${propsRes.error.message}`);

  const properties = new Map<string, { name: string; checkoutTime: string }>();
  for (const p of (propsRes.data ?? []) as Array<{ id: string; name: string | null; is_active: boolean | null; kind: string | null; default_checkout_time: string | null }>) {
    if (p.is_active === false || p.kind === 'hq') continue;
    properties.set(p.id, { name: p.name ?? p.id, checkoutTime: (p.default_checkout_time ?? '10:00').slice(0, 5) });
  }

  const holds = ownerHoldCheckouts(nights, horizon).filter((h) => h.checkOut >= today && properties.has(h.propertyId));
  if (holds.length === 0) return { today, cards: [], pending: [] };

  const propertyIds = [...new Set(holds.map((h) => h.propertyId))];
  const checkIns = [...new Set(holds.map((h) => h.checkIn))];
  const checkOuts = [...new Set(holds.map((h) => h.checkOut))];
  const [decRes, skipRes, arrRes] = await Promise.all([
    supabase
      .from('owner_hold_decisions')
      .select('property_id, stay_check_in, decision, decided_by, decided_at')
      .in('property_id', propertyIds)
      .in('stay_check_in', checkIns),
    supabase
      .from('checkout_cleaning_skips')
      .select('property_id, stay_check_in, created_by')
      .is('cleared_at', null)
      .in('property_id', propertyIds)
      .in('stay_check_in', checkIns),
    supabase
      .from('bookings')
      .select('property_id, check_in, guest_name')
      .in('property_id', propertyIds)
      .in('check_in', checkOuts)
      .in('status', ['confirmed', 'completed'])
      .is('duplicate_of', null),
  ]);
  // A missing decisions table (migration not applied yet) must not take the
  // page down: every hold simply reads as unanswered.
  const decisions = (decRes.error ? [] : (decRes.data ?? [])) as OwnerHoldDecisionRow[];
  const skips = (skipRes.error ? [] : (skipRes.data ?? [])) as LiveSkipRow[];
  const arrivals = new Map<string, string>();
  for (const b of (arrRes.data ?? []) as Array<{ property_id: string; check_in: string; guest_name: string | null }>) {
    const name = (b.guest_name ?? '').trim();
    const key = stayKey(b.property_id, b.check_in);
    if (name && !arrivals.has(key)) arrivals.set(key, name);
  }

  const questions = ownerHoldQuestions(holds, decisions, skips, today);
  const cards: OwnerHoldQuestionCard[] = questions.map((q) => {
    const p = properties.get(q.propertyId)!;
    return {
      ...q,
      propertyName: p.name,
      checkoutTime: p.checkoutTime,
      arrivingGuest: arrivals.get(stayKey(q.propertyId, q.checkOut)) ?? null,
    };
  });
  return { today, cards, pending: pendingOwnerHoldQuestions(cards) as OwnerHoldQuestionCard[] };
}

/** For the Messaging tab badge. Null when it cannot be read. */
export async function countPendingOwnerHoldQuestions(supabase: SupabaseClient): Promise<number | null> {
  try {
    return (await loadOwnerHoldQuestions(supabase)).pending.length;
  } catch {
    return null;
  }
}
