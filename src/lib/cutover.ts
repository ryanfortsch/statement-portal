/**
 * The cutover: the per-property switch that moves a home from Guesty to Helm.
 *
 * Three parts, deliberately separated:
 *
 *   evaluateCutoverPreflight   pure. Takes the loaded facts and answers, check
 *                              by check, whether the home can run without
 *                              Guesty today. Tested in
 *                              src/lib/__tests__/cutover-preflight.test.ts.
 *   loadCutoverFacts           the database read behind those facts.
 *   flipToHelm / revertToGuesty the writes: the SECURITY DEFINER function
 *                              flip_calendar_authority (touches only the
 *                              property's own rows and writes a
 *                              property_pms_events audit row), then, on a flip
 *                              to Helm, the Helm calendar mirror for
 *                              today-90 .. today+540 so the twelve
 *                              property_calendar_days readers never see an
 *                              empty window.
 *
 * The checks, in the order the panel shows them:
 *   rate_plan          a property_rate_plans row exists (Helm can price a night)
 *   tax_config         a property_tax_config row exists, or the home is in
 *                      cape_ann where the MA table in occupancy-tax.ts applies
 *   feeds_fresh        every ACTIVE non-direct channel_listings row (Airbnb,
 *                      VRBO, Booking.com, other) has an iCal URL and its last
 *                      import succeeded within two hours
 *   export_subscribed  each of those rows is ticked export_subscribed AND the
 *                      OTA has pulled Helm's export within 24 hours
 *                      (ical_export_pulls, matched by channel_guess; an
 *                      'other' row has no user-agent signature, so it is
 *                      matched to the pulls the guess could not classify)
 *   no_double_bookings findDoubleBookings over the home's canonical stays is
 *                      empty
 *   guesty_stays_carried every Guesty-era Airbnb / VRBO stay still ahead has a
 *                      live direct-feed twin (the only thing that can cancel
 *                      it once Guesty stops writing), and every Booking.com
 *                      reservation on file is still closed on Booking.com's
 *                      own feed (cutover-carryover.ts)
 *   booking_com_reconciled every Booking.com closure still ahead has a
 *                      reservation on file or something Helm sends Booking.com
 *                      behind it, and none sits on a feed Helm stopped reading
 *   cleaner_recipient  an ENABLED cleaner_schedule_recipients row covers the
 *                      home: property_ids contains it, or property_ids is
 *                      '{}' and the recipient's region is the home's region
 *   automations_reviewed        the operator ticked that they reviewed the
 *                               automation rules for this home
 *   guesty_disconnect_acknowledged the operator ticked that the listing's
 *                               channels are disconnected in Guesty
 *
 * The last two are acknowledgements from the flip form, not data: Helm cannot
 * see inside Guesty or read the operator's mind. They ride in the same
 * checks list so the panel reads as one ledger.
 *
 * Relative imports and no 'server-only' marker so node:test can load the
 * pure half; only server code (the cutover server action) imports the rest.
 */

import { supabaseAdmin, isServiceConfigured } from './supabase-admin.ts';
import { selectAllPaged } from './paged-select.ts';
import { findDoubleBookings, type ConflictRow } from './booking-conflicts.ts';
import { propertyInScope, recipientScope } from './cleaner-digest-core.ts';
import { CAPE_ANN_REGION } from './property-scope.ts';
import { mirrorWindow, writeHelmCalendarMirror, type HelmMirrorResult } from './helm-calendar-mirror.ts';
import { relativeAge } from './calendar-model.ts';
import { carryoverClear, evaluateCarryover, isGuestyRule, mirrorRunsFromDays, type CarryRow, type Carryover, type MirrorDay, type MirrorHold } from './cutover-carryover.ts';
import { todayInEastern } from './sca-quotes-types.ts';

// ── Facts ───────────────────────────────────────────────────────────────────

export type CutoverFeedFact = {
  id: string;
  channel: string;
  is_active: boolean;
  ical_import_url: string | null;
  last_import_status: string | null;
  last_imported_at: string | null;
  last_import_error: string | null;
  export_subscribed: boolean;
  export_subscribed_at: string | null;
  /** channel_listings.ical_import_enabled; absent reads as enabled. */
  ical_import_enabled?: boolean;
};

export type CutoverPullFact = {
  channel_guess: string | null;
  pulled_at: string;
  /** The channel the pulled URL named (for= or listing=); null for a bare URL. */
  requested_for?: string | null;
  /** The user agent's own guess. When it names another OTA than the URL
   *  did, the wrong line was pasted into that OTA. */
  ua_guess?: string | null;
};

export type CutoverRecipientFact = {
  display_name: string;
  enabled: boolean;
  property_ids: string[];
  region: string;
};

export type CutoverAutomationFacts = {
  fleet_rules: number;
  property_rules: number;
  enabled_rules: number;
  configured_in_ota: number;
};

export type CutoverAcknowledgements = {
  automations_reviewed: boolean;
  guesty_disconnect: boolean;
};

export type CutoverFacts = {
  propertyId: string;
  propertyName: string;
  region: string;
  calendarAuthority: string;
  guestyListingId: string | null;
  formerGuestyListingId: string | null;
  automationsEnabled: boolean;
  ratePlan: { base_nightly_cents: number; min_nights_default: number; updated_at?: string | null; booking_window_days?: number | null } | null;
  taxConfig: { jurisdiction: string; rate: number } | null;
  feeds: CutoverFeedFact[];
  pulls: CutoverPullFact[];
  /** Canonical rows for this property in the look-ahead window; any status. */
  bookings: ConflictRow[];
  /** Every row still ahead (check_out after today), duplicates and cancelled
   *  rows included, for the carryover reconciliation (cutover-carryover.ts).
   *  Absent: the carryover checks read as clear (older fixtures). */
  carryRows?: CarryRow[];
  /** Guesty calendar holds, while Guesty runs the home (loadGuestyMirrorHolds). */
  mirrorHolds?: MirrorHold[];
  /** Guesty's rolling booking window as its calendar mirror shows it. */
  mirrorBookingWindow?: { check_in: string; seen_at: string } | null;
  /** The calendar mirror's last night while Guesty runs the home (null: no
   *  rows). Absent in older fixtures: the unmirrored range is not reported. */
  mirrorLastDate?: string | null;
  recipients: CutoverRecipientFact[];
  automations: CutoverAutomationFacts;
  acknowledgements: CutoverAcknowledgements;
  now: Date;
};

export const NO_ACKNOWLEDGEMENTS: CutoverAcknowledgements = { automations_reviewed: false, guesty_disconnect: false };

// ── Preflight ───────────────────────────────────────────────────────────────

export type CutoverCheckKey =
  | 'rate_plan'
  | 'tax_config'
  | 'feeds_fresh'
  | 'export_subscribed'
  | 'no_double_bookings'
  | 'guesty_stays_carried'
  | 'booking_com_reconciled'
  | 'cleaner_recipient'
  | 'automations_reviewed'
  | 'guesty_disconnect_acknowledged';

export type CutoverCheck = {
  key: CutoverCheckKey;
  label: string;
  ok: boolean;
  detail: string;
  /** True for the two acknowledgement checks the form itself supplies. */
  acknowledgement: boolean;
  /** Where the operator fixes a red check. */
  href?: string;
};

export type CutoverPreflight = {
  ok: boolean;
  checks: CutoverCheck[];
  /** The data checks (everything but the acknowledgements) all pass. */
  dataOk: boolean;
  failing: CutoverCheckKey[];
};

export const FEED_FRESH_HOURS = 2;
export const PULL_FRESH_HOURS = 24;

/** channel_listings channels that are neither the direct pseudo-channel nor the Guesty aggregate. */
export function isOtaFeedChannel(channel: string): boolean {
  const c = String(channel ?? '').toLowerCase();
  return c !== 'direct' && c !== 'manual' && c !== 'block' && c !== 'guesty';
}

const CHANNEL_NAMES: Record<string, string> = {
  airbnb: 'Airbnb',
  vrbo: 'VRBO',
  booking_com: 'Booking.com',
  other: 'Other',
};

function channelName(c: string): string {
  return CHANNEL_NAMES[c] ?? c;
}

function hoursSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (now.getTime() - t) / 3_600_000;
}

/**
 * The verdict. Pure: every fact comes in, nothing is read here. Detail
 * strings are written for the panel, one line each, naming what is wrong
 * and where to fix it.
 */
export function evaluateCutoverPreflight(facts: CutoverFacts): CutoverPreflight {
  const now = facts.now ?? new Date();
  const checks: CutoverCheck[] = [];
  const ratesHref = `/properties/${facts.propertyId}?tab=guest#rates`;
  const listingsHref = '/channels/listings';

  // 1. rate plan
  if (facts.ratePlan) {
    const base = facts.ratePlan.base_nightly_cents;
    // An unlimited window (0 or less; Guesty's "all future dates" is seeded
    // as -1) sells every night ahead, past the horizon the handover carries
    // Guesty's rolling closures to, and past anything a person has looked at.
    const window = facts.ratePlan.booking_window_days;
    const unlimited = window != null && window <= 0;
    checks.push({
      key: 'rate_plan',
      label: 'Rate plan',
      ok: base > 0 && !unlimited,
      detail:
        base <= 0
          ? 'A plan row exists but its base rate is zero. Set it under Rates & taxes (property page, Guest & listing).'
          : unlimited
          ? 'The booking window is unlimited, so Helm would sell every night ahead, however far. Set how many days ahead a stay may start under Rates & taxes (property page, Guest & listing) (and the same window on each OTA).'
          : `Base $${Math.round(base / 100).toLocaleString('en-US')} a night, ${facts.ratePlan.min_nights_default} night minimum${window != null ? `, bookable ${window} days ahead` : ''}.`,
      acknowledgement: false,
      href: ratesHref,
    });
  } else {
    checks.push({
      key: 'rate_plan',
      label: 'Rate plan',
      ok: false,
      detail: 'No property_rate_plans row. Without it Helm cannot price a night or quote a stay. Set it under Rates & taxes (property page, Guest & listing).',
      acknowledgement: false,
      href: ratesHref,
    });
  }

  // 2. tax config
  const region = facts.region || CAPE_ANN_REGION;
  if (facts.taxConfig) {
    checks.push({
      key: 'tax_config',
      label: 'Tax configuration',
      ok: true,
      detail: `${facts.taxConfig.jurisdiction} at ${(facts.taxConfig.rate * 100).toFixed(2).replace(/\.?0+$/, '')}% from property_tax_config.`,
      acknowledgement: false,
      href: ratesHref,
    });
  } else if (region === CAPE_ANN_REGION) {
    checks.push({
      key: 'tax_config',
      label: 'Tax configuration',
      ok: true,
      detail: 'No property_tax_config row; a Cape Ann home falls back to the Massachusetts occupancy table (occupancy-tax.ts).',
      acknowledgement: false,
      href: ratesHref,
    });
  } else {
    checks.push({
      key: 'tax_config',
      label: 'Tax configuration',
      ok: false,
      detail: `No property_tax_config row and the home is outside Cape Ann (${region}); Helm refuses to quote a rate it does not know. Add the jurisdiction under Rates & taxes (property page, Guest & listing).`,
      acknowledgement: false,
      href: ratesHref,
    });
  }

  // 3. feeds fresh
  const otaFeeds = facts.feeds.filter((f) => f.is_active && isOtaFeedChannel(f.channel));
  if (otaFeeds.length === 0) {
    checks.push({
      key: 'feeds_fresh',
      label: 'OTA feeds importing',
      ok: false,
      detail: 'No active Airbnb / VRBO / Booking.com feed row. Add each OTA iCal export URL on the wiring page and sync it before the flip.',
      acknowledgement: false,
      href: listingsHref,
    });
  } else {
    const problems: string[] = [];
    const fine: string[] = [];
    for (const f of otaFeeds) {
      const name = channelName(f.channel);
      // An 'other' platform's labels decide whether its closures are guests
      // or echoes, and Helm cannot see them: forwarded, its echoes can loop
      // with Booking.com's; dropped, a booking it publishes as "Blocked" is
      // sold elsewhere. Until 'other' feeds can be classified, a Helm-run
      // home has none.
      if (isUnclassifiedChannel(f.channel) && f.ical_import_url) {
        problems.push(`${name}: Helm cannot tell whether this platform's closed nights are its bookings or echoes of Helm's, so a Helm-run home cannot read an 'other' feed yet; retire the row before the flip`);
        continue;
      }
      if (!f.ical_import_url) {
        problems.push(`${name}: no iCal URL`);
        continue;
      }
      const age = hoursSince(f.last_imported_at, now);
      if (f.last_import_status !== 'success') {
        problems.push(`${name}: last import ${f.last_import_status ?? 'never ran'}${f.last_import_error ? ` (${f.last_import_error})` : ''}`);
        continue;
      }
      if (age == null || age > FEED_FRESH_HOURS) {
        problems.push(`${name}: last success ${relativeAge(f.last_imported_at, now)}, older than ${FEED_FRESH_HOURS}h`);
        continue;
      }
      fine.push(`${name} ${relativeAge(f.last_imported_at, now)}`);
    }
    checks.push({
      key: 'feeds_fresh',
      label: 'OTA feeds importing',
      ok: problems.length === 0,
      detail: problems.length === 0 ? `Imported: ${fine.join(', ')}.` : problems.join('; ') + '.',
      acknowledgement: false,
      href: listingsHref,
    });
  }

  // 4. export subscribed and pulled
  if (otaFeeds.length === 0) {
    checks.push({
      key: 'export_subscribed',
      label: 'OTAs reading Helm',
      ok: false,
      detail: 'No OTA feed rows to subscribe. Wire the channels first.',
      acknowledgement: false,
      href: listingsHref,
    });
  } else {
    const problems: string[] = [];
    const fine: string[] = [];
    for (const f of otaFeeds) {
      const name = channelName(f.channel);
      const pull = latestPullFor(facts.pulls, f.channel);
      const pullAge = hoursSince(pull?.pulled_at, now);
      // 'other' is any feed whose user agent guessChannelFromUserAgent cannot
      // name, so its evidence is a pull with no channel guess; say so.
      const unclassified = isUnclassifiedChannel(f.channel);
      if (!f.export_subscribed) {
        problems.push(`${name}: export not ticked as subscribed`);
        continue;
      }
      if (pullAge == null) {
        problems.push(
          unclassified
            ? `${name}: never pulled its own export line (the hub's ?listing= URL for this feed)`
            : `${name}: never pulled Helm's export`,
        );
        continue;
      }
      if (pull?.requested_for && pull.ua_guess && pull.requested_for !== pull.ua_guess) {
        problems.push(`${name} is importing the ${channelName(pull.requested_for)} line; paste ${name}'s own line from the hub`);
        continue;
      }
      if (pullAge > PULL_FRESH_HOURS) {
        problems.push(`${name}: last pull ${relativeAge(pull?.pulled_at, now)}, older than ${PULL_FRESH_HOURS}h`);
        continue;
      }
      fine.push(`${name} pulled ${relativeAge(pull?.pulled_at, now)}${unclassified ? ' (its own listing line)' : ''}`);
    }
    checks.push({
      key: 'export_subscribed',
      label: 'OTAs reading Helm',
      ok: problems.length === 0,
      detail: problems.length === 0 ? `${fine.join(', ')}.` : problems.join('; ') + '.',
      acknowledgement: false,
      href: listingsHref,
    });
  }

  // 5. double bookings
  const doubles = findDoubleBookings(facts.bookings.filter((b) => b.property_id === facts.propertyId));
  checks.push({
    key: 'no_double_bookings',
    label: 'No double-bookings',
    ok: doubles.length === 0,
    detail:
      doubles.length === 0
        ? `No two stays share a night across ${facts.bookings.length} upcoming row${facts.bookings.length === 1 ? '' : 's'}.`
        : doubles
            .slice(0, 3)
            .map((d) => `${d.a.check_in} to ${d.a.check_out} overlaps ${d.b.check_in} to ${d.b.check_out} (${d.overlap_nights} night${d.overlap_nights === 1 ? '' : 's'})`)
            .join('; ') + (doubles.length > 3 ? `; and ${doubles.length - 3} more.` : '.'),
    acknowledgement: false,
    href: `/channels/${facts.propertyId}/calendar`,
  });

  // 5b. what the flip hands over (cutover-carryover.ts)
  const carry = carryoverFor(facts);
  // The hub's Needs attention panel shows once a cutover is underway (an OTA
  // ticked as reading Helm) or the home is Helm-run; before that the check's
  // detail is the list, and a link to a panel that is not there is none.
  const panelShown = facts.calendarAuthority === 'helm' || facts.feeds.some((f) => f.is_active && f.channel !== 'guesty' && f.export_subscribed);
  const attentionHref = panelShown ? `/channels/${facts.propertyId}#attention` : undefined;
  const listRows = (rows: readonly CarryRow[]) =>
    rows
      .slice(0, 3)
      .map((r) => `${r.check_in} to ${r.check_out}${r.guest_name ? ` (${r.guest_name})` : ''}`)
      .join('; ') + (rows.length > 3 ? `; and ${rows.length - 3} more` : '');
  {
    const problems: string[] = [];
    if (carry.untwinnedGuestyStays.length > 0) {
      problems.push(
        `${carry.untwinnedGuestyStays.length} Guesty-era Airbnb or VRBO stay${carry.untwinnedGuestyStays.length === 1 ? ' has' : 's have'} no live twin on the OTA's own feed, so nothing could cancel ${carry.untwinnedGuestyStays.length === 1 ? 'it' : 'them'} after the flip: ${listRows(carry.untwinnedGuestyStays)}. Sync that OTA's feed, or cancel the stay in Helm if it is gone`,
      );
    }
    if (carry.bookingComNotShown.length > 0) {
      problems.push(
        `Booking.com no longer shows ${carry.bookingComNotShown.length} reservation${carry.bookingComNotShown.length === 1 ? '' : 's'} Helm has on file as closed: ${listRows(carry.bookingComNotShown)}. Check the extranet and cancel ${carry.bookingComNotShown.length === 1 ? 'it' : 'each one'} in Helm if the guest cancelled`,
      );
    }
    if (carry.bookingComUnwatched.length > 0) {
      problems.push(
        `${carry.bookingComUnwatched.length} Booking.com reservation${carry.bookingComUnwatched.length === 1 ? ' is' : 's are'} on file but Helm reads no Booking.com feed, so a cancellation could never reach Helm: ${listRows(carry.bookingComUnwatched)}. Keep the Booking.com feed wired until they have checked out`,
      );
    }
    if (carry.guestyHoldsUncarried.length > 0) {
      problems.push(
        `${carry.guestyHoldsUncarried.length} hold${carry.guestyHoldsUncarried.length === 1 ? '' : 's'} set in Guesty ${carry.guestyHoldsUncarried.length === 1 ? 'has' : 'have'} nothing in Helm over ${carry.guestyHoldsUncarried.length === 1 ? 'it' : 'them'}: ${listRows(carry.guestyHoldsUncarried)}. After the flip nothing closes those nights; re-enter each hold you want kept as a Helm block, before the first "imports Helm" tick if you can (after it, an OTA's leftover copy of the hold may refuse the entry until you open it in the extranet)`,
      );
    }
    // Guesty's rolling booking window: after the flip only the rate plan
    // (and each OTA's own setting) keeps those nights off sale.
    const gap = carry.bookingWindowGap;
    if (gap) {
      problems.push(
        `Guesty takes no bookings from ${gap.closedFrom}; the Helm rate plan's booking window is ${gap.planWindow == null ? 'unlimited' : `${gap.planWindow} days`}, which would sell some of those nights. Set it to ${gap.maxPlanWindow} days or fewer under Rates & taxes (property page, Guest & listing), and the same window on each OTA, before the flip cancels Guesty's rule`,
      );
    }
    const rulesDropped = carry.guestyBlocks.filter((r) => isGuestyRule(r)).length;
    // Not a failure (nothing Helm can read would clear it): the disconnect
    // acknowledgement asks for the check.
    const blind = carry.mirrorBlindFrom
      ? ` Helm's copy of Guesty's calendar stops before ${carry.mirrorBlindFrom}: check Guesty's calendar from that date on for holds before you disconnect, and re-enter any as Helm blocks.`
      : '';
    const compared = facts.feeds.some((f) => f.is_active && f.channel === 'booking_com' && !!f.ical_import_url);
    checks.push({
      key: 'guesty_stays_carried',
      label: 'Guesty stays handed over',
      ok: problems.length === 0,
      detail:
        problems.length === 0
          ? `Every Guesty-era Airbnb or VRBO stay ahead has a live twin on the OTA's own feed${compared ? ', and every Booking.com reservation on file is still closed on Booking.com' : ''}.${carry.guestyBlocks.length > 0 ? ` The flip cancels ${carry.guestyBlocks.length} Guesty block${carry.guestyBlocks.length === 1 ? '' : 's'}${rulesDropped > 0 ? ` (${rulesDropped} of them Guesty's own booking-window or advance-notice rule${rulesDropped === 1 ? '' : 's'}: set those in the rate plan and on each OTA)` : ''}; every other one already has a Helm block or a reservation on file over it.` : ''}`
          : problems.join('. ') + '.',
      acknowledgement: false,
      href: attentionHref,
    });
    if (blind) checks[checks.length - 1].detail += blind;
  }
  {
    const problems: string[] = [];
    if (carry.bookingComUnexplained.length > 0) {
      problems.push(
        `Booking.com shows ${carry.bookingComUnexplained.length} closure${carry.bookingComUnexplained.length === 1 ? '' : 's'} with no reservation on file behind ${carry.bookingComUnexplained.length === 1 ? 'it' : 'them'}: ${listRows(carry.bookingComUnexplained)}. Check each in the extranet: enter a Booking.com booking from its confirmation email; open the nights only if Booking.com shows no reservation there`,
      );
    }
    if (carry.bookingComOrphaned.length > 0) {
      problems.push(
        `${carry.bookingComOrphaned.length} Booking.com closure${carry.bookingComOrphaned.length === 1 ? ' sits' : 's sit'} on a feed Helm no longer reads: ${listRows(carry.bookingComOrphaned)}. Release ${carry.bookingComOrphaned.length === 1 ? 'it' : 'them'} on the channel hub once checked`,
      );
    }
    checks.push({
      key: 'booking_com_reconciled',
      label: 'Booking.com reconciled',
      ok: problems.length === 0,
      detail: problems.length === 0 ? 'Every Booking.com closure ahead has a reservation on file or a Helm row behind it.' : problems.join('. ') + '.',
      acknowledgement: false,
      href: attentionHref,
    });
  }

  // 6. cleaner recipient
  const covering = facts.recipients.filter(
    (r) => r.enabled && propertyInScope({ id: facts.propertyId, region }, recipientScope(r)),
  );
  checks.push({
    key: 'cleaner_recipient',
    label: 'Cleaner digest recipient',
    ok: covering.length > 0,
    detail:
      covering.length > 0
        ? `${covering.map((r) => r.display_name).join(', ')} ${covering.length === 1 ? 'receives' : 'receive'} the checkout digest for this home.`
        : `No enabled cleaner_schedule_recipients row covers this home (property_ids containing it, or '{}' in region ${region}). Add the cleaner on the schedule page.`,
    acknowledgement: false,
    href: '/turnovers/schedule',
  });

  // 7. automations reviewed (acknowledgement)
  const a = facts.automations;
  const automationSummary = `${a.fleet_rules} fleet rule${a.fleet_rules === 1 ? '' : 's'}, ${a.property_rules} override${a.property_rules === 1 ? '' : 's'} for this home, ${a.enabled_rules} enabled, ${a.configured_in_ota} marked configured in the OTA.`;
  checks.push({
    key: 'automations_reviewed',
    label: 'Automations reviewed',
    ok: facts.acknowledgements.automations_reviewed,
    detail: facts.acknowledgements.automations_reviewed
      ? `Reviewed. ${automationSummary}`
      : `${automationSummary} Tick the box once you have reviewed them under Automations (property page, Guest & listing); Guesty's own message automations for this listing stop when the listing is deleted there.`,
    acknowledgement: true,
    href: `/properties/${facts.propertyId}?tab=guest#automations`,
  });

  // 8. Guesty disconnect acknowledged (acknowledgement)
  const blindFrom = carry.mirrorBlindFrom;
  const blindAsk = blindFrom
    ? ` Before deleting the Guesty listing, check its calendar from ${blindFrom} on for owner holds (Helm's copy of it stops there) and re-enter any as Helm blocks.`
    : '';
  const guestyRowActive = facts.feeds.some((f) => f.is_active && String(f.channel).toLowerCase() === 'guesty');
  const guestyNote = facts.guestyListingId
    ? `Guesty listing ${facts.guestyListingId} is still mapped; the flip parks that id and deletes Helm's guesty_listings row.`
    : 'No Guesty listing id is mapped.';
  checks.push({
    key: 'guesty_disconnect_acknowledged',
    label: 'Guesty disconnect acknowledged',
    ok: facts.acknowledgements.guesty_disconnect,
    detail: facts.acknowledgements.guesty_disconnect
      ? `Acknowledged. ${guestyNote}${guestyRowActive ? ' The active Guesty aggregate feed row is retired by the flip.' : ''}`
      : `Tick the box once the Airbnb, VRBO and Booking.com connections are disconnected in Guesty and each OTA imports Helm's export.${blindAsk} ${guestyNote}${guestyRowActive ? ' The active Guesty aggregate feed row will be retired by the flip.' : ''}`,
    acknowledgement: true,
  });

  const failing = checks.filter((c) => !c.ok).map((c) => c.key);
  const dataOk = checks.filter((c) => !c.acknowledgement).every((c) => c.ok);
  return { ok: failing.length === 0, checks, dataOk, failing };
}

/** The carryover reconciliation over a home's loaded facts. */
export function carryoverFor(facts: CutoverFacts): Carryover {
  return evaluateCarryover({
    rows: facts.carryRows ?? [],
    listings: facts.feeds.map((f) => ({
      id: f.id,
      channel: f.channel,
      is_active: f.is_active,
      ical_import_url: f.ical_import_url,
      ical_import_enabled: f.ical_import_enabled,
      last_import_status: f.last_import_status,
      last_imported_at: f.last_imported_at,
      export_subscribed: f.export_subscribed,
      export_subscribed_at: f.export_subscribed_at,
    })),
    todayIso: todayInEastern(facts.now),
    calendarAuthority: facts.calendarAuthority,
    now: facts.now,
    mirrorHolds: facts.mirrorHolds ?? [],
    mirrorBookingWindow: facts.mirrorBookingWindow ?? null,
    mirrorLastDate: facts.mirrorLastDate,
    planWindowDays: facts.ratePlan?.booking_window_days ?? null,
  });
}

export { carryoverClear };

/** The channel_listings channel with no user-agent signature: any OTA that is
 * not Airbnb, VRBO or Booking.com. Its pulls are credited 'other' only when
 * it imports its own ?listing= line from the hub. */
export function isUnclassifiedChannel(channel: string): boolean {
  return String(channel ?? '').toLowerCase() === 'other';
}

/**
 * The most recent pull credited to this channel. For 'other' that is a pull
 * of the feed's own ?listing= line (credited 'other' by the route); a
 * bare-URL pull with no guess never counts, because that feed would carry
 * the platform's own holds back to it. A null guess never counts for a
 * named OTA either.
 */
export function latestPullFor(pulls: readonly CutoverPullFact[], channel: string): CutoverPullFact | null {
  const unclassified = isUnclassifiedChannel(channel);
  let best: CutoverPullFact | null = null;
  for (const p of pulls) {
    // An 'other' platform counts only once it pulls its own ?listing= line
    // (credited 'other'). A bare-URL pull (no guess) would feed it its own
    // holds back, which is the stuck-block loop the per-listing URL prevents.
    const matches = unclassified ? p.channel_guess === 'other' : p.channel_guess === channel;
    if (!matches) continue;
    if (!best || p.pulled_at > best.pulled_at) best = p;
  }
  return best;
}

// ── Facts loader ────────────────────────────────────────────────────────────

const LOOKAHEAD_DAYS = 540;

/**
 * What Guesty's own calendar closes on a home, from its calendar mirror
 * (property_calendar_days), grouped into runs of consecutive nights:
 *   - a real hold (block_type m, o, ...): an owner's or the team's;
 *   - a night closed by Guesty's "closed from a fixed date" rule ('bd');
 *   - a closed night whose type the mirror does not know (rows written
 *     before block_rule_type existed): read as a hold, because fail-open
 *     here reopens a closed season (16 Waterman is closed from 11-02 and its
 *     mirror rows carry no type), EXCEPT one night today or tomorrow, which
 *     is Guesty's advance-notice rule;
 * and, apart, the first night of Guesty's rolling booking window ('bw'),
 * with the day the mirror saw it, for the booking-window check, and the
 * mirror's last night. Advance notice and padding are skipped; any rule
 * type Helm does not recognise is carried. The mirror stops about a year
 * out (the Guesty sync's window): a hold that reaches its last night ends
 * where its Guesty ref says, and any other run that does is flagged
 * `rolling` and carried to the handover's horizon. The flip rewrites the
 * mirror with Helm's, so this is read while Guesty still runs the home; the
 * mirror keeps its last rows once the Guesty listing is deleted
 * (calendar-days writes nothing for a listing that 404s).
 */
export async function loadGuestyMirrorHolds(
  propertyId: string,
  todayIso: string,
): Promise<{ holds: MirrorHold[]; bw: { check_in: string; seen_at: string } | null; lastDate: string | null }> {
  const rows = await selectAllPaged<MirrorDay>(
    (from, to) =>
      supabaseAdmin
        .from('property_calendar_days')
        .select('date, status, block_type, block_rule_type, block_ref_id, block_note, block_end, synced_at')
        .eq('property_id', propertyId)
        .gte('date', todayIso)
        .order('date', { ascending: true })
        .range(from, to),
    { label: `cutover mirror holds ${propertyId}` },
  );
  return mirrorRunsFromDays(rows, todayIso);
}

/** Every row still ahead, any status, duplicates included (CutoverFacts.carryRows). */
export async function loadCarryRows(propertyId: string, todayIso: string): Promise<CarryRow[]> {
  return selectAllPaged<CarryRow>(
    (from, to) =>
      supabaseAdmin
        .from('bookings')
        .select('id, property_id, source, channel, status, check_in, check_out, duplicate_of, hold_kind, channel_listing_id, created_at, guest_name, missing_since, cancelled_at, ical_uid, live_since')
        .eq('property_id', propertyId)
        .gt('check_out', todayIso)
        .order('check_in', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: `cutover carry ${propertyId}` },
  );
}

async function loadCanonicalStays(propertyId: string, todayIso: string): Promise<ConflictRow[]> {
  const end = new Date(Date.parse(`${todayIso}T00:00:00Z`) + LOOKAHEAD_DAYS * 86_400_000).toISOString().slice(0, 10);
  return selectAllPaged<ConflictRow>(
    (from, to) =>
      supabaseAdmin
        .from('bookings')
        .select('id, property_id, status, check_in, check_out')
        .eq('property_id', propertyId)
        .is('duplicate_of', null)
        .gte('check_out', todayIso)
        .lte('check_in', end)
        .order('check_in', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: `cutover stays ${propertyId}` },
  );
}

/**
 * Everything the preflight needs, in one call. Acknowledgements default to
 * false; the action folds the form's ticks in before evaluating. A failed
 * read of any part throws: a preflight over half the facts is not a
 * preflight.
 */
export async function loadCutoverFacts(
  propertyId: string,
  opts: { acknowledgements?: Partial<CutoverAcknowledgements>; now?: Date } = {},
): Promise<CutoverFacts> {
  if (!isServiceConfigured) throw new Error('Supabase service role is not configured.');
  if (!propertyId) throw new Error('Missing property id.');
  const now = opts.now ?? new Date();
  // The Eastern date: Guesty keys its rules on the listing's local day, and
  // at 21:00 EDT the UTC date is already tomorrow.
  const todayIso = todayInEastern(now);
  const pullsSince = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  const [propRes, planRes, taxRes, feedsRes, pullsRes, recipientsRes, automationsRes, stays, carryRows, mirrorHolds] = await Promise.all([
    supabaseAdmin
      .from('properties')
      .select('id, name, region, calendar_authority, guesty_listing_id, former_guesty_listing_id, automations_enabled')
      .eq('id', propertyId)
      .maybeSingle(),
    supabaseAdmin.from('property_rate_plans').select('base_nightly_cents, min_nights_default, updated_at, booking_window_days').eq('property_id', propertyId).maybeSingle(),
    supabaseAdmin.from('property_tax_config').select('jurisdiction, state_rate, local_rate, cif_rate').eq('property_id', propertyId).maybeSingle(),
    supabaseAdmin
      .from('channel_listings')
      .select('id, channel, is_active, ical_import_url, ical_import_enabled, last_import_status, last_imported_at, last_import_error, export_subscribed, export_subscribed_at')
      .eq('property_id', propertyId)
      .order('channel'),
    supabaseAdmin
      .from('ical_export_pulls')
      .select('channel_guess, pulled_at, requested_for, ua_guess')
      .eq('property_id', propertyId)
      .gte('pulled_at', pullsSince)
      .order('pulled_at', { ascending: false })
      .limit(200),
    supabaseAdmin.from('cleaner_schedule_recipients').select('display_name, enabled, property_ids, region'),
    supabaseAdmin
      .from('message_automations')
      .select('id, property_id, enabled, configured_in_ota')
      .or(`property_id.is.null,property_id.eq.${propertyId}`),
    loadCanonicalStays(propertyId, todayIso),
    loadCarryRows(propertyId, todayIso),
    loadGuestyMirrorHolds(propertyId, todayIso),
  ]);

  if (propRes.error) throw new Error(`properties read: ${propRes.error.message}`);
  if (!propRes.data) throw new Error(`Property ${propertyId} not found.`);
  for (const [what, res] of [
    ['rate plan', planRes],
    ['tax config', taxRes],
    ['channel listings', feedsRes],
    ['export pulls', pullsRes],
    ['cleaner recipients', recipientsRes],
    ['automations', automationsRes],
  ] as const) {
    if (res.error) throw new Error(`${what} read: ${res.error.message}`);
  }

  const prop = propRes.data as {
    id: string;
    name: string | null;
    region: string | null;
    calendar_authority: string | null;
    guesty_listing_id: string | null;
    former_guesty_listing_id: string | null;
    automations_enabled: boolean | null;
  };
  const planRow = planRes.data as { base_nightly_cents: unknown; min_nights_default: unknown; updated_at: string | null; booking_window_days?: unknown } | null;
  const taxRow = taxRes.data as { jurisdiction: string; state_rate: unknown; local_rate: unknown; cif_rate: unknown } | null;
  const num = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const automationRows = (automationsRes.data ?? []) as Array<{ property_id: string | null; enabled: boolean | null; configured_in_ota: boolean | null }>;

  return {
    propertyId,
    propertyName: prop.name ?? propertyId,
    region: prop.region ?? CAPE_ANN_REGION,
    calendarAuthority: prop.calendar_authority === 'helm' ? 'helm' : 'guesty',
    guestyListingId: prop.guesty_listing_id ?? null,
    formerGuestyListingId: prop.former_guesty_listing_id ?? null,
    automationsEnabled: !!prop.automations_enabled,
    ratePlan: planRow
      ? {
          base_nightly_cents: num(planRow.base_nightly_cents),
          min_nights_default: num(planRow.min_nights_default) || 1,
          updated_at: planRow.updated_at,
          booking_window_days: planRow.booking_window_days == null ? null : num(planRow.booking_window_days),
        }
      : null,
    taxConfig: taxRow
      ? { jurisdiction: taxRow.jurisdiction, rate: Math.round((num(taxRow.state_rate) + num(taxRow.local_rate) + num(taxRow.cif_rate)) * 10000) / 10000 }
      : null,
    feeds: ((feedsRes.data ?? []) as Array<Record<string, unknown>>).map((f) => ({
      id: String(f.id),
      channel: String(f.channel),
      is_active: f.is_active !== false,
      ical_import_url: (f.ical_import_url as string | null) ?? null,
      last_import_status: (f.last_import_status as string | null) ?? null,
      last_imported_at: (f.last_imported_at as string | null) ?? null,
      last_import_error: (f.last_import_error as string | null) ?? null,
      export_subscribed: !!f.export_subscribed,
      export_subscribed_at: (f.export_subscribed_at as string | null) ?? null,
      ical_import_enabled: f.ical_import_enabled !== false,
    })),
    pulls: ((pullsRes.data ?? []) as Array<{ channel_guess: string | null; pulled_at: string; requested_for?: string | null; ua_guess?: string | null }>).map((p) => ({
      requested_for: p.requested_for ?? null,
      ua_guess: p.ua_guess ?? null,
      channel_guess: p.channel_guess ?? null,
      pulled_at: p.pulled_at,
    })),
    bookings: stays,
    carryRows,
    // Only while Guesty runs the home is the calendar mirror Guesty's.
    mirrorHolds: propRes.data && (propRes.data as { calendar_authority?: string | null }).calendar_authority !== 'helm' ? mirrorHolds.holds : [],
    mirrorBookingWindow: propRes.data && (propRes.data as { calendar_authority?: string | null }).calendar_authority !== 'helm' ? mirrorHolds.bw : null,
    mirrorLastDate: mirrorHolds.lastDate,
    recipients: ((recipientsRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      display_name: String(r.display_name ?? ''),
      enabled: !!r.enabled,
      property_ids: Array.isArray(r.property_ids) ? (r.property_ids as string[]) : [],
      region: (r.region as string | null) ?? CAPE_ANN_REGION,
    })),
    automations: {
      fleet_rules: automationRows.filter((r) => r.property_id == null).length,
      property_rules: automationRows.filter((r) => r.property_id === propertyId).length,
      enabled_rules: automationRows.filter((r) => !!r.enabled).length,
      configured_in_ota: automationRows.filter((r) => !!r.configured_in_ota).length,
    },
    acknowledgements: { ...NO_ACKNOWLEDGEMENTS, ...(opts.acknowledgements ?? {}) },
    now,
  };
}

// ── History ─────────────────────────────────────────────────────────────────

export type PmsEvent = {
  id: string;
  property_id: string;
  from_authority: string;
  to_authority: string;
  actor_email: string;
  detail: Record<string, unknown>;
  created_at: string;
};

/** Who flipped what and when, newest first. Empty on a failed read. */
export async function listPmsEvents(propertyId: string, limit = 50): Promise<PmsEvent[]> {
  if (!isServiceConfigured || !propertyId) return [];
  const { data, error } = await supabaseAdmin
    .from('property_pms_events')
    .select('id, property_id, from_authority, to_authority, actor_email, detail, created_at')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as PmsEvent[]).map((e) => ({ ...e, detail: (e.detail ?? {}) as Record<string, unknown> }));
}

// ── The switch ──────────────────────────────────────────────────────────────

export class CutoverPreflightError extends Error {
  readonly preflight: CutoverPreflight;
  constructor(preflight: CutoverPreflight) {
    const names = preflight.checks.filter((c) => !c.ok).map((c) => c.label);
    super(`Preflight failed: ${names.join(', ')}`);
    this.name = 'CutoverPreflightError';
    this.preflight = preflight;
  }
}

export type FlipResult = {
  property: { id: string; calendar_authority: string; cutover_at: string | null; former_guesty_listing_id: string | null; guesty_listing_id: string | null };
  event: PmsEvent | null;
  /** Present on a flip to Helm. */
  mirror?: HelmMirrorResult;
  preflight?: CutoverPreflight;
  /** Present on a flip to Helm: Guesty aggregate blocks cancelled. */
  guestyBlocksCancelled?: { count: number; error: string | null };
};

async function callFlip(propertyId: string, target: 'helm' | 'guesty', actorEmail: string): Promise<FlipResult['property']> {
  const { data, error } = await supabaseAdmin.rpc('flip_calendar_authority', {
    p_property_id: propertyId,
    p_target: target,
    p_actor_email: actorEmail,
  });
  if (error) {
    if (error.code === 'P0003') throw new Error(`Property ${propertyId} not found.`);
    throw new Error(`flip_calendar_authority: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) throw new Error('flip_calendar_authority returned no row.');
  return {
    id: String(row.id),
    calendar_authority: String(row.calendar_authority),
    cutover_at: (row.cutover_at as string | null) ?? null,
    former_guesty_listing_id: (row.former_guesty_listing_id as string | null) ?? null,
    guesty_listing_id: (row.guesty_listing_id as string | null) ?? null,
  };
}

/**
 * Guesty -> Helm. Runs the preflight with the operator's acknowledgements
 * (throws CutoverPreflightError with the full ledger when any check is red),
 * flips the switch through flip_calendar_authority, then writes the Helm
 * mirror for today-90 .. today+540 so property_calendar_days is Helm's the
 * moment the flip lands. A mirror failure is reported in the result, not
 * thrown: the flip itself has committed.
 */
export async function flipToHelm(
  propertyId: string,
  actorEmail: string,
  acknowledgements: CutoverAcknowledgements,
): Promise<FlipResult> {
  if (!isServiceConfigured) throw new Error('Supabase service role is not configured.');
  const facts = await loadCutoverFacts(propertyId, { acknowledgements });
  const preflight = evaluateCutoverPreflight(facts);
  if (!preflight.ok) throw new CutoverPreflightError(preflight);

  const property = await callFlip(propertyId, 'helm', actorEmail);
  // After the flip, never before: the flip retires the aggregate feed row,
  // and a sync of that feed would otherwise write them straight back (its
  // upsert keys on channel + UID). A sync already in flight still can; the
  // stale-closure sweep in ical-sync clears those on its next full run.
  const guestyBlocksCancelled = await cancelGuestyBlocks(
    carryoverFor(facts).guestyBlocks.map((r) => r.id),
    actorEmail,
  ).then(
    (count) => ({ count, error: null as string | null }),
    (err: unknown) => ({ count: 0, error: err instanceof Error ? err.message : String(err) }),
  );
  const window = mirrorWindow(90, 540);
  const mirror = await writeHelmCalendarMirror([propertyId], window.start, window.end);
  const [event] = await listPmsEvents(propertyId, 1);
  return { property, event: event ?? null, mirror, preflight, guestyBlocksCancelled };
}

/**
 * The Guesty aggregate feed's blocks are cancelled at the flip. Once the
 * flip retires that feed nothing can cancel its rows, so they would stand
 * forever; and they cannot be carried over blind, because Guesty labels its
 * owner holds and its own rolling rules alike ("Blocked by Guesty"). The
 * preflight (cutover-carryover guestyHoldsUncarried) already made sure every
 * one that may be an owner's hold has a Helm block over it. Reported in the
 * flip result, never thrown: the flip itself has committed.
 */
async function cancelGuestyBlocks(ids: readonly string[], actorEmail: string): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: actorEmail,
      cancel_reason: 'cutover_guesty_block',
    })
    .in('id', [...ids])
    .eq('status', 'block')
    .select('id');
  if (error) throw new Error(`cancel Guesty blocks: ${error.message}`);
  return ((data ?? []) as Array<{ id: string }>).length;
}

/**
 * Helm -> Guesty. No preflight: the operator is retreating. The function sets
 * the switch back and restores the parked Guesty listing id. It does NOT
 * recreate the listing in Guesty, reconnect any channel, or undo anything
 * done in the OTAs; the next Guesty calendar sync overwrites Helm's mirror
 * rows for this home only if the listing still exists in Guesty. The
 * property hub says all of this next to the button.
 */
export async function revertToGuesty(propertyId: string, actorEmail: string): Promise<FlipResult> {
  if (!isServiceConfigured) throw new Error('Supabase service role is not configured.');
  const property = await callFlip(propertyId, 'guesty', actorEmail);
  const [event] = await listPmsEvents(propertyId, 1);
  return { property, event: event ?? null };
}
