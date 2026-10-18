'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { canOpenMailbox, gmailUrl, mailboxOwnerLabel } from '@/lib/gmail-links';
import {
  loadOwnerConfig, loadTaxCerts, loadRemittanceSheet, loadOwnerActionCounts as loadOwnerActionCountsAction,
  loadDepositReviewCounts, loadPeriodData, loadStatementData, loadPeriodsList, loadLastSyncMap, loadMonthDataStatus,
  loadCloseState as loadCloseStateAction, saveFundsSentDateAction, upsertCloseTask,
  loadGuestyRowsByCodes, loadOwnerRequestCandidatesAction, saveOwnerRequestSelectionsAction,
  setPeriodStatusAction, unmarkStatementSentAction,
  type SyncHealthRow, type MonthDataStatus,
} from './actions';
import { PROPERTIES, ALWAYS_CC, SEND_FROM } from '@/lib/properties';
import type { Reconciliation, Lane } from '@/lib/statement-reconciliation';
import type { RemittanceSheet } from '@/lib/remittance';
import {
  renderEmail, fmtFundsSentDate, resolveOwnerRequests, ownerRequestsHaveContent,
  type EmailTemplate, type OwnerRequestSelections, type PropertyRequestCandidates,
} from '@/lib/email-templates';
import { OwnerRequestsPanel } from '@/components/OwnerRequestsPanel';
import { downloadStatementPdf } from '@/lib/download-pdf';
import { jsonWithFreezeRetry, formWithFreezeRetry } from '@/lib/freeze-confirm';
import { closeTaskPatchRow } from '@/lib/close-task-write';
import { revenueSignal } from '@/lib/guesty-revenue-signal';
import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { isStatementMonth, previousCalendarMonth, statementsHref, statementsUploadHref } from '@/lib/statements-month';
import { HelmMasthead } from '@/components/HelmMasthead';
import { FinancialsTabs } from '@/components/FinancialsTabs';
import { AddNoteModal } from '@/components/AddNoteModal';
import { PlatformCSVUploadCard } from '@/components/PlatformCSVUploadCard';
import { BookingDepositsUploadCard } from '@/components/BookingDepositsUploadCard';
import { PeriodNotesCard } from '@/components/PeriodNotesCard';
import { BankDepositReview } from '@/components/BankDepositReview';
import { CleaningEventCredit } from '@/components/CleaningEventCredit';
import { ReceiptCapture, ReceiptRowActions } from '@/components/ReceiptCapture';
import { HandoffFileQueue } from '@/components/HandoffFileQueue';

/* ─── Types ─── */
type Reservation = {
  id: string;
  guest_name: string;
  confirmation_code: string;
  check_in: string;
  check_out: string;
  nights: number;
  platform: string;
  guesty_rental_income: number;
  stripe_fee: number;
  adjusted_revenue: number;
  bank_deposit_amount: number | null;
  bank_match_status: string;
};

type CleaningEvent = {
  id: string;
  checkout_date: string;
  guest_name: string;
  invoice_no: string | null;
  invoice_amount: number | null;
  bank_charge_amount: number | null;
  bank_charge_date: string | null;
  amount: number;
  source: string;
  vendor: string | null;
  credit_amount: number | null;
  credit_reason: string | null;
};

type RepairEvent = {
  id: string;
  vendor_name: string | null;
  description: string | null;
  bank_charge_date: string | null;
  bank_charge_amount: number;
  source: string | null;
  // Backlink to property_receipts for receipt-sourced mirror rows
  // (source='receipt'). Optional: absent until the receipts migration runs.
  receipt_id?: string | null;
};

/**
 * An operator-attributed bank debit: a charge that never classified as a
 * known maintenance vendor, so it landed in the bank review queue and was
 * deducted from the payout by hand. It has no repair_events row, and the
 * statement bills it on the same Repairs & Maint. line as one.
 */
type AttributedDebit = {
  id: string;
  deposit_date: string | null;
  amount: number;
  label: string | null;
  description: string | null;
};

/**
 * An operator-attributed bank deposit: add-on revenue tied to one stay by
 * confirmation code. It rides with that guest's Net Rev rather than hanging
 * below the table, which is how the owner's copy prints it -- one number per
 * guest, because a second figure under the same name reads as a correction.
 * Amounts can be negative (an occupancy-tax correction carves the state's
 * money back out of a stay's revenue), so nothing here may assume a credit.
 */
type AttributedAddOn = AttributedDebit & {
  attributed_reservation_code: string | null;
};

type DataGap = {
  id: string;
  gap_type: string;
  description: string;
  severity: string;
  expected_data: string;
  resolved: boolean;
  upload_id: string | null;
};

type DriftBooking = {
  confirmation_code: string;
  guest_name: string | null;
  check_out: string;
  // Three columns because three writers populate them. An SCA direct stay
  // carries only host_payout (Guesty never processed the payment). Display
  // only -- revenueSignal() takes the max, which mixes bases and must never
  // reach payout math.
  total_paid: number | null;
  host_payout: number | null;
  owner_net_revenue_guesty: number | null;
};

type PropertyStatement = {
  id: string;
  property_id: string;
  property_name: string;
  owner_name: string;
  management_fee_pct: number;
  rental_revenue: number;
  management_fee: number;
  cleaning_total: number;
  repairs_total: number;
  /** Attributed add-on revenue; the statement bills this on the same Gross
   *  Revenue line as rental_revenue. */
  add_ons_revenue?: number;
  /** Operator-attributed bank debits; the statement bills these on the same
   *  Repairs & Maint. line as repairs_total. */
  attributed_debits_total?: number;
  tax_remittance: number;
  reserve_holdback?: number;
  owner_payout: number;
  num_stays: number;
  nights_booked: number;
  has_guesty_statement: boolean;
  has_platform_csv: boolean;
  has_bank_csv: boolean;
  confidence: string;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
  reservations?: Reservation[];
  cleaning_events?: CleaningEvent[];
  repair_events?: RepairEvent[];
  attributed_debits?: AttributedDebit[];
  attributed_addons?: AttributedAddOn[];
  data_gaps?: DataGap[];
  drift_bookings?: DriftBooking[];
  /** false = the drift probe FAILED. Not "no drift" -- unknown drift. */
  drift_known?: boolean;
  /** false = the data_gaps read FAILED; the gap list below is not trustworthy. */
  gaps_known?: boolean;
  /** Revenue-bearing Guesty rows with no confirmation code: unmatchable. */
  drift_unmatchable?: number;
  /**
   * Helm's numbers held against independent sources, every difference
   * named (src/lib/statement-reconciliation.ts). Undefined means the loader
   * could not build it, which the strip must show as unknown, never as
   * reconciled.
   */
  reconciliation?: Reconciliation;
};

type StatementPeriod = {
  id: string;
  month: string;
  status: string;
  funds_sent_date?: string | null;
  property_statements?: PropertyStatement[];
};

type CloseTask = {
  period_id: string;
  property_id: string;
  email_template: 'monthly' | 'touch_base' | 'year_end';
  // Fold the owner-request section into the email. The name predates the
  // reframe from "here's what we did" to "here's what we need from you";
  // the column still means "include the section".
  email_include_work_slips: boolean;
  // Per-item picks and operator wording, keyed by work_slip id.
  owner_request_items: OwnerRequestSelections | null;
  // Opt-in sub-section: recap what we handled, under the asks.
  email_include_handled: boolean;
  email_drafted_at: string | null;
  email_sent_at: string | null;
  owner_transfer_done_at: string | null;
  mgmt_sweep_done_at: string | null;
  notes: string | null;
  // Drive webViewLink for the archived statement PDF. Stamped by
  // /api/archive-statement after "Statement sent" is ticked.
  statement_drive_url: string | null;
};

/* ─── Formatters ─── */
function fmt(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function fmtCompact(amount: number): string {
  // "$3,978.00" -> "$3,978" for the insights strip
  return '$' + Math.round(amount).toLocaleString('en-US');
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return '--';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function monthLabel(m: string): string {
  const d = new Date(m + '-01T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function monthLong(m: string): string {
  const d = new Date(m + '-01T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long' });
}

function monthShort(m: string): string {
  const d = new Date(m + '-01T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/**
 * Open a print-only popup with a title + a monospace text block, then
 * trigger the browser's print dialog. Used by the Remittance Instructions
 * and Transfer List modals so the accountant can hand a paper copy to
 * whoever's making the transfers. HTML-escapes the body so any literal
 * `<` / `>` in the text (arrows in payout descriptions, etc.) prints as
 * the characters, not as broken HTML.
 */
function printPlainText(title: string, body: string): void {
  const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] || c));
  const w = window.open('', '_blank', 'width=820,height=920');
  if (!w) return; // popup blocked
  w.document.open();
  w.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>
    @page { margin: 0.5in; }
    body { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px; line-height: 1.55; color: #1e2e34; margin: 24px; }
    h1 { font-family: ui-serif, Georgia, serif; font-size: 18px; font-weight: 500; margin: 0 0 18px; letter-spacing: -0.01em; }
    pre { white-space: pre; font-family: inherit; margin: 0; }
    .meta { font-size: 10px; color: #6b7d83; text-transform: uppercase; letter-spacing: .14em; margin-bottom: 4px; }
  </style></head><body><div class="meta">Rising Tide &middot; Helm</div><h1>${esc(title)}</h1><pre>${esc(body)}</pre><script>window.onload=function(){setTimeout(function(){window.print();},80);};window.onafterprint=function(){window.close();};</script></body></html>`);
  w.document.close();
}

// Default suggestion: first Monday of the month AFTER the statement month.
// Rendered as "Monday 5/4" -- operator can still override via the date picker.
function defaultFundsSentDate(statementMonth: string): string {
  const [y, m] = statementMonth.split('-').map(Number);
  const first = new Date(Date.UTC(y, m, 1));  // first day of next month (UTC)
  const day = first.getUTCDay();  // 0 = Sun
  const offsetToMonday = (8 - day) % 7;
  const mon = new Date(first);
  mon.setUTCDate(first.getUTCDate() + offsetToMonday);
  return mon.toISOString().slice(0, 10);
}

/**
 * Text-format the accountant's monthly remittance checklist. What the
 * accountant used to assemble by hand each close cycle:
 *
 *   1. TAX -> *9928:   per property, the occupancy tax collected this month
 *      on Stay Cape Ann / VRBO / Booking stays, plus the tax collected
 *      inside any add-on charge (a late checkout, an extra night) sold
 *      through a payment link. Move these dollars out of the property
 *      account into the shared tax-holding account so MassTaxConnect can
 *      debit them when filings post.
 *
 *   2. VRBO COMMISSION -> *5130:   per property, 5% of each VRBO stay's
 *      pre-tax guest total. This reimburses the credit card (*3878) that
 *      Rising Tide uses to pay VRBO the monthly commission lump sum.
 *
 *   3. BOOKING.COM AUTO-DEBIT (FYI only, no action):   Booking pulls
 *      their commission directly from the property account the following
 *      month. We show the number so the accountant can reconcile it when
 *      the debit clears.
 *
 * Airbnb bookings are absent from this list: Airbnb handles both tax and
 * commission on its side and pays Rising Tide a net amount. Nothing for
 * the accountant to route.
 *
 * Two coverage rules, added 2026-08-27 after a July close where four
 * newly onboarded properties were missing from the tax section entirely:
 *   - EVERY property with a statement is printed, including the ones
 *     owing $0, so absence from the sheet is never how a property gets
 *     skipped. A property owing nothing says so on its own line.
 *   - Taxable stays carrying no tax at all are listed in their own
 *     section with the rent at stake, so a genuinely missing tax line
 *     reads differently from the 32+ night exemption that legitimately
 *     zeroes one out.
 */
function buildRemittanceList(args: {
  monthName: string;
  sheet: RemittanceSheet;
}): string {
  const { monthName, sheet } = args;
  const rows = sheet.rows;
  const dollars = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const totalTax = rows.reduce((s, r) => s + r.taxToRemit, 0);
  const totalVrbo = rows.reduce((s, r) => s + r.vrboCommissionSweep, 0);
  const totalBooking = rows.reduce((s, r) => s + r.bookingAutoDebit, 0);
  const totalAddOnTax = rows.reduce((s, r) => s + r.addOnTax, 0);

  const lines: string[] = [];
  lines.push(`${monthName} REMITTANCE INSTRUCTIONS`);
  lines.push(`Generated ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
  if (sheet.installmentsDegraded) {
    lines.push('');
    lines.push('!! WARNING -- CROSS-MONTH SPLIT DATA UNAVAILABLE !!');
    lines.push('   The installment table could not be read when this sheet was built.');
    lines.push('   Any long stay split across months may be attributed to the wrong');
    lines.push('   month here. Re-generate this sheet before filing.');
  }
  lines.push('');

  const totalRent = rows.reduce((s, r) => s + r.taxableRent, 0);

  lines.push('1. TAX REMITTANCE (property account -> *9928)');
  lines.push('   Enter RENTAL INCOME on MassTaxConnect under the certificate; the');
  lines.push('   state computes the excise. TAX OWED is what we move to *9928, so');
  lines.push("   the state's computed figure and this column should agree. A \">>\"");
  lines.push('   line means the listing collected the wrong rate -- check it in Guesty.');
  lines.push('-'.repeat(76));
  if (rows.length === 0) {
    lines.push('  (no statements for this month)');
  } else {
    lines.push(`  ${'PROPERTY'.padEnd(26)} ${'RENTAL INCOME'.padStart(14)} ${'TAX OWED'.padStart(12)}   CERTIFICATE`);
    lines.push('  ' + '-'.repeat(74));
    // Every property prints, $0 included. A property missing from this
    // list is a property nobody filed for.
    rows.forEach(r => {
      const cert = r.taxCertId || 'NO CERT ON FILE';
      const rent = r.taxableRent > 0 ? dollars(r.taxableRent) : '--';
      const amount = r.taxToRemit > 0 ? dollars(r.taxToRemit) : 'none owed';
      lines.push(`  ${r.propertyShort.slice(0, 26).padEnd(26)} ${rent.padStart(14)} ${amount.padStart(12)}   ${cert}`);
      if (r.addOnTax > 0) {
        // The add-on leg called out so its rent can be traced: it comes from
        // a payment link, not from a Guesty reservation.
        lines.push(`  ${'incl. add-on fees'.padEnd(26)} ${dollars(r.addOnRent).padStart(14)} ${dollars(r.addOnTax).padStart(12)}`);
      }
      // The two columns are a check on each other. If tax / rent is not the
      // property's statutory rate, a listing's tax config in Guesty is
      // charging the wrong percentage and MassTaxConnect's computed excise
      // will not agree with the number we moved. Say so on the line rather
      // than let the accountant discover it in the filing.
      //
      // It runs both ways. Under-collection is the common case, but a
      // listing can bill a Community Impact Fee its property does not owe
      // (17 Beach, found 2026-09-02), and then the excess is not the state's
      // money and must not be wired out.
      //
      // The line deliberately stops at "do not remit" and does not prescribe
      // the remedy, because that is Dotti's call and it has gone both ways:
      // she refunded nobody for 17 Beach and recognized the excess as revenue
      // instead (2026-09-02), booked as a bank_deposit_attributions row whose
      // tax_amount backs the over-collection out of this very wire.
      if (r.taxableRent > 0 && r.expectedTaxRate > 0) {
        const implied = r.taxToRemit / r.taxableRent;
        if (Math.abs(implied - r.expectedTaxRate) > 0.002) {
          const shouldBe = r.taxableRent * r.expectedTaxRate;
          const diff = shouldBe - r.taxToRemit;
          const verdict = diff >= 0
            ? `short ${dollars(diff)}`
            : `OVER-COLLECTED ${dollars(-diff)} - do not remit`;
          lines.push(
            `  ${'>> collected'.padEnd(26)} ${pct(implied).padStart(14)} ${`vs ${pct(r.expectedTaxRate)}`.padStart(12)}` +
            `   ${verdict}`,
          );
        }
      }
    });
    lines.push('  ' + '-'.repeat(74));
    lines.push(`  ${'TOTAL TO *9928'.padEnd(26)} ${dollars(totalRent).padStart(14)} ${dollars(totalTax).padStart(12)}`);
    if (totalAddOnTax > 0) {
      lines.push(`  ${'of which add-on tax'.padEnd(26)} ${''.padStart(14)} ${dollars(totalAddOnTax).padStart(12)}`);
    }
    const noCert = rows.filter(r => r.taxToRemit > 0 && !r.taxCertId);
    if (noCert.length > 0) {
      lines.push('');
      lines.push('  ACTION: tax owed but no MassTaxConnect certificate on file for');
      lines.push(`  ${noCert.map(r => r.propertyShort).join(', ')}.`);
      lines.push('  Add it on the property page so it prints here next month.');
    }
  }
  lines.push('');

  lines.push('2. VRBO COMMISSION SWEEP (property account -> *5130)');
  lines.push("   5% of each VRBO stay's pre-tax guest total.");
  lines.push('-'.repeat(76));
  const vrboRows = rows.filter(r => r.vrboCommissionSweep > 0);
  if (vrboRows.length === 0) {
    lines.push('  (no VRBO stays this month)');
  } else {
    vrboRows.forEach(r => {
      const note = r.sweepEstimated ? '   (est. - no folio in Guesty)' : '';
      lines.push(`  ${r.propertyShort.padEnd(28)} ${dollars(r.vrboCommissionSweep).padStart(12)}${note}`);
    });
    lines.push('-'.repeat(76));
    lines.push(`  ${'TOTAL VRBO TO *5130'.padEnd(28)} ${dollars(totalVrbo).padStart(12)}`);
  }
  lines.push('');

  lines.push('3. BOOKING.COM AUTO-DEBIT (FYI -- no action required)');
  lines.push('    Booking.com will pull their commission directly from the property');
  lines.push('    account next month. Verify against these amounts when they post.');
  lines.push('-'.repeat(76));
  const bookingRows = rows.filter(r => r.bookingAutoDebit > 0);
  if (bookingRows.length === 0) {
    lines.push('  (no Booking.com stays this month)');
  } else {
    bookingRows.forEach(r => {
      lines.push(`  ${r.propertyShort.padEnd(28)} ${dollars(r.bookingAutoDebit).padStart(12)}`);
    });
    lines.push('-'.repeat(76));
    lines.push(`  ${'TOTAL BOOKING DEBIT'.padEnd(28)} ${dollars(totalBooking).padStart(12)}`);
  }

  // Exceptions: a taxable stay Guesty shows no tax on. Long stays are
  // genuinely exempt (MA exempts 32+ consecutive nights); anything else is
  // a listing whose tax config needs fixing before the next filing.
  const gapRows = rows.filter(r => r.taxGaps.length > 0);
  if (gapRows.length > 0) {
    lines.push('');
    lines.push('4. TAXABLE STAYS WITH NO TAX IN GUESTY (check before filing)');
    lines.push('-'.repeat(76));
    gapRows.forEach(r => {
      r.taxGaps.forEach(g => {
        const why = g.reason === 'long_stay_exempt'
          ? `${g.nights} nights - exempt (32+ nights)`
          : 'no tax line on the listing';
        lines.push(`  ${r.propertyShort.padEnd(20)} ${g.confirmationCode.padEnd(14)} ${dollars(g.rent).padStart(11)}  ${g.guestName}`);
        lines.push(`  ${''.padEnd(20)} ${why}`);
      });
    });
  }

  if (sheet.missingProperties.length > 0) {
    lines.push('');
    lines.push('5. ACTIVE PROPERTIES WITH NO STATEMENT THIS MONTH');
    lines.push('    Nothing to remit for these, but confirm that is right.');
    lines.push('-'.repeat(76));
    sheet.missingProperties.forEach(p => lines.push(`  ${p.name}`));
  }

  return lines.join('\n');
}

function buildTransferList(args: {
  monthName: string;
  fundsSentIso: string;
  rows: Array<{ property: string; owner: string; payout: number; mgmtFee: number }>;
}): string {
  const { monthName, fundsSentIso, rows } = args;
  const totalPayout = rows.reduce((s, r) => s + r.payout, 0);
  const totalMgmt = rows.reduce((s, r) => s + r.mgmtFee, 0);
  const fs = fmtFundsSentDate(fundsSentIso);
  const dollars = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  const lines: string[] = [];
  lines.push(`${monthName} TRANSFERS`);
  lines.push(`Funds sent ${fs}`);
  lines.push('');
  lines.push('OWNER PAYOUTS (ACH to owner bank account)');
  lines.push('-'.repeat(72));
  rows.forEach(r => {
    lines.push(`  ${r.owner.padEnd(28)} ${dollars(r.payout).padStart(12)}   (${r.property})`);
  });
  lines.push('-'.repeat(72));
  lines.push(`  ${'TOTAL OWNER PAYOUTS'.padEnd(28)} ${dollars(totalPayout).padStart(12)}`);
  lines.push('');
  lines.push('MANAGEMENT SWEEP (to Rising Tide operating account)');
  lines.push('-'.repeat(72));
  rows.forEach(r => {
    lines.push(`  ${r.owner.padEnd(28)} ${dollars(r.mgmtFee).padStart(12)}   (${r.property})`);
  });
  lines.push('-'.repeat(72));
  lines.push(`  ${'TOTAL MGMT SWEEP'.padEnd(28)} ${dollars(totalMgmt).padStart(12)}`);
  return lines.join('\n');
}

/**
 * Booking.com deposit routing checklist.
 *
 * Booking.com pays the FULL guest gross (rental + tax + Booking's own
 * commission) as one ACH into the central *5623 Booking.com deposits
 * account. That cash has to be swept to the individual property account so
 * the owner payout can be funded from the right place. After the sweep, two
 * things come OUT of the property account and are handled elsewhere:
 *   - Booking.com auto-debits its 15% commission next month (shown FYI on
 *     the Remittance Instructions).
 *   - The occupancy tax is remitted to *9928 (also on the Remittance list).
 *
 * So this list is only the missing first hop: *5623 -> property account,
 * one line per Booking.com booking, amount = the gross Booking deposited
 * (guesty_reservations.total_paid). The tax + commission are shown as a
 * sub-line for reconciliation, NOT as separate transfers here.
 */
function buildBookingRoutingList(args: {
  monthName: string;
  rows: Array<{
    propertyShort: string;
    bankLast4: string | null;
    guest: string;
    code: string;
    stay: string;
    gross: number | null;
    tax: number;
    commission: number;
  }>;
}): string {
  const { monthName, rows } = args;
  const dollars = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  const lines: string[] = [];
  lines.push(`${monthName} BOOKING.COM DEPOSIT ROUTING`);
  lines.push(`Generated ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
  lines.push('');
  lines.push('Booking.com pays the full guest gross into the *5623 deposits account.');
  lines.push('Sweep each deposit below to its property account. Booking.com then');
  lines.push('auto-debits its commission from the property account next month, and');
  lines.push('the tax portion is remitted to *9928 (see Remittance Instructions).');
  lines.push('-'.repeat(72));
  if (rows.length === 0) {
    lines.push('  (no Booking.com bookings this month)');
    return lines.join('\n');
  }

  let totalSweep = 0;
  let anyUnknown = false;
  rows.forEach(r => {
    const dest = r.bankLast4 ? `-> *${r.bankLast4}` : '-> (no account on file)';
    if (r.gross != null) {
      totalSweep += r.gross;
      lines.push(`  ${(`${r.propertyShort} ${dest}`).padEnd(34)} ${dollars(r.gross).padStart(12)}`);
    } else {
      anyUnknown = true;
      lines.push(`  ${(`${r.propertyShort} ${dest}`).padEnd(34)} ${'amount unknown'.padStart(12)}`);
    }
    lines.push(`     ${r.guest}  ${r.code}  ${r.stay}`);
    lines.push(`     tax ${dollars(r.tax)} -> *9928   Booking commission ${dollars(r.commission)} (auto-debit)`);
  });
  lines.push('-'.repeat(72));
  lines.push(`  ${'TOTAL TO SWEEP FROM *5623'.padEnd(34)} ${dollars(totalSweep).padStart(12)}`);
  if (anyUnknown) {
    lines.push('');
    lines.push('  NOTE: a booking is missing its gross in Guesty -- re-sync bookings');
    lines.push('  or check the Booking.com deposit against the *5623 statement.');
  }
  return lines.join('\n');
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/**
 * The sync_status sources that feed statement inputs. A failure on any of
 * these means the numbers on this page may be stale even though every
 * freshness chip looks recent -- last_synced_at alone once hid a six-day
 * reservations-feed freeze.
 */
const STATEMENT_SYNC_SOURCES = [
  'guesty-reservations', 'guesty-listings', 'guesty-reviews',
  'guesty-cancel-reconcile', 'gmail-invoices', 'stripe',
] as const;

/**
 * Health-aware meta line for a sync source: "failing · 2h ago" in alert
 * red when the last attempt errored, the familiar "last 2h ago" otherwise.
 */
function syncMeta(row?: SyncHealthRow): { text: string; alert: boolean; detail?: string } {
  if (!row || (!row.last_synced_at && !row.last_status)) return { text: 'never', alert: false };
  if (row.last_status === 'error') {
    const when = row.last_attempted_at || row.last_synced_at;
    return {
      text: `failing${when ? ' · ' + relativeTime(when) : ''}`,
      alert: true,
      detail: row.last_error || undefined,
    };
  }
  return { text: row.last_synced_at ? `last ${relativeTime(row.last_synced_at)}` : 'never', alert: false };
}

/** Worst health across several sources (for the grouped "Sync Bookings" row). */
function worstSyncMeta(rows: Array<SyncHealthRow | undefined>): { text: string; alert: boolean; detail?: string } {
  const failing = rows.filter((r): r is SyncHealthRow => !!r && r.last_status === 'error');
  if (failing.length > 0) return syncMeta(failing[0]);
  const freshest = rows
    .map(r => r?.last_synced_at)
    .filter((t): t is string => !!t)
    .sort()
    .reverse()[0];
  return freshest ? { text: `last ${relativeTime(freshest)}`, alert: false } : { text: 'never', alert: false };
}

/* ─── Icons (inline SVGs) ─── */
function IconCheck({ className = 'w-4 h-4' }: { className?: string }) {
  return <svg className={className} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>;
}

function IconChevron({ open, className = 'w-5 h-5' }: { open: boolean; className?: string }) {
  return (
    <svg className={`${className} transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function IconDownload({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function IconSync({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function IconWarning({ className = 'w-4 h-4' }: { className?: string }) {
  return <svg className={className} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>;
}

/* ─── Shared Components (editorial) ─── */
const CHANNEL_DOT: Record<string, string> = {
  Airbnb: '#ff5a5f', VRBO: '#245abc', Booking: '#003580', Direct: '#4a6b3a', Unknown: '#8a969c',
};

function chShort(platform: string): string {
  return ({ HomeAway: 'VRBO', Manual: 'Direct', 'Booking.com': 'Booking' } as Record<string, string>)[platform] || platform;
}

function PlatformBadge({ platform }: { platform: string }) {
  const label = chShort(platform);
  const dot = CHANNEL_DOT[label] || CHANNEL_DOT.Unknown;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '2px 8px 2px 7px',
      border: '1px solid var(--rule)',
      background: 'var(--paper-2)',
      fontSize: 10, fontWeight: 600, color: 'var(--ink-2)',
      letterSpacing: '.04em',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />
      {label}
    </span>
  );
}

function ConfidenceIndicator({ level }: { level: string }) {
  const color = level === 'green' ? 'var(--positive)' : level === 'yellow' ? 'var(--signal)' : 'var(--negative)';
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />;
}

function CheckTask({ label, done, onToggle, disabled }: { label: string; done: boolean; onToggle: (next: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!done)}
      disabled={disabled}
      aria-pressed={done}
      title={label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: 'transparent', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase',
        color: done ? 'var(--positive)' : 'var(--ink-4)',
        padding: 4,
      }}
    >
      <span style={{
        width: 14, height: 14,
        border: `1px solid ${done ? 'var(--positive)' : 'var(--rule)'}`,
        background: done ? 'var(--positive)' : 'transparent',
        color: 'var(--paper)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {done && (
          <svg width="9" height="9" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        )}
      </span>
      {label}
    </button>
  );
}

type FillGapType = 'bank_csv' | 'platform_csv';

/**
 * Which file type fills a given data-gap type? Returns null for gaps that
 * aren't user-fillable (those need a full re-upload or a Gmail sync).
 */
function gapFillType(gapType: string): FillGapType | null {
  if (gapType === 'missing_bank_csv' || gapType === 'unmatched_bank') return 'bank_csv';
  if (gapType === 'no_platform_match' || gapType === 'unresolved_guest_names') return 'platform_csv';
  return null;
}

/**
 * Gap types an automated pass OWNS: it deletes and re-derives them on every
 * run (stripe-sync nightly, fill-gap on upload, the missing-direct sweep).
 * Marking one resolved by hand is undone the next time that pass runs, so
 * the Resolve button is not offered for them -- they clear themselves when
 * the underlying condition clears, which is the honest contract. Everything
 * else is a standing judgement that only a person can retire.
 */
const PIPELINE_OWNED_GAP_TYPES = new Set([
  // Hand-credit notices are re-derived by every rebuild; the two the
  // operator can act on carry a Remove button of their own below.
  'cleaning_credit_override_unapplied',
  'cleaning_credit_override_collision',
  'cleaning_credit_overrides_unavailable',
  'missing_bank_csv', 'unmatched_bank',
  'no_platform_match', 'unresolved_guest_names', 'missing_direct_reservation',
]);
// NOT cancelled_reservation_retained: there is no in-app path to edit one
// stay's amount, so the only honest exits are a re-ingest after Sync Guesty
// or a Resolve with a note.
// NOT vendor_refund_unapplied: Fill Gap deliberately no longer deletes and
// re-derives it (a narrower CSV would lose a real one), so nothing retires
// it automatically and Resolve is its only exit.
const isPipelineOwnedGap = (gapType: string) =>
  gapType.startsWith('stripe_') || PIPELINE_OWNED_GAP_TYPES.has(gapType);

/**
 * Flags that name a file the statement was built without. The close
 * strip's "Inputs on file" step counts a statement missing one; its Open
 * lands on the flag, where Fill Gap uploads the file.
 */
const INPUT_GAP_TYPES = new Set(['missing_bank_csv', 'no_platform_match', 'unresolved_guest_names']);

// Response shapes returned by /api/fill-gap -- discriminated by file_type.
type BankChange = { guest: string; status_before: string; status_after: string; deposit_amount: number | null; adjusted_revenue: number | null; changed: boolean };
// adjusted_revenue_after is NULLABLE: a row whose money the operator owns
// (paid_off_stripe) reports its existing value back verbatim rather than a
// re-priced one, and that value can be null. This type is a hand-written
// mirror of the /api/fill-gap response, so tsc cannot catch it drifting.
type PlatformChange = { id: string; guest_before: string | null; guest_after: string; platform_before: string | null; platform_after: string; adjusted_revenue_before: number | null; adjusted_revenue_after: number | null };
type FillGapResult =
  | {
      file_type: 'bank_csv';
      summary: { cleaning_total: number; owner_payout: number; reservations_matched: number; reservations_unmatched: number; confidence: string };
      changes: BankChange[];
    }
  | {
      file_type: 'platform_csv';
      summary: { rental_revenue: number; management_fee: number; owner_payout: number; reservations_matched_by_csv: number; reservations_total: number; confidence: string };
      changes: PlatformChange[];
    };

/**
 * Small modal that lets the user patch a single missing-file gap on an
 * existing statement without re-uploading everything else. Calls
 * /api/fill-gap with the one file and refreshes the card on success.
 */
function FillGapModal(props: {
  gap: DataGap;
  propertyId: string;
  propertyName: string;
  month: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { gap, propertyId, propertyName, month, onClose, onSuccess } = props;
  const fileType = gapFillType(gap.gap_type);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<FillGapResult | null>(null);

  // Accept a dropped-in file. Tolerates anything that ends in .csv or has
  // a text/* mime type -- Chrome downloads sometimes report
  // "application/octet-stream" for exported CSVs, so we don't require a
  // strict text/csv match.
  function acceptFile(f: File | null | undefined) {
    if (!f) return;
    const looksLikeCsv = /\.csv$/i.test(f.name) || f.type.startsWith('text/') || f.type === 'application/vnd.ms-excel';
    if (!looksLikeCsv) {
      setErr(`"${f.name}" doesn't look like a CSV.`);
      return;
    }
    setFile(f);
    setErr(null);
  }

  if (!fileType) return null;
  const title = fileType === 'bank_csv' ? 'Upload Chase Bank CSV' : 'Upload Platform CSV';
  const hint = fileType === 'bank_csv'
    ? 'Export the month\'s transactions from your Chase account as CSV. We\'ll re-run cleaning + deposit matching against the existing reservations. Nothing else on the statement gets touched.'
    : 'Export the reservations table from Guesty as CSV. We\'ll use it to fill in booking channels and guest names on the existing reservations, and recompute Stripe fees + owner payout. Bank-sourced cleaning data stays as-is.';

  async function submit() {
    if (!file || !fileType) return;
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append('month', month);
      fd.append('property_id', propertyId);
      fd.append('file_type', fileType);
      fd.append('file', file);
      const { res, cancelled } = await formWithFreezeRetry('/api/fill-gap', fd);
      if (cancelled) { setErr('Not applied: the statement is marked sent. Override was declined.'); return; }
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Upload failed'); return; }
      setResult(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally { setBusy(false); }
  }

  return (
    <PreviewModal onClose={busy ? () => {} : onClose}>
      <div style={{ fontFamily: 'var(--sans)' }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          Fill Data Gap &middot; {propertyName} &middot; {month}
        </div>
        <h2 className="font-serif" style={{ fontSize: 24, fontWeight: 500, marginTop: 6, letterSpacing: '-0.01em' }}>{title}</h2>

        {!result && (
          <>
            <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5, marginTop: 10 }}>{hint}</p>

            <div
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!busy) setDragging(true); }}
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); if (!busy) setDragging(true); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(false); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragging(false);
                if (busy) return;
                const dropped = e.dataTransfer.files?.[0];
                acceptFile(dropped);
              }}
              style={{
                marginTop: 18, padding: 18,
                border: `${dragging ? '2px' : '1px'} dashed ${dragging ? 'var(--ink)' : 'var(--ink-4)'}`,
                background: dragging ? 'var(--paper-2)' : (file ? 'var(--paper-2)' : 'transparent'),
                transition: 'background .12s, border-color .12s',
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                <input
                  type="file"
                  accept=".csv,text/csv,application/vnd.ms-excel"
                  disabled={busy}
                  onChange={(e) => acceptFile(e.target.files?.[0])}
                  style={{ display: 'none' }}
                />
                <span
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    border: '1px solid var(--ink)',
                    padding: '8px 14px',
                    fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase',
                    color: 'var(--ink)',
                  }}
                >
                  Choose CSV
                </span>
                <span style={{ fontSize: 12, color: file ? 'var(--ink)' : 'var(--ink-4)' }}>
                  {file ? file.name : (dragging ? 'Release to upload' : 'or drag from Finder / Downloads')}
                </span>
              </label>
            </div>

            {err && (
              <div style={{ marginTop: 14, padding: '10px 12px', background: 'rgba(200,90,58,.08)', border: '1px solid var(--signal)', fontSize: 12, color: 'var(--signal)' }}>
                {err}
              </div>
            )}

            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={onClose}
                disabled={busy}
                style={{
                  background: 'transparent', border: '1px solid var(--rule)',
                  padding: '10px 16px',
                  fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase',
                  color: 'var(--ink-3)',
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!file || busy}
                style={{
                  background: 'var(--ink)', color: 'var(--paper)', border: 'none',
                  padding: '10px 18px',
                  fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase',
                  cursor: (!file || busy) ? 'not-allowed' : 'pointer',
                  opacity: (!file || busy) ? 0.4 : 1,
                }}
              >
                {busy ? 'Processing…' : 'Patch Statement'}
              </button>
            </div>
          </>
        )}

        {result && (
          <div style={{ marginTop: 18 }}>
            <div style={{ padding: 16, background: 'var(--paper-2)', borderLeft: '3px solid #4a6b3a' }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: '#4a6b3a' }}>Success</div>
              <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 6 }}>
                {result.file_type === 'bank_csv' ? (
                  <>
                    Cleaning total: <strong>${result.summary.cleaning_total.toFixed(2)}</strong>
                    {' · '}owner payout <strong>${result.summary.owner_payout.toFixed(2)}</strong>
                    {' · '}{result.summary.reservations_matched} of {result.summary.reservations_matched + result.summary.reservations_unmatched} reservations matched
                    {' · '}confidence <strong>{result.summary.confidence}</strong>
                  </>
                ) : (
                  <>
                    Rental revenue: <strong>${result.summary.rental_revenue.toFixed(2)}</strong>
                    {' · '}owner payout <strong>${result.summary.owner_payout.toFixed(2)}</strong>
                    {' · '}{result.summary.reservations_matched_by_csv} of {result.summary.reservations_total} reservations filled in from CSV
                    {' · '}confidence <strong>{result.summary.confidence}</strong>
                  </>
                )}
              </div>
            </div>

            {/* Per-guest change list so the operator can verify which
                reservations actually flipped, rather than trusting raw counts. */}
            {result.file_type === 'bank_csv' && result.changes.some(c => c.changed) && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 6 }}>Bank match changes</div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 12, color: 'var(--ink-2)' }}>
                  {result.changes.filter(c => c.changed).map((c, i) => (
                    <li key={i} style={{ padding: '6px 0', borderBottom: '1px dotted var(--rule)', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <span><strong style={{ color: 'var(--ink)' }}>{c.guest}</strong>: {c.status_before} &rarr; <strong>{c.status_after}</strong></span>
                      {c.deposit_amount != null && <span className="tabular-nums" style={{ color: 'var(--ink-3)' }}>${c.deposit_amount.toFixed(2)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.file_type === 'platform_csv' && result.changes.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 6 }}>Reservation updates</div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 12, color: 'var(--ink-2)' }}>
                  {result.changes.map((c, i) => {
                    const nameChanged = (c.guest_before || '').trim() !== c.guest_after.trim();
                    const platChanged = (c.platform_before || '') !== c.platform_after;
                    return (
                      <li key={i} style={{ padding: '6px 0', borderBottom: '1px dotted var(--rule)' }}>
                        <div><strong style={{ color: 'var(--ink)' }}>{c.guest_after}</strong>{nameChanged && c.guest_before && <span style={{ color: 'var(--ink-4)' }}> (was &ldquo;{c.guest_before}&rdquo;)</span>}</div>
                        {platChanged && <div style={{ color: 'var(--ink-3)', marginTop: 2 }}>Platform: {c.platform_before || '(unknown)'} &rarr; <strong>{c.platform_after}</strong></div>}
                        {c.adjusted_revenue_before !== c.adjusted_revenue_after && c.adjusted_revenue_after !== null && (
                          <div style={{ color: 'var(--ink-3)', marginTop: 2 }} className="tabular-nums">Net revenue: ${(c.adjusted_revenue_before ?? 0).toFixed(2)} &rarr; <strong>${c.adjusted_revenue_after.toFixed(2)}</strong></div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={onSuccess}
                style={{
                  background: 'var(--ink)', color: 'var(--paper)', border: 'none',
                  padding: '10px 18px',
                  fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </PreviewModal>
  );
}

function PreviewModal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(30, 46, 52, 0.35)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 80, paddingBottom: 40,
        overflow: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rt-modal"
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--ink)',
          width: '100%', maxWidth: 640,
          padding: 28,
          boxShadow: '0 30px 80px -20px rgba(30,46,52,.25), 0 8px 24px -8px rgba(30,46,52,.1)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--ink-4)', cursor: 'pointer' }}
            aria-label="close"
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Toast({ tone, onDismiss, action, children }: {
  tone: 'positive' | 'tide' | 'negative';
  onDismiss?: () => void;
  // One verb beside the sentence, e.g. Retry on a read that failed.
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  const color = tone === 'positive' ? 'var(--positive)' : tone === 'tide' ? 'var(--tide-deep)' : 'var(--negative)';
  return (
    <div className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 16 }}>
      <div style={{
        background: 'var(--paper-2)',
        borderLeft: `3px solid ${color}`,
        borderTop: '1px solid var(--rule)',
        borderRight: '1px solid var(--rule)',
        borderBottom: '1px solid var(--rule)',
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        fontSize: 12, color: 'var(--ink-2)',
      }}>
        <div className="flex items-center gap-3">
          {tone === 'negative' ? <IconWarning className="w-3.5 h-3.5 shrink-0" /> : <IconCheck className="w-3.5 h-3.5 shrink-0" />}
          <span>{children}</span>
        </div>
        <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              style={{
                border: '1px solid var(--ink)', background: 'transparent', color: 'var(--ink)',
                fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase',
                padding: '5px 12px', cursor: 'pointer',
              }}
            >
              {action.label}
            </button>
          )}
          {onDismiss && (
            <button
              onClick={onDismiss}
              style={{ color: 'var(--ink-4)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}
              aria-label="dismiss"
            >
              <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniMetric({ label, value, hide }: { label: string; value: string; hide?: 'sm' | 'md' }) {
  const hideClass = hide === 'sm' ? 'hidden sm:block' : hide === 'md' ? 'hidden md:block' : '';
  return (
    <div className={hideClass} style={{ textAlign: 'right' }}>
      <div className="eyebrow">{label}</div>
      <div className="font-serif tabular-nums" style={{ fontSize: 15, fontWeight: 400, color: 'var(--ink-2)', marginTop: 3 }}>{value}</div>
    </div>
  );
}

function SectionHead({ num, title, meta, signal }: { num: string; title: string; meta?: string; signal?: boolean }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'auto 1fr auto',
      gap: 12,
      alignItems: 'baseline',
      paddingBottom: 10,
    }}>
      <span className="font-mono" style={{ fontSize: 10, color: signal ? 'var(--signal)' : 'var(--signal)', letterSpacing: '.08em' }}>{num}</span>
      <h4 className="font-serif" style={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>{title}</h4>
      {meta && <span style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.14em' }}>{meta}</span>}
    </div>
  );
}

function FinRow({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  return (
    <tr>
      <td style={{ padding: '10px 0 9px', borderBottom: '1px dotted var(--rule)', color: 'var(--ink-2)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{
            display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
            border: '1px solid var(--ink-3)', transform: 'translateY(-1px)',
          }} />
          {label}
        </span>
      </td>
      <td style={{
        padding: '10px 0 9px', borderBottom: '1px dotted var(--rule)',
        textAlign: 'right',
        fontFamily: 'var(--font-fraunces)',
        fontSize: 13,
        color: negative ? 'var(--negative)' : 'var(--ink)',
      }}>{value}</td>
    </tr>
  );
}

/**
 * Owner Reserve row. Renders as a checkbox + inline dollar input; ticking
 * defaults to $2,000, editable to any non-negative amount. Amount subtracts
 * from owner_payout and appears as a "Owner Reserve" line item on the
 * editorial PDF. Persists via PATCH /api/property-statements/[id]/reserve.
 * Survives re-ingest (preserved in /api/ingest's SELECT-before-delete).
 */
function ReserveHoldbackRow({ prop, onSaved }: { prop: PropertyStatement; onSaved: () => void }) {
  const initial = Number(prop.reserve_holdback || 0);
  const [enabled, setEnabled] = useState(initial > 0);
  const [amount, setAmount] = useState<string>(initial > 0 ? initial.toFixed(2) : '2000.00');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function persist(nextAmount: number) {
    setSaving(true); setErr(null);
    try {
      const { res, cancelled } = await jsonWithFreezeRetry(`/api/property-statements/${prop.id}/reserve`, 'PATCH',
        { amount: nextAmount });
      if (cancelled) {
        // Revert the optimistic checkbox/amount: the server kept the old value.
        setEnabled(initial > 0);
        setAmount(initial > 0 ? initial.toFixed(2) : '2000.00');
        setErr('Not saved: statement is frozen');
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'save failed');
      // Re-read this statement. That refreshes every owner_payout display
      // on the card (header, Financials Net, Owner Payout total) in one
      // shot rather than mutating prop in place.
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td style={{ padding: '10px 0 9px', borderBottom: '1px dotted var(--rule)', color: 'var(--ink-2)' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => {
              const next = e.target.checked;
              setEnabled(next);
              if (next) {
                const amt = Number(amount) || 2000;
                if (amt !== initial) void persist(amt);
                else if (initial === 0) void persist(2000);
              } else {
                void persist(0);
              }
            }}
            disabled={saving}
            style={{ transform: 'translateY(-1px)' }}
          />
          <span>Withhold Owner Reserve</span>
          {enabled && (
            <>
              <span style={{ color: 'var(--ink-3)' }}>$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                onBlur={() => {
                  const amt = Number(amount);
                  if (!Number.isFinite(amt) || amt < 0) return;
                  if (amt !== initial) void persist(amt);
                }}
                disabled={saving}
                style={{
                  width: 80, padding: '2px 6px', fontSize: 12,
                  fontFamily: 'var(--font-jetbrains, monospace)',
                  border: '1px solid var(--rule)',
                  textAlign: 'right',
                }}
              />
            </>
          )}
          {err && <span style={{ fontSize: 10, color: 'var(--negative)' }}>{err}</span>}
        </label>
      </td>
      <td style={{
        padding: '10px 0 9px', borderBottom: '1px dotted var(--rule)',
        textAlign: 'right',
        fontFamily: 'var(--font-fraunces)',
        fontSize: 13,
        color: enabled && Number(amount) > 0 ? 'var(--negative)' : 'var(--ink-4)',
      }}>
        {enabled && Number(amount) > 0 ? `−${fmt(Number(amount))}` : '—'}
      </td>
    </tr>
  );
}

function DataSourceChip({ active, label }: { active: boolean; label: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 10, fontWeight: 500, letterSpacing: '.14em', textTransform: 'uppercase',
      padding: '3px 9px',
      border: `1px solid ${active ? 'var(--ink)' : 'var(--rule)'}`,
      background: active ? 'var(--ink)' : 'transparent',
      color: active ? 'var(--paper)' : 'var(--ink-4)',
    }}>
      {active && (
        <svg width="9" height="9" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      )}
      {label}
    </span>
  );
}

function Insight({ label, value, sub, accent, last }: { label: string; value: string; sub?: string; accent?: boolean; last?: boolean }) {
  return (
    <div style={{
      padding: '14px 16px',
      borderRight: last ? 'none' : '1px solid var(--rule)',
    }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      <div
        className="font-serif tabular-nums"
        style={{
          fontSize: 22,
          lineHeight: 1,
          fontWeight: 400,
          color: accent ? 'var(--signal)' : 'var(--ink)',
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 5 }}>{sub}</div>
      )}
    </div>
  );
}

/**
 * One step of the close strip: its number (a tick once done), its name, a
 * count out of the month's statements, what is holding it, and one Open
 * that lands on the exact section of the first card that needs it. The
 * first step not done is marked as the next one. A null count is unknown
 * (a read failed), which never shows as a number.
 */
function CloseStep({ index, label, done, total, complete, next, details, onOpen }: {
  index: number;
  label: string;
  done: number | null;
  total: number;
  complete: boolean;
  next: boolean;
  details: React.ReactNode[];
  onOpen?: () => void;
}) {
  return (
    <div className="rt-close-step" style={{
      display: 'grid',
      gridTemplateColumns: '22px 130px 64px 1fr auto',
      alignItems: 'baseline',
      columnGap: 12,
      padding: '7px 0',
      borderTop: index > 1 ? '1px dotted var(--rule)' : 'none',
      fontSize: 12,
    }}>
      <span className="font-mono" style={{ fontSize: 11, color: complete ? 'var(--positive)' : next ? 'var(--signal)' : 'var(--ink-4)' }}>
        {complete ? '✓' : index}
      </span>
      <span style={{ fontWeight: next ? 600 : 500, color: complete ? 'var(--ink-3)' : 'var(--ink)' }}>{label}</span>
      <span className="font-mono tabular-nums" style={{ color: complete ? 'var(--positive)' : done === null ? 'var(--negative)' : 'var(--ink-2)' }}>
        {done === null ? '?' : `${done}/${total}`}
      </span>
      <span className="flex items-baseline flex-wrap" style={{ gap: 14, minWidth: 0 }}>{details}</span>
      {onOpen && !complete ? (
        <button
          type="button"
          onClick={onOpen}
          style={{
            border: `1px solid ${next ? 'var(--ink)' : 'var(--rule)'}`,
            background: next ? 'var(--ink)' : 'transparent',
            color: next ? 'var(--paper)' : 'var(--ink-3)',
            fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase',
            padding: '4px 12px', cursor: 'pointer',
          }}
        >
          Open
        </button>
      ) : <span />}
    </div>
  );
}

/** A clickable count inside a close step: lands on that kind of work only. */
function StepLink({ alert, onClick, children }: { alert?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
        fontSize: 12, color: alert ? 'var(--negative)' : 'var(--ink-2)', fontWeight: alert ? 600 : 400,
        textDecoration: 'underline', textDecorationColor: 'var(--rule)', textUnderlineOffset: 3,
      }}
    >
      {children}
    </button>
  );
}

/** A plain line inside a close step: said, not clickable. */
function StepNote({ alert, children }: { alert?: boolean; children: React.ReactNode }) {
  return <span style={{ fontSize: 12, color: alert ? 'var(--negative)' : 'var(--ink-4)' }}>{children}</span>;
}

function EditorialButton({
  onClick, disabled, busy, label, meta, metaAlert, icon,
}: {
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  label: string;
  meta?: string;
  metaAlert?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        border: '1px solid var(--rule)',
        background: busy ? 'var(--paper-2)' : 'transparent',
        color: 'var(--ink-3)',
        fontSize: 11, fontWeight: 500, letterSpacing: '.08em', textTransform: 'uppercase',
        padding: '6px 12px',
        cursor: disabled ? (busy ? 'wait' : 'not-allowed') : 'pointer',
        opacity: disabled && !busy ? 0.5 : 1,
        transition: 'background .15s, border-color .15s',
      }}
    >
      {busy ? (
        <span
          aria-hidden
          style={{
            width: 10, height: 10, borderRadius: '50%',
            border: '1.5px solid var(--ink-3)', borderTopColor: 'transparent',
            animation: 'spin 0.8s linear infinite',
          }}
        />
      ) : icon}
      {label}
      {meta && (
        <span style={{ color: metaAlert ? 'var(--negative)' : 'var(--ink-4)', fontWeight: metaAlert ? 600 : 400, letterSpacing: 0, textTransform: 'none', fontSize: 10 }}>
          &middot; {meta}
        </span>
      )}
    </button>
  );
}

/* ─── Sync menu item (used inside the Sync ▾ dropdown) ─── */
function SyncMenuItem({
  label, meta, metaAlert, metaDetail, primary, onClick,
}: {
  label: string;
  meta?: string;
  metaAlert?: boolean;
  metaDetail?: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={metaDetail}
      style={{
        display: 'block', width: '100%',
        textAlign: 'left',
        padding: '10px 14px',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase',
        color: primary ? 'var(--ink)' : 'var(--ink-3)',
        fontWeight: primary ? 600 : 500,
        transition: 'background .12s',
      }}
      onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--paper-2)'; }}
      onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span>{label}</span>
        {meta && (
          <span style={{
            color: metaAlert ? 'var(--negative)' : 'var(--ink-4)', fontWeight: metaAlert ? 600 : 400, letterSpacing: 0,
            textTransform: 'none', fontSize: 10,
          }}>
            {meta}
          </span>
        )}
      </div>
      {metaAlert && metaDetail && (
        <div style={{
          color: 'var(--negative)', fontWeight: 400, letterSpacing: 0, textTransform: 'none',
          fontSize: 10, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 250,
        }}>
          {metaDetail}
        </div>
      )}
    </button>
  );
}

/* ─── Property Card ─── */
const LANE_GLYPH: Record<Lane['state'], { glyph: string; color: string; word: string }> = {
  agree: { glyph: '✓', color: 'var(--positive)', word: 'agrees' },
  differs: { glyph: '✕', color: 'var(--negative)', word: 'differs' },
  unknown: { glyph: '?', color: 'var(--negative)', word: 'unknown' },
  not_recorded: { glyph: '–', color: 'var(--ink-4)', word: 'not recorded' },
  info: { glyph: '·', color: 'var(--ink-4)', word: '' },
};

/**
 * One line per lane. A lane that agrees shows only its sentence; a lane that
 * differs, is unknown, or carries a warning line opens up and names the
 * rows and amounts, so the operator's time goes to the difference and
 * nowhere else. That is the whole point: the close used to be verifying
 * every statement by hand because nothing here said which ones needed it.
 */
function ReconciliationStrip({ recon }: { recon?: Reconciliation }) {
  const fmtAmt = (v: number) => `${v < 0 ? '−' : '+'}$${Math.abs(v).toFixed(2)}`;
  if (!recon) {
    return (
      <div style={{ padding: '10px 0', borderTop: '1px dotted var(--rule)' }}>
        <span className="eyebrow" style={{ color: 'var(--negative)', marginRight: 10 }}>Reconciliation</span>
        <span style={{ fontSize: 12, color: 'var(--negative)' }}>could not be computed for this statement</span>
      </div>
    );
  }
  return (
    <div style={{ padding: '10px 0', borderTop: '1px dotted var(--rule)' }}>
      <div className="flex items-baseline flex-wrap" style={{ gap: 14, marginBottom: 6 }}>
        <span className="eyebrow" style={{ color: recon.reconciled ? 'var(--ink-4)' : 'var(--signal)' }}>Reconciliation</span>
        {recon.reconciled ? (
          <span className="font-serif" style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--ink-3)' }}>
            Reconciled &middot; every check agrees or has nothing to check against.
          </span>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--negative)', fontWeight: 600 }}>
            Not reconciled &middot; {recon.blocking.length} thing{recon.blocking.length === 1 ? '' : 's'} to look at
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 12, rowGap: 3, fontSize: 12 }}>
        {recon.lanes.map(l => {
          const g = LANE_GLYPH[l.state];
          const open = l.state === 'differs' || l.state === 'unknown' || l.lines.some(x => x.tone === 'warn');
          return (
            <div key={l.key} style={{ display: 'contents' }}>
              <span style={{ color: 'var(--ink-4)', fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', paddingTop: 2, whiteSpace: 'nowrap' }}>
                <span style={{ color: g.color, fontWeight: 700, marginRight: 6 }}>{g.glyph}</span>{l.title}
              </span>
              <div>
                <span style={{ color: l.state === 'differs' || l.state === 'unknown' ? 'var(--ink)' : 'var(--ink-3)' }}>{l.summary}</span>
                {open && l.lines.length > 0 && (
                  <ul style={{ listStyle: 'none', margin: '3px 0 4px', padding: 0 }}>
                    {l.lines.map((x, i) => (
                      <li key={i} style={{ color: x.tone === 'warn' ? 'var(--negative)' : 'var(--ink-3)', padding: '1px 0' }}>
                        {x.label}
                        {x.count !== undefined && <span className="tabular-nums"> &middot; {x.count}</span>}
                        {x.amount !== undefined && <span className="tabular-nums"> &middot; {fmtAmt(x.amount)}</span>}
                        {x.codes && x.codes.length > 0 && (
                          <span className="font-mono" style={{ fontSize: 10, color: 'var(--ink-4)', marginLeft: 6 }}>{x.codes.join(' ')}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The parts of an expanded card the close strip can land on. Each renders
 * an element with id stmt-<property_id>-<section>.
 */
type CardSection = 'sources' | 'drift' | 'recon' | 'bank' | 'flags' | 'send';

function PropertyCard({
  prop,
  month,
  ownerActionCount,
  onRefresh,
  reviewRefresh = 0,
  focus,
  closeTask,
  closeTaskKnown,
  ownerGreeting,
  ownerEmailMissing,
  onCloseTaskField,
  onMarkSent,
  onPreview,
}: {
  prop: PropertyStatement;
  month: string;
  ownerActionCount: number;
  // The Send section: this home's owner email and transfers. It used to be
  // a row in a close-out grid ten cards below the card, so one property's
  // close lived in two places.
  closeTask: CloseTask | undefined;
  // false = the close-out ticks did not load; they show, but cannot be
  // ticked until they do.
  closeTaskKnown: boolean;
  ownerGreeting: string;
  ownerEmailMissing: boolean;
  onCloseTaskField: (patch: Partial<CloseTask>) => void;
  // "Statement sent" has its own door (markStatementSent): unticking it
  // unfreezes the statement and must leave a trace.
  onMarkSent: (next: boolean) => void;
  onPreview: () => void;
  // Re-read THIS statement and the strip counts, in place. The card stays
  // mounted, so it stays open and the page stays where it was scrolled.
  onRefresh: () => void;
  // Bumped by the dashboard on every period reload so the deposit-review
  // queue refetches (syncs can land new pending rows).
  reviewRefresh?: number;
  // From the close strip: open this card at this section, with its queue
  // unfolded. The token increments on every strip click, so a re-click
  // after a manual collapse opens it again. Only the first card the click
  // names scrolls.
  focus?: { token: number; section: CardSection; scroll: boolean };
}) {
  const [expanded, setExpanded] = useState(false);
  const focusToken = focus?.token ?? 0;
  const focusSection = focus?.section;
  const focusScroll = !!focus?.scroll;
  // Bumped when the strip lands on this card's bank rows, which unfolds
  // the queue instead of leaving it folded inside the opened card.
  const [bankOpenToken, setBankOpenToken] = useState(0);
  const scrollTarget = useRef<string | null>(null);
  useEffect(() => {
    if (focusToken === 0 || !focusSection) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpanded(true);
    if (focusSection === 'bank') setBankOpenToken(focusToken);
    if (focusScroll) scrollTarget.current = `stmt-${prop.property_id}-${focusSection}`;
  }, [focusToken, focusSection, focusScroll, prop.property_id]);
  useEffect(() => {
    // Runs once the detail is in the DOM: the section anchors live inside it.
    if (!expanded || !scrollTarget.current) return;
    const id = scrollTarget.current;
    scrollTarget.current = null;
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [expanded, focusToken]);
  const [generating, setGenerating] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [fillingGap, setFillingGap] = useState<DataGap | null>(null);
  const [resolvingGapId, setResolvingGapId] = useState<string | null>(null);
  const [refreshingStatement, setRefreshingStatement] = useState(false);
  const [addingReceipt, setAddingReceipt] = useState(false);
  // Bumped by an action that can change this card's bank rows (a bank CSV
  // patched through Fill Gap re-runs deposit matching), so the queue below
  // refetches along with the statement.
  const [queueToken, setQueueToken] = useState(0);
  const refreshWithQueue = () => { setQueueToken(n => n + 1); onRefresh(); };
  const gaps = prop.data_gaps?.filter(g => !g.resolved) || [];
  const reservations = prop.reservations || [];
  // Sort on the same date the row displays (bank charge date, falling back to
  // checkout). The fetch has no order, so without this the list renders in
  // insertion order: bank rows from ingest first, invoice rows appended later.
  const cleaning = [...(prop.cleaning_events || [])].sort((a, b) =>
    (a.bank_charge_date || a.checkout_date || '').localeCompare(b.bank_charge_date || b.checkout_date || ''));
  const repairs = prop.repair_events || [];
  const attributedDebits = prop.attributed_debits || [];
  // The total for the Repairs & Maintenance SECTION below, which lists both
  // vendor-classified repairs and hand-attributed debits. The Financials
  // column no longer sums them into one row: repairs and refunds each carry
  // their own line there, so the column still foots to the payout without
  // printing a guest refund as maintenance on the owner's house.
  const repairsCombined = Number(prop.repairs_total || 0) + Number(prop.attributed_debits_total || 0);
  // Same story on the way in: an attributed deposit is add-on revenue billed
  // on the Gross Revenue line.
  const grossRevenue = Number(prop.rental_revenue || 0) + Number(prop.add_ons_revenue || 0);
  // ...and the Reservations table below has to agree with it. Its Net Rev
  // column reads adjusted_revenue, which does NOT carry attributed add-ons,
  // so a stay with one printed the pre-attribution figure and the column
  // totalled rental_revenue while Gross Revenue two inches away totalled
  // rental_revenue + add_ons_revenue. On 3 South's August 2026 statement
  // that was a silent $227.60 disagreement (an occupancy-tax correction on
  // the Javelly stay). Fold them in per stay, exactly as the owner's copy
  // does at statements/render/page.tsx.
  const addOnsByCode = new Map<string, AttributedAddOn[]>();
  for (const a of prop.attributed_addons || []) {
    const code = a.attributed_reservation_code;
    if (!code) continue;
    const list = addOnsByCode.get(code);
    if (list) list.push(a);
    else addOnsByCode.set(code, [a]);
  }
  const addOnTotalFor = (code: string | null) =>
    (code ? addOnsByCode.get(code) || [] : []).reduce((s, a) => s + (Number(a.amount) || 0), 0);
  // An add-on whose stay is not on this statement (carried from a month that
  // already paid out, or attributed with no code) has no row to ride with.
  // It is inside grossRevenue regardless, so it gets its own row or the
  // column stops adding up.
  const onStatementCodes = new Set((prop.reservations || []).map(r => r.confirmation_code).filter(Boolean));
  const carriedAddOns = (prop.attributed_addons || []).filter(
    a => !a.attributed_reservation_code || !onStatementCodes.has(a.attributed_reservation_code),
  );
  const bankMatched = reservations.filter(r => r.bank_match_status === 'matched').length;
  const pctMatched = reservations.length > 0 ? Math.round((bankMatched / reservations.length) * 100) : 0;

  function downloadStatement(e: React.MouseEvent) {
    e.stopPropagation();
    window.open(`/statements/render?id=${prop.id}&month=${month}`, '_blank');
  }

  const gtySum = reservations.reduce((s, r) => s + r.guesty_rental_income, 0);
  const stripeSum = reservations.reduce((s, r) => s + r.stripe_fee, 0);

  return (
    <div
      id={'stmt-' + prop.property_id}
      style={{
        background: 'var(--paper)',
        borderTop: '1px solid var(--ink)',
        // Anchor target for the month review strip; clear the sticky masthead.
        scrollMarginTop: 72,
      }}
    >
      {/* Card Header -- editorial row */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{ width: '100%', textAlign: 'left', padding: '16px 0', background: 'transparent', cursor: 'pointer' }}
      >
        <div className="rt-prop-head flex items-center justify-between gap-4">
          <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
            <ConfidenceIndicator level={prop.confidence} />
            <div>
              <div className="flex items-baseline gap-3 flex-wrap">
                <h3 className="font-serif" style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.01em' }}>{prop.property_name}</h3>
                {gaps.length > 0 && (
                  <span style={{
                    fontSize: 9, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
                    color: 'var(--signal)',
                    border: '1px solid var(--signal)',
                    padding: '2px 7px',
                  }}>
                    {gaps.length} gap{gaps.length > 1 ? 's' : ''}
                  </span>
                )}
                {(prop.drift_bookings?.length || 0) > 0 && (
                  <span title="Revenue-bearing bookings have been added to Guesty since this statement was last ingested. Click the property to expand and refresh." style={{
                    fontSize: 9, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
                    color: 'var(--paper)',
                    background: 'var(--tide)',
                    padding: '2px 7px',
                  }}>
                    {prop.drift_bookings!.length} new
                  </span>
                )}
                {closeTask?.email_sent_at ? (
                  <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--positive)' }}>
                    Sent
                  </span>
                ) : closeTask?.email_drafted_at ? (
                  <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--tide-deep)' }}>
                    Drafted
                  </span>
                ) : null}
                {ownerActionCount > 0 && (
                  <Link
                    href="/work?filter=owner-action"
                    onClick={(e) => e.stopPropagation()}
                    title={`${ownerActionCount} open work slip${ownerActionCount === 1 ? '' : 's'} flagged for owner input. Click to draft an email from the queue.`}
                    style={{
                      fontSize: 9, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
                      color: 'var(--paper)',
                      background: 'var(--signal)',
                      padding: '2px 7px',
                      textDecoration: 'none',
                    }}
                  >
                    {ownerActionCount} owner action
                  </Link>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3, letterSpacing: '.02em' }}>
                {prop.owner_name} &middot; {prop.management_fee_pct}% management fee
                {prop.updated_at && (
                  <> &middot; <span title={`Last ingested ${new Date(prop.updated_at).toLocaleString()}`}>ingested {relativeTime(prop.updated_at)}</span></>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-baseline gap-10">
            <MiniMetric label="Revenue" value={fmtCompact(prop.rental_revenue)} hide="sm" />
            <MiniMetric label="Stays" value={String(prop.num_stays)} hide="md" />
            <MiniMetric label="Cleaning" value={fmtCompact(prop.cleaning_total)} hide="md" />
            <div style={{ textAlign: 'right' }}>
              <div className="eyebrow">Owner Payout</div>
              <div className="font-serif tabular-nums" style={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', marginTop: 3 }}>
                {fmtCompact(prop.owner_payout)}
              </div>
            </div>
            <IconChevron open={expanded} className="rt-chevron w-4 h-4" />
          </div>
        </div>
      </button>

      {/* Expanded Detail */}
      {expanded && (
        <div style={{ paddingBottom: 24 }}>
          {/* Drift banner: paid bookings added to guesty_reservations since
              this statement was last ingested. One-click adds them to the
              statement without a full re-ingest of all 3 files. */}
          {(prop.drift_bookings?.length || 0) > 0 && (
            <div id={`stmt-${prop.property_id}-drift`} style={{
              scrollMarginTop: 72,
              padding: '12px 14px',
              borderTop: '1px dotted var(--rule)',
              borderBottom: '1px dotted var(--rule)',
              background: 'rgba(75, 138, 158, 0.08)',
              borderLeft: '3px solid var(--tide)',
              display: 'flex', alignItems: 'center', gap: 12,
              fontSize: 12, color: 'var(--ink-2)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, color: 'var(--ink)' }}>
                  {prop.drift_bookings!.length} new booking{prop.drift_bookings!.length === 1 ? '' : 's'} since this statement was generated
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3 }}>
                  {prop.drift_bookings!.slice(0, 3).map(d => `${d.guest_name || 'Guest'} ($${revenueSignal(d).toFixed(0)})`).join(' · ')}
                  {prop.drift_bookings!.length > 3 && ` +${prop.drift_bookings!.length - 3} more`}
                </div>
              </div>
              <button
                disabled={refreshingStatement}
                onClick={async (e) => {
                  e.stopPropagation();
                  setRefreshingStatement(true);
                  try {
                    const { res, cancelled } = await jsonWithFreezeRetry('/api/refresh-statement', 'POST',
                      { month, property_id: prop.property_id });
                    if (cancelled) return;
                    const data = await res.json();
                    if (!res.ok) {
                      alert(`Refresh failed: ${data.error || 'unknown error'}`);
                    } else {
                      // A booking Guesty has no collected gross for cannot be
                      // priced here; say so rather than let an unqualified
                      // success imply the statement is now complete.
                      const noGross: string[] = Array.isArray(data.missing_gross_codes) ? data.missing_gross_codes : [];
                      const added = Array.isArray(data.added) ? data.added.length : 0;
                      if (noGross.length > 0) {
                        alert(
                          `${added} booking${added === 1 ? '' : 's'} added.\n\n` +
                          `${noGross.length} could NOT be added: Guesty has no collected gross for ${noGross.length === 1 ? 'it' : 'them'} ` +
                          `(typically a Stay Cape Ann direct booking paid through the property's own Stripe, where the money never passes through Guesty).\n\n` +
                          `Re-ingest this month with the Guesty PDF to price ${noGross.length === 1 ? 'it' : 'them'}. ` +
                          `Any that are confirmed Direct stays with real folio revenue are also flagged as a critical data gap on this statement.`,
                        );
                      }
                      onRefresh();
                    }
                  } catch (err) {
                    alert(`Refresh failed: ${err instanceof Error ? err.message : err}`);
                  } finally {
                    setRefreshingStatement(false);
                  }
                }}
                style={{
                  border: '1px solid var(--ink)',
                  background: 'var(--ink)',
                  color: 'var(--paper)',
                  fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase',
                  padding: '8px 14px',
                  cursor: refreshingStatement ? 'wait' : 'pointer',
                  opacity: refreshingStatement ? 0.5 : 1,
                  flexShrink: 0,
                }}
              >
                {refreshingStatement ? 'Refreshing…' : 'Add to Statement'}
              </button>
            </div>
          )}

          {/* Sources + bank verified */}
          <div id={`stmt-${prop.property_id}-sources`} className="flex items-center gap-2 flex-wrap" style={{
            scrollMarginTop: 72,
            padding: '10px 0',
            borderTop: '1px dotted var(--rule)',
          }}>
            <span className="eyebrow" style={{ marginRight: 6 }}>Sources</span>
            <DataSourceChip active={prop.has_guesty_statement} label="Guesty" />
            <DataSourceChip active={prop.has_platform_csv} label="Platform" />
            <DataSourceChip active={prop.has_bank_csv} label="Bank" />
            <div style={{ flex: 1 }} />
            {prop.has_bank_csv && (
              <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                Bank verified{' '}
                <span className="font-serif tabular-nums" style={{
                  fontWeight: 500, fontSize: 13,
                  color: pctMatched === 100 ? 'var(--positive)' : pctMatched >= 50 ? 'var(--signal)' : 'var(--negative)',
                }}>{pctMatched}%</span>
              </span>
            )}
          </div>

          {/* Reconciliation: Helm against independent sources, differences named.
              Sits above the financials because it is the thing that says
              whether the financials can be trusted. Not a numbered section:
              it is a status surface, not part of the document. */}
          <div id={`stmt-${prop.property_id}-recon`} style={{ scrollMarginTop: 72 }}>
            <ReconciliationStrip recon={prop.reconciliation} />
          </div>

          {/* Financial summary. The Performance block that sat beside it
              (stays, nights, fee, ADR) repeated the header and this table. */}
          <div style={{ padding: '20px 0 8px', maxWidth: 560 }}>
            <div>
              <SectionHead num="01" title="Financials" meta={`Net ${fmt(prop.owner_payout)}`} />
              <table className="w-full tabular-nums" style={{ borderCollapse: 'collapse', fontSize: 12, color: 'var(--ink-2)' }}>
                <tbody>
                  <FinRow label="Gross Revenue" value={fmt(grossRevenue)} />
                  <FinRow label={`Mgmt Fee (${prop.management_fee_pct}%)`} value={`−${fmt(prop.management_fee)}`} negative />
                  <FinRow label="Cleaning" value={`−${fmt(prop.cleaning_total)}`} negative />
                  {Number(prop.repairs_total || 0) > 0 && <FinRow label="Repairs" value={`−${fmt(Number(prop.repairs_total))}`} negative />}
                  {Number(prop.attributed_debits_total || 0) > 0 && <FinRow label="Refunds & Adjustments" value={`−${fmt(Number(prop.attributed_debits_total))}`} negative />}
                  <ReserveHoldbackRow prop={prop} onSaved={onRefresh} />
                  <tr>
                    <td style={{ padding: '10px 0 0', borderTop: '1.5px solid var(--ink)', borderBottom: '2.5px double var(--ink)', fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>
                      Owner Payout
                    </td>
                    <td style={{ padding: '10px 0 0', borderTop: '1.5px solid var(--ink)', borderBottom: '2.5px double var(--ink)', fontWeight: 600, fontSize: 15, color: 'var(--ink)', fontFamily: 'var(--font-fraunces)', textAlign: 'right' }}>
                      {fmt(prop.owner_payout)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Reservations */}
          {reservations.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <SectionHead num="02" title="Reservations" meta={`${reservations.length} stays`} />
              <div className="rt-scroll-x">
              <table className="w-full tabular-nums" style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                    <th style={{ textAlign: 'left', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Guest</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Stay</th>
                    <th style={{ textAlign: 'center', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Nts</th>
                    <th style={{ textAlign: 'center', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Channel</th>
                    <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Guesty</th>
                    <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Stripe</th>
                    <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Net Rev</th>
                    <th style={{ textAlign: 'center', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Bank</th>
                  </tr>
                </thead>
                <tbody>
                  {reservations.map((r) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                      <td style={{ padding: '10px 6px', color: 'var(--ink)', fontFamily: 'var(--font-fraunces)', fontWeight: 500 }}>
                        {r.guest_name}
                        {(addOnsByCode.get(r.confirmation_code) || []).map(a => (
                          <div key={a.id} style={{ fontFamily: 'var(--font-inter)', fontWeight: 400, fontSize: 10, color: 'var(--ink-3)', marginTop: 2 }}>
                            {a.label || 'Add-on'}{' '}
                            <span style={{ color: Number(a.amount) < 0 ? 'var(--negative)' : 'var(--positive)' }}>
                              {Number(a.amount) < 0 ? '−' : '+'}{fmt(Math.abs(Number(a.amount)))}
                            </span>
                          </div>
                        ))}
                      </td>
                      <td style={{ padding: '10px 6px', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                        {fmtDate(r.check_in)} → {fmtDate(r.check_out)}
                        {(() => {
                          // Mirror the splitter's own qualification (see
                          // MultiMonthBookingsSection.qualifiesForInstallment):
                          // the LAST PAID NIGHT decides the span (checkout
                          // morning is not a paid night, so an Aug 2 -> Sep 1
                          // stay does not span), 30+ nights, and the guest has
                          // not already checked out (the splitter's query
                          // filters check_out >= today, so a chip on a
                          // checked-out stay would dead-end).
                          if (!r.check_out || !r.nights || r.nights < 30) return null;
                          const lastNight = new Date(new Date(`${r.check_out}T00:00:00Z`).getTime() - 86400000)
                            .toISOString()
                            .slice(0, 7);
                          if (lastNight <= month) return null;
                          if (r.check_out < new Date().toISOString().slice(0, 10)) return null;
                          return (
                            // Splitter lives on the property page above its tabs,
                            // so a bare /properties/<id> link lands right on it.
                            <Link
                              href={`/properties/${prop.property_id}`}
                              onClick={(e) => e.stopPropagation()}
                              title="This stay runs past the statement month. Open the installment splitter on the property page to spread its revenue across the months it spans."
                              style={{ marginLeft: 8, fontSize: 10, color: 'var(--tide)', textDecoration: 'underline', textUnderlineOffset: 2 }}
                            >
                              Spans into {monthLong(lastNight)} · installment splitter →
                            </Link>
                          );
                        })()}
                      </td>
                      <td style={{ padding: '10px 6px', textAlign: 'center', color: 'var(--ink-3)' }}>{r.nights}</td>
                      <td style={{ padding: '10px 6px', textAlign: 'center' }}><PlatformBadge platform={r.platform} /></td>
                      <td style={{ padding: '10px 6px', textAlign: 'right', color: 'var(--ink-3)' }}>{fmt(r.guesty_rental_income)}</td>
                      <td style={{ padding: '10px 6px', textAlign: 'right', color: r.stripe_fee > 0 ? 'var(--negative)' : 'var(--ink-4)' }}>
                        {r.stripe_fee > 0 ? `−${fmt(r.stripe_fee)}` : '—'}
                      </td>
                      <td style={{ padding: '10px 6px', textAlign: 'right', color: 'var(--ink)', fontFamily: 'var(--font-fraunces)', fontSize: 13 }}>{fmt(r.adjusted_revenue + addOnTotalFor(r.confirmation_code))}</td>
                      <td style={{ padding: '10px 6px', textAlign: 'center' }}>
                        {r.bank_match_status === 'matched' ? (
                          <span style={{ color: 'var(--positive)' }}>✓</span>
                        ) : r.bank_match_status === 'paid_off_stripe' ? (
                          // The operator ruled this stay paid by check, ACH
                          // or wire, so no Stripe fee is charged. Said here
                          // rather than as a data gap: it is a standing fact
                          // about the row, and it explains the "—" in the fee
                          // column beside it. Without it the row is
                          // indistinguishable from one that simply never
                          // matched a deposit.
                          <span
                            title="Operator ruled: paid by check, ACH or wire. No Stripe fee charged."
                            style={{ color: 'var(--ink-3)', fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase' }}
                          >
                            off-Stripe
                          </span>
                        ) : (
                          <span style={{ color: 'var(--ink-4)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {carriedAddOns.map((a) => (
                    <tr key={a.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                      <td style={{ padding: '10px 6px', color: 'var(--ink-2)' }}>+ {a.label || 'Add-on'}</td>
                      <td style={{ padding: '10px 6px', color: 'var(--ink-4)', fontSize: 11 }}>
                        {a.attributed_reservation_code ? `stay not on this statement · ${a.attributed_reservation_code}` : 'no reservation code'}
                      </td>
                      <td /><td /><td /><td />
                      <td style={{ padding: '10px 6px', textAlign: 'right', color: 'var(--ink)', fontFamily: 'var(--font-fraunces)', fontSize: 13 }}>{fmt(Number(a.amount) || 0)}</td>
                      <td />
                    </tr>
                  ))}
                  <tr style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-2)' }}>
                    <td style={{ padding: '10px 6px', borderTop: '1px solid var(--ink)' }} colSpan={4}>Totals</td>
                    <td style={{ padding: '10px 6px', textAlign: 'right', borderTop: '1px solid var(--ink)' }}>{fmt(gtySum)}</td>
                    <td style={{ padding: '10px 6px', textAlign: 'right', borderTop: '1px solid var(--ink)', color: stripeSum > 0 ? 'var(--negative)' : 'var(--ink-4)' }}>
                      {stripeSum > 0 ? `−${fmt(stripeSum)}` : '—'}
                    </td>
                    {/* Gross Revenue, not rental_revenue: the rows above now
                        carry their attributed add-ons, so the column has to
                        foot to the same figure the Financials block prints. */}
                    <td style={{ padding: '10px 6px', textAlign: 'right', borderTop: '1px solid var(--ink)' }}>{fmt(grossRevenue)}</td>
                    <td style={{ padding: '10px 6px', textAlign: 'center', borderTop: '1px solid var(--ink)', color: 'var(--ink-4)', fontWeight: 400 }}>{bankMatched}/{reservations.length}</td>
                  </tr>
                </tbody>
              </table>
              </div>
            </div>
          )}

          {/* Cleaning */}
          {cleaning.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <SectionHead num="03" title="Cleaning Charges" meta={`${fmt(prop.cleaning_total)} total`} />
              <div>
                {cleaning.map((ce) => (
                  <div key={ce.id} className="flex items-center justify-between" style={{ padding: '10px 0', borderBottom: '1px dotted var(--rule)', fontSize: 12 }}>
                    <div className="flex items-center gap-4" style={{ minWidth: 0 }}>
                      <span className="tabular-nums" style={{ color: 'var(--ink-4)', width: 50, fontSize: 11 }}>
                        {ce.bank_charge_date ? fmtDate(ce.bank_charge_date) : (ce.checkout_date ? fmtDate(ce.checkout_date) : '—')}
                      </span>
                      <span style={{
                        fontFamily: ce.guest_name ? 'var(--font-fraunces)' : 'var(--font-inter)',
                        fontWeight: ce.guest_name ? 500 : 400,
                        fontStyle: ce.guest_name ? 'normal' : 'italic',
                        color: ce.guest_name ? 'var(--ink)' : 'var(--ink-4)',
                      }}>
                        {ce.source === 'bank-linen'
                          ? 'Linen service'
                          : ce.source === 'bank-laundry'
                            ? (ce.guest_name || 'Laundry service')
                            : (ce.guest_name || (ce.invoice_no ? `Invoice ${ce.invoice_no}` : 'Unmatched charge'))}
                      </span>
                      {ce.source === 'bank-linen' && (
                        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--tide)' }}>
                          {ce.vendor || "Nor'East"} · Linens
                        </span>
                      )}
                      {ce.source === 'bank-laundry' && (
                        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--tide)' }}>
                          {ce.vendor || 'Laundry Plus'} · Laundry
                        </span>
                      )}
                      {ce.source === 'corroborated' && (
                        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--positive)' }}>
                          Verified
                        </span>
                      )}
                      {ce.source === 'invoice' && (
                        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--tide)' }}>
                          Invoice only
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      {ce.invoice_no && <span className="font-mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>#{ce.invoice_no}</span>}
                      {(Number(ce.credit_amount) || 0) > 0 ? (
                        <span className="font-serif tabular-nums" style={{ color: 'var(--ink-3)' }}>
                          <s style={{ color: 'var(--ink-4)' }}>{fmt(ce.amount)}</s>{' '}
                          <span style={{ color: 'var(--positive)' }}>−{fmt(Number(ce.credit_amount) || 0)}</span>
                        </span>
                      ) : (
                        <span className="font-serif tabular-nums" style={{ fontWeight: 500, color: 'var(--ink)' }}>{fmt(ce.amount)}</span>
                      )}
                      {ce.source !== 'bank-linen' && (
                        <CleaningEventCredit
                          eventId={ce.id}
                          amount={ce.amount}
                          initialCreditAmount={Number(ce.credit_amount) || 0}
                          initialCreditReason={ce.credit_reason}
                          onSaved={onRefresh}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Repairs & Maintenance: vendor-classified repairs, then the
              debits an operator attributed by hand. Both bill to the same
              owner-facing line, so both are listed under it and the section
              total is the line itself. */}
          {(repairs.length > 0 || attributedDebits.length > 0) && (
            <div style={{ marginTop: 28 }}>
              <SectionHead num="04" title="Repairs & Maintenance" meta={`${fmt(repairsCombined)} total`} />
              <div>
                {repairs.map((re) => (
                  <div key={re.id} className="flex items-center justify-between" style={{ padding: '10px 0', borderBottom: '1px dotted var(--rule)', fontSize: 12 }}>
                    <div className="flex items-center gap-4" style={{ minWidth: 0 }}>
                      <span className="tabular-nums" style={{ color: 'var(--ink-4)', width: 50, fontSize: 11 }}>
                        {re.bank_charge_date ? fmtDate(re.bank_charge_date) : '—'}
                      </span>
                      <span style={{
                        fontFamily: 'var(--font-fraunces)',
                        fontWeight: 500,
                        color: 'var(--ink)',
                      }}>
                        {re.vendor_name || (re.source === 'receipt' ? 'Receipt expense' : 'Maintenance vendor')}
                      </span>
                      {re.source === 'receipt' && re.description && (
                        <span style={{ fontSize: 11, color: 'var(--ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {re.description}
                        </span>
                      )}
                      <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: re.source === 'receipt' ? 'var(--tide)' : 'var(--ink-4)' }}>
                        {re.source === 'receipt' ? 'Receipt' : 'Bank'}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-serif tabular-nums" style={{ fontWeight: 500, color: 'var(--ink)' }}>{fmt(re.bank_charge_amount)}</span>
                      {re.source === 'receipt' && re.receipt_id && (
                        <ReceiptRowActions receiptId={re.receipt_id} onVoided={onRefresh} />
                      )}
                    </div>
                  </div>
                ))}
                {attributedDebits.map((d) => (
                  <div key={d.id} className="flex items-center justify-between" style={{ padding: '10px 0', borderBottom: '1px dotted var(--rule)', fontSize: 12 }}>
                    <div className="flex items-center gap-4" style={{ minWidth: 0 }}>
                      <span className="tabular-nums" style={{ color: 'var(--ink-4)', width: 50, fontSize: 11 }}>
                        {d.deposit_date ? fmtDate(d.deposit_date) : '—'}
                      </span>
                      <span style={{
                        fontFamily: 'var(--font-fraunces)',
                        fontWeight: 500,
                        color: 'var(--ink)',
                      }}>
                        {d.label || 'Attributed charge'}
                      </span>
                      {/* The raw bank descriptor: on an internal page it is
                          how you find the row again in the Chase CSV. */}
                      {d.description && (
                        <span style={{ fontSize: 11, color: 'var(--ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {d.description}
                        </span>
                      )}
                      <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--tide)' }}>
                        Attributed
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-serif tabular-nums" style={{ fontWeight: 500, color: 'var(--ink)' }}>{fmt(Number(d.amount) || 0)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* The field handoff: what the operations manager sent for this
              home and month. Filed through the same /api/receipts path as the
              button below, or noted on the period, never written straight to
              the statement. Renders nothing when there is nothing waiting. */}
          <HandoffFileQueue propertyId={prop.property_id} propertyName={prop.property_name} month={month} onFiled={onRefresh} />

          {/* Receipt capture -- photograph a Home Depot run (or drag the
              photo in) and bill it to this month's Repairs & Maintenance.
              Rides under section 05 when repairs exist; stands alone as a
              slim affordance when the month has none yet. */}
          <div style={{ marginTop: repairs.length > 0 || attributedDebits.length > 0 ? 12 : 28 }}>
            {addingReceipt ? (
              <ReceiptCapture
                propertyId={prop.property_id}
                propertyName={prop.property_name}
                defaultMonth={month}
                onDone={onRefresh}
                onCancel={() => setAddingReceipt(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setAddingReceipt(true)}
                style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
                  color: 'var(--ink-3)', border: '1px solid var(--rule)', background: 'transparent',
                  padding: '5px 10px', cursor: 'pointer',
                }}
              >
                + Add receipt
              </button>
            )}
          </div>

          {/* Unattributed bank deposits -- operator review queue. Shows
              nothing if there are no pending deposits for this property+month. */}
          {month && (
            <div id={`stmt-${prop.property_id}-bank`} style={{ scrollMarginTop: 72 }}>
              <BankDepositReview
                propertyId={prop.property_id}
                month={month}
                reservations={(prop.reservations || []).map(r => ({ confirmation_code: r.confirmation_code, guest_name: r.guest_name }))}
                refreshToken={`${reviewRefresh}:${queueToken}`}
                onChanged={onRefresh}
                openToken={bankOpenToken}
              />
            </div>
          )}

          {/* Data Gaps */}
          {gaps.length > 0 && (
            <div id={`stmt-${prop.property_id}-flags`} style={{ marginTop: 28, scrollMarginTop: 72 }}>
              <SectionHead num="05" title="Data Gaps" meta={`${gaps.length} flag${gaps.length > 1 ? 's' : ''}`} signal />
              <div>
                {gaps.map((gap) => {
                  const fillable = gapFillType(gap.gap_type) !== null;
                  const offStripeResolvable = gap.gap_type === 'stripe_missing_charge';
                  // A flag with no action of its own would otherwise sit on
                  // the card forever and ride along in every Draft All
                  // confirm, which is how operators learn to click through
                  // the confirm without reading it.
                  const needsManualResolve = !fillable && !offStripeResolvable
                    // cancelled_reservation keeps its Remove button AND gets
                    // Resolve: Remove now refuses when the cancellation
                    // retained money, and a refused flag needs an exit.
                    && !isPipelineOwnedGap(gap.gap_type);
                  return (
                    <div
                      key={gap.id}
                      style={{
                        padding: '12px 14px',
                        marginBottom: 8,
                        background: 'var(--paper-2)',
                        borderLeft: `3px solid ${gap.severity === 'critical' ? 'var(--negative)' : gap.severity === 'warning' ? 'var(--signal)' : 'var(--ink-4)'}`,
                        fontSize: 12,
                        color: 'var(--ink-2)',
                        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 500, color: 'var(--ink)' }}>{gap.description}</div>
                        {gap.expected_data && <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3 }}>{gap.expected_data}</div>}
                      </div>
                      <div style={{ flexShrink: 0, display: 'flex', gap: 6 }}>
                        {needsManualResolve && (
                          <button
                            disabled={resolvingGapId === gap.id}
                            onClick={async (e) => {
                              e.stopPropagation();
                              const note = prompt('Resolve this flag. What did you do? (optional, shown in the audit trail)');
                              if (note === null) return;
                              setResolvingGapId(gap.id);
                              try {
                                const res = await fetch('/api/resolve-gap', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ gap_id: gap.id, resolution: 'acknowledge', note }),
                                });
                                const data = await res.json();
                                if (!res.ok) alert(`Failed: ${data.error || 'unknown error'}`);
                                else onRefresh();
                              } catch (err) {
                                alert(`Failed: ${err instanceof Error ? err.message : err}`);
                              } finally {
                                setResolvingGapId(null);
                              }
                            }}
                            style={{
                              border: '1px solid var(--ink-4)',
                              background: 'transparent',
                              color: 'var(--ink-3)',
                              fontSize: 10, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase',
                              padding: '6px 10px',
                              cursor: resolvingGapId === gap.id ? 'wait' : 'pointer',
                              opacity: resolvingGapId === gap.id ? 0.5 : 1,
                            }}
                          >
                            {resolvingGapId === gap.id ? 'Working…' : 'Resolve'}
                          </button>
                        )}
                        {offStripeResolvable && (
                          <button
                            disabled={resolvingGapId === gap.id}
                            onClick={async (e) => {
                              e.stopPropagation();
                              const guestMatch = gap.description.match(/for\s+([^(]+)\s+\(/);
                              const guest = guestMatch ? guestMatch[1].trim() : 'this guest';
                              if (!confirm(`Mark as paid off-Stripe?\n\nThis will zero ${guest}'s Stripe fee and add that amount back to the owner payout. Use this only if the guest paid by check, wire, or ACH.`)) return;
                              setResolvingGapId(gap.id);
                              try {
                                const { res, cancelled } = await jsonWithFreezeRetry('/api/resolve-gap', 'POST',
                                  { gap_id: gap.id, resolution: 'paid_off_stripe' });
                                if (cancelled) return;
                                const data = await res.json();
                                if (!res.ok) alert(`Failed: ${data.error || 'unknown error'}`);
                                else onRefresh();
                              } catch (err) {
                                alert(`Failed: ${err instanceof Error ? err.message : err}`);
                              } finally {
                                setResolvingGapId(null);
                              }
                            }}
                            style={{
                              border: '1px solid var(--ink)',
                              background: 'transparent',
                              color: 'var(--ink)',
                              fontSize: 10, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase',
                              padding: '6px 10px',
                              cursor: resolvingGapId === gap.id ? 'wait' : 'pointer',
                              opacity: resolvingGapId === gap.id ? 0.5 : 1,
                            }}
                          >
                            {resolvingGapId === gap.id ? 'Working…' : 'Paid Off-Stripe'}
                          </button>
                        )}
                        {(gap.gap_type === 'cleaning_credit_override_unapplied' || gap.gap_type === 'cleaning_credit_override_collision') && (
                          <button
                            disabled={resolvingGapId === gap.id}
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!confirm('Remove this hand-applied credit?\n\nIt was not applied on the last rebuild, so nothing on the statement changes. If the charge is real, apply the credit again on its row afterward.')) return;
                              setResolvingGapId(gap.id);
                              try {
                                const res = await fetch('/api/resolve-gap', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ gap_id: gap.id, resolution: 'remove_credit_override' }),
                                });
                                const data = await res.json();
                                if (!res.ok) alert(`Failed: ${data.error || 'unknown error'}`);
                                else onRefresh();
                              } catch (err) {
                                alert(`Failed: ${err instanceof Error ? err.message : err}`);
                              } finally {
                                setResolvingGapId(null);
                              }
                            }}
                            style={{
                              border: '1px solid var(--ink)',
                              background: 'transparent',
                              color: 'var(--ink)',
                              fontSize: 10, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase',
                              padding: '6px 10px',
                              cursor: resolvingGapId === gap.id ? 'wait' : 'pointer',
                              opacity: resolvingGapId === gap.id ? 0.5 : 1,
                            }}
                          >
                            {resolvingGapId === gap.id ? 'Working…' : 'Remove hand credit'}
                          </button>
                        )}
                        {gap.gap_type === 'cancelled_reservation' && (
                          <button
                            disabled={resolvingGapId === gap.id}
                            onClick={async (e) => {
                              e.stopPropagation();
                              // First token only: expected_data is `reservation:CODE`, and any
                              // trailing annotation must never reach the route as part of the code.
                              const code = (gap.expected_data || '').replace(/^reservation:/, '').trim().split(/\s+/)[0] || '';
                              if (!code) { alert('No confirmation code on this gap.'); return; }
                              if (!confirm(`Remove this cancelled reservation from the statement?\n\nHelm re-verifies it's cancelled in Guesty, then deletes it and recomputes the owner payout. It won't touch a booking Guesty still shows as confirmed.`)) return;
                              setResolvingGapId(gap.id);
                              try {
                                const { res, cancelled } = await jsonWithFreezeRetry('/api/reservations/remove', 'POST',
                                  { confirmation_code: code, property_statement_id: prop.id });
                                if (cancelled) return;
                                const data = await res.json();
                                if (!res.ok) alert(`Failed: ${data.error || 'unknown error'}`);
                                else onRefresh();
                              } catch (err) {
                                alert(`Failed: ${err instanceof Error ? err.message : err}`);
                              } finally {
                                setResolvingGapId(null);
                              }
                            }}
                            style={{
                              border: '1px solid var(--negative)',
                              background: 'var(--negative)',
                              color: 'var(--paper)',
                              fontSize: 10, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase',
                              padding: '6px 10px',
                              cursor: resolvingGapId === gap.id ? 'wait' : 'pointer',
                              opacity: resolvingGapId === gap.id ? 0.5 : 1,
                            }}
                          >
                            {resolvingGapId === gap.id ? 'Removing…' : 'Remove from statement'}
                          </button>
                        )}
                        {fillable && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setFillingGap(gap); }}
                            style={{
                              border: '1px solid var(--ink)',
                              background: 'transparent',
                              color: 'var(--ink)',
                              fontSize: 10, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase',
                              padding: '6px 10px',
                              cursor: 'pointer',
                            }}
                          >
                            Fill Gap
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {fillingGap && (
            <FillGapModal
              gap={fillingGap}
              propertyId={prop.property_id}
              propertyName={prop.property_name}
              month={month}
              onClose={() => setFillingGap(null)}
              onSuccess={() => { setFillingGap(null); refreshWithQueue(); }}
            />
          )}

          {/* Send: the owner email and the two transfers for this home, in
              the order they happen. Was a row in the close-out grid at the
              bottom of the page; now one property is one place. */}
          <div id={`stmt-${prop.property_id}-send`} style={{ marginTop: 28, scrollMarginTop: 72 }}>
            <SectionHead
              num="06"
              title="Send"
              meta={ownerEmailMissing ? 'no owner email on file' : `to ${ownerGreeting}`}
              signal={ownerEmailMissing}
            />
            {!closeTaskKnown && (
              <div style={{ fontSize: 11, color: 'var(--negative)', marginBottom: 6 }}>
                The close-out ticks did not load. Retry from the notice at the top of the page.
              </div>
            )}
            <div className="flex items-center flex-wrap" style={{ gap: 14, padding: '8px 0', borderTop: '1px dotted var(--rule)', borderBottom: '1px dotted var(--rule)', fontSize: 12 }}>
              <select
                value={closeTask?.email_template || 'monthly'}
                onChange={(e) => onCloseTaskField({ email_template: e.target.value as EmailTemplate })}
                disabled={!closeTaskKnown}
                aria-label="Email template"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--rule)',
                  fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase',
                  color: 'var(--ink-3)',
                  padding: '5px 20px 5px 8px',
                  appearance: 'none',
                  cursor: 'pointer',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%23506068' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 4px center',
                  backgroundSize: '12px',
                }}
              >
                <option value="monthly">Monthly</option>
                <option value="touch_base">Touch-base</option>
                <option value="year_end">Year-end</option>
              </select>
              {/* Opt-in: fold the curated owner-request section into the
                  email. Persists like the template picker, so Draft All
                  honors it too. Curate the items in Preview. */}
              <CheckTask
                label={ownerActionCount > 0 ? `Owner requests (${ownerActionCount})` : 'Owner requests'}
                done={!!closeTask?.email_include_work_slips}
                disabled={!closeTaskKnown}
                onToggle={(next) => onCloseTaskField({ email_include_work_slips: next })}
              />
              <button
                type="button"
                onClick={onPreview}
                style={{
                  border: '1px solid var(--rule)',
                  background: 'transparent', color: 'var(--ink-3)',
                  fontSize: 10, fontWeight: 500, letterSpacing: '.12em', textTransform: 'uppercase',
                  padding: '5px 12px', cursor: 'pointer',
                }}
              >
                Preview
              </button>
              <CheckTask
                label="Drafted"
                done={!!closeTask?.email_drafted_at}
                disabled={!closeTaskKnown}
                onToggle={(next) => onCloseTaskField({ email_drafted_at: next ? new Date().toISOString() : null })}
              />
              {/* Statement sent -- the moment of finality. Stamped by hand
                  after the operator hits send in Gmail (Helm only creates
                  the draft, never sends). Ticking it also fires the Drive
                  archive: the statement PDF lands in Helm Records /
                  Statements / and its link shows beside the tick. */}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <CheckTask
                  label="Statement sent"
                  done={!!closeTask?.email_sent_at}
                  disabled={!closeTaskKnown}
                  onToggle={(next) => onMarkSent(next)}
                />
                {closeTask?.statement_drive_url && (
                  <a
                    href={closeTask.statement_drive_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 10, color: 'var(--tide-deep)', textDecoration: 'underline', textUnderlineOffset: 2 }}
                  >
                    PDF in Drive
                  </a>
                )}
              </span>
              <CheckTask
                label="Owner paid"
                done={!!closeTask?.owner_transfer_done_at}
                disabled={!closeTaskKnown}
                onToggle={(next) => onCloseTaskField({ owner_transfer_done_at: next ? new Date().toISOString() : null })}
              />
              <CheckTask
                label="Mgmt swept"
                done={!!closeTask?.mgmt_sweep_done_at}
                disabled={!closeTaskKnown}
                onToggle={(next) => onCloseTaskField({ mgmt_sweep_done_at: next ? new Date().toISOString() : null })}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: 24 }}>
            <button
              onClick={downloadStatement}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'var(--ink)', color: 'var(--paper)',
                fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase',
                padding: '10px 18px',
                cursor: 'pointer',
                border: 'none',
              }}
            >
              <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              View Statement
            </button>
            <button
              disabled={downloadingPdf}
              onClick={async (e) => {
                e.stopPropagation();
                setDownloadingPdf(true);
                setPdfError(null);
                try {
                  await downloadStatementPdf(prop.id, month);
                } catch (err) {
                  setPdfError(err instanceof Error ? err.message : 'Download failed');
                } finally {
                  setDownloadingPdf(false);
                }
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: downloadingPdf ? 'var(--paper-2)' : 'transparent',
                color: 'var(--ink-2)',
                fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase',
                padding: '10px 18px',
                border: '1px solid var(--ink)',
                cursor: downloadingPdf ? 'wait' : 'pointer',
                minWidth: 170,
                justifyContent: 'center',
              }}
            >
              {downloadingPdf ? (
                <>
                  <span style={{
                    width: 10, height: 10, borderRadius: '50%',
                    border: '1.5px solid var(--ink-3)', borderTopColor: 'transparent',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  Preparing PDF…
                </>
              ) : (
                <>
                  <IconDownload className="w-3 h-3" />
                  Download PDF
                </>
              )}
            </button>
            {pdfError && (
              <span style={{ fontSize: 11, color: 'var(--negative)' }}>{pdfError}</span>
            )}
            <Link
              href={statementsUploadHref(month, prop.property_id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'transparent', color: 'var(--ink-3)',
                fontSize: 11, fontWeight: 500, letterSpacing: '.08em', textTransform: 'uppercase',
                padding: '10px 18px',
                border: '1px solid var(--rule)',
              }}
            >
              Re-upload Data
            </Link>
            <Link
              href={`/properties/${prop.property_id}`}
              title="Open the installment splitter on the property page. It lists upcoming 30-night-plus bookings that span statement months."
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'transparent', color: 'var(--ink-3)',
                fontSize: 11, fontWeight: 500, letterSpacing: '.08em', textTransform: 'uppercase',
                padding: '10px 18px',
                border: '1px solid var(--rule)',
              }}
            >
              Multi-month bookings →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main Dashboard ─── */
function DashboardContent() {
  const [period, setPeriod] = useState<StatementPeriod | null>(null);
  const [periods, setPeriods] = useState<{ month: string; status: string }[]>([]);
  // True until the first month arrives. Never again: a refresh keeps the
  // page it has, and only a month switch swaps the body for a spinner.
  const [initialLoading, setInitialLoading] = useState(true);
  // 'no_data' only: the first-ever state, before any month exists.
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState('');
  // The month being loaded while a different one is on screen. The
  // masthead and the month select stay put; the body shows the spinner.
  const [switchingMonth, setSwitchingMonth] = useState<string | null>(null);
  // A load that left nothing to show: the first load, or a month switch.
  // month null means the month list itself failed.
  const [loadError, setLoadError] = useState<{ month: string | null; message: string } | null>(null);
  // A refresh that failed while the page still shows the last good numbers.
  const [refreshNotice, setRefreshNotice] = useState<{
    text: string;
    retry: { kind: 'month'; month: string } | { kind: 'statement'; id: string; name: string };
  } | null>(null);
  // Secondary reads fail on their own and say so, instead of taking down
  // the whole page with them.
  const [closeStateError, setCloseStateError] = useState<string | null>(null);
  const [ownerCfgError, setOwnerCfgError] = useState(false);
  // In-flight quiet refreshes, for the one-word indicator in the strip.
  const [refreshing, setRefreshing] = useState(0);
  // Bumped after a card action so the strip's counts re-read without
  // refetching every card's bank queue.
  const [countsRefresh, setCountsRefresh] = useState(0);
  // The month the page is showing, for callbacks that outlive a render.
  const shownMonthRef = useRef<string | null>(null);
  // The month last asked for. A slower answer for an earlier month is
  // dropped, so a quick September-then-August never lands on September.
  const requestedMonthRef = useRef<string | null>(null);
  // The month lives in the URL (/statements?month=YYYY-MM). The select
  // pushes it; the effect below loads whatever the URL names, which also
  // makes Back and Forward step between months.
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlMonth = searchParams.get('month');
  // A link to a month with no statements yet lands on the newest month
  // and says so, with the upload one click away.
  const [missingMonth, setMissingMonth] = useState<string | null>(null);
  // Map of legacy property_id ("21_horton") → count of open owner-action
  // work slips on that property. Loaded once on mount and refreshed
  // alongside period data, so the per-card badge stays in sync after a
  // bulk-action or owner-email send.
  const [ownerActionCounts, setOwnerActionCounts] = useState<Record<string, number>>({});
  // Owner name / email config, hydrated live from the `properties` table.
  // The static PROPERTIES map in lib/properties.ts is only a fallback for
  // properties not yet in the DB -- the DB is the source of truth, so an
  // owner-profile edit (name, email) on the property page shows up here
  // without a code change. Keyed by property_id.
  const [ownerCfg, setOwnerCfg] = useState<Record<string, { name: string; owner_greeting: string; owner_full: string; owner_emails: string[]; owner_id: string | null }>>({});
  const loadOwnerCfg = useCallback(async () => {
    // Owner emails/names are PII -- fetched server-side (service role) rather
    // than read directly off the anon key from the browser. See
    // src/app/statements/actions.ts. A failure falls back to the built-in
    // map (resolveCfg) and says so, rather than taking the page down.
    try {
      setOwnerCfg(await loadOwnerConfig());
      setOwnerCfgError(false);
    } catch {
      setOwnerCfgError(true);
    }
  }, []);
  // DB-first owner config for a property. When the DB row exists it wins
  // (fields it leaves blank fall back to the static map); otherwise the
  // static map is used. Returns null only when the property is in neither.
  const resolveCfg = useCallback((propertyId: string) => {
    const db = ownerCfg[propertyId];
    const stat = PROPERTIES[propertyId];
    if (db) {
      return {
        name: db.name || stat?.name || propertyId,
        owner_greeting: db.owner_greeting || stat?.owner_greeting || '',
        owner_full: db.owner_full || stat?.owner_full || '',
        owner_emails: db.owner_emails.length > 0 ? db.owner_emails : (stat?.owner_emails || []),
        owner_id: db.owner_id,
      };
    }
    if (stat) {
      // Static-const fallback: no owner_id exists here, so a property that
      // only resolves this way can never be shown as a combined owner. That
      // is the honest answer -- the draft route keys on the DB column.
      return { name: stat.name, owner_greeting: stat.owner_greeting, owner_full: stat.owner_full, owner_emails: stat.owner_emails, owner_id: null };
    }
    return null;
  }, [ownerCfg]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<
    | { total: number; matched: number; inserted: number; skipped: number }
    | string
    | null
  >(null);
  const [syncingGuesty, setSyncingGuesty] = useState(false);
  const [guestySyncResult, setGuestySyncResult] = useState<
    | {
        listings: number;
        reviews?: { fetched: number; upserted: number; skipped: number; error?: string };
        reservations?: { fetched: number; upserted: number; skipped: number; error?: string };
      }
    | string
    | null
  >(null);
  const [lastSync, setLastSync] = useState<Record<string, SyncHealthRow>>({});
  const [syncingStripe, setSyncingStripe] = useState(false);
  // Incremented on every period (re)load; threads into BankDepositReview
  // so the pending queue refetches after syncs land new rows.
  const [reviewRefresh, setReviewRefresh] = useState(0);
  // Aggregate pending count per property for the bank review queue --
  // unattributed deposits, unattributed debits, and parked vendor refunds
  // (source='vendor-refund') all live in bank_deposit_attributions, so one
  // property_id-only query covers the whole queue. The per-card
  // BankDepositReview still owns the row-level fetch.
  const [depositReviewCounts, setDepositReviewCounts] = useState<{ known: boolean; counts: Record<string, number> }>({ known: true, counts: {} });
  // Live on-file status for the month's two must-do uploads (Platform CSV,
  // Booking.com 5623 activity). Feeds the close-review strip and the two
  // upload cards, so "Month is clear" can't assert itself over a missing file.
  const [monthStatus, setMonthStatus] = useState<MonthDataStatus | null>(null);
  useEffect(() => {
    if (!selectedMonth) return;
    let cancelled = false;
    (async () => {
      const [review, status] = await Promise.all([
        // A thrown read is an unknown count, never a zero.
        loadDepositReviewCounts(selectedMonth).catch(() => ({ known: false, counts: {} as Record<string, number> })),
        loadMonthDataStatus(selectedMonth).catch(() => null),
      ]);
      if (cancelled) return;
      setDepositReviewCounts(review);
      setMonthStatus(status);
    })();
    return () => { cancelled = true; };
  }, [selectedMonth, reviewRefresh, countsRefresh]);
  // Broadcast from the close strip: open these cards at these sections,
  // queues unfolded, and land on the first. The token forces a re-open on
  // repeat clicks after a manual collapse.
  const [cardFocus, setCardFocus] = useState<{ token: number; targets: Record<string, CardSection>; first: string | null }>({ token: 0, targets: {}, first: null });
  const focusSections = useCallback((targets: Array<[propertyId: string, section: CardSection]>) => {
    if (targets.length === 0) return;
    setCardFocus(prev => ({ token: prev.token + 1, targets: Object.fromEntries(targets), first: targets[0][0] }));
  }, []);
  // Month-level inputs live above the cards, not in one.
  const scrollToId = useCallback((id: string) => {
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);
  const [stripeSyncResult, setStripeSyncResult] = useState<
    | {
        properties: number;
        fee_updates: number;
        refunds: number;
        gross_mismatches: number;
        gross_reconstructions: number;
        reconstructed_gain: number;
        missing_charges: number;
        orphan_charges: number;
        fee_unreadable: number;
        truncated_rebuilds: number;
        keyless: number;
        errors: string[];
      }
    | string
    | null
  >(null);
  const [fundsSentDate, setFundsSentDate] = useState<string>('');
  const [closeTasks, setCloseTasks] = useState<Record<string, CloseTask>>({});
  const [previewPropertyId, setPreviewPropertyId] = useState<string | null>(null);
  // Owner-request candidates for the email preview, keyed "propertyId:month".
  // Fetched lazily when the preview opens with the section on, via the same
  // loader /api/draft-email uses, so what the operator curates here is
  // literally what the draft composes.
  const [requestCandidates, setRequestCandidates] = useState<Record<string, PropertyRequestCandidates>>({});
  const [previewNotesLoading, setPreviewNotesLoading] = useState(false);

  // Every house this preview's email will cover: the previewed property plus
  // any sibling sharing its owner_id (Prudenzi, Moynahan get ONE email). The
  // curation panel needs all of them -- an operator who could only pick
  // items for one house would be signing off on a list they never saw.
  const previewHouses = useMemo(() => {
    if (!previewPropertyId) return [] as { propertyId: string; name: string }[];
    const cfg = resolveCfg(previewPropertyId);
    if (!cfg) return [];
    // Same source the render path uses: "has a statement this period" is
    // exactly what the draft route groups on.
    const siblings = (period?.property_statements || [])
      .filter(p => {
        if (p.property_id === previewPropertyId) return false;
        const sc = resolveCfg(p.property_id);
        return !!sc && !!sc.owner_id && sc.owner_id === cfg.owner_id;
      })
      .map(p => ({ propertyId: p.property_id, name: resolveCfg(p.property_id)?.name || p.property_name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [{ propertyId: previewPropertyId, name: cfg.name }, ...siblings];
  }, [previewPropertyId, period, resolveCfg]);

  /**
   * The statement's Repairs & Maint. line per property. Non-zero turns the
   * finished-work list into the itemization of a charge the owner is paying,
   * so the email can name the number they are looking at.
   *
   * repairs_total ONLY. Attributed debits used to be added in here, which
   * told an owner that a maintenance charge "covers" the work slips below it
   * while the number secretly included a guest refund (4 Brier Neck's
   * $3,000.00, August 2026). A refund covers no work.
   */
  const maintenanceChargeBy = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of period?.property_statements || []) {
      map[p.property_id] = Number(p.repairs_total || 0);
    }
    return map;
  }, [period]);

  /** property_statements.id per property, so the loader can offer the
   *  statement's own repair charges as itemization material. */
  const statementIdBy = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of period?.property_statements || []) map[p.property_id] = p.id;
    return map;
  }, [period]);

  const loadCandidatesFor = useCallback(async (propertyId: string, name: string, month: string, statementId?: string | null) => {
    const key = `${propertyId}:${month}`;
    setPreviewNotesLoading(true);
    try {
      const loaded = await loadOwnerRequestCandidatesAction(propertyId, name, month, statementId);
      setRequestCandidates(prev => ({ ...prev, [key]: loaded }));
    } catch {
      // Leave the key unset: the panel keeps saying "loading" rather than
      // showing an empty list, which would read as "nothing to ask about".
    } finally {
      setPreviewNotesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!previewPropertyId || !selectedMonth) return;
    if (!closeTasks[previewPropertyId]?.email_include_work_slips) return;
    const missing = previewHouses.filter(h => !requestCandidates[`${h.propertyId}:${selectedMonth}`]);
    if (missing.length === 0) return;
    let cancelled = false;
    setPreviewNotesLoading(true);
    Promise.all(missing.map(h =>
      loadOwnerRequestCandidatesAction(h.propertyId, h.name, selectedMonth, statementIdBy[h.propertyId] || null)))
      .then(results => {
        if (cancelled) return;
        setRequestCandidates(prev => {
          const next = { ...prev };
          results.forEach(r => { next[`${r.propertyId}:${selectedMonth}`] = r; });
          return next;
        });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setPreviewNotesLoading(false); });
    return () => { cancelled = true; };
  }, [previewPropertyId, selectedMonth, closeTasks, previewHouses, requestCandidates, statementIdBy]);
  const [draftingProperty, setDraftingProperty] = useState<string | null>(null);
  const [draftResult, setDraftResult] = useState<
    | { url: string; mailbox: string | null; property: string; attachedPdf: boolean; warnings: string[] }
    | string
    | null
  >(null);
  // The drafts land in the shared token's mailbox. The toasts link into it
  // only for the session that owns it and otherwise say whose it is.
  const sessionEmail = useSession().data?.user?.email;
  const [draftMailbox, setDraftMailbox] = useState<string | null>(null);
  const [transferListOpen, setTransferListOpen] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [remittanceOpen, setRemittanceOpen] = useState(false);
  // Booking.com deposit routing (sweep *5623 -> property accounts). Loaded
  // lazily on button click, same pattern as the remittance sheet.
  const [bookingRoutingOpen, setBookingRoutingOpen] = useState(false);
  const [loadingBookingRouting, setLoadingBookingRouting] = useState(false);
  const [bookingRoutingRows, setBookingRoutingRows] = useState<Array<{
    propertyShort: string;
    bankLast4: string | null;
    guest: string;
    code: string;
    stay: string;
    gross: number | null;
    tax: number;
    commission: number;
  }> | null>(null);
  const [addNoteOpen, setAddNoteOpen] = useState(false);
  const [periodNotesRefreshKey, setPeriodNotesRefreshKey] = useState(0);
  const [syncMenuOpen, setSyncMenuOpen] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  // Reconcile (compare what we emailed against what Helm now thinks).
  const [reconciling, setReconciling] = useState(false);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<{
    month: string;
    emails_found: number;
    emails_unparsed: { subject: string; sender: string; reason: string }[];
    rows: {
      property_id: string;
      property_name: string;
      emailed_payout: number | null;
      helm_payout: number | null;
      delta: number | null;
      email_message_id: string | null;
      email_sender: string | null;
      email_subject: string | null;
      email_date: string | null;
      status: 'matched' | 'diverged' | 'helm_only' | 'email_only' | 'no_amount_in_email';
    }[];
    gaps_written: number;
  } | string | null>(null);
  // Bulk-draft progress: tracks the current "n of N" while running. null
  // when idle. Used by the Draft All button label and to disable the button.
  const [bulkDraftProgress, setBulkDraftProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkDraftResult, setBulkDraftResult] = useState<
    | { drafted: number; skipped: number; failed: { property: string; error: string }[] }
    | string
    | null
  >(null);
  const [remittanceSheet, setRemittanceSheet] = useState<RemittanceSheet | null>(null);
  const [loadingRemittance, setLoadingRemittance] = useState(false);
  const [uploadingCsv, setUploadingCsv] = useState(false);
  const [csvResult, setCsvResult] = useState<
    | { parsed: number; reservations: number; reviews: number; unmatched: number }
    | string
    | null
  >(null);

  // Pulls every active work slip flagged owner_action_required, attaches
  // the Helm property name via the foreign-key join, and rolls up to a
  // {legacy_property_id: count} map. The map is keyed by the legacy
  // statements id (e.g. "21_horton") via a name → legacy-id reverse
  // lookup against PROPERTIES, so PropertyCard can look up its count
  // by prop.property_id directly.
  const loadOwnerActionCounts = useCallback(async () => {
    // Fetched server-side (service role): this embedded-join query touches
    // `properties` (PostgREST resource expansion requires SELECT on it even
    // though the literal .from() target is work_slips), same as the owner
    // PII/financial reads above. See src/app/statements/actions.ts.
    try {
      const counts = await loadOwnerActionCountsAction();
      setOwnerActionCounts(counts);
    } catch {
      // Non-fatal: the badge just won't appear. Avoid surfacing this in
      // the existing setError() since that would tank the whole dashboard.
      setOwnerActionCounts({});
    }
  }, []);

  /**
   * The close-out ticks and the funds-sent date. A failed read leaves the
   * ticks unknown and says so; Draft All and Finalize wait until it loads,
   * because an empty list would read as "nothing drafted, nothing sent".
   */
  const reloadCloseState = useCallback(async (periodId: string, month: string) => {
    try {
      const { tasks, funds_sent_date, error: readError } = await loadCloseStateAction(periodId);
      if (readError) throw new Error(readError);
      const map: Record<string, CloseTask> = {};
      (tasks as unknown as CloseTask[]).forEach((t: CloseTask) => { map[t.property_id] = t; });
      setCloseTasks(map);
      setFundsSentDate(funds_sent_date || defaultFundsSentDate(month));
      setCloseStateError(null);
    } catch (err) {
      setCloseStateError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  /**
   * Load a whole month. A different month swaps the body for a spinner
   * under the masthead; the same month (after a sync, Finalize, Check sent
   * emails) refreshes quietly: every card stays mounted, so the ones open
   * stay open and the page stays where it was scrolled. A quiet refresh
   * that fails keeps the numbers it had and says so with a Retry.
   */
  const loadPeriod = useCallback(async (month: string, opts: { quiet?: boolean } = {}) => {
    const quiet = !!opts.quiet && shownMonthRef.current === month;
    if (quiet) {
      setRefreshing(n => n + 1);
    } else {
      requestedMonthRef.current = month;
      setSwitchingMonth(month);
      setLoadError(null);
      // The Check sent emails result belongs to the month it ran on.
      setReconcileResult(null);
    }
    // Bump the review-queue token so each BankDepositReview refetches --
    // a Sync Stripe / ingest run may have queued new one-off charges.
    setReviewRefresh(n => n + 1);
    // Drop the month's sheets so the Remittance and Booking.com modals
    // never show a previous month's (or a pre-refresh) sheet. They
    // lazy-reload on next open.
    setRemittanceSheet(null);
    setBookingRoutingRows(null);
    try {
      // Period row + statements + per-property enrichment (reservations,
      // cleaning, repairs, gaps, drift probe) all happen server-side now --
      // same queries, one round trip, service role instead of the anon key.
      const res = await loadPeriodData(month);
      // Another month was asked for while this one loaded: that one wins.
      if (requestedMonthRef.current !== month) return;
      if ('error' in res) throw new Error(res.error);
      const periodData = res.period as unknown as StatementPeriod;
      const enrichedProps = res.props as unknown as PropertyStatement[];

      if (!quiet) setCloseTasks({});
      setPeriod({ ...periodData, property_statements: enrichedProps });
      setSelectedMonth(month);
      shownMonthRef.current = month;
      setRefreshNotice(null);
      await Promise.all([
        reloadCloseState(periodData.id, month),
        loadOwnerActionCounts(),
      ]);
    } catch (err) {
      if (requestedMonthRef.current !== month) return;
      const message = err instanceof Error ? err.message : JSON.stringify(err);
      if (quiet) {
        setRefreshNotice({
          text: `${monthLabel(month)} did not refresh (${message}). The numbers below are from the last good load.`,
          retry: { kind: 'month', month },
        });
      } else {
        setLoadError({ month, message });
      }
    } finally {
      if (quiet) setRefreshing(n => n - 1);
      else if (requestedMonthRef.current === month) setSwitchingMonth(null);
      setInitialLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Re-read one statement after an action on its card, and the strip's
   * counts with it. Nothing else reloads: no spinner, no other card
   * touched, the open cards stay open and the scroll stays put.
   */
  const refreshStatement = useCallback(async (statementId: string, propertyName: string) => {
    const month = shownMonthRef.current;
    if (!month) return;
    setRefreshing(n => n + 1);
    try {
      const res = await loadStatementData(month, statementId);
      if ('error' in res) throw new Error(res.error);
      const fresh = res.prop as unknown as PropertyStatement;
      setPeriod(prev => (prev && prev.month === month
        ? { ...prev, property_statements: (prev.property_statements || []).map(p => (p.id === statementId ? fresh : p)) }
        : prev));
      setRefreshNotice(null);
    } catch (err) {
      setRefreshNotice({
        text: `${propertyName} did not refresh (${err instanceof Error ? err.message : String(err)}). Its card may show the numbers from before your change.`,
        retry: { kind: 'statement', id: statementId, name: propertyName },
      });
    } finally {
      setRefreshing(n => n - 1);
      setCountsRefresh(n => n + 1);
    }
  }, []);

  const loadLastSync = useCallback(async () => {
    setLastSync(await loadLastSyncMap());
  }, []);


  async function saveFundsSentDate(iso: string) {
    setFundsSentDate(iso);
    if (!period) return;
    await saveFundsSentDateAction(period.id, iso);
  }

  async function createGmailDraft(propertyId: string) {
    if (!period) return;
    setDraftingProperty(propertyId);
    setDraftResult(null);
    try {
      const tmpl = closeTasks[propertyId]?.email_template || 'monthly';
      const includeWorkSlips = closeTasks[propertyId]?.email_include_work_slips || false;
      const { res, cancelled } = await jsonWithFreezeRetry('/api/draft-email', 'POST', {
        property_id: propertyId,
        month: selectedMonth,
        template: tmpl,
        include_work_slips: includeWorkSlips,
        funds_sent_date: fundsSentDate,
        period_id: period.id,
      });
      if (cancelled) return;
      const data = await res.json();
      if (!data.success) {
        setDraftResult(data.error || 'Draft creation failed');
      } else {
        const propName = PROPERTIES[propertyId]?.name || propertyId;
        setDraftResult({
          url: data.draft_url,
          mailbox: typeof data.mailbox === 'string' ? data.mailbox : null,
          property: propName,
          attachedPdf: !!data.attached_pdf,
          warnings: Array.isArray(data.warnings) ? data.warnings : [],
        });
        // Reflect the server-side stamp locally so the checkbox updates
        // without a reload. A forced redraft of a sent statement clears the
        // sent stamp server-side (cleared_sent_property_ids); mirror that
        // here so the UI never shows "sent" over an unfrozen statement.
        //
        // A combined owner draft (Prudenzi, Moynahan) covers several
        // properties and the route stamps close_tasks for all of them, so
        // stamp every covered id -- not just the one whose button was
        // clicked. Missing the sibling left its "Drafted" box empty until
        // reload, and clicking Draft on it produced a SECOND full combined
        // draft with both PDFs. Same handling draftAll already does.
        const covered: string[] = Array.isArray(data.covered_property_ids) && data.covered_property_ids.length > 0
          ? data.covered_property_ids
          : [propertyId];
        const clearedSent: string[] = Array.isArray(data.cleared_sent_property_ids) ? data.cleared_sent_property_ids : [];
        setCloseTasks(prev => {
          const next = { ...prev };
          for (const pid of covered) {
            const existing = prev[pid];
            next[pid] = {
              period_id: period.id,
              property_id: pid,
              email_template: (existing?.email_template || 'monthly') as CloseTask['email_template'],
              email_include_work_slips: existing?.email_include_work_slips || false,
              owner_request_items: existing?.owner_request_items || null,
              email_include_handled: existing?.email_include_handled || false,
              email_drafted_at: new Date().toISOString(),
              email_sent_at: clearedSent.includes(pid) ? null : (existing?.email_sent_at || null),
              owner_transfer_done_at: existing?.owner_transfer_done_at || null,
              mgmt_sweep_done_at: existing?.mgmt_sweep_done_at || null,
              notes: existing?.notes || null,
              statement_drive_url: existing?.statement_drive_url || null,
            };
          }
          for (const pid of clearedSent) {
            if (covered.includes(pid) || !next[pid]) continue;
            next[pid] = { ...next[pid], email_sent_at: null };
          }
          return next;
        });
        setPreviewPropertyId(null);
      }
    } catch (err) {
      setDraftResult(err instanceof Error ? err.message : 'Draft creation failed');
    } finally {
      setDraftingProperty(null);
    }
  }

  /**
   * Persist one house's per-item picks. Written on every tick and every
   * wording edit: /api/draft-email reads the STORED picks, never anything
   * the browser hands it, so an unsaved edit would silently not ship.
   */
  async function saveOwnerRequestSelections(propertyId: string, selections: OwnerRequestSelections) {
    if (!period) return;
    setCloseTasks(prev => {
      const existing = prev[propertyId];
      return {
        ...prev,
        [propertyId]: {
          period_id: period.id,
          property_id: propertyId,
          email_template: (existing?.email_template || 'monthly') as CloseTask['email_template'],
          email_include_work_slips: existing?.email_include_work_slips || false,
          email_include_handled: existing?.email_include_handled || false,
          email_drafted_at: existing?.email_drafted_at || null,
          email_sent_at: existing?.email_sent_at || null,
          owner_transfer_done_at: existing?.owner_transfer_done_at || null,
          mgmt_sweep_done_at: existing?.mgmt_sweep_done_at || null,
          notes: existing?.notes || null,
          statement_drive_url: existing?.statement_drive_url || null,
          owner_request_items: selections,
        },
      };
    });
    await saveOwnerRequestSelectionsAction(period.id, propertyId, selections);
  }

  /**
   * Save one close-out field. The box flips at once, as before, but the
   * write carries ONLY the changed field (closeTaskPatchRow). It used to
   * send this tab's whole copy of the row, so a tick in a tab loaded before
   * the statement was marked sent wrote email_sent_at and
   * statement_drive_url back as null: a sent statement unfrozen, and its
   * Drive link dropped, by an unrelated click. A failed save puts the field
   * back and says so; it used to look saved until a reload unticked it.
   * Resolves to whether the save landed.
   */
  async function saveCloseTaskField(propertyId: string, patch: Partial<CloseTask>): Promise<boolean> {
    if (!period) return false;
    const existing = closeTasks[propertyId];
    const before: CloseTask = {
      period_id: period.id,
      property_id: propertyId,
      email_template: existing?.email_template || 'monthly',
      email_include_work_slips: existing?.email_include_work_slips || false,
      owner_request_items: existing?.owner_request_items || null,
      email_include_handled: existing?.email_include_handled || false,
      email_drafted_at: existing?.email_drafted_at || null,
      email_sent_at: existing?.email_sent_at || null,
      owner_transfer_done_at: existing?.owner_transfer_done_at || null,
      mgmt_sweep_done_at: existing?.mgmt_sweep_done_at || null,
      notes: existing?.notes || null,
      statement_drive_url: existing?.statement_drive_url || null,
    };
    const merged: CloseTask = { ...before, ...patch };
    setCloseTasks(prev => ({ ...prev, [propertyId]: merged }));
    let saved: { ok: boolean; error: string | null };
    try {
      saved = await upsertCloseTask(closeTaskPatchRow(period.id, propertyId, patch));
    } catch (err) {
      saved = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (saved.ok) return true;
    // Put back only what this click changed, as it showed before the click,
    // and only if the page is still on the month the click was made in.
    const undo = Object.fromEntries(
      Object.keys(patch).map(k => [k, before[k as keyof CloseTask]]),
    ) as Partial<CloseTask>;
    setCloseTasks(prev => (prev[propertyId]?.period_id === before.period_id
      ? { ...prev, [propertyId]: { ...prev[propertyId], ...undo } }
      : prev));
    alert(`Save failed: ${saved.error || 'unknown error'}\n\nNothing was changed.`);
    return false;
  }

  /**
   * "Statement sent" toggle.
   *
   * Ticking ON stamps email_sent_at, then fires the Drive archive in the
   * background. The archive renders the statement PDF server-side (~10s)
   * and uploads it to Helm Records / Statements / <year>/<month>/; the
   * Drive link appears on the row when it resolves. Best-effort: an archive
   * failure leaves the box ticked and is logged server-side, never
   * surfaced as a blocking error. A stamp that failed to save archives
   * nothing, since the statement is not marked sent.
   *
   * Unticking is unfreezing: every payout writer (the nightly Stripe sync,
   * re-ingest, Fill Gap, attributions) decides whether it may move this
   * statement by reading the stamp. So it confirms first, in the operator's
   * terms, then goes through unmarkStatementSentAction, which files a
   * post_send_write flag on the statement BEFORE clearing and leaves the
   * sibling stamps alone. Never saveCloseTaskField: that path left no trace,
   * and upsertCloseTask now refuses it.
   */
  async function markStatementSent(p: PropertyStatement, next: boolean) {
    if (!period) return;
    if (!next) {
      if (!closeTasks[p.property_id]?.email_sent_at) return;
      // A finalized month stays frozen whatever the sent stamp says
      // (statement-finality.ts), so do not promise an unfreeze there.
      const message = period.status === 'final'
        ? `Unmark ${p.property_name} as sent? Its numbers stay frozen while ${monthLong(period.month)} is finalized, and become editable again if the month is reopened. The unmark is recorded on the statement.`
        : `Unmark ${p.property_name} as sent? Its numbers become editable again: the nightly Stripe sync, re-ingest, Fill Gap and bank attributions can move the owner payout with no override. The unmark is recorded on the statement.`;
      if (!confirm(message)) return;
      let r: { ok: boolean; error: string | null };
      try {
        r = await unmarkStatementSentAction({ periodId: period.id, propertyId: p.property_id, statementId: p.id });
      } catch (err) {
        r = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      if (!r.ok) {
        alert(`Unmark failed: ${r.error || 'unknown error'}`);
        return;
      }
      const periodId = period.id;
      setCloseTasks(prev => {
        const existing = prev[p.property_id];
        if (!existing || existing.period_id !== periodId) return prev;
        return { ...prev, [p.property_id]: { ...existing, email_sent_at: null } };
      });
      return;
    }
    if (!(await saveCloseTaskField(p.property_id, { email_sent_at: new Date().toISOString() }))) return;
    try {
      const res = await fetch('/api/archive-statement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statementId: p.id,
          month: period.month,
          periodId: period.id,
          propertyId: p.property_id,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; url?: string };
        if (data.ok && data.url) {
          const driveUrl = data.url;
          setCloseTasks(prev => {
            const existing = prev[p.property_id];
            if (!existing) return prev;
            return { ...prev, [p.property_id]: { ...existing, statement_drive_url: driveUrl } };
          });
        }
      }
    } catch {
      // Archive is best-effort; the checkbox is already saved.
    }
  }

  /**
   * First load: the month list. The effect below then loads the month the
   * URL names, or the newest. The sync health and the owner contacts are
   * secondary: each fails on its own, so neither can take the page down.
   */
  const init = useCallback(async () => {
    try {
      const res = await loadPeriodsList();
      if ('error' in res) throw new Error(res.error);
      const data = res.periods;
      if (!data || data.length === 0) { setError('no_data'); setInitialLoading(false); return; }
      setPeriods(data);
    } catch (err) {
      setLoadError({ month: null, message: err instanceof Error ? err.message : JSON.stringify(err) });
      setInitialLoading(false);
    }
    loadLastSync().catch(() => {});
    void loadOwnerCfg();
  }, [loadLastSync, loadOwnerCfg]);

  useEffect(() => {
    (async () => { await init(); })();
  }, [init]);

  // Load the month the URL names: on arrival, on a pick from the select,
  // and on Back/Forward. The live address bar is read, not the hook's
  // snapshot, which can report an empty query mid-transition (the /work
  // board lost its open groups to that, #1200); the hook value is only the
  // change signal. No month in the URL means the newest month.
  useEffect(() => {
    if (periods.length === 0) return;
    const live = new URLSearchParams(window.location.search).get('month');
    const known = isStatementMonth(live) && periods.some(p => p.month === live);
    const target = known ? live : periods[0].month;
    (async () => {
      if (isStatementMonth(live) && !known) {
        setMissingMonth(live);
        router.replace(statementsHref(target), { scroll: false });
      }
      if (target === shownMonthRef.current || target === requestedMonthRef.current) return;
      await loadPeriod(target);
    })();
  }, [urlMonth, periods, loadPeriod, router]);

  async function syncInvoices() {
    if (!selectedMonth) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/sync-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: selectedMonth }),
      });
      const data = await res.json();
      if (data.success) {
        setSyncResult({ total: data.total_invoices_found, matched: data.matched, inserted: data.inserted, skipped: data.skipped });
        await loadPeriod(selectedMonth, { quiet: true });
        await loadLastSync();
      } else {
        // A dead Gmail token during close must never read as "no invoices
        // this month" -- surface the failure loudly.
        setSyncResult(data.error || 'Invoice sync failed (Gmail token?)');
      }
    } catch (err) {
      setSyncResult(err instanceof Error ? err.message : 'Invoice sync failed');
    } finally {
      setSyncing(false);
    }
  }

  /**
   * Load the accountant's remittance sheet for the current month. The whole
   * computation lives in lib/remittance.ts and runs server-side: it reads
   * guesty_reservations.folio_items, which is the only trustworthy source
   * for occupancy tax and for the pre-tax guest total a channel commissions
   * on, and which is far too heavy to ship to the browser. Lazy on button
   * click so the dashboard doesn't pay for it on every load.
   */
  async function loadRemittance() {
    setLoadingRemittance(true);
    try {
      setRemittanceSheet(await loadRemittanceSheet(selectedMonth));
    } finally {
      setLoadingRemittance(false);
    }
  }

  /**
   * Build the Booking.com deposit-routing rows for the current month: one
   * per Booking.com reservation on this month's statements. amount = the
   * gross Booking deposited (guesty_reservations.total_paid), which is the
   * cash to sweep from *5623 to the property account. tax + commission are
   * carried through for the reconciliation sub-line only. Read-only; touches
   * no statement totals. Lazy on button click, mirrors loadRemittance.
   */
  async function loadBookingRouting() {
    setLoadingBookingRouting(true);
    try {
      const allCodes: string[] = [];
      props.forEach(p => (p.reservations || []).forEach(r => { if (r.confirmation_code) allCodes.push(r.confirmation_code); }));
      const guestyRows = await loadGuestyRowsByCodes(allCodes);
      const byCode = new Map<string, { total_paid: number | null; total_taxes: number | null; channel_commission: number | null }>();
      (guestyRows || []).forEach(g => { if (g.confirmation_code) byCode.set(g.confirmation_code, g); });

      const stayFmt = (ci: string, co: string) =>
        `${fmtDate(ci)} → ${fmtDate(co)}`;

      const rows: NonNullable<typeof bookingRoutingRows> = [];
      for (const p of props) {
        for (const r of p.reservations || []) {
          if (!(r.platform || '').toUpperCase().includes('BOOKING')) continue;
          const g = byCode.get(r.confirmation_code);
          const grossRaw = g?.total_paid;
          rows.push({
            propertyShort: PROPERTIES[p.property_id]?.name || p.property_name,
            bankLast4: PROPERTIES[p.property_id]?.bank_last4 ?? null,
            guest: r.guest_name || 'Guest',
            code: r.confirmation_code || '—',
            stay: stayFmt(r.check_in, r.check_out),
            gross: grossRaw != null ? Math.round(Number(grossRaw) * 100) / 100 : null,
            tax: Math.round(Number(g?.total_taxes || 0) * 100) / 100,
            commission: Math.round(Number(g?.channel_commission || 0) * 100) / 100,
          });
        }
      }
      setBookingRoutingRows(rows);
    } finally {
      setLoadingBookingRouting(false);
    }
  }

  async function syncStripe() {
    if (!selectedMonth) return;
    setSyncingStripe(true);
    setStripeSyncResult(null);
    try {
      const res = await fetch('/api/sync-stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: selectedMonth }),
      });
      const data = await res.json();
      if (!data.success) {
        setStripeSyncResult(data.error || 'Sync failed');
        return;
      }
      // Aggregate across properties for the toast summary.
      type Pr = {
        fee_updates: unknown[]; refunds_detected: unknown[]; gross_mismatches: unknown[];
        gross_reconstructions?: { prev_net: number; next_net: number }[];
        reservations_missing_charge: unknown[]; unmatched_charges: unknown[]; error?: string;
        fee_unreadable?: unknown[]; collected_rebuild_truncated?: unknown[]; no_stripe_key?: boolean;
      };
      const rs: Pr[] = data.results || [];
      const agg = {
        properties: rs.length,
        fee_updates: rs.reduce((s, p) => s + (p.fee_updates?.length || 0), 0),
        refunds: rs.reduce((s, p) => s + (p.refunds_detected?.length || 0), 0),
        gross_mismatches: rs.reduce((s, p) => s + (p.gross_mismatches?.length || 0), 0),
        gross_reconstructions: rs.reduce((s, p) => s + (p.gross_reconstructions?.length || 0), 0),
        reconstructed_gain: rs.reduce((s, p) => s + (p.gross_reconstructions || []).reduce((t, g) => t + (g.next_net - g.prev_net), 0), 0),
        missing_charges: rs.reduce((s, p) => s + (p.reservations_missing_charge?.length || 0), 0),
        orphan_charges: rs.reduce((s, p) => s + (p.unmatched_charges?.length || 0), 0),
        fee_unreadable: rs.reduce((s, p) => s + (p.fee_unreadable?.length || 0), 0),
        truncated_rebuilds: rs.reduce((s, p) => s + (p.collected_rebuild_truncated?.length || 0), 0),
        keyless: rs.filter(p => p.no_stripe_key).length,
        errors: rs.filter(p => p.error).map(p => p.error as string),
      };
      setStripeSyncResult(agg);
      await loadPeriod(selectedMonth, { quiet: true });
      await loadLastSync();
    } catch (err) {
      setStripeSyncResult(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncingStripe(false);
    }
  }

  async function syncGuesty() {
    setSyncingGuesty(true);
    setGuestySyncResult(null);
    try {
      const res = await fetch('/api/sync-guesty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        setGuestySyncResult({
          listings: data.listings_mapped,
          reviews: data.reviews,
          reservations: data.reservations,
        });
        await loadLastSync();
      } else {
        setGuestySyncResult(data.error || 'Sync failed');
      }
    } catch (err) {
      setGuestySyncResult(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncingGuesty(false);
    }
  }

  /**
   * Run all three syncs sequentially (Invoices, Bookings, Stripe). The
   * individual sync functions own their own toast results; this just
   * orchestrates them in order so the operator can hit one button at
   * the start of a close instead of three. Each leg surfaces its own
   * failure toast; the chain runs to completion because the three legs
   * are independent (Gmail, Guesty, Stripe).
   */
  async function syncAll() {
    setSyncingAll(true);
    setSyncMenuOpen(false);
    try {
      await syncInvoices();
      await syncGuesty();
      await syncStripe();
    } finally {
      setSyncingAll(false);
    }
  }

  /**
   * End-of-month verification: search Gmail for owner-statement sends
   * in this period, parse payout amounts out of message snippets, and
   * compare against what Helm currently thinks. Surfaces any divergence
   * as a `data_gaps` row of type 'email_payout_mismatch' so the existing
   * gap-resolution flow on each property card carries the explanation.
   */
  async function runReconcile() {
    if (!selectedMonth) return;
    setReconciling(true);
    setReconcileResult(null);
    setReconcileOpen(true);
    try {
      const res = await fetch('/api/reconcile-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: selectedMonth }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setReconcileResult(data.error || 'Reconcile failed');
        return;
      }
      setReconcileResult(data);
      // Refresh the period so any newly-written gap rows surface on
      // their property cards immediately. Quiet, so the result above
      // stays on screen.
      await loadPeriod(selectedMonth, { quiet: true });
    } catch (err) {
      setReconcileResult(err instanceof Error ? err.message : 'Reconcile failed');
    } finally {
      setReconciling(false);
    }
  }

  /**
   * Bulk-draft Gmail emails for every property in the current month
   * that's "ready": confidence !== 'red' (so the math is at least
   * partially trustworthy) and no existing email_drafted_at stamp.
   *
   * Sequential, not parallel: Gmail API rate-limits aggressively when
   * many drafts hit in flight, and each draft renders a PDF via
   * headless Chromium which is memory-heavy. Sequential is also nicer
   * for the progress indicator since the operator sees "3 of 9" tick
   * forward steadily.
   */
  async function draftAll() {
    if (!period) return;
    const candidates = props.filter(p =>
      p.confidence !== 'red' &&
      !closeTasks[p.property_id]?.email_drafted_at,
    );
    if (candidates.length === 0) {
      setBulkDraftResult('All eligible statements are already drafted.');
      return;
    }
    // Pre-flight: numbers that are still moving should not get drafted into
    // owner emails without the operator saying so. Count the live problems
    // and make skipping them an explicit choice, not a default.
    const openGaps = props.reduce((s, p) => s + (p.data_gaps?.filter(g => !g.resolved).length || 0), 0);
    const pendingBankRows = Object.values(depositReviewCounts.counts).reduce((s, n) => s + n, 0);
    const driftCount = props.reduce((s, p) => s + (p.drift_bookings?.length || 0), 0);
    const problems: string[] = [];
    if (openGaps > 0) problems.push(`${openGaps} open data gap${openGaps === 1 ? '' : 's'}`);
    if (pendingBankRows > 0) problems.push(`${pendingBankRows} bank row${pendingBankRows === 1 ? '' : 's'} awaiting review`);
    if (driftCount > 0) problems.push(`${driftCount} new paid booking${driftCount === 1 ? '' : 's'} not yet on a statement`);
    if (!depositReviewCounts.known) problems.push('bank review queue unreadable (count unknown)');
    if (props.some(p => p.drift_known === false)) problems.push('new-booking check unreadable (drift count unknown)');
    if (props.some(p => p.gaps_known === false)) problems.push('gap list unreadable (a statement may be carrying flags this page cannot show)');
    // Not a blocker: see the close-review strip. The operator cannot clear
    // these from Helm, so blocking every draft on them would train them to
    // click through the confirm without reading it.
    if (problems.length > 0 && !confirm(
      `This month still has:\n\n  · ${problems.join('\n  · ')}\n\nDraft ${candidates.length} owner email${candidates.length === 1 ? '' : 's'} anyway?`,
    )) {
      return;
    }
    setBulkDraftProgress({ done: 0, total: candidates.length });
    setBulkDraftResult(null);

    let drafted = 0;
    // Siblings of a combined owner email (Prudenzi, Moynahan) no-op inside
    // the loop rather than being filtered out before it, so without this
    // they land in neither `drafted` nor `skipped` and the toast silently
    // under-reports (15 ready, 14 drafted, 0 skipped).
    let coveredByGroup = 0;
    const failed: { property: string; error: string }[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const p = candidates[i];
      const tmpl = closeTasks[p.property_id]?.email_template || 'monthly';
      try {
        const { res, cancelled } = await jsonWithFreezeRetry('/api/draft-email', 'POST', {
          property_id: p.property_id,
          month: selectedMonth,
          template: tmpl,
          include_work_slips: closeTasks[p.property_id]?.email_include_work_slips || false,
          funds_sent_date: fundsSentDate,
          period_id: period.id,
          // Lets the route no-op a sibling already covered by a combined
          // owner draft earlier in this same loop (multi-property owners
          // get ONE email; both siblings sit in `candidates`).
          bulk: true,
        });
        if (cancelled) {
          failed.push({ property: p.property_name, error: 'skipped: already marked sent (override declined)' });
          setBulkDraftProgress({ done: i + 1, total: candidates.length });
          continue;
        }
        const data = await res.json();
        if (data.success) {
          if (data.already_drafted) coveredByGroup++;
          else drafted++;
          if (typeof data.mailbox === 'string') setDraftMailbox(data.mailbox);
          // Reflect the server-side stamp locally so the property card's
          // "drafted" state updates without a reload, same as the
          // single-property createGmailDraft flow does. A combined owner
          // draft covers several properties -- stamp them all.
          const covered: string[] = Array.isArray(data.covered_property_ids) && data.covered_property_ids.length > 0
            ? data.covered_property_ids
            : [p.property_id];
          const clearedSent: string[] = Array.isArray(data.cleared_sent_property_ids) ? data.cleared_sent_property_ids : [];
          setCloseTasks(prev => {
            const next = { ...prev };
            for (const pid of covered) {
              const existing = prev[pid];
              next[pid] = {
                period_id: period.id,
                property_id: pid,
                email_template: (existing?.email_template || 'monthly') as CloseTask['email_template'],
                email_include_work_slips: existing?.email_include_work_slips || false,
                owner_request_items: existing?.owner_request_items || null,
                email_include_handled: existing?.email_include_handled || false,
                email_drafted_at: new Date().toISOString(),
                email_sent_at: clearedSent.includes(pid) ? null : (existing?.email_sent_at || null),
                owner_transfer_done_at: existing?.owner_transfer_done_at || null,
                mgmt_sweep_done_at: existing?.mgmt_sweep_done_at || null,
                notes: existing?.notes || null,
                statement_drive_url: existing?.statement_drive_url || null,
              };
            }
            return next;
          });
        } else {
          failed.push({ property: p.property_name, error: data.error || 'unknown error' });
        }
      } catch (err) {
        failed.push({ property: p.property_name, error: err instanceof Error ? err.message : 'request failed' });
      }
      setBulkDraftProgress({ done: i + 1, total: candidates.length });
    }

    setBulkDraftProgress(null);
    setBulkDraftResult({
      drafted,
      skipped: (props.length - candidates.length) + coveredByGroup,
      failed,
    });
  }

  /* ─── Empty / Error States (editorial) ─── */
  if (error === 'no_data') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--paper)' }}>
        <div style={{ textAlign: 'center', maxWidth: 420, padding: '0 24px' }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>No statements yet</div>
          <h1 className="font-serif" style={{ fontSize: 36, fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--ink)', lineHeight: 1.1 }}>
            Upload your first <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>owner statement</em> to get started.
          </h1>
          <Link href={statementsUploadHref(selectedMonth)} style={{
            display: 'inline-flex', marginTop: 28,
            background: 'var(--ink)', color: 'var(--paper)',
            fontSize: 11, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase',
            padding: '12px 24px',
          }}>
            Upload Data
          </Link>
        </div>
      </div>
    );
  }

  // The masthead, the money strip and the month select render in every
  // state below, so a month switch or a failed load never blanks the frame
  // and the operator can always pick another month.
  const shownMonth = switchingMonth || loadError?.month || selectedMonth;
  const frame = (
    <>
      {/* Use the shared HelmMasthead so /statements matches every other module
          on the logo, wordmark, nav, search trigger, and user menu. The
          Period dropdown rides in the rightContent slot. The bespoke close-
          of-month actions strip below is its own non-sticky section. */}
      <HelmMasthead
        rightContent={
          <select
            value={shownMonth}
            onChange={(e) => {
              if (e.target.value === '__new__') {
                router.push(statementsUploadHref(previousCalendarMonth()));
                return;
              }
              setMissingMonth(null);
              router.push(statementsHref(e.target.value), { scroll: false });
            }}
            aria-label="Statement period"
            className="font-serif"
            style={{
              background: 'transparent',
              border: '1px solid var(--rule)',
              color: 'var(--ink)',
              fontSize: 15,
              fontWeight: 500,
              padding: '4px 24px 4px 10px',
              outline: 'none',
              cursor: 'pointer',
              appearance: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%23506068' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 6px center',
              backgroundSize: '14px',
            }}
          >
            {periods.map(p => (
              <option key={p.month} value={p.month}>{monthLabel(p.month)}</option>
            ))}
            <option disabled style={{ color: 'var(--ink-4)' }}>──────────</option>
            <option value="__new__">+ New month…</option>
          </select>
        }
      />
      <FinancialsTabs current="statements" />
    </>
  );

  if (loadError || initialLoading || switchingMonth || !period) {
    const retry = () => {
      if (loadError?.month) { void loadPeriod(loadError.month); return; }
      setLoadError(null);
      setInitialLoading(true);
      void init();
    };
    return (
      <div className="min-h-screen" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        {frame}
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 72, paddingBottom: 72 }}>
          {loadError ? (
            <div style={{ textAlign: 'center', maxWidth: 520, margin: '0 auto' }}>
              <div className="eyebrow" style={{ marginBottom: 14, color: 'var(--negative)' }}>Did not load</div>
              <h1 className="font-serif" style={{ fontSize: 28, fontWeight: 300, color: 'var(--ink)', lineHeight: 1.2 }}>
                {loadError.month ? `${monthLabel(loadError.month)} statements did not load.` : 'The statement months did not load.'}
              </h1>
              <pre className="font-mono" style={{
                color: 'var(--negative)',
                fontSize: 11,
                background: 'var(--paper-2)',
                borderLeft: '3px solid var(--negative)',
                padding: '12px 16px',
                marginTop: 18,
                textAlign: 'left',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}>{loadError.message}</pre>
              <button
                type="button"
                onClick={retry}
                style={{
                  marginTop: 18,
                  background: 'var(--ink)', color: 'var(--paper)', border: 'none',
                  fontSize: 11, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
                  padding: '10px 22px', cursor: 'pointer',
                }}
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center" style={{ gap: 14 }}>
              <span style={{
                width: 24, height: 24, borderRadius: '50%',
                border: '2px solid var(--ink)', borderTopColor: 'transparent',
                animation: 'spin 0.8s linear infinite',
              }} />
              <p className="eyebrow">{shownMonth ? `Loading ${monthLabel(shownMonth)}` : 'Loading statements'}</p>
            </div>
          )}
        </section>
      </div>
    );
  }

  const props = period.property_statements || [];
  const totalPayout = props.reduce((s, p) => s + p.owner_payout, 0);
  const totalRevenue = props.reduce((s, p) => s + p.rental_revenue, 0);
  const totalMgmt = props.reduce((s, p) => s + p.management_fee, 0);
  const totalCleaning = props.reduce((s, p) => s + p.cleaning_total, 0);
  const totalStays = props.reduce((s, p) => s + p.num_stays, 0);

  return (
    <div className="min-h-screen" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      {frame}

      {/* ─── ACTIONS STRIP ───
          Module-specific close-of-month controls. Lives directly under the
          masthead with a thin rule divider. Until 2026-05-06 this was three
          separate sync buttons plus a CSV-upload label, which crowded the
          strip and forced three sequential clicks at the start of every
          close. Now: a single "Sync ▾" dropdown that bundles all four data
          sources + a "Sync All" entry, so close-of-month is one click. The
          Reservations CSV fallback lives inside the dropdown because it's
          used rarely (only when the Guesty API sync is down). Add Note and
          Draft All sit next to it as primary workflow actions. */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', borderBottom: '1px solid var(--ink)' }}>
        <div>
          <div className="rt-masthead-actions flex items-center justify-between gap-3" style={{ padding: '10px 0' }}>
            <div className="flex items-center gap-2">
              <div style={{ position: 'relative' }}>
                {(() => {
                  const failing = STATEMENT_SYNC_SOURCES.filter(s => lastSync[s]?.last_status === 'error');
                  const freshest = [lastSync['gmail-invoices'], lastSync['guesty-reviews'], lastSync['stripe']]
                    .map(r => r?.last_synced_at)
                    .filter((t): t is string => !!t)
                    .sort()
                    .reverse()[0];
                  return (
                    <EditorialButton
                      onClick={() => setSyncMenuOpen(o => !o)}
                      disabled={syncingAll}
                      busy={syncing || syncingGuesty || syncingStripe || syncingAll}
                      label={
                        syncingAll ? 'Syncing all…'
                        : syncing ? 'Syncing invoices…'
                        : syncingGuesty ? 'Syncing bookings…'
                        : syncingStripe ? 'Syncing Stripe…'
                        : 'Sync ▾'
                      }
                      meta={
                        failing.length > 0
                          ? `${failing.length} feed${failing.length === 1 ? '' : 's'} failing`
                          : freshest ? `last ${relativeTime(freshest)}` : undefined
                      }
                      metaAlert={failing.length > 0}
                      icon={<IconSync className="w-3 h-3" />}
                    />
                  );
                })()}
                {syncMenuOpen && (
                  <>
                    {/* Click-outside backdrop */}
                    <div
                      onClick={() => setSyncMenuOpen(false)}
                      style={{ position: 'fixed', inset: 0, zIndex: 60 }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        left: 0,
                        zIndex: 70,
                        minWidth: 280,
                        background: 'var(--paper)',
                        border: '1px solid var(--ink)',
                        boxShadow: '0 12px 32px -10px rgba(30,46,52,.2)',
                      }}
                    >
                      <SyncMenuItem
                        label="Sync All"
                        meta="invoices, bookings, Stripe"
                        primary
                        onClick={() => syncAll()}
                      />
                      <div style={{ borderTop: '1px solid var(--rule)' }} />
                      {(() => {
                        const inv = syncMeta(lastSync['gmail-invoices']);
                        // The revenue-bearing feed is guesty-reservations; the
                        // reviews/listings stamps ride along. Show the worst.
                        const bk = worstSyncMeta([
                          lastSync['guesty-reservations'], lastSync['guesty-reviews'],
                          lastSync['guesty-listings'], lastSync['guesty-cancel-reconcile'],
                        ]);
                        const st = syncMeta(lastSync['stripe']);
                        return (
                          <>
                            <SyncMenuItem
                              label="Sync Invoices"
                              meta={inv.text} metaAlert={inv.alert} metaDetail={inv.detail}
                              onClick={() => { setSyncMenuOpen(false); syncInvoices(); }}
                            />
                            <SyncMenuItem
                              label="Sync Bookings"
                              meta={bk.text} metaAlert={bk.alert} metaDetail={bk.detail}
                              onClick={() => { setSyncMenuOpen(false); syncGuesty(); }}
                            />
                            <SyncMenuItem
                              label="Sync Stripe"
                              meta={st.text} metaAlert={st.alert} metaDetail={st.detail}
                              onClick={() => { setSyncMenuOpen(false); syncStripe(); }}
                            />
                          </>
                        );
                      })()}
                      <div style={{ borderTop: '1px solid var(--rule)' }} />
                      <label
                        title={lastSync['csv-fallback']?.last_synced_at
                          ? `Reservations CSV uploaded ${relativeTime(lastSync['csv-fallback'].last_synced_at)}`
                          : 'Guesty reservations CSV fallback. Use only when the Guesty API sync is down.'}
                        style={{
                          display: 'block',
                          padding: '10px 14px',
                          fontSize: 11, color: 'var(--ink-3)',
                          letterSpacing: '.08em', textTransform: 'uppercase',
                          cursor: uploadingCsv ? 'wait' : 'pointer',
                          background: uploadingCsv ? 'var(--paper-2)' : 'transparent',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                          <span style={{ fontWeight: 500 }}>
                            {uploadingCsv ? 'Uploading…' : 'Upload Reservations CSV'}
                          </span>
                          <span style={{
                            color: 'var(--ink-4)', fontWeight: 400, letterSpacing: 0,
                            textTransform: 'none', fontSize: 10,
                          }}>
                            fallback
                          </span>
                        </div>
                        {lastSync['csv-fallback']?.last_synced_at && !uploadingCsv && (
                          <div style={{ color: 'var(--ink-4)', fontWeight: 400, letterSpacing: 0, textTransform: 'none', fontSize: 10, marginTop: 2 }}>
                            last {relativeTime(lastSync['csv-fallback'].last_synced_at)}
                          </div>
                        )}
                        <input
                          type="file"
                          accept=".csv"
                          className="hidden"
                          disabled={uploadingCsv}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setSyncMenuOpen(false);
                            setUploadingCsv(true);
                            setCsvResult(null);
                            try {
                              const text = await file.text();
                              const res = await fetch('/api/ingest-guesty-csv', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ csv: text }),
                              });
                              const data = await res.json();
                              if (data.success) {
                                setCsvResult({
                                  parsed: data.parsed,
                                  reservations: data.reservations_upserted,
                                  reviews: data.reviews_upserted,
                                  unmatched: data.unmatched_listings,
                                });
                                await loadLastSync();
                              } else {
                                setCsvResult(data.error || 'Upload failed');
                              }
                            } catch (err) {
                              setCsvResult(err instanceof Error ? err.message : 'Upload failed');
                            } finally {
                              setUploadingCsv(false);
                              e.target.value = '';
                            }
                          }}
                        />
                      </label>
                    </div>
                  </>
                )}
              </div>
              <EditorialButton
                onClick={() => setAddNoteOpen(true)}
                label="Add Note"
                icon={
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                }
              />
              <EditorialButton
                onClick={draftAll}
                disabled={!!bulkDraftProgress || props.length === 0 || !!closeStateError}
                busy={!!bulkDraftProgress}
                label={
                  bulkDraftProgress
                    ? `Drafting ${bulkDraftProgress.done}/${bulkDraftProgress.total}…`
                    : 'Draft All'
                }
                meta={(() => {
                  // "Ready to draft" is the strip's word for a reviewed
                  // statement; Draft All drafts every one not yet drafted
                  // (red confidence aside), reviewed or not, after a confirm.
                  const eligible = props.filter(p => p.confidence !== 'red' && !closeTasks[p.property_id]?.email_drafted_at).length;
                  return eligible > 0 ? `${eligible} not drafted` : 'all drafted';
                })()}
                icon={
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                }
              />
              <EditorialButton
                onClick={runReconcile}
                disabled={reconciling || !selectedMonth}
                busy={reconciling}
                label={reconciling ? 'Reconciling…' : 'Reconcile Sends'}
                meta="email vs DB"
                icon={
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7M5 12h14" />
                  </svg>
                }
              />
            </div>
            <div className="flex items-center gap-3">
              {refreshing > 0 && (
                <span className="eyebrow" aria-live="polite" style={{ color: 'var(--ink-4)' }}>Refreshing…</span>
              )}
              <Link href={statementsUploadHref(selectedMonth)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'var(--ink)', color: 'var(--paper)',
                fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase',
                padding: '7px 14px',
              }}>
                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Upload Month
              </Link>
            </div>
          </div>
        </div>
      </section>

      {missingMonth && (
        <Toast
          tone="tide"
          onDismiss={() => setMissingMonth(null)}
          action={{ label: `Upload ${monthLong(missingMonth)}`, onClick: () => router.push(statementsUploadHref(missingMonth)) }}
        >
          There are no statements for {monthLabel(missingMonth)} yet, so this is {monthLabel(selectedMonth)}.
        </Toast>
      )}

      {/* ─── Read failures ─── each says what it costs and offers a Retry;
           none of them takes the rest of the page down. */}
      {refreshNotice && (
        <Toast
          tone="negative"
          onDismiss={() => setRefreshNotice(null)}
          action={{
            label: 'Retry',
            onClick: () => {
              const r = refreshNotice.retry;
              if (r.kind === 'month') void loadPeriod(r.month, { quiet: true });
              else void refreshStatement(r.id, r.name);
            },
          }}
        >
          {refreshNotice.text}
        </Toast>
      )}
      {closeStateError && (
        <Toast tone="negative" action={{ label: 'Retry', onClick: () => { void reloadCloseState(period.id, period.month); } }}>
          The close-out ticks did not load ({closeStateError}), so Drafted and Sent below are unknown. Draft All and Finalize wait until they load.
        </Toast>
      )}
      {ownerCfgError && (
        <Toast tone="tide" action={{ label: 'Retry', onClick: () => { void loadOwnerCfg(); } }}>
          Owner contacts did not load, so email previews show the built-in names and addresses. The Gmail draft reads the live ones.
        </Toast>
      )}

      {/* ─── Sync toasts ─── */}
      {syncResult && (
        typeof syncResult === 'string' ? (
          <Toast tone="negative" onDismiss={() => setSyncResult(null)}>
            Invoice sync failed: {syncResult}. Cleaning attribution did NOT run for this month.
          </Toast>
        ) : (
          <Toast tone="positive" onDismiss={() => setSyncResult(null)}>
            Matched <strong>{syncResult.matched}</strong> of <strong>{syncResult.total}</strong> cleaning invoices to bank charges (<strong>{syncResult.inserted}</strong> new, <strong>{syncResult.skipped}</strong> skipped). The dashboard has refreshed automatically.
          </Toast>
        )
      )}
      {guestySyncResult && (
        typeof guestySyncResult === 'string' ? (
          <Toast tone="negative" onDismiss={() => setGuestySyncResult(null)}>
            Guesty sync failed: {guestySyncResult}. If urgent, click <strong>Upload Reservations CSV</strong> instead.
          </Toast>
        ) : (
          <Toast tone="tide" onDismiss={() => setGuestySyncResult(null)}>
            <strong>{guestySyncResult.reviews?.upserted ?? 0}</strong> reviews and <strong>{guestySyncResult.reservations?.upserted ?? 0}</strong> bookings synced from Guesty
            {guestySyncResult.reviews?.error && <span style={{ color: 'var(--signal)' }}> (reviews failed: {guestySyncResult.reviews.error})</span>}
            {guestySyncResult.reservations?.error && <span style={{ color: 'var(--signal)' }}> (reservations failed: {guestySyncResult.reservations.error})</span>}
            {'. '}These feed guest ratings and <em>On the horizon</em>. Open any statement (or regenerate a Gmail draft) to see them &mdash; no dashboard refresh needed.
          </Toast>
        )
      )}
      {csvResult && (
        typeof csvResult === 'string' ? (
          <Toast tone="negative" onDismiss={() => setCsvResult(null)}>CSV upload failed: {csvResult}</Toast>
        ) : (
          <Toast tone="positive" onDismiss={() => setCsvResult(null)}>
            <strong>{csvResult.reservations}</strong> reservations and <strong>{csvResult.reviews}</strong> reviews saved from your Guesty CSV
            {csvResult.unmatched > 0 && <span style={{ color: 'var(--signal)' }}> ({csvResult.unmatched} rows didn&apos;t match a property)</span>}
            {'. '}Open any statement (or regenerate a Gmail draft) to see them &mdash; no dashboard refresh needed.
          </Toast>
        )
      )}
      {stripeSyncResult && (
        typeof stripeSyncResult === 'string' ? (
          <Toast tone="negative" onDismiss={() => setStripeSyncResult(null)}>Stripe sync failed: {stripeSyncResult}</Toast>
        ) : (
          <Toast
            tone={(stripeSyncResult.keyless > 0 || stripeSyncResult.errors.length > 0) ? 'negative' : (stripeSyncResult.refunds > 0 || stripeSyncResult.fee_unreadable > 0 || stripeSyncResult.truncated_rebuilds > 0) ? 'tide' : 'positive'}
            onDismiss={() => setStripeSyncResult(null)}
          >
            Stripe synced across <strong>{stripeSyncResult.properties}</strong> propert{stripeSyncResult.properties === 1 ? 'y' : 'ies'}
            {stripeSyncResult.fee_updates > 0 && <>: <strong>{stripeSyncResult.fee_updates}</strong> fee{stripeSyncResult.fee_updates === 1 ? '' : 's'} corrected to the real Stripe number</>}
            {stripeSyncResult.refunds > 0 && <span style={{ color: 'var(--signal)' }}> &middot; {stripeSyncResult.refunds} refund{stripeSyncResult.refunds === 1 ? '' : 's'} flagged</span>}
            {stripeSyncResult.gross_reconstructions > 0 && <span style={{ color: 'var(--positive, #2e6b4f)' }}> &middot; {stripeSyncResult.gross_reconstructions} stay{stripeSyncResult.gross_reconstructions === 1 ? '' : 's'} rebuilt from Stripe actuals (+{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(stripeSyncResult.reconstructed_gain)} net recovered; Guesty TOTAL_PAID under-reported an installment plan)</span>}
            {stripeSyncResult.gross_mismatches > 0 && <span style={{ color: 'var(--signal)' }}> &middot; {stripeSyncResult.gross_mismatches} gross mismatch{stripeSyncResult.gross_mismatches === 1 ? '' : 'es'}</span>}
            {stripeSyncResult.missing_charges > 0 && <span style={{ color: 'var(--ink-4)' }}> &middot; {stripeSyncResult.missing_charges} expected charge{stripeSyncResult.missing_charges === 1 ? '' : 's'} missing</span>}
            {stripeSyncResult.orphan_charges > 0 && <span style={{ color: 'var(--signal)' }}> &middot; {stripeSyncResult.orphan_charges} unmatched charge{stripeSyncResult.orphan_charges === 1 ? '' : 's'} found; one-off payment links land in the review queue on each property card</span>}
            {stripeSyncResult.keyless > 0 && <span style={{ color: 'var(--negative)' }}> &middot; {stripeSyncResult.keyless} propert{stripeSyncResult.keyless === 1 ? 'y has' : 'ies have'} VRBO/Direct stays but NO Stripe key configured, so their fees were never verified</span>}
            {stripeSyncResult.fee_unreadable > 0 && <span style={{ color: 'var(--signal)' }}> &middot; {stripeSyncResult.fee_unreadable} matched charge{stripeSyncResult.fee_unreadable === 1 ? '' : 's'} returned no fee from Stripe; those stays are still on the 3.9% estimate</span>}
            {stripeSyncResult.truncated_rebuilds > 0 && <span style={{ color: 'var(--signal)' }}> &middot; {stripeSyncResult.truncated_rebuilds} stay{stripeSyncResult.truncated_rebuilds === 1 ? '' : 's'} rebuilt from less money than Guesty recorded as collected; check for an earlier charge</span>}
            {stripeSyncResult.errors.length === 0 && stripeSyncResult.fee_updates === 0 && stripeSyncResult.refunds === 0 && stripeSyncResult.gross_mismatches === 0 && stripeSyncResult.gross_reconstructions === 0 && stripeSyncResult.missing_charges === 0 && stripeSyncResult.fee_unreadable === 0 && stripeSyncResult.truncated_rebuilds === 0 && stripeSyncResult.keyless === 0 && <>: no discrepancies. All estimates match Stripe within $1.</>}
            {stripeSyncResult.errors.length > 0 && (
              <span style={{ display: 'block', marginTop: 4, color: 'var(--signal)', fontSize: 11 }}>
                {stripeSyncResult.errors.length} account{stripeSyncResult.errors.length === 1 ? '' : 's'} errored: {stripeSyncResult.errors.slice(0, 2).join(' · ')}
              </span>
            )}
          </Toast>
        )
      )}
      {draftResult && (
        typeof draftResult === 'string' ? (
          <Toast tone="negative" onDismiss={() => setDraftResult(null)}>Gmail draft failed: {draftResult}</Toast>
        ) : (
          <Toast tone={draftResult.warnings.length > 0 ? 'tide' : 'positive'} onDismiss={() => setDraftResult(null)}>
            Gmail draft created for <strong>{draftResult.property}</strong>
            {draftResult.attachedPdf
              ? <> with the statement PDF attached. </>
              : <> (no PDF attached, see warnings). </>}
            {canOpenMailbox(sessionEmail, draftResult.mailbox) ? (
              <a href={draftResult.url} target="_blank" rel="noopener" style={{ color: 'var(--tide-deep)', textDecoration: 'underline' }}>
                Open in Gmail →
              </a>
            ) : (
              <>It is in {mailboxOwnerLabel(draftResult.mailbox)} Gmail drafts.</>
            )}
            {draftResult.warnings.length > 0 && (
              <span style={{ display: 'block', marginTop: 4, color: 'var(--signal)', fontSize: 11 }}>
                {draftResult.warnings.join(' · ')}
              </span>
            )}
          </Toast>
        )
      )}
      {bulkDraftResult && (
        typeof bulkDraftResult === 'string' ? (
          <Toast tone="tide" onDismiss={() => setBulkDraftResult(null)}>{bulkDraftResult}</Toast>
        ) : (
          <Toast
            tone={bulkDraftResult.failed.length > 0 ? 'tide' : 'positive'}
            onDismiss={() => setBulkDraftResult(null)}
          >
            <strong>{bulkDraftResult.drafted}</strong> Gmail draft{bulkDraftResult.drafted === 1 ? '' : 's'} created
            {bulkDraftResult.skipped > 0 && (
              <span style={{ color: 'var(--ink-4)' }}> &middot; {bulkDraftResult.skipped} skipped (already drafted, red, or covered by a combined owner email)</span>
            )}
            {bulkDraftResult.failed.length > 0 && (
              <span style={{ display: 'block', marginTop: 4, color: 'var(--signal)', fontSize: 11 }}>
                {bulkDraftResult.failed.length} failed: {bulkDraftResult.failed.slice(0, 3).map(f => `${f.property} (${f.error})`).join(' · ')}
                {bulkDraftResult.failed.length > 3 && ` +${bulkDraftResult.failed.length - 3} more`}
              </span>
            )}
            {bulkDraftResult.drafted > 0 && canOpenMailbox(sessionEmail, draftMailbox) && (
              <a
                href={gmailUrl(draftMailbox, 'drafts')}
                target="_blank"
                rel="noopener"
                style={{ display: 'inline-block', marginLeft: 8, color: 'var(--tide-deep)', textDecoration: 'underline' }}
              >
                Open Gmail drafts →
              </a>
            )}
            {bulkDraftResult.drafted > 0 && !canOpenMailbox(sessionEmail, draftMailbox) && (
              <span style={{ marginLeft: 8 }}>They are in {mailboxOwnerLabel(draftMailbox)} Gmail drafts.</span>
            )}
          </Toast>
        )
      )}

      {/* ─── INSIGHTS STRIP (replaces KPI cards) ─── */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 28, paddingBottom: 20 }}>
        <div className="rt-period-head flex items-baseline justify-between" style={{ marginBottom: 14 }}>
          <div>
            <div className="eyebrow">Month at a glance</div>
            <h1 className="rt-display-h1 font-serif" style={{ fontSize: 38, lineHeight: 1, fontWeight: 400, letterSpacing: '-0.02em', marginTop: 8 }}>
              {monthLong(selectedMonth)} <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>Statements</em>
            </h1>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="eyebrow">Total Owner Payout</div>
            <div className="font-serif tabular-nums" style={{ fontSize: 32, fontWeight: 400, color: 'var(--ink)', marginTop: 6 }}>
              {fmtCompact(totalPayout)}
            </div>
          </div>
        </div>

        <div className="rt-insights-6 rule-top rule-bottom" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, 1fr)',
        }}>
          <Insight label="Properties" value={String(props.length)} />
          <Insight label="Stays" value={String(totalStays)} />
          <Insight label="Revenue" value={fmtCompact(totalRevenue)} />
          <Insight label="Mgmt Fees" value={fmtCompact(totalMgmt)} accent />
          <Insight label="Cleaning" value={fmtCompact(totalCleaning)} />
          <Insight label="Owner Payouts" value={fmtCompact(totalPayout)} last />
        </div>
      </section>

      {/* ─── THE CLOSE, IN ORDER ─── five fixed steps, each a count out of
           the month's statements: Inputs on file, Synced, Reviewed, Drafted,
           Sent. The first step not done is the next thing to do. Every Open
           lands on the exact section of the first card that needs it, with
           its queue unfolded, and opens the rest at the same section. */}
      {props.length > 0 && (() => {
        const n = props.length;
        const openGaps = (p: PropertyStatement) => (p.data_gaps || []).filter(g => !g.resolved);
        const bankRows = (p: PropertyStatement) => depositReviewCounts.counts[p.property_id] || 0;

        // 1. Inputs on file: the month's two portfolio files, and each
        // statement's own ingest (the Guesty PDF, and no flag naming a file
        // it is still missing).
        const platformMissing = monthStatus ? !monthStatus.platform_csv.on_file : false;
        const bookingMissing = monthStatus?.booking_activity.known ? monthStatus.booking_activity.rows === 0 : false;
        const inputsUnknown = !monthStatus || !monthStatus.booking_activity.known;
        const inputsOk = (p: PropertyStatement) => p.has_guesty_statement && !openGaps(p).some(g => INPUT_GAP_TYPES.has(g.gap_type));
        const inputsMissing = props.filter(p => !inputsOk(p));

        // 2. Synced: the feeds are healthy and no paid booking has landed
        // in Guesty since the statement was built.
        const failingSyncs = STATEMENT_SYNC_SOURCES.filter(src => lastSync[src]?.last_status === 'error');
        const syncedOk = (p: PropertyStatement) => p.drift_known !== false && (p.drift_bookings?.length || 0) === 0;
        const driftCards = props.filter(p => (p.drift_bookings?.length || 0) > 0);
        const driftCount = driftCards.reduce((sum, p) => sum + (p.drift_bookings?.length || 0), 0);
        const driftUnknown = props.some(p => p.drift_known === false);
        // Revenue rows in Guesty with no confirmation code: nothing in Helm
        // can match them, so they never block a step. Said, not counted.
        const unmatchable = props.reduce((sum, p) => sum + (p.drift_unmatchable || 0), 0);

        // 3. Reviewed: no bank row waiting, no open flag, reconciled.
        const reviewedOk = (p: PropertyStatement) => !!p.reconciliation?.reconciled && p.gaps_known !== false
          && openGaps(p).length === 0 && depositReviewCounts.known && bankRows(p) === 0;
        const bankCards = props.filter(p => bankRows(p) > 0);
        const bankCount = bankCards.reduce((sum, p) => sum + bankRows(p), 0);
        const flagCards = props.filter(p => openGaps(p).length > 0);
        const flagCount = flagCards.reduce((sum, p) => sum + openGaps(p).length, 0);
        const unreconciledCards = props.filter(p => p.reconciliation && !p.reconciliation.reconciled);
        const reviewUnknown = !depositReviewCounts.known || props.some(p => p.gaps_known === false || !p.reconciliation);
        // The first section that holds the card back, in the order it is worked.
        const reviewSection = (p: PropertyStatement): CardSection =>
          bankRows(p) > 0 ? 'bank' : openGaps(p).length > 0 ? 'flags' : 'recon';

        // 4 and 5. Drafted and Sent, from the close-out ticks.
        const ticksKnown = !closeStateError;
        const drafted = (p: PropertyStatement) => !!closeTasks[p.property_id]?.email_drafted_at;
        const sent = (p: PropertyStatement) => !!closeTasks[p.property_id]?.email_sent_at;
        // Ready to draft is not done: inputs on file, synced and reviewed,
        // and no draft yet.
        const readyToDraft = props.filter(p => !drafted(p) && inputsOk(p) && syncedOk(p) && reviewedOk(p));
        const undrafted = props.filter(p => !drafted(p));
        const draftedUnsent = props.filter(p => drafted(p) && !sent(p));
        const unsent = props.filter(p => !sent(p));

        const send = (list: PropertyStatement[]) => focusSections(list.map(p => [p.property_id, 'send'] as [string, CardSection]));
        const steps: Array<{
          label: string;
          done: number | null;
          complete: boolean;
          details: React.ReactNode[];
          open?: () => void;
        }> = [
          {
            label: 'Inputs on file',
            done: n - inputsMissing.length,
            complete: inputsMissing.length === 0 && !platformMissing && !bookingMissing && !inputsUnknown,
            details: [
              platformMissing && <StepLink key="pc" alert onClick={() => scrollToId('inputs-guesty-csv')}>Guesty reservations CSV not uploaded</StepLink>,
              bookingMissing && <StepLink key="bk" alert onClick={() => scrollToId('inputs-booking')}>Booking.com 5623 CSV not uploaded</StepLink>,
              inputsUnknown && <StepNote key="iu" alert>month files unknown (the check did not load)</StepNote>,
              inputsMissing.length > 0 && (
                <StepLink key="im" onClick={() => focusSections(inputsMissing.map(p => [p.property_id, openGaps(p).some(g => INPUT_GAP_TYPES.has(g.gap_type)) ? 'flags' : 'sources']))}>
                  {inputsMissing.length} statement{inputsMissing.length === 1 ? '' : 's'} missing a file
                </StepLink>
              ),
            ],
            open: platformMissing ? () => scrollToId('inputs-guesty-csv')
              : bookingMissing ? () => scrollToId('inputs-booking')
              : inputsMissing.length > 0 ? () => focusSections(inputsMissing.map(p => [p.property_id, openGaps(p).some(g => INPUT_GAP_TYPES.has(g.gap_type)) ? 'flags' : 'sources']))
              : undefined,
          },
          {
            label: 'Synced',
            done: driftUnknown ? null : n - props.filter(p => !syncedOk(p)).length,
            complete: !driftUnknown && driftCards.length === 0 && failingSyncs.length === 0,
            details: [
              failingSyncs.length > 0 && (
                <StepLink key="fs" alert onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); setSyncMenuOpen(true); }}>
                  {failingSyncs.length} feed{failingSyncs.length === 1 ? '' : 's'} failing ({failingSyncs.join(', ')})
                </StepLink>
              ),
              driftCount > 0 && (
                <StepLink key="dr" onClick={() => focusSections(driftCards.map(p => [p.property_id, 'drift']))}>
                  {driftCount} new paid booking{driftCount === 1 ? '' : 's'} not on a statement
                </StepLink>
              ),
              driftUnknown && <StepNote key="du" alert>new-booking check did not load for a statement</StepNote>,
              unmatchable > 0 && (
                <StepNote key="um">
                  {unmatchable} Guesty row{unmatchable === 1 ? '' : 's'} with no confirmation code (check in Guesty; does not hold up the close)
                </StepNote>
              ),
            ],
            open: driftCards.length > 0 ? () => focusSections(driftCards.map(p => [p.property_id, 'drift']))
              : failingSyncs.length > 0 ? () => { window.scrollTo({ top: 0, behavior: 'smooth' }); setSyncMenuOpen(true); }
              : undefined,
          },
          {
            label: 'Reviewed',
            done: reviewUnknown ? null : n - props.filter(p => !reviewedOk(p)).length,
            complete: !reviewUnknown && props.every(reviewedOk),
            details: [
              bankCount > 0 && (
                <StepLink key="bq" onClick={() => focusSections(bankCards.map(p => [p.property_id, 'bank']))}>
                  {bankCount} bank row{bankCount === 1 ? '' : 's'} to review
                </StepLink>
              ),
              flagCount > 0 && (
                <StepLink key="fl" onClick={() => focusSections(flagCards.map(p => [p.property_id, 'flags']))}>
                  {flagCount} open flag{flagCount === 1 ? '' : 's'}
                </StepLink>
              ),
              unreconciledCards.length > 0 && (
                <StepLink key="rc" onClick={() => focusSections(unreconciledCards.map(p => [p.property_id, 'recon']))}>
                  {unreconciledCards.length} not reconciled
                </StepLink>
              ),
              !depositReviewCounts.known && <StepNote key="bu" alert>bank row count did not load</StepNote>,
              props.some(p => p.gaps_known === false) && <StepNote key="gu" alert>a flag list did not load</StepNote>,
              props.some(p => !p.reconciliation) && <StepNote key="ru" alert>a reconciliation could not be computed</StepNote>,
            ],
            open: props.some(p => !reviewedOk(p))
              ? () => focusSections(props.filter(p => !reviewedOk(p)).map(p => [p.property_id, reviewSection(p)]))
              : undefined,
          },
          {
            label: 'Drafted',
            done: ticksKnown ? n - undrafted.length : null,
            complete: ticksKnown && undrafted.length === 0,
            details: [
              ticksKnown && undrafted.length > 0 && (
                readyToDraft.length > 0 ? (
                  <StepLink key="rd" onClick={() => send(readyToDraft)}>
                    {readyToDraft.length} ready to draft
                  </StepLink>
                ) : (
                  <StepNote key="rd">none ready to draft yet</StepNote>
                )
              ),
              !ticksKnown && <StepNote key="tu" alert>close-out ticks did not load</StepNote>,
            ],
            open: ticksKnown && undrafted.length > 0 ? () => send(readyToDraft.length > 0 ? readyToDraft : undrafted) : undefined,
          },
          {
            label: 'Sent',
            done: ticksKnown ? n - unsent.length : null,
            complete: ticksKnown && unsent.length === 0,
            details: [
              ticksKnown && draftedUnsent.length > 0 && (
                <StepLink key="du" onClick={() => send(draftedUnsent)}>
                  {draftedUnsent.length} drafted, not marked sent
                </StepLink>
              ),
            ],
            open: ticksKnown && unsent.length > 0 ? () => send(draftedUnsent.length > 0 ? draftedUnsent : unsent) : undefined,
          },
        ];
        const nextStep = steps.findIndex(st => !st.complete);
        return (
          <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 20 }}>
            <div className="rule-top rule-bottom" style={{ padding: '10px 0' }}>
              <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 12, marginBottom: 6 }}>
                <span className="eyebrow" style={{ color: nextStep < 0 ? 'var(--ink-4)' : 'var(--signal)' }}>The close</span>
                {nextStep < 0 && (
                  <span className="font-serif" style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--ink-3)' }}>
                    Month is clear &middot; inputs on file, synced, every statement reviewed, drafted and sent.
                  </span>
                )}
              </div>
              {steps.map((st, i) => (
                <CloseStep
                  key={st.label}
                  index={i + 1}
                  label={st.label}
                  done={st.done}
                  total={n}
                  complete={st.complete}
                  next={i === nextStep}
                  details={st.details.filter(Boolean)}
                  onOpen={st.open}
                />
              ))}
            </div>
          </section>
        );
      })()}

      {/* ─── MONTHLY INPUTS ─── the two once-a-month uploads, compact.
           Each card collapses to a one-line status row when its file is on
           file for the month and expands automatically when it isn't. */}
      <div id="inputs-guesty-csv" style={{ scrollMarginTop: 72 }}>
        <PlatformCSVUploadCard
          defaultMonth={selectedMonth || undefined}
          status={monthStatus?.platform_csv ?? null}
          onUploaded={() => { setCountsRefresh(n => n + 1); }}
        />
      </div>
      <div id="inputs-booking" style={{ scrollMarginTop: 72 }}>
        <BookingDepositsUploadCard
          defaultMonth={selectedMonth || undefined}
          status={monthStatus?.booking_activity ?? null}
          onUploaded={() => { setCountsRefresh(n => n + 1); }}
        />
      </div>

      {/* ─── CLOSE-OUT NOTES ─── per-month freeform notepad the operator
           drops context into throughout the month (cancellations, refunds,
           weird charges, follow-ups) so it's all in one place at close-out.
           Stored in period_notes (supabase-schema-period-notes.sql). */}
      {selectedMonth && <PeriodNotesCard month={selectedMonth} refreshKey={periodNotesRefreshKey} />}

      {/* Email preview modal */}
      {previewPropertyId && (() => {
        const prop = props.find(p => p.property_id === previewPropertyId);
        const cfg = resolveCfg(previewPropertyId);
        if (!prop || !cfg) return null;
        const task = closeTasks[previewPropertyId];
        const tmpl = (task?.email_template || 'monthly') as EmailTemplate;
        const includeNotes = !!task?.email_include_work_slips;
        // Resolve each covered house's curated list exactly the way
        // /api/draft-email will: same candidates, same stored picks, same
        // resolver. The body below is therefore the email, not an
        // approximation of it.
        const resolvedRequests = includeNotes
          ? previewHouses
              .map(h => {
                const loaded = requestCandidates[`${h.propertyId}:${selectedMonth}`];
                if (!loaded) return null;
                const houseTask = closeTasks[h.propertyId];
                return resolveOwnerRequests(loaded, houseTask?.owner_request_items, {
                  includeHandled: !!houseTask?.email_include_handled,
                  maintenanceCharge: maintenanceChargeBy[h.propertyId] || 0,
                });
              })
              .filter(r => r !== null)
              .filter(ownerRequestsHaveContent)
          : [];
        const notesEmpty = includeNotes
          && previewHouses.every(h => !!requestCandidates[`${h.propertyId}:${selectedMonth}`])
          && resolvedRequests.length === 0;
        // Combined owner (Prudenzi, Moynahan): /api/draft-email will group
        // every sibling sharing this owner_id that has a statement this
        // period. `props` is exactly "has a statement this period", so
        // filtering it mirrors the route. Sibling order matches the route's
        // too: requested property first, then the rest by name.
        const previewSiblings = props
          .filter(p => {
            if (p.property_id === previewPropertyId) return false;
            const sc = resolveCfg(p.property_id);
            return !!sc && !!sc.owner_id && sc.owner_id === cfg.owner_id;
          })
          .sort((a, b) => (resolveCfg(a.property_id)?.name || a.property_name)
            .localeCompare(resolveCfg(b.property_id)?.name || b.property_name));
        const previewGrouped = previewSiblings.length > 0;
        // Recipient union across the group, same as the route: a sibling row
        // carrying no email of its own is covered by the others.
        const previewRecipients = Array.from(new Set([
          ...cfg.owner_emails,
          ...previewSiblings.flatMap(s => resolveCfg(s.property_id)?.owner_emails || []),
        ]));
        const { subject, body } = renderEmail({
          greeting: cfg.owner_greeting,
          monthName: monthLabel(selectedMonth),
          propertyShort: cfg.name,
          fundsSentIso: fundsSentDate,
          ownerPayout: prop.owner_payout,
          template: tmpl,
          ownerRequests: resolvedRequests.length > 0 ? resolvedRequests : undefined,
          properties: previewGrouped
            ? [{ name: cfg.name, payout: prop.owner_payout || undefined },
               ...previewSiblings.map(s => ({
                 name: resolveCfg(s.property_id)?.name || s.property_name,
                 payout: s.owner_payout || undefined,
               }))]
            : undefined,
        });
        return (
          <PreviewModal onClose={() => setPreviewPropertyId(null)}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Email preview · {tmpl.replace('_', '-')}</div>
            <h3 className="font-serif" style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>{cfg.owner_full}</h3>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
              To: {previewRecipients.length > 0 ? previewRecipients.join(', ') : <em style={{ color: 'var(--signal)' }}>no email on file</em>}
              <br />
              Cc: {ALWAYS_CC.join(', ')}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 6 }}>From: {SEND_FROM.name} &lt;{SEND_FROM.email}&gt;</div>
            {previewGrouped && (
              <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--paper-2)', borderLeft: '2px solid var(--signal)', fontSize: 11, color: 'var(--ink-2)' }}>
                Combined owner: this draft covers{' '}
                <strong>{[cfg.name, ...previewSiblings.map(s => resolveCfg(s.property_id)?.name || s.property_name)].join(' + ')}</strong>{' '}
                in one email, with a PDF attached per property.
                {includeNotes && ' Requests are curated per house below.'}
              </div>
            )}

            {/* The owner-request section: master switch, then the curation
                panel. The body below re-renders live off the same picks the
                draft route will read. */}
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <CheckTask
                label="Include owner requests"
                done={includeNotes}
                onToggle={(next) => saveCloseTaskField(previewPropertyId, { email_include_work_slips: next })}
              />
              {includeNotes && notesEmpty && (
                <span style={{ fontSize: 10, color: 'var(--ink-4)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
                  Nothing included; section left out
                </span>
              )}
            </div>
            {includeNotes && (
              <OwnerRequestsPanel
                houses={previewHouses}
                candidates={Object.fromEntries(previewHouses.map(h =>
                  [h.propertyId, requestCandidates[`${h.propertyId}:${selectedMonth}`]]))}
                selections={Object.fromEntries(previewHouses.map(h =>
                  [h.propertyId, closeTasks[h.propertyId]?.owner_request_items]))}
                includeHandled={Object.fromEntries(previewHouses.map(h =>
                  [h.propertyId, !!closeTasks[h.propertyId]?.email_include_handled]))}
                maintenanceCharge={Object.fromEntries(previewHouses.map(h =>
                  [h.propertyId, maintenanceChargeBy[h.propertyId] || 0]))}
                loading={previewNotesLoading}
                onSelectionsChange={saveOwnerRequestSelections}
                onToggleHandled={(pid, next) => saveCloseTaskField(pid, { email_include_handled: next })}
                onReloadHouse={(pid) => {
                  const name = previewHouses.find(h => h.propertyId === pid)?.name || pid;
                  loadCandidatesFor(pid, name, selectedMonth, statementIdBy[pid] || null);
                }}
              />
            )}

            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--ink)' }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Subject</div>
              <div className="font-serif" style={{ fontSize: 16, color: 'var(--ink)' }}>{subject}</div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Body</div>
              <pre className="font-serif" style={{
                whiteSpace: 'pre-wrap',
                fontSize: 13, lineHeight: 1.55,
                color: 'var(--ink)',
                background: 'var(--paper-2)',
                padding: '14px 16px',
                borderLeft: '3px solid var(--tide)',
                margin: 0,
                fontFamily: 'var(--font-fraunces)',
              }}>{body}</pre>
            </div>

            <div style={{ marginTop: 18, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                onClick={() => createGmailDraft(previewPropertyId)}
                disabled={draftingProperty === previewPropertyId || cfg.owner_emails.length === 0}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: 'var(--ink)', color: 'var(--paper)',
                  fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase',
                  padding: '10px 18px', border: 'none',
                  cursor: (draftingProperty === previewPropertyId || cfg.owner_emails.length === 0) ? 'not-allowed' : 'pointer',
                  opacity: (draftingProperty === previewPropertyId || cfg.owner_emails.length === 0) ? 0.4 : 1,
                }}
              >
                {draftingProperty === previewPropertyId ? (
                  <>
                    <span style={{
                      width: 10, height: 10, borderRadius: '50%',
                      border: '1.5px solid var(--paper)', borderTopColor: 'transparent',
                      animation: 'spin 0.8s linear infinite',
                    }} />
                    Drafting
                  </>
                ) : (
                  <>
                    <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 9v.906a2.25 2.25 0 01-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 001.183 1.981l6.478 3.488m8.839 2.51l-4.66-2.51m0 0l-1.023-.55a2.25 2.25 0 00-2.134 0l-1.022.55m0 0l-4.661 2.51m16.5 1.615a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75a2.25 2.25 0 012.25-2.25h15a2.25 2.25 0 012.25 2.25v10.875z" />
                    </svg>
                    Create Gmail Draft
                  </>
                )}
              </button>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
                  } catch {}
                }}
                style={{
                  background: 'transparent', color: 'var(--ink-3)',
                  fontSize: 10, fontWeight: 500, letterSpacing: '.12em', textTransform: 'uppercase',
                  padding: '10px 16px', border: '1px solid var(--rule)', cursor: 'pointer',
                }}
              >
                Copy Instead
              </button>
              <button
                onClick={() => {
                  saveCloseTaskField(previewPropertyId, { email_drafted_at: new Date().toISOString() });
                  setPreviewPropertyId(null);
                }}
                style={{
                  background: 'transparent', color: 'var(--ink-4)',
                  fontSize: 10, fontWeight: 500, letterSpacing: '.12em', textTransform: 'uppercase',
                  padding: '10px 16px', border: '1px solid var(--rule)', cursor: 'pointer',
                }}
              >
                Mark Drafted (manual)
              </button>
              {cfg.owner_emails.length === 0 && (
                <span style={{ fontSize: 10, color: 'var(--signal)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
                  No owner email on file
                </span>
              )}
            </div>
          </PreviewModal>
        );
      })()}

      {/* Transfer list modal */}
      {transferListOpen && (
        <PreviewModal onClose={() => setTransferListOpen(false)}>
          {(() => {
            const rows = props
              .filter(p => p.owner_payout > 0)
              .map(p => ({
                property: p.property_name,
                owner: resolveCfg(p.property_id)?.owner_full || p.owner_name,
                payout: p.owner_payout,
                mgmtFee: p.management_fee,
              }));
            const text = buildTransferList({
              monthName: monthLabel(selectedMonth).toUpperCase(),
              fundsSentIso: fundsSentDate,
              rows,
            });
            return (
              <>
                <div className="eyebrow" style={{ marginBottom: 6 }}>Transfer list</div>
                <h3 className="font-serif" style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>
                  {monthLabel(selectedMonth)} &middot; {rows.length} owners
                </h3>
                <pre className="font-mono" style={{
                  marginTop: 18,
                  whiteSpace: 'pre',
                  fontSize: 11, lineHeight: 1.55,
                  color: 'var(--ink-2)',
                  background: 'var(--paper-2)',
                  padding: '16px 18px',
                  borderLeft: '3px solid var(--tide)',
                  overflowX: 'auto',
                }}>{text}</pre>
                <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(text);
                      } catch {}
                    }}
                    style={{
                      background: 'var(--ink)', color: 'var(--paper)',
                      fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase',
                      padding: '9px 16px', border: 'none', cursor: 'pointer',
                    }}
                  >
                    Copy to Clipboard
                  </button>
                  <button
                    onClick={() => printPlainText(`${monthLabel(selectedMonth)} · Owner Transfer List`, text)}
                    style={{
                      background: 'transparent', color: 'var(--ink)',
                      border: '1px solid var(--rule)',
                      fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase',
                      padding: '9px 16px', cursor: 'pointer',
                    }}
                  >
                    Print
                  </button>
                </div>
              </>
            );
          })()}
        </PreviewModal>
      )}

      {/* Booking.com deposit routing modal -- sweep *5623 -> property accounts */}
      {bookingRoutingOpen && (
        <PreviewModal onClose={() => setBookingRoutingOpen(false)}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Booking.com deposit routing</div>
          <h3 className="font-serif" style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>
            {monthLabel(selectedMonth)} &middot; sweep <em style={{ color: 'var(--tide-deep)' }}>*5623</em> to property accounts
          </h3>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.5 }}>
            Booking.com pays the full guest gross into the *5623 deposits account. Move each deposit to its property account. Booking.com auto-debits its commission from the property account next month, and the tax portion is remitted to *9928 (both on the Remittance list).
          </p>
          {loadingBookingRouting || !bookingRoutingRows ? (
            <div style={{ marginTop: 18, padding: 16, background: 'var(--paper-2)', fontSize: 12, color: 'var(--ink-4)' }}>Loading…</div>
          ) : (() => {
            const text = buildBookingRoutingList({
              monthName: monthLabel(selectedMonth).toUpperCase(),
              rows: bookingRoutingRows,
            });
            return (
              <>
                <pre className="font-mono" style={{
                  marginTop: 18,
                  whiteSpace: 'pre',
                  fontSize: 11, lineHeight: 1.55,
                  color: 'var(--ink-2)',
                  background: 'var(--paper-2)',
                  padding: '16px 18px',
                  borderLeft: '3px solid var(--tide)',
                  overflowX: 'auto',
                }}>{text}</pre>
                <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
                  <button
                    onClick={async () => { try { await navigator.clipboard.writeText(text); } catch {} }}
                    style={{
                      background: 'var(--ink)', color: 'var(--paper)',
                      fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase',
                      padding: '9px 16px', border: 'none', cursor: 'pointer',
                    }}
                  >
                    Copy to Clipboard
                  </button>
                  <button
                    onClick={() => printPlainText(`${monthLabel(selectedMonth)} · Booking.com Deposit Routing`, text)}
                    style={{
                      background: 'transparent', color: 'var(--ink)',
                      border: '1px solid var(--rule)',
                      fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase',
                      padding: '9px 16px', cursor: 'pointer',
                    }}
                  >
                    Print
                  </button>
                  <button
                    onClick={() => { setBookingRoutingRows(null); loadBookingRouting(); }}
                    disabled={loadingBookingRouting}
                    style={{
                      background: 'transparent', color: 'var(--ink)',
                      border: '1px solid var(--rule)',
                      fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase',
                      padding: '9px 16px', cursor: loadingBookingRouting ? 'wait' : 'pointer',
                    }}
                  >
                    Refresh
                  </button>
                </div>
              </>
            );
          })()}
        </PreviewModal>
      )}

      {/* Add note modal -- captures Allie's "FYI" emails as structured rows */}
      {addNoteOpen && (
        <AddNoteModal
          onClose={() => setAddNoteOpen(false)}
          defaultAuthor="helm-portal"
          month={selectedMonth || undefined}
          onSavedPeriodNote={() => setPeriodNotesRefreshKey(k => k + 1)}
        />
      )}

      {/* Reconcile-sends results modal. Compares what's in Gmail (the
          owner emails that actually went out) to what Helm now shows. */}
      {reconcileOpen && (
        <PreviewModal onClose={() => setReconcileOpen(false)}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Reconcile sends</div>
          <h3 className="font-serif" style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>
            {monthLabel(selectedMonth)} &middot; emails vs Helm DB
          </h3>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.5 }}>
            Searches Gmail for sent owner statements (any subject containing &ldquo;{monthLabel(selectedMonth).split(' ')[0]} Owner Statement&rdquo;), parses payout amounts from the snippets, and joins to the current Helm record. Divergences land as gaps on the affected property cards.
          </p>

          {reconciling && !reconcileResult && (
            <div style={{ marginTop: 18, padding: 16, background: 'var(--paper-2)', fontSize: 12, color: 'var(--ink-4)' }}>
              Searching Gmail…
            </div>
          )}

          {reconcileResult && typeof reconcileResult === 'string' && (
            <div style={{
              marginTop: 14, padding: '10px 12px',
              borderLeft: '2px solid var(--negative)',
              background: 'var(--paper-2)',
              fontSize: 12, color: 'var(--ink-2)',
            }}>
              {reconcileResult}
            </div>
          )}

          {reconcileResult && typeof reconcileResult !== 'string' && (
            <div style={{ marginTop: 18 }}>
              <div className="flex items-center gap-5 flex-wrap" style={{ fontSize: 11, marginBottom: 14 }}>
                <span style={{ color: 'var(--ink-3)' }}>
                  <strong>{reconcileResult.emails_found}</strong> email{reconcileResult.emails_found === 1 ? '' : 's'} found
                </span>
                <span style={{ color: reconcileResult.gaps_written > 0 ? 'var(--signal)' : 'var(--positive)' }}>
                  <strong>{reconcileResult.gaps_written}</strong> divergence{reconcileResult.gaps_written === 1 ? '' : 's'} flagged
                </span>
                {reconcileResult.emails_unparsed.length > 0 && (
                  <span style={{ color: 'var(--ink-4)' }}>
                    <strong>{reconcileResult.emails_unparsed.length}</strong> unparsed
                  </span>
                )}
              </div>

              {reconcileResult.rows.length === 0 ? (
                <div style={{ padding: 16, background: 'var(--paper-2)', fontSize: 12, color: 'var(--ink-4)' }}>
                  No matching sends found and no Helm statements for this month.
                </div>
              ) : (
                <table className="w-full tabular-nums" style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                      <th style={{ textAlign: 'left', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Property</th>
                      <th style={{ textAlign: 'left', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Status</th>
                      <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Sent</th>
                      <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Helm</th>
                      <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Δ</th>
                      <th style={{ textAlign: 'left', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Sender</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reconcileResult.rows.map((r) => {
                      const statusColor =
                        r.status === 'matched' ? 'var(--positive)' :
                        r.status === 'diverged' ? 'var(--signal)' :
                        r.status === 'helm_only' ? 'var(--negative)' :
                        r.status === 'email_only' ? 'var(--tide-deep)' :
                        'var(--ink-4)';
                      const statusLabel: Record<typeof r.status, string> = {
                        matched: 'matched',
                        diverged: 'diverged',
                        helm_only: 'not sent',
                        email_only: 'no helm record',
                        no_amount_in_email: 'amount on PDF only',
                      };
                      return (
                        <tr key={r.property_id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                          <td style={{ padding: '8px 6px', color: 'var(--ink)', fontFamily: 'var(--font-fraunces)', fontWeight: 500 }}>
                            {r.property_name}
                          </td>
                          <td style={{ padding: '8px 6px', fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: statusColor }}>
                            {statusLabel[r.status]}
                          </td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--ink-3)' }}>
                            {r.emailed_payout != null ? `$${r.emailed_payout.toFixed(2)}` : '—'}
                          </td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--ink)' }}>
                            {r.helm_payout != null ? `$${r.helm_payout.toFixed(2)}` : '—'}
                          </td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', color: r.delta != null && Math.abs(r.delta) >= 1 ? 'var(--signal)' : 'var(--ink-4)' }}>
                            {r.delta != null ? `${r.delta >= 0 ? '+' : ''}$${r.delta.toFixed(2)}` : '—'}
                          </td>
                          <td style={{ padding: '8px 6px', color: 'var(--ink-4)', fontSize: 11 }}>
                            {r.email_sender ? r.email_sender.replace(/<[^>]+>/, '').replace(/"/g, '').trim().split('@')[0] : '—'}
                            {r.email_date && (
                              <span style={{ marginLeft: 6, fontSize: 10 }}>
                                &middot; {r.email_date.slice(0, 10)}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {reconcileResult.gaps_written > 0 && (
                <div style={{ marginTop: 14, padding: '10px 12px', borderLeft: '2px solid var(--signal)', background: 'var(--paper-2)', fontSize: 11, color: 'var(--ink-2)' }}>
                  Divergences are now flagged on the relevant property cards as <code>email_payout_mismatch</code> gaps. Resolve from there with an explanation (e.g. &ldquo;cleaning held back pending guest recoupment&rdquo;) so the next reconcile run preserves the resolved state.
                </div>
              )}

              {reconcileResult.emails_unparsed.length > 0 && (
                <details style={{ marginTop: 14, fontSize: 11, color: 'var(--ink-4)' }}>
                  <summary style={{ cursor: 'pointer' }}>{reconcileResult.emails_unparsed.length} unparsed email{reconcileResult.emails_unparsed.length === 1 ? '' : 's'}</summary>
                  <ul style={{ marginTop: 8, paddingLeft: 18 }}>
                    {reconcileResult.emails_unparsed.slice(0, 10).map((u, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>{u.reason}</code> &middot; {u.subject}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </PreviewModal>
      )}

      {/* Remittance instructions modal */}
      {remittanceOpen && (
        <PreviewModal onClose={() => setRemittanceOpen(false)}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Remittance instructions</div>
          <h3 className="font-serif" style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>
            {monthLabel(selectedMonth)} &middot; accountant transfers
          </h3>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.5 }}>
            Tax gets moved from each property account to *9928. VRBO commissions get swept to *5130 to reimburse the *3878 credit card. Booking.com&apos;s auto-debit next month is shown for reconciliation only. Every property with a statement is listed, including the ones owing nothing.
          </p>
          {loadingRemittance || !remittanceSheet ? (
            <div style={{ marginTop: 18, padding: 16, background: 'var(--paper-2)', fontSize: 12, color: 'var(--ink-4)' }}>Loading…</div>
          ) : (() => {
            const text = buildRemittanceList({
              monthName: monthLabel(selectedMonth).toUpperCase(),
              sheet: remittanceSheet,
            });
            return (
              <>
                <pre className="font-mono" style={{
                  marginTop: 18,
                  whiteSpace: 'pre',
                  fontSize: 11, lineHeight: 1.55,
                  color: 'var(--ink-2)',
                  background: 'var(--paper-2)',
                  padding: '16px 18px',
                  borderLeft: '3px solid var(--tide)',
                  overflowX: 'auto',
                }}>{text}</pre>
                <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
                  <button
                    onClick={async () => { try { await navigator.clipboard.writeText(text); } catch {} }}
                    style={{
                      background: 'var(--ink)', color: 'var(--paper)',
                      fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase',
                      padding: '9px 16px', border: 'none', cursor: 'pointer',
                    }}
                  >
                    Copy to Clipboard
                  </button>
                  <button
                    onClick={() => printPlainText(`${monthLabel(selectedMonth)} · Accountant Transfers`, text)}
                    style={{
                      background: 'transparent', color: 'var(--ink)',
                      border: '1px solid var(--rule)',
                      fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase',
                      padding: '9px 16px', cursor: 'pointer',
                    }}
                  >
                    Print
                  </button>
                  <button
                    onClick={() => { setRemittanceSheet(null); loadRemittance(); }}
                    disabled={loadingRemittance}
                    style={{
                      background: 'transparent', color: 'var(--ink)',
                      border: '1px solid var(--rule)',
                      fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase',
                      padding: '9px 16px', cursor: loadingRemittance ? 'wait' : 'pointer',
                    }}
                  >
                    Refresh
                  </button>
                </div>
              </>
            );
          })()}
        </PreviewModal>
      )}

      {/* ─── Property list ─── */}
      <main className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 8, paddingBottom: 40 }}>
        {props.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>No properties this month</div>
            <h2 className="font-serif" style={{ fontSize: 24, fontWeight: 300, color: 'var(--ink)' }}>
              Nothing uploaded for {monthLabel(selectedMonth)}.
            </h2>
            <Link href={statementsUploadHref(selectedMonth)} style={{
              display: 'inline-flex', gap: 8, alignItems: 'center',
              marginTop: 18, padding: '10px 18px',
              background: 'var(--ink)', color: 'var(--paper)',
              fontSize: 11, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
            }}>
              Upload statement data
              <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
            </Link>
          </div>
        ) : (
          <div>
            {props.map((prop) => (
              <PropertyCard
                key={prop.id}
                prop={prop}
                month={selectedMonth}
                ownerActionCount={ownerActionCounts[prop.property_id] ?? 0}
                onRefresh={() => { void refreshStatement(prop.id, prop.property_name); }}
                reviewRefresh={reviewRefresh}
                focus={cardFocus.targets[prop.property_id]
                  ? { token: cardFocus.token, section: cardFocus.targets[prop.property_id], scroll: cardFocus.first === prop.property_id }
                  : undefined}
                closeTask={closeTasks[prop.property_id]}
                closeTaskKnown={!closeStateError}
                ownerGreeting={resolveCfg(prop.property_id)?.owner_greeting || prop.owner_name}
                ownerEmailMissing={(resolveCfg(prop.property_id)?.owner_emails.length ?? 0) === 0}
                onCloseTaskField={(patch) => { void saveCloseTaskField(prop.property_id, patch); }}
                onMarkSent={(next) => markStatementSent(prop, next)}
                onPreview={() => setPreviewPropertyId(prop.property_id)}
              />
            ))}
            <div style={{ borderTop: '1px solid var(--ink)' }} />
          </div>
        )}
      </main>

      {/* ─── CLOSE-OUT PANEL ─── the month-level controls only: the
           funds-sent date, the three transfer sheets and Finalize. Each
           home's email and transfer ticks live on its card, under Send. */}
      {props.length > 0 && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 32 }}>
          <div className="rule-top" style={{ paddingTop: 20 }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto',
              gap: 14,
              alignItems: 'baseline',
              paddingBottom: 14,
            }}>
              <span className="font-mono" style={{ fontSize: 10, color: 'var(--signal)', letterSpacing: '.08em' }}>●</span>
              <h2 className="font-serif" style={{ fontSize: 18, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>
                Close out <em style={{ color: 'var(--tide-deep)' }}>{monthLong(selectedMonth)}</em>
              </h2>
              <span style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.14em' }}>
                The month
              </span>
            </div>

            {/* Top strip: funds sent date + totals + actions */}
            <div className="rt-closeout-top" style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto auto',
              gap: 20,
              alignItems: 'center',
              padding: '10px 0',
            }}>
              <div>
                <div className="eyebrow" style={{ marginBottom: 4 }}>Funds sent</div>
                <input
                  type="date"
                  value={fundsSentDate}
                  onChange={(e) => saveFundsSentDate(e.target.value)}
                  className="font-serif tabular-nums"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--ink)',
                    padding: '4px 0',
                    fontSize: 15, fontWeight: 500, color: 'var(--ink)',
                    outline: 'none',
                  }}
                />
              </div>
              <div />
              <div style={{ textAlign: 'right' }}>
                <div className="eyebrow" style={{ marginBottom: 4 }}>Total to Rising Tide</div>
                <div className="font-serif tabular-nums" style={{ fontSize: 20, fontWeight: 500, color: 'var(--signal)' }}>
                  {fmtCompact(totalMgmt)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => { setRemittanceOpen(true); if (!remittanceSheet) loadRemittance(); }}
                  style={{
                    border: '1px solid var(--ink)',
                    background: 'transparent', color: 'var(--ink)',
                    fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase',
                    padding: '8px 14px', cursor: 'pointer',
                  }}
                >
                  Remittance
                </button>
                <button
                  onClick={() => setTransferListOpen(true)}
                  style={{
                    border: '1px solid var(--ink)',
                    background: 'transparent', color: 'var(--ink)',
                    fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase',
                    padding: '8px 14px', cursor: 'pointer',
                  }}
                >
                  Transfer List
                </button>
                <button
                  onClick={() => { setBookingRoutingOpen(true); if (!bookingRoutingRows) loadBookingRouting(); }}
                  style={{
                    border: '1px solid var(--ink)',
                    background: 'transparent', color: 'var(--ink)',
                    fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase',
                    padding: '8px 14px', cursor: 'pointer',
                  }}
                >
                  Booking.com
                </button>
                {/* The period status machine, finally driven: 'final' freezes
                    every statement in the month behind the shared finality
                    guard. Reopen flips it back to draft. Shown on every
                    month: the freeze no longer grandfathers older ones, so
                    the badge tells the truth wherever it appears. */}
                {period.status === 'final' ? (
                  <button
                    disabled={finalizing}
                    onClick={async () => {
                      if (!confirm(`Reopen ${monthLong(selectedMonth)}? Statements become editable again (per-property sent stamps still apply).`)) return;
                      setFinalizing(true);
                      try {
                        const r = await setPeriodStatusAction(period.id, 'draft');
                        if (!r.ok) alert(`Reopen failed: ${r.error}`);
                        else await loadPeriod(selectedMonth, { quiet: true });
                      } finally { setFinalizing(false); }
                    }}
                    style={{
                      border: '1px solid var(--positive)',
                      background: 'transparent', color: 'var(--positive)',
                      fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase',
                      padding: '8px 14px', cursor: finalizing ? 'wait' : 'pointer',
                    }}
                  >
                    {finalizing ? 'Working…' : '✓ Finalized · Reopen'}
                  </button>
                ) : (
                  <button
                    disabled={finalizing || !!closeStateError}
                    title="Freeze every statement in this month. Any later change requires an explicit, recorded override."
                    onClick={async () => {
                      const unsent = props.filter(p => !closeTasks[p.property_id]?.email_sent_at).length;
                      const warn = unsent > 0 ? `\n\nNote: ${unsent} statement${unsent === 1 ? ' is' : 's are'} not yet marked sent.` : '';
                      if (!confirm(`Finalize ${monthLong(selectedMonth)}? Every statement in the month freezes; changes after this require an explicit override that is recorded on the statement.${warn}`)) return;
                      setFinalizing(true);
                      try {
                        const r = await setPeriodStatusAction(period.id, 'final');
                        if (!r.ok) alert(`Finalize failed: ${r.error}`);
                        else await loadPeriod(selectedMonth, { quiet: true });
                      } finally { setFinalizing(false); }
                    }}
                    style={{
                      border: '1px solid var(--ink)',
                      background: 'var(--ink)', color: 'var(--paper)',
                      fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase',
                      padding: '8px 14px', cursor: finalizing ? 'wait' : 'pointer',
                    }}
                  >
                    {finalizing ? 'Working…' : 'Finalize Month'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ─── Footer ─── */}
      <footer style={{ borderTop: '1px solid var(--ink)', marginTop: 24 }}>
        <div className="rt-footer max-w-[1100px] mx-auto px-10 flex items-center justify-between" style={{ padding: '14px 40px', fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          <span>Rising Tide &middot; 85 Eastern Ave &middot; Gloucester, MA 01930</span>
          <span className="font-serif" style={{ textTransform: 'none', letterSpacing: 0, fontStyle: 'italic', color: 'var(--ink-3)', fontSize: 11 }}>&ldquo;We care for your home as if it were our own.&rdquo;</span>
        </div>
      </footer>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex flex-col items-center justify-center" style={{ background: 'var(--paper)', gap: 14 }}>
        <span style={{
          width: 24, height: 24, borderRadius: '50%',
          border: '2px solid var(--ink)', borderTopColor: 'transparent',
          animation: 'spin 0.8s linear infinite',
        }} />
        <p className="eyebrow">Loading</p>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}
