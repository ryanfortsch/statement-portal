/**
 * Statement reconciliation: Helm's numbers held up against independent
 * sources, every difference named.
 *
 * Pure: no imports, no IO, so `node --test` loads it bare. The loader in
 * src/app/statements/actions.ts gathers the rows and passes them in; the
 * pure payout formula's result is passed in too, so this module never has
 * to import it.
 *
 * WHY THIS EXISTS. Until now every source Helm reaches was used to FILL IN
 * a number and never to CHECK one against another. Stripe replaced an
 * estimated fee and stopped; the PDF's section facts were parsed and thrown
 * away; the bank CSV was mined for cleaning charges and never summed. So
 * the only proof a statement was right was the operator doing by hand what
 * this file does: comparing. Green meant "three files showed up".
 *
 * A LANE is one comparison between two things that were produced
 * independently. Each lane ends in one of:
 *   agree         the two sides match to the cent
 *   differs       they do not, and `lines` say exactly where and by how much
 *   not_recorded  the independent side does not exist for this statement
 *                 (ingested before the PDF facts were kept; no invoices on
 *                 file; no bank CSV). Neutral: neither certifies nor blocks.
 *   unknown       a read the lane depends on FAILED. Blocks. Absence of
 *                 data is never a fact.
 *   info          the lane is a report, not a check (no independent side to
 *                 hold it against yet). Never blocks.
 *
 * A statement is RECONCILED when every hard lane is agree or not_recorded,
 * no lane is unknown, and no critical gap is open. That is a much stronger
 * claim than "confidence: green" and it is the one the close should rest on.
 *
 * What the August 2026 data settled, and the rules that follow from it:
 *   - Airbnb and Booking.com stays pass through untouched, so for them
 *     Helm's adjusted_revenue MUST equal the PDF's rental income to the
 *     cent. Hard check, per row. (August: 68 of 68 exact.)
 *   - VRBO / Manual / Direct are rebuilt from the guest gross, so their
 *     difference from the PDF is structural (Stripe fee, taxes, commission).
 *     Reported per stay, not judged: the fee is a stored fact; the rest is
 *     shown as the channel adjustment.
 *   - Guesty's API owner-net column is populated on 26 of 95 confirmed
 *     August stays and disagrees with the PDF on every one it has. It is
 *     not an independent check of anything and is not a lane.
 *   - Cape Ann Elite invoices equal the bank cleaning total to the cent on
 *     every August statement that has invoices (11 of 17). Hard check when
 *     invoices are on file; not_recorded when none are.
 *   - One cleaning charge per turnover is the rule, but a checkout on the
 *     30th bills next month, so the COUNT is shown, never judged.
 */

const EPS = 0.005;
const round2 = (n: number) => Math.round(n * 100) / 100;
const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const eq = (a: number, b: number) => Math.abs(a - b) <= EPS;

export const SYNTHETIC_SLICE_STATUS = 'installment_no_bank_event';
export const OFF_STRIPE_STATUS = 'paid_off_stripe';
const CAE_SOURCES = new Set(['bank', 'matched', 'corroborated']);
const LINEN_LAUNDRY_SOURCES = new Set(['bank-linen', 'bank-laundry']);

export const isPassThroughChannel = (platform: string | null | undefined): boolean => {
  const p = (platform || '').toUpperCase();
  return p.includes('AIRBNB') || p.includes('BOOKING');
};
export const isRtStripeChannel = (platform: string | null | undefined): boolean => {
  const p = (platform || '').toUpperCase();
  return p.includes('HOMEAWAY') || p.includes('VRBO') || p === 'MANUAL' || p === 'DIRECT';
};

export type LaneState = 'agree' | 'differs' | 'not_recorded' | 'unknown' | 'info';
export type LineTone = 'ok' | 'warn' | 'neutral';
export type LaneLine = {
  label: string;
  /** Money, when the line is about money. */
  amount?: number;
  /** A count, when the line is about rows. */
  count?: number;
  /** Confirmation codes the line is about, for the operator to find them. */
  codes?: string[];
  tone: LineTone;
};
export type LaneKey = 'stays' | 'gross' | 'helm' | 'stripe' | 'bank' | 'cleaning' | 'payout';
export type Lane = {
  key: LaneKey;
  title: string;
  state: LaneState;
  /** A hard lane blocks reconciliation when it differs. */
  hard: boolean;
  /** One sentence for the strip. */
  summary: string;
  lines: LaneLine[];
};

export type ReconciliationInput = {
  month: string;
  statement: {
    rental_revenue: number | null;
    management_fee: number | null;
    cleaning_total: number | null;
    repairs_total: number | null;
    add_ons_revenue: number | null;
    attributed_debits_total: number | null;
    reserve_holdback: number | null;
    owner_payout: number | null;
    num_stays: number | null;
    nights_booked: number | null;
    has_bank_csv: boolean;
    /**
     * The PDF header's reservation count. Shown, never judged: besides the
     * $0 reprocessed-cancellation blocks, the header regex cannot tell a
     * listing name ending in a digit from the count that follows it.
     */
    pdf_stay_count: number | null;
    /** What the PDF printed per stay, target section only. Null = not recorded. */
    pdf_stays: { code: string; check_out: string; rental_income: number }[] | null;
  };
  reservations: {
    confirmation_code: string | null;
    guest_name: string | null;
    platform: string | null;
    check_out: string | null;
    guesty_rental_income: number | null;
    adjusted_revenue: number | null;
    stripe_fee: number | null;
    bank_match_status: string | null;
  }[];
  cleaningEvents: {
    source: string | null;
    amount: number | null;
    credit_amount: number | null;
    invoice_no: string | null;
    invoice_amount: number | null;
  }[];
  gaps: { gap_type: string; severity: string | null; resolved: boolean | null }[];
  /** False when the data_gaps read FAILED: the list above is empty because nothing could be read, not because nothing is open. */
  gapsKnown?: boolean;
  /** Confirmed in Guesty with checkout in month and NOT on the statement. Null = the probe failed. */
  driftCodes: string[] | null;
  /** Codes on this statement that carry an installment split. Null = the read failed. */
  splitCodes: Set<string> | null;
  /**
   * PDF stays that are absent from the statement for a reason ingest or the
   * operator decided, so their absence is excused rather than missing:
   *   splitElsewhere   split across months with no slice for THIS month
   *   cancelled        cancelled in Guesty and removed from the statement
   * Out-of-month absences are excused from the PDF stay's own checkout date
   * and need no input. Null = the installments read failed (the split set is
   * unknowable, which is not the same as empty).
   */
  excused: { splitElsewhere: Set<string>; cancelled: Set<string> } | null;
  /** False when the sync_status read FAILED: feed states below are unknown, not ok. */
  feedsKnown?: boolean;
  /** Feed health for the lanes that lean on a sync. */
  feeds: { stripe: 'ok' | 'error' | 'unknown'; invoices: 'ok' | 'error' | 'unknown' };
  /** The pure payout formula run over the same rows. Null = it could not be computed. */
  recomputed: {
    rental_revenue: number; management_fee: number; cleaning_total: number;
    owner_payout: number; num_stays: number; nights_booked: number;
  } | null;
};

export type Reconciliation = {
  reconciled: boolean;
  /** Why not, in the operator's words. Empty when reconciled. */
  blocking: string[];
  lanes: Lane[];
  openCriticalGaps: number;
};

const lane = (key: LaneKey, title: string, hard: boolean, state: LaneState, summary: string, lines: LaneLine[] = []): Lane =>
  ({ key, title, hard, state, summary, lines });

const money = (v: number) => `$${round2(v).toFixed(2)}`;

export function reconcileStatement(i: ReconciliationInput): Reconciliation {
  const month = i.month;
  const inMonth = (d: string | null) => (d || '').slice(0, 7) === month;
  // The statement's real stays: checkout in month, not a synthetic slice.
  const stays = i.reservations.filter(r => r.bank_match_status !== SYNTHETIC_SLICE_STATUS && inMonth(r.check_out));
  const codeOf = (r: { confirmation_code: string | null }) => r.confirmation_code || '';
  const stayCodes = new Set(stays.map(codeOf).filter(Boolean));
  const lanes: Lane[] = [];

  // ── STAYS: the PDF's list vs the statement's ─────────────────────────
  {
    const pdf = i.statement.pdf_stays;
    const lines: LaneLine[] = [];
    if (i.driftCodes === null) {
      lines.push({ label: 'Guesty check failed: bookings could be missing without showing here', tone: 'warn' });
    } else if (i.driftCodes.length > 0) {
      lines.push({ label: 'Confirmed in Guesty, not on this statement', count: i.driftCodes.length, codes: i.driftCodes, tone: 'warn' });
    }
    if (pdf === null) {
      // No PDF list to compare against, but the Guesty probe still stands
      // on its own: a confirmed, paid stay that is not on the statement is
      // a missing stay whether or not the PDF facts were kept.
      const state: LaneState = i.driftCodes === null ? 'unknown' : i.driftCodes.length > 0 ? 'differs' : 'not_recorded';
      lanes.push(lane('stays', 'Stays', true, state,
        state === 'unknown' ? 'Guesty check failed'
          : state === 'differs' ? `${i.driftCodes!.length} confirmed in Guesty, not on this statement`
          : `${stays.length} on the statement · PDF list not recorded (ingested before reconciliation)`,
        lines));
    } else {
      // Every non-synthetic row counts as "on the statement" here, whatever
      // its checkout: a row booked under the has-a-slice-this-month
      // exemption checks out in another month and is still on this one.
      const onStatement = new Set(i.reservations.filter(r => r.bank_match_status !== SYNTHETIC_SLICE_STATUS).map(codeOf).filter(Boolean));
      const pdfCodes = new Set(pdf.map(p => p.code));
      // Each PDF stay that is absent is EXCUSED or MISSING, never just
      // "absent": ingest declines some by design and the operator removes
      // some on purpose, and both used to read as a hard difference that
      // nothing could clear.
      const outOfMonth: string[] = [], splitElsewhere: string[] = [], cancelled: string[] = [], missing: string[] = [];
      for (const p of pdf) {
        if (onStatement.has(p.code)) continue;
        if (!inMonth(p.check_out)) outOfMonth.push(p.code);
        else if (i.excused?.cancelled.has(p.code)) cancelled.push(p.code);
        else if (i.excused?.splitElsewhere.has(p.code)) splitElsewhere.push(p.code);
        else missing.push(p.code);
      }
      const hereNotOnPdf = [...onStatement].filter(c => !pdfCodes.has(c));
      if (missing.length) lines.push({ label: 'On the PDF, not on the statement', count: missing.length, codes: missing, tone: 'warn' });
      if (outOfMonth.length) lines.push({ label: 'On the PDF but checks out in another month, so not recognized here', count: outOfMonth.length, codes: outOfMonth, tone: 'neutral' });
      if (splitElsewhere.length) lines.push({ label: 'On the PDF, split across months and recognized in another', count: splitElsewhere.length, codes: splitElsewhere, tone: 'neutral' });
      if (cancelled.length) lines.push({ label: 'On the PDF, cancelled in Guesty and removed', count: cancelled.length, codes: cancelled, tone: 'neutral' });
      if (hereNotOnPdf.length) lines.push({ label: 'On the statement, not on the PDF (added after ingest)', count: hereNotOnPdf.length, codes: hereNotOnPdf, tone: 'neutral' });
      // The header's count vs what the parser could read is shown, never
      // judged. Guesty prints a date-range block with $0.00 and no rental
      // line for a stay that was cancelled and reprocessed, and the parser
      // deliberately reads nothing from it, so a header claiming more than
      // was read is the normal shape of a month with a cancellation.
      const claimed = i.statement.pdf_stay_count;
      if (claimed !== null && claimed !== pdf.length) {
        lines.push({ label: `PDF header lists ${claimed} reservation${claimed === 1 ? '' : 's'}; ${pdf.length} carried rental income (a cancelled and reprocessed stay prints as $0)`, tone: 'neutral' });
      }
      // Without the installment read, a PDF-only stay could be a split
      // recognized elsewhere or a missing stay, and the difference is money.
      const state: LaneState = i.driftCodes === null || (i.excused === null && missing.length > 0) ? 'unknown'
        : (missing.length === 0 && i.driftCodes.length === 0) ? 'agree' : 'differs';
      lanes.push(lane('stays', 'Stays', true, state,
        state === 'agree'
          ? `${stays.length} stays, every one the PDF listed${hereNotOnPdf.length ? `, plus ${hereNotOnPdf.length} added after ingest` : ''}`
          : state === 'unknown' ? (i.driftCodes === null ? 'Guesty check failed' : 'Installment read failed: a PDF stay is absent and cannot be excused or judged')
          : `${missing.length + (i.driftCodes?.length || 0)} stay${missing.length + (i.driftCodes?.length || 0) === 1 ? '' : 's'} missing`,
        lines));
    }
  }

  // ── GROSS: what the PDF printed per stay vs what the statement carries ─
  {
    const pdf = i.statement.pdf_stays;
    if (pdf === null) {
      lanes.push(lane('gross', 'PDF rental income', true, 'not_recorded', 'PDF amounts not recorded (ingested before reconciliation)'));
    } else {
      // Per stay, for the PDF stays that ARE on the statement: does the row
      // carry what the PDF printed? Absent stays are the Stays lane's job;
      // comparing sums would blame them for a difference that is not money.
      const byCode = new Map<string, number>();
      for (const r of i.reservations) {
        if (r.bank_match_status === SYNTHETIC_SLICE_STATUS) continue;
        const c = codeOf(r);
        if (c && !byCode.has(c)) byCode.set(c, n(r.guesty_rental_income));
      }
      const changed: { code: string; delta: number }[] = [];
      let compared = 0, pdfTotal = 0;
      for (const p of pdf) {
        if (!byCode.has(p.code)) continue;
        compared += 1;
        pdfTotal = round2(pdfTotal + p.rental_income);
        const delta = round2(byCode.get(p.code)! - p.rental_income);
        if (!eq(delta, 0)) changed.push({ code: p.code, delta });
      }
      const state: LaneState = changed.length ? 'differs' : 'agree';
      lanes.push(lane('gross', 'PDF rental income', true, state,
        state === 'agree' ? `${money(pdfTotal)} across ${compared} stay${compared === 1 ? '' : 's'}, carried exactly as printed`
          : `${changed.length} stay${changed.length === 1 ? '' : 's'} carr${changed.length === 1 ? 'ies' : 'y'} a different rental income than the PDF printed`,
        changed.map(c => ({ label: 'Rental income changed after ingest', amount: c.delta, codes: [c.code], tone: 'warn' as LineTone }))));
    }
  }

  // ── HELM: what Helm recognized vs what the PDF said, per channel ─────
  {
    const lines: LaneLine[] = [];
    const split = i.splitCodes;
    const badPassThrough: string[] = [];
    let fee = 0, channelAdj = 0, rtRows = 0;
    const offStripe: string[] = [];
    for (const r of i.reservations) {
      if (r.bank_match_status === SYNTHETIC_SLICE_STATUS) continue;
      const code = codeOf(r);
      const sliced = split ? split.has(code) : false;
      const delta = round2(n(r.adjusted_revenue) - n(r.guesty_rental_income));
      if (isPassThroughChannel(r.platform)) {
        if (!sliced && !eq(delta, 0)) badPassThrough.push(code);
        continue;
      }
      if (isRtStripeChannel(r.platform)) {
        rtRows += 1;
        fee = round2(fee + n(r.stripe_fee));
        if (!sliced) channelAdj = round2(channelAdj + delta + n(r.stripe_fee));
        if (r.bank_match_status === OFF_STRIPE_STATUS) offStripe.push(code);
      }
    }
    if (split === null) lines.push({ label: 'Installment read failed: sliced stays cannot be told from changed ones', tone: 'warn' });
    if (badPassThrough.length) lines.push({ label: 'Airbnb/Booking.com stay whose net differs from the PDF (these pass through untouched)', count: badPassThrough.length, codes: badPassThrough, tone: 'warn' });
    if (rtRows > 0) {
      lines.push({ label: `Stripe fees on ${rtRows} VRBO/Manual/Direct stay${rtRows === 1 ? '' : 's'}`, amount: -fee, tone: 'neutral' });
      if (!eq(channelAdj, 0)) lines.push({ label: 'Channel adjustment (taxes, commission) on those stays', amount: channelAdj, tone: 'neutral' });
    }
    if (split && split.size) lines.push({ label: 'Stays recognized as installment slices', count: split.size, codes: [...split], tone: 'neutral' });
    if (offStripe.length) lines.push({ label: 'Ruled paid off-Stripe (no fee)', count: offStripe.length, codes: offStripe, tone: 'neutral' });
    const state: LaneState = split === null ? 'unknown' : badPassThrough.length ? 'differs' : 'agree';
    lanes.push(lane('helm', 'Helm vs PDF', true, state,
      state === 'unknown' ? 'Installment read failed'
        : state === 'differs' ? `${badPassThrough.length} pass-through stay${badPassThrough.length === 1 ? '' : 's'} changed from the PDF`
        : `${money(n(i.statement.rental_revenue))} recognized; every Airbnb and Booking.com stay matches the PDF`,
      lines));
  }

  // ── STRIPE: what the sync could and could not verify ─────────────────
  {
    const rt = i.reservations.filter(r => r.bank_match_status !== SYNTHETIC_SLICE_STATUS && isRtStripeChannel(r.platform));
    const open = i.gaps.filter(g => !g.resolved && g.gap_type.startsWith('stripe_'));
    const byType = new Map<string, number>();
    for (const g of open) byType.set(g.gap_type, (byType.get(g.gap_type) || 0) + 1);
    const lines: LaneLine[] = [...byType].map(([t, c]) => ({ label: t.replace(/^stripe_/, '').replace(/_/g, ' '), count: c, tone: 'warn' as LineTone }));
    lines.push({ label: 'Fee provenance (estimate vs synced actual) is not tracked per stay yet', tone: 'neutral' });
    const state: LaneState = i.feeds.stripe === 'error' ? 'unknown' : 'info';
    lanes.push(lane('stripe', 'Stripe', false, state,
      i.feeds.stripe === 'error' ? 'Stripe sync is failing'
        : rt.length === 0 ? 'No stays go through our Stripe this month'
        : `${rt.length} stay${rt.length === 1 ? '' : 's'} through our Stripe · ${open.length} open Stripe flag${open.length === 1 ? '' : 's'}`,
      lines));
  }

  // ── BANK: deposits corroborating revenue ─────────────────────────────
  {
    if (!i.statement.has_bank_csv) {
      lanes.push(lane('bank', 'Bank', false, 'not_recorded', 'No bank CSV on file'));
    } else {
      const rev = stays.filter(r => n(r.adjusted_revenue) > 0);
      const matched = rev.filter(r => r.bank_match_status === 'matched').length;
      const off = rev.filter(r => r.bank_match_status === OFF_STRIPE_STATUS);
      const unmatched = rev.filter(r => r.bank_match_status === 'unmatched');
      const lines: LaneLine[] = [];
      if (unmatched.length) lines.push({ label: 'No deposit matched', count: unmatched.length, codes: unmatched.map(codeOf), tone: 'warn' });
      if (off.length) lines.push({ label: 'Paid by check or wire (no deposit expected in the Stripe batch)', count: off.length, codes: off.map(codeOf), tone: 'neutral' });
      lanes.push(lane('bank', 'Bank', false, 'info',
        rev.length === 0 ? 'No revenue-bearing stays' : `${matched} of ${rev.length} stays corroborated by a deposit`,
        lines));
    }
  }

  // ── CLEANING: the bank's charges vs the vendor's invoices ────────────
  {
    const cae = i.cleaningEvents.filter(e => CAE_SOURCES.has(e.source || ''));
    const bankTotal = round2(cae.reduce((s, e) => s + n(e.amount) - n(e.credit_amount), 0));
    const paired = cae.filter(e => !!e.invoice_no && e.invoice_amount !== null);
    const uninvoiced = cae.filter(e => !e.invoice_no);
    const unpaid = i.cleaningEvents.filter(e => e.source === 'invoice');
    const linen = i.cleaningEvents.filter(e => LINEN_LAUNDRY_SOURCES.has(e.source || ''));
    const linenTotal = round2(linen.reduce((s, e) => s + n(e.amount) - n(e.credit_amount), 0));
    const credits = i.cleaningEvents.filter(e => n(e.credit_amount) > 0);
    const lines: LaneLine[] = [];
    const turnovers = n(i.statement.num_stays);
    lines.push({ label: `${cae.length} Cape Ann Elite charge${cae.length === 1 ? '' : 's'} against ${turnovers} turnover${turnovers === 1 ? '' : 's'} (a late-month checkout bills next month)`, tone: cae.length === turnovers ? 'ok' : 'neutral' });
    if (linen.length) lines.push({ label: 'Linen and laundry, never invoiced', count: linen.length, amount: linenTotal, tone: 'neutral' });
    if (credits.length) lines.push({ label: 'Credits applied', count: credits.length, amount: -round2(credits.reduce((s, e) => s + n(e.credit_amount), 0)), tone: 'neutral' });
    if (i.feeds.invoices === 'error') {
      lines.push({ label: 'Invoice sync is failing: invoices may be missing', tone: 'warn' });
      lanes.push(lane('cleaning', 'Cleaning', true, 'unknown', 'Invoice sync failing', lines));
    } else if (paired.length === 0 && unpaid.length === 0) {
      lanes.push(lane('cleaning', 'Cleaning', true, 'not_recorded', `${money(bankTotal)} from the bank · no invoices on file to check it against`, lines));
    } else {
      // The hard check is per corroborated pair: a bank charge and the
      // invoice attached to it must agree to the cent, net of any credit.
      // A bank charge with no invoice, or an invoice with no bank charge,
      // is the ordinary shape of month-end -- the invoice is emailed on the
      // 31st and the ACH lands on the 2nd, and the sync attaches each to
      // the month it fell in -- so those open the lane with a warning and
      // never block it. Judging them made two consecutive months fail with
      // nothing in the product to clear either.
      const mismatched = paired.filter(e => !eq(n(e.amount) - n(e.credit_amount), n(e.invoice_amount)));
      for (const e of mismatched) lines.push({ label: `Bank ${money(n(e.amount) - n(e.credit_amount))} vs its invoice ${money(n(e.invoice_amount))}`, amount: round2(n(e.amount) - n(e.credit_amount) - n(e.invoice_amount)), tone: 'warn' });
      if (uninvoiced.length) lines.push({ label: 'Bank charge with no invoice yet', count: uninvoiced.length, amount: round2(uninvoiced.reduce((s, e) => s + n(e.amount), 0)), tone: 'warn' });
      if (unpaid.length) lines.push({ label: 'Invoice with no bank charge yet (usually paid next month)', count: unpaid.length, amount: round2(unpaid.reduce((s, e) => s + n(e.invoice_amount), 0)), tone: 'warn' });
      const state: LaneState = mismatched.length ? 'differs' : 'agree';
      lanes.push(lane('cleaning', 'Cleaning', true, state,
        state === 'agree'
          ? `${money(bankTotal)} from the bank; ${paired.length} invoiced charge${paired.length === 1 ? '' : 's'} agree${paired.length === 1 ? 's' : ''} to the cent${uninvoiced.length || unpaid.length ? `, ${uninvoiced.length + unpaid.length} straddling the month` : ''}`
          : `${mismatched.length} invoiced charge${mismatched.length === 1 ? '' : 's'} disagree${mismatched.length === 1 ? 's' : ''} with the invoice`,
        lines));
    }
  }

  // ── PAYOUT: the stored columns vs the formula over the same rows ─────
  {
    const rc = i.recomputed;
    if (!rc) {
      lanes.push(lane('payout', 'Payout math', true, 'unknown', 'Could not recompute from the rows'));
    } else {
      const s = i.statement;
      const checks: [string, number, number][] = [
        ['Gross revenue', n(s.rental_revenue), rc.rental_revenue],
        ['Management fee', n(s.management_fee), rc.management_fee],
        ['Cleaning', n(s.cleaning_total), rc.cleaning_total],
        ['Owner payout', n(s.owner_payout), rc.owner_payout],
      ];
      const counts: [string, number, number][] = [
        ['Stays', n(s.num_stays), rc.num_stays],
        ['Nights', n(s.nights_booked), rc.nights_booked],
      ];
      const lines: LaneLine[] = [];
      for (const [label, stored, derived] of checks) {
        if (!eq(stored, derived)) lines.push({ label: `${label}: stored ${money(stored)}, rows give ${money(derived)}`, amount: round2(stored - derived), tone: 'warn' });
      }
      for (const [label, stored, derived] of counts) {
        if (stored !== derived) lines.push({ label: `${label}: stored ${stored}, rows give ${derived}`, tone: 'neutral' });
      }
      const moneyOff = lines.some(l => l.tone === 'warn');
      lanes.push(lane('payout', 'Payout math', true, moneyOff ? 'differs' : 'agree',
        moneyOff ? 'A stored money column does not match its rows' : `${money(n(s.owner_payout))} reproduces exactly from the rows`,
        lines));
    }
  }

  const openCriticalGaps = i.gaps.filter(g => !g.resolved && g.severity === 'critical').length;
  const blocking: string[] = [];
  for (const l of lanes) {
    if (l.state === 'unknown') blocking.push(`${l.title}: ${l.summary}`);
    else if (l.hard && l.state === 'differs') blocking.push(`${l.title}: ${l.summary}`);
  }
  if (i.feedsKnown === false) blocking.push('Feed health could not be read: a failing sync would not show here');
  if (i.gapsKnown === false) blocking.push('Flag list could not be read: open critical flags may exist');
  else if (openCriticalGaps > 0) blocking.push(`${openCriticalGaps} open critical flag${openCriticalGaps === 1 ? '' : 's'}`);
  return { reconciled: blocking.length === 0, blocking, lanes, openCriticalGaps };
}
