/**
 * Vendor visit holds, the rules (2026-10-18). The IO lives in
 * vendor-visits.ts (detection, the card's data) and vendor-visit-approve.ts
 * (the one writer); everything a test needs to pin is here, pure.
 *
 * A trade vendor texts back a day ("Tuesday 10/27 at 1 works"). Helm files a
 * proposal, the Team inbox shows it as a card, and only the operator's
 * approve holds the calendar and schedules the slips. Dotti, 2026-10-18:
 * "schedule block should be for my approval." See docs/vendor-visit-holds.md.
 */

import { slipLane, type WorkLane } from './work-slip-lanes.ts';
import { heldNightReason, isGuestyRuleArtifactUid } from './calendar-holds.ts';
import { isOwnerNight } from './owner-hold-checkouts.ts';
import { addDays, daysBetween, fmtClock, fmtDay, inWindows, MAX_VISIT_DAYS, type OfferWindow, type Ymd } from './vendor-visit-dates.ts';

export type VendorVisitStatus = 'pending' | 'approving' | 'approved' | 'handled' | 'superseded';

/** One row of vendor_visit_proposals. */
export type VendorVisitRow = {
  id: string;
  /** Null on an owner's report (source 'owner'), which names no vendor. */
  trade_vendor_id: string | null;
  /** 'vendor': a trade vendor's text. 'owner': work an owner told us about
   *  (owner-work-holds.ts). Absent before 20261023130000. */
  source?: 'vendor' | 'owner' | null;
  /** The owner who wrote, on an owner's report. */
  reported_by?: string | null;
  owner_card_id?: string | null;
  vendor_name: string;
  from_phone: string;
  quo_line: string | null;
  quo_message_id: string;
  message_body: string;
  message_at: string;
  property_id: string | null;
  property_basis: string | null;
  visit_date: string | null;
  visit_end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  time_label: string | null;
  date_basis: string | null;
  ask_reason: string | null;
  date_candidates: string[] | null;
  offer_text: string | null;
  offer_at: string | null;
  status: VendorVisitStatus;
  claimed_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  handled_reason: string | null;
  hold_result: unknown;
  scheduled_slip_ids: string[] | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

// ─── which home ──────────────────────────────────────────────────────────

export type RosterEntry = { id: string; name: string; listing_match?: string | null };

/**
 * The home a vendor's (or our) text names, or null.
 *
 * Stricter than the cleaner matcher on purpose. A cleaner's "21 done" may
 * name a home by its number alone; a vendor's text is full of dates, and that
 * rule reads "Wed 10/21" as 21 Horton. So dates and times are blanked first,
 * and a home matches only on its listing name, or on its street number AND a
 * street word. "53 Rocky Neck" and "53 Rocky Neck, Downstairs" both match
 * "53 rocky neck": the one with the most of its words present wins, and a tie
 * is no answer.
 */
export function matchVisitProperty(text: string, roster: readonly RosterEntry[]): RosterEntry | null {
  if (!text) return null;
  const cleaned = text
    .toLowerCase()
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const padded = ` ${cleaned} `;
  let best: { entry: RosterEntry; score: number } | null = null;
  let tie = false;
  for (const p of roster) {
    let score = 0;
    const listing = (p.listing_match ?? '').toLowerCase().trim();
    if (listing && listing.length >= 6 && padded.includes(` ${listing} `)) score = 100 + listing.length;
    const num = p.name.match(/^(\d+)/)?.[1];
    if (!score && num && new RegExp(`(^| )${num}( |$)`).test(cleaned)) {
      const words = p.name
        .replace(/^\d+\s*/, '')
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => w.length >= 3);
      const present = words.filter((w) => padded.includes(` ${w.slice(0, 4)}`)).length;
      if (present > 0) score = present * 10 - (words.length - present);
    }
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = { entry: p, score };
      tie = false;
    } else if (score === best.score && best.entry.id !== p.id) {
      tie = true;
    }
  }
  return best && !tie ? best.entry : null;
}

// ─── which slips ─────────────────────────────────────────────────────────

/** The words a slip about each trade's work uses. A trade with no entry
 *  ticks nothing by default: its pro-lane slips are listed for the operator. */
export const TRADE_WORDS: Record<string, RegExp> = {
  plumbing:
    /\b(plumb\w*|toilets?|flush\w*|faucets?|sinks?|drains?|clog\w*|pipes?|piping|shower ?(?:valve|head|cartridge|diverter|drain)|valves?|cartridges?|spigots?|hose ?bibb?s?|shut-?offs?|water heater|hot water|sewer|disposal|tubs?|bathtub|wax ring|supply lines?|sump)\b/i,
  electrical:
    /\b(electric\w*|outlets?|breakers?|panel|gfci|wiring|wires?|light fixtures?|switch(?:es)?|circuits?|sconces?|ceiling fans?|dimmers?|smoke detectors?|co detectors?)\b/i,
  hvac: /\b(hvac|heat|heater|heating|furnace|boiler|a\/c|ac unit|air condition\w*|mini[- ]?splits?|heat pump|thermostats?|ducts?|radiators?|baseboards?)\b/i,
  appliance:
    /\b(appliances?|dishwasher|washer|washing machine|dryer|fridge|refrigerator|freezer|oven|stove|range|cooktop|microwave|ice maker|disposal)\b/i,
  locksmith: /\b(locks?|deadbolts?|keypads?|smart lock|door handles?|lockbox)\b/i,
  pest: /\b(pests?|mice|mouse|rats?|rodents?|ants|bugs?|bees|wasps?|hornets?|termites?|bats?|exterminat\w*|droppings)\b/i,
  roofing: /\b(roof\w*|shingles?|gutters?|flashing|downspouts?|skylights?)\b/i,
  chimney: /\b(chimney|fireplace|flue|wood ?stove)\b/i,
  septic_water: /\b(septic|well pump|water pressure|cesspool|leach field)\b/i,
  pool_spa: /\b(pool|hot tub|spa|jacuzzi)\b/i,
  windows_doors: /\b(windows?|doors?|screens?|slider|storm door|glass)\b/i,
  internet_av: /\b(wi-?fi|internet|router|modem|tv|television|cable box|sonos|speakers?)\b/i,
  alarm_security: /\b(alarm|cameras?|doorbell|security system)\b/i,
};

export type VisitSlipInput = {
  id: string;
  title: string;
  description?: string | null;
  action_summary?: string | null;
  category: string;
  status: string;
  run_scope?: string | null;
  owner_action_required?: boolean | null;
  from_supply_key?: string | null;
  from_guest_request_key?: string | null;
  scheduled_date?: string | null;
  assigned_to_label?: string | null;
  assigned_to_email?: string | null;
  property_id?: string;
  completed_at?: string | null;
};

export type VisitSlipChoice = {
  id: string;
  title: string;
  lane: WorkLane;
  matchesTrade: boolean;
  /** Ticked on the card by default. */
  ticked: boolean;
  /** Who already has it, when someone does ("with Vendor: X for Oct 30"). */
  note: string | null;
};

const ACTIVE = new Set(['open', 'in_progress', 'scheduled']);

/** The label a vendor visit stamps on a slip. The maintenance board's
 *  "Mark scheduled" writes the same shape after a work order. */
export function vendorSlipLabel(vendorName: string): string {
  return `Vendor: ${vendorName.trim()}`;
}

/**
 * Relevant work only. A pasted review in description can mention several
 * unrelated repairs, so match the task's title/summary, not its source text.
 */
export function chooseVisitSlips(
  slips: readonly VisitSlipInput[],
  opts: { category: string; vendorName: string },
): VisitSlipChoice[] {
  const words = TRADE_WORDS[opts.category] ?? null;
  const ours = vendorSlipLabel(opts.vendorName);
  const out: VisitSlipChoice[] = [];
  for (const s of slips) {
    if (!ACTIVE.has(s.status)) continue;
    const lane = slipLane({
      category: s.category as never,
      title: s.title,
      run_scope: (s.run_scope ?? null) as never,
      owner_action_required: !!s.owner_action_required,
      from_supply_key: s.from_supply_key ?? null,
      from_guest_request_key: s.from_guest_request_key ?? null,
    });
    if (lane === 'supply' || lane === 'office') continue;
    if (lane === 'owner') continue;
    const matchesTrade = !!words && words.test(`${s.title} ${s.action_summary ?? ''}`);
    if (!matchesTrade && s.assigned_to_label !== ours) continue;
    const who = s.assigned_to_label || s.assigned_to_email || null;
    const elsewhere = !!who && who !== ours;
    const note = elsewhere ? `with ${who}${s.scheduled_date ? ` for ${fmtDay(s.scheduled_date)}` : ''}` : null;
    out.push({ id: s.id, title: s.title, lane, matchesTrade, ticked: lane === 'pro' && matchesTrade && !elsewhere, note });
  }
  return out.sort((a, b) => Number(b.ticked) - Number(a.ticked) || Number(b.lane === 'pro') - Number(a.lane === 'pro') || a.title.localeCompare(b.title));
}

// ─── which nights ────────────────────────────────────────────────────────

/** One night at the home, from the calendar (maintenance-runs dayClearRange). */
export type NightFact = {
  /** Someone sleeps there that night. */
  guest: boolean;
  /** A guest stay starts that day. */
  arrival: boolean;
  /** A guest stay ends that morning. */
  departure: boolean;
  /** A deliberate hold covers the night, in operator words; null when none. */
  held: string | null;
  /** That hold is the owner's. */
  ownerHeld: boolean;
};

/** A canonical `bookings` row at the home (duplicate_of is null). */
export type BookingNight = {
  check_in: string;
  check_out: string;
  status: string;
  ical_uid?: string | null;
  hold_kind?: string | null;
};

/** A `property_calendar_days` row. */
export type MirrorNight = {
  date: string;
  status: string;
  block_type: string | null;
  block_reason?: string | null;
  block_note?: string | null;
};

/** Stays that put a guest in the house. A pending request counts: a hold
 *  must never sit over a booking that is about to be confirmed. */
const GUEST_STATUSES = new Set(['confirmed', 'completed', 'pending']);

/**
 * The night facts for [from, to] from the two calendar sources, read the way
 * maintenance-runs dayClearRange reads them: a guest stay or a mirror night
 * Guesty shows as booked is a guest; a deliberate hold from either source is
 * held (Guesty's advance-notice and booking-window artifacts are not); the
 * owner's holds are named. The caller passes rows it actually read: a failed
 * read is an error upstream, never an empty calendar here.
 */
export function nightFactsFrom(
  bookings: readonly BookingNight[],
  mirror: readonly MirrorNight[],
  from: Ymd,
  to: Ymd,
): Map<Ymd, NightFact> {
  const out = new Map<Ymd, NightFact>();
  const byDate = new Map(mirror.map((m) => [m.date.slice(0, 10), m]));
  const stays = bookings.filter((b) => GUEST_STATUSES.has(b.status));
  const blocks = bookings.filter((b) => b.status === 'block' && !isGuestyRuleArtifactUid(b.ical_uid ?? null));
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const day = byDate.get(d);
    const covering = blocks.filter((b) => b.check_in <= d && d < b.check_out);
    const mirrorBooked = !!day && day.status !== 'available' && day.status !== 'unavailable';
    const guest = stays.some((b) => b.check_in <= d && d < b.check_out) || mirrorBooked;
    const held = guest ? null : heldNightReason(day ?? null, covering.map((b) => ({ ical_uid: b.ical_uid ?? null })));
    out.set(d, {
      guest,
      arrival: stays.some((b) => b.check_in === d),
      departure: stays.some((b) => b.check_out === d),
      held,
      ownerHeld: !!held && ((!!day && isOwnerNight(day)) || covering.some((b) => b.hold_kind === 'owner')),
    });
  }
  return out;
}

export type HoldPlanInput = {
  /** Live callers pass today's Eastern date; past nights cannot be held. */
  today?: Ymd;
  start: Ymd;
  end: Ymd;
  time: { start: string | null; end: string | null };
  /** Every night from the day before the visit to its last day. A night
   *  missing here was not read, and is never held. */
  nights: ReadonlyMap<Ymd, NightFact>;
  /** The home's guest checkout and check-in, 'HH:MM'. */
  checkoutTime: string;
  checkinTime: string;
  /** The operator ticked "hold the night before too". */
  holdNightBefore: boolean;
  vendorName: string;
  windows: readonly OfferWindow[];
};

export type HoldPlan = {
  /** The nights approve closes: open nights only, never a guest's. */
  holdNights: Ymd[];
  alreadyHeld: { date: Ymd; reason: string }[];
  /** Nights a guest has, inside the visit. Never held. */
  guestNights: Ymd[];
  /** The night before the visit, offered when the vendor comes before
   *  checkout (or gave no time) and the night is open. Suggested when the
   *  early arrival is certain. */
  nightBefore: { date: Ymd; offered: boolean; suggested: boolean };
  /** What the operator should know first, in operator words. */
  warnings: string[];
  /** Null when we offered no windows. */
  outsideOffer: boolean | null;
};

export function planVisitHold(input: HoldPlanInput): HoldPlan {
  const { start, end, time, nights, checkoutTime, checkinTime, vendorName } = input;
  const plan: HoldPlan = {
    holdNights: [],
    alreadyHeld: [],
    guestNights: [],
    nightBefore: { date: addDays(start, -1), offered: false, suggested: false },
    warnings: [],
    outsideOffer: null,
  };

  // The morning of the first day: a guest leaving, and when the vendor comes.
  const first = nights.get(start);
  if (first?.departure) {
    if (!time.start) plan.warnings.push(`A guest checks out ${fmtDay(start)} at ${fmtClock(checkoutTime)}, and ${vendorName} gave no time.`);
    else if (time.start < checkoutTime) plan.warnings.push(`A guest checks out ${fmtDay(start)} at ${fmtClock(checkoutTime)}; ${vendorName} comes at ${fmtClock(time.start)}.`);
  }

  // The night before, when an arrival before checkout could meet a guest
  // who books it.
  const before = nights.get(plan.nightBefore.date);
  if ((!input.today || plan.nightBefore.date >= input.today) && before && !before.guest && !before.held && (!time.start || time.start < checkoutTime)) {
    plan.nightBefore.offered = true;
    plan.nightBefore.suggested = !!time.start;
    if (input.holdNightBefore) plan.holdNights.push(plan.nightBefore.date);
  }

  for (let d = start; d <= end && daysBetween(start, d) < MAX_VISIT_DAYS; d = addDays(d, 1)) {
    if (input.today && d < input.today) continue;
    const n = nights.get(d);
    if (!n) {
      plan.warnings.push(`The calendar for ${fmtDay(d)} could not be read; that night is not held.`);
      continue;
    }
    if (n.guest) {
      plan.guestNights.push(d);
      if (n.arrival) {
        plan.warnings.push(
          d === start
            ? `A guest arrives ${fmtDay(d)} at ${fmtClock(checkinTime)}: ${vendorName} has to be done before then.`
            : `A guest arrives ${fmtDay(d)}, in the middle of the visit.`,
        );
      } else {
        plan.warnings.push(`A guest is in the house the night of ${fmtDay(d)}.`);
      }
      continue;
    }
    if (n.held) {
      plan.alreadyHeld.push({ date: d, reason: n.held });
      if (n.ownerHeld) plan.warnings.push(`The owner has the home ${fmtDay(d)}.`);
      continue;
    }
    plan.holdNights.push(d);
  }

  if (input.windows.length > 0) {
    let inside = true;
    for (let d = start; d <= end; d = addDays(d, 1)) if (!inWindows(d, input.windows)) inside = false;
    plan.outsideOffer = !inside;
    if (!inside) plan.warnings.push(`${end > start ? `${fmtDay(start)} to ${fmtDay(end)} is` : `${fmtDay(start)} is`} outside the windows you offered.`);
  }
  return plan;
}

/** The note every Guesty hold this rail places carries. It never contains
 *  "owner" (owner-hold-checkouts.ts reads that word as an owner stay). */
export function vendorVisitNote(proposalId: string, vendorName: string): string {
  const name = vendorName.replace(/\bowner\b/gi, '').replace(/\s+/g, ' ').trim();
  return `Helm vendor visit: ${name} (vv:${proposalId.slice(0, 8)})`;
}

// ─── the approve gate ────────────────────────────────────────────────────

export type ApproveInput = {
  propertyId: string;
  start: Ymd;
  end: Ymd;
  startTime: string | null;
  endTime: string | null;
  slipIds: string[];
  holdNightBefore: boolean;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Why these days and times cannot be a visit, or null. */
export function checkVisitDays(
  i: Pick<ApproveInput, 'start' | 'end' | 'startTime' | 'endTime'>,
  today: Ymd,
): string | null {
  if (!YMD.test(i.start) || !YMD.test(i.end)) return 'Pick the visit day first.';
  if (i.end < i.start) return 'The last day is before the first.';
  if (daysBetween(i.start, i.end) + 1 > MAX_VISIT_DAYS) return `A visit holds at most ${MAX_VISIT_DAYS} days.`;
  if (i.start < today) return `${fmtDay(i.start)} has passed.`;
  if (i.startTime && !HHMM.test(i.startTime)) return 'The time does not read as a clock time.';
  if (i.endTime && !HHMM.test(i.endTime)) return 'The time does not read as a clock time.';
  return null;
}

/** Why this input cannot be approved, or null. */
export function checkApproveInput(i: ApproveInput, today: Ymd): string | null {
  if (!i.propertyId) return 'Pick the home first.';
  const days = checkVisitDays(i, today);
  if (days) return days;
  if (i.slipIds.length > 40) return 'Too many slips on one visit.';
  return null;
}

/** "at 1 PM", "by 3 PM", or null, for a time the operator set. */
export function timeLabelOf(startTime: string | null, endTime: string | null): string | null {
  if (startTime && endTime) return `${fmtClock(startTime)} to ${fmtClock(endTime)}`;
  if (startTime) return `at ${fmtClock(startTime)}`;
  if (endTime) return `by ${fmtClock(endTime)}`;
  return null;
}

/** Why this proposal cannot be approved as it stands, or null. A card that
 *  moved on (decided elsewhere, superseded) is stale, not an error. */
export function proposalGate(row: Pick<VendorVisitRow, 'status'>): { stale: boolean; reason: string } | null {
  if (row.status === 'pending') return null;
  if (row.status === 'approving') return { stale: false, reason: 'Someone is approving this card right now.' };
  return { stale: true, reason: 'This card was already decided.' };
}

/** "Holds 73 Rocky Neck the night of Tue Oct 27", "Holds Mon Oct 26 to Tue
 *  Oct 27", for the card's first Also on approve line. */
export function describeHold(nights: readonly Ymd[]): string {
  if (nights.length === 0) return 'no night';
  const sorted = [...nights].sort();
  if (sorted.length === 1) return `the night of ${fmtDay(sorted[0])}`;
  return `${sorted.length} nights, ${fmtDay(sorted[0])} to ${fmtDay(sorted[sorted.length - 1])}`;
}
