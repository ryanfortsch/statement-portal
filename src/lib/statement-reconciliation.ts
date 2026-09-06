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
    pdf_stay_count: number | null;
    pdf_rental_income_sum: number | null;
    pdf_confirmation_codes: string[] | null;
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
    const pdfCodes = i.statement.pdf_confirmation_codes;
    const lines: LaneLine[] = [];
    if (i.driftCodes === null) {
      lines.push({ label: 'Guesty check failed: bookings could be missing without showing here', tone: 'warn' });
    } else if (i.driftCodes.length > 0) {
      lines.push({ label: 'Confirmed in Guesty, not on this statement', count: i.driftCodes.length, codes: i.driftCodes, tone: 'warn' });
    }
    if (pdfCodes === null) {
      lanes.push(lane('stays', 'Stays', true,
        i.driftCodes === null ? 'unknown' : 'not_recorded',
        i.driftCodes === null ? 'Guesty check failed'
          : `${stays.length} on the statement · PDF list not recorded (ingested before reconciliation)`,
        lines));
    } else {
      const pdfSet = new Set(pdfCodes);
      const onPdfNotHere = pdfCodes.filter(c => !stayCodes.has(c));
      const hereNotOnPdf = [...stayCodes].filter(c => !pdfSet.has(c));
      if (onPdfNotHere.length) lines.push({ label: 'On the PDF, not on the statement', count: onPdfNotHere.length, codes: onPdfNotHere, tone: 'warn' });
      if (hereNotOnPdf.length) lines.push({ label: 'On the statement, not on the PDF (added after ingest)', count: hereNotOnPdf.length, codes: hereNotOnPdf, tone: 'neutral' });
      const claimed = i.statement.pdf_stay_count;
      if (claimed !== null && claimed !== pdfCodes.length) {
        lines.push({ label: `PDF header says ${claimed} reservations, ${pdfCodes.length} could be read`, tone: 'warn' });
      }
      const state: LaneState = i.driftCodes === null ? 'unknown'
        : (onPdfNotHere.length === 0 && i.driftCodes.length === 0 && (claimed === null || claimed === pdfCodes.length)) ? 'agree' : 'differs';
      lanes.push(lane('stays', 'Stays', true, state,
        state === 'agree'
          ? `${stays.length} stays, every one the PDF listed${hereNotOnPdf.length ? `, plus ${hereNotOnPdf.length} added after ingest` : ''}`
          : state === 'unknown' ? 'Guesty check failed'
          : `${stays.length} on the statement vs ${pdfCodes.length} on the PDF`,
        lines));
    }
  }

  // ── GROSS: what the PDF printed vs what the statement carries ────────
  {
    const pdfSum = i.statement.pdf_rental_income_sum;
    const pdfCodes = i.statement.pdf_confirmation_codes;
    if (pdfSum === null || pdfCodes === null) {
      lanes.push(lane('gross', 'PDF rental income', true, 'not_recorded', 'PDF total not recorded (ingested before reconciliation)'));
    } else {
      const pdfSet = new Set(pdfCodes);
      const carried = round2(i.reservations.filter(r => pdfSet.has(codeOf(r)) && r.bank_match_status !== SYNTHETIC_SLICE_STATUS)
        .reduce((s, r) => s + n(r.guesty_rental_income), 0));
      const delta = round2(carried - pdfSum);
      const state: LaneState = eq(delta, 0) ? 'agree' : 'differs';
      lanes.push(lane('gross', 'PDF rental income', true, state,
        state === 'agree' ? `${money(pdfSum)} on the PDF, carried exactly`
          : `PDF printed ${money(pdfSum)}, statement carries ${money(carried)} (${delta > 0 ? '+' : ''}${money(delta)}) for those stays`,
        state === 'agree' ? [] : [{ label: 'A PDF stay\'s rental income was changed after ingest', amount: delta, tone: 'warn' }]));
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
    const invoiced = i.cleaningEvents.filter(e => !!e.invoice_no);
    const invoiceTotal = round2(invoiced.reduce((s, e) => s + n(e.invoice_amount), 0));
    const unpaid = i.cleaningEvents.filter(e => e.source === 'invoice');
    const uninvoiced = cae.filter(e => !e.invoice_no);
    const linen = i.cleaningEvents.filter(e => LINEN_LAUNDRY_SOURCES.has(e.source || ''));
    const linenTotal = round2(linen.reduce((s, e) => s + n(e.amount) - n(e.credit_amount), 0));
    const credits = i.cleaningEvents.filter(e => n(e.credit_amount) > 0);
    const lines: LaneLine[] = [];
    const turnovers = n(i.statement.num_stays);
    lines.push({ label: `${cae.length} Cape Ann Elite charge${cae.length === 1 ? '' : 's'} against ${turnovers} turnover${turnovers === 1 ? '' : 's'} (a late-month checkout bills next month)`, tone: cae.length === turnovers ? 'ok' : 'neutral' });
    if (linen.length) lines.push({ label: `Linen and laundry, never invoiced`, count: linen.length, amount: linenTotal, tone: 'neutral' });
    if (credits.length) lines.push({ label: 'Credits applied', count: credits.length, amount: -round2(credits.reduce((s, e) => s + n(e.credit_amount), 0)), tone: 'neutral' });
    if (i.feeds.invoices === 'error') {
      lines.push({ label: 'Invoice sync is failing: invoices may be missing', tone: 'warn' });
      lanes.push(lane('cleaning', 'Cleaning', true, 'unknown', 'Invoice sync failing', lines));
    } else if (invoiced.length === 0) {
      lanes.push(lane('cleaning', 'Cleaning', true, 'not_recorded', `${money(bankTotal)} from the bank · no invoices on file to check it against`, lines));
    } else {
      if (uninvoiced.length) lines.push({ label: 'Bank charge with no invoice', count: uninvoiced.length, amount: round2(uninvoiced.reduce((s, e) => s + n(e.amount), 0)), tone: 'warn' });
      if (unpaid.length) lines.push({ label: 'Invoice with no bank charge (unpaid or paid elsewhere)', count: unpaid.length, amount: round2(unpaid.reduce((s, e) => s + n(e.invoice_amount), 0)), tone: 'warn' });
      const delta = round2(bankTotal - invoiceTotal);
      const state: LaneState = eq(delta, 0) ? 'agree' : 'differs';
      lanes.push(lane('cleaning', 'Cleaning', true, state,
        state === 'agree' ? `${money(bankTotal)} from the bank, invoices agree to the cent`
          : `Bank ${money(bankTotal)} vs invoices ${money(invoiceTotal)} (${delta > 0 ? '+' : ''}${money(delta)})`,
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
  if (i.gapsKnown === false) blocking.push('Flag list could not be read: open critical flags may exist');
  else if (openCriticalGaps > 0) blocking.push(`${openCriticalGaps} open critical flag${openCriticalGaps === 1 ? '' : 's'}`);
  return { reconciled: blocking.length === 0, blocking, lanes, openCriticalGaps };
}
