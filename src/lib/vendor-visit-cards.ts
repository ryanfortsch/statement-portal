import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { loadGuestTimes } from '@/lib/property-rates';
import { DEFAULT_GUEST_CHECKIN, DEFAULT_GUEST_CHECKOUT } from '@/lib/house-policy';
import { categoryLabel } from '@/lib/trades';
import { QUO_LINES, type QuoLine } from '@/lib/quo-lines';
import { loadVisitQueue } from '@/lib/vendor-visit-queue';
import { offeredVisitDeadline, visitTiming, type VisitTiming } from '@/lib/vendor-visit-follow-through';
import { addDays, etDateOf, readOfferWindows, type OfferWindow, type Ymd } from '@/lib/vendor-visit-dates';
import {
  chooseVisitSlips,
  nightFactsFrom,
  planVisitHold,
  type BookingNight,
  type HoldPlan,
  type MirrorNight,
  type NightFact,
  type VisitSlipChoice,
  type VisitSlipInput,
} from '@/lib/vendor-visit-core';

/**
 * Vendor visit holds, the reads (2026-10-18): the Team inbox cards and the
 * count on the Team tab. Nothing here writes. See docs/vendor-visit-holds.md.
 */

export type VendorVisitCardData = {
  id: string;
  status: 'pending' | 'approving';
  /** An approve that started more than five minutes ago and never finished. */
  stuck: boolean;
  vendorName: string;
  /** 'owner' when an owner told us about the work: the owner wrote the
   *  message, the vendor is theirs, and there is no trade slip to schedule. */
  source: 'vendor' | 'owner';
  /** Who wrote the message: the owner on an owner's report, else the vendor. */
  writer: string;
  tradeLabel: string | null;
  tradeCategory: string | null;
  fromPhone: string;
  lineLabel: string | null;
  messageBody: string;
  messageAt: string;
  createdAt: string;
  /** Minutes since the card was filed, for the card's header. */
  ageMinutes: number;
  property: { id: string; name: string; authority: 'guesty' | 'helm' } | null;
  propertyBasis: string | null;
  start: Ymd | null;
  end: Ymd | null;
  startTime: string | null;
  endTime: string | null;
  timeLabel: string | null;
  dateBasis: string | null;
  askReason: string | null;
  candidates: Ymd[];
  offer: { text: string; at: string; windows: OfferWindow[] } | null;
  checkoutTime: string;
  checkinTime: string;
  /** Null until the card has a home and a day. */
  plan: HoldPlan | null;
  /** The calendar could not be read: the card says so and approve re-reads. */
  planError: string | null;
  slips: VisitSlipChoice[];
  lastError: string | null;
  timing: VisitTiming;
};

export const STUCK_CLAIM_MS = 5 * 60_000;

/**
 * The calendar facts for one home over [from, to]: canonical bookings plus
 * the day mirror. Throws when either read fails, because an unread calendar
 * is not an empty one (a failed read must never make a booked night look
 * open).
 */
export async function loadNightFacts(propertyId: string, from: Ymd, to: Ymd): Promise<Map<Ymd, NightFact>> {
  const [b, m] = await Promise.all([
    supabaseAdmin
      .from('bookings')
      .select('check_in, check_out, status, ical_uid, hold_kind')
      .eq('property_id', propertyId)
      .is('duplicate_of', null)
      .in('status', ['confirmed', 'completed', 'pending', 'block'])
      .lte('check_in', to)
      .gte('check_out', from),
    supabaseAdmin
      .from('property_calendar_days')
      .select('date, status, block_type, block_reason, block_note')
      .eq('property_id', propertyId)
      .gte('date', from)
      .lte('date', to),
  ]);
  if (b.error) throw new Error(`bookings: ${b.error.message}`);
  if (m.error) throw new Error(`calendar days: ${m.error.message}`);
  const bookings = ((b.data ?? []) as BookingNight[]).map((r) => ({ ...r, check_in: String(r.check_in).slice(0, 10), check_out: String(r.check_out).slice(0, 10) }));
  return nightFactsFrom(bookings, (m.data ?? []) as MirrorNight[], from, to);
}

/** Pending vendor visits, for the Team pill and the kinds line. Null when
 *  unreadable; 0 before the migration lands. */
export async function countPendingVendorVisits(): Promise<number | null> {
  try {
    return (await loadVisitQueue(supabaseAdmin)).rows.length;
  } catch {
    return null;
  }
}

/** Every pending vendor visit, ready for the card. Empty before the
 *  migration lands. */
export async function loadVendorVisitCards(now: Date = new Date()): Promise<VendorVisitCardData[]> {
  const { rows, slips, categories: category } = await loadVisitQueue(supabaseAdmin);
  if (rows.length === 0) return [];

  const today = etDateOf(now);
  const propertyIds = [...new Set(rows.map((r) => r.property_id).filter(Boolean) as string[])];
  const [props, times] = await Promise.all([
    propertyIds.length
      ? supabaseAdmin.from('properties').select('id, name, calendar_authority').in('id', propertyIds)
      : Promise.resolve({ data: [], error: null }),
    loadGuestTimes(propertyIds).catch(() => new Map<string, { checkin: string | null; checkout: string | null }>()),
  ]);
  if (props.error) throw new Error('The homes for these visits could not be read. Try again.');
  const homes = new Map(
    ((props.data ?? []) as Array<{ id: string; name: string; calendar_authority: string | null }>).map((p) => [
      p.id,
      { id: p.id, name: p.name, authority: (p.calendar_authority === 'helm' ? 'helm' : 'guesty') as 'guesty' | 'helm' },
    ]),
  );
  const slipsByHome = new Map<string, VisitSlipInput[]>();
  for (const s of slips) {
    if (!s.property_id) continue;
    const list = slipsByHome.get(s.property_id) ?? [];
    list.push(s);
    slipsByHome.set(s.property_id, list);
  }

  const cards: VendorVisitCardData[] = [];
  for (const r of rows) {
    const home = r.property_id ? homes.get(r.property_id) ?? null : null;
    const t = home ? times.get(home.id) : undefined;
    const checkoutTime = t?.checkout ?? DEFAULT_GUEST_CHECKOUT;
    const checkinTime = t?.checkin ?? DEFAULT_GUEST_CHECKIN;
    const offerWindows = r.offer_text && r.offer_at ? readOfferWindows(r.offer_text, etDateOf(r.offer_at)).filter((w) => w.end >= today) : [];
    const start = r.visit_date ? String(r.visit_date).slice(0, 10) : null;
    const end = start ? (r.visit_end_date ? String(r.visit_end_date).slice(0, 10) : start) : null;
    const fromOwner = r.source === 'owner';
    const trade = r.trade_vendor_id ? category.get(r.trade_vendor_id) ?? null : null;

    let plan: HoldPlan | null = null;
    let planError: string | null = null;
    let arrivalDeadline: string | null = null;
    if (home && start && end) {
      try {
        const nights = await loadNightFacts(home.id, addDays(start, -1), end);
        if (nights.get(end)?.arrival) arrivalDeadline = checkinTime;
        plan = planVisitHold({
          today,
          start,
          end,
          time: { start: r.start_time, end: r.end_time },
          nights,
          checkoutTime,
          checkinTime,
          holdNightBefore: false,
          vendorName: r.vendor_name,
          windows: offerWindows,
        });
      } catch (e) {
        planError = e instanceof Error ? e.message : String(e);
      }
    }

    const line = (r.quo_line ?? null) as QuoLine | null;
    cards.push({
      id: r.id,
      status: r.status === 'approving' ? 'approving' : 'pending',
      stuck: r.status === 'approving' && !!r.claimed_at && now.getTime() - Date.parse(r.claimed_at) > STUCK_CLAIM_MS,
      vendorName: r.vendor_name,
      source: fromOwner ? 'owner' : 'vendor',
      writer: fromOwner ? r.reported_by || 'The owner' : r.vendor_name,
      tradeLabel: trade ? categoryLabel(trade) : null,
      tradeCategory: trade,
      fromPhone: r.from_phone,
      lineLabel: line && QUO_LINES[line] ? QUO_LINES[line].label : null,
      messageBody: r.message_body,
      messageAt: r.message_at,
      createdAt: r.created_at,
      ageMinutes: Math.max(0, Math.floor((now.getTime() - Date.parse(r.created_at)) / 60_000)),
      property: home,
      propertyBasis: r.property_basis,
      start,
      end,
      startTime: r.start_time,
      endTime: r.end_time,
      timeLabel: r.time_label,
      dateBasis: r.date_basis,
      askReason: r.ask_reason,
      candidates: (r.date_candidates ?? []).map((d) => String(d).slice(0, 10)).filter((d) => d >= today),
      offer: r.offer_text && r.offer_at ? { text: r.offer_text, at: r.offer_at, windows: offerWindows } : null,
      checkoutTime,
      checkinTime,
      plan,
      planError,
      // The owner's own crew: none of our slips are theirs to schedule.
      slips: home && !fromOwner ? chooseVisitSlips(slipsByHome.get(home.id) ?? [], { category: trade ?? '', vendorName: r.vendor_name }) : [],
      lastError: r.last_error,
      timing: visitTiming(start, end, [r.end_time, offeredVisitDeadline(r), arrivalDeadline], now),
    });
  }
  return cards;
}
