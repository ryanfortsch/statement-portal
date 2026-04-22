'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { PROPERTIES, ALWAYS_CC, SEND_FROM } from '@/lib/properties';
import { renderEmail, fmtFundsSentDate, type EmailTemplate } from '@/lib/email-templates';
import { downloadStatementPdf } from '@/lib/download-pdf';
import { Suspense } from 'react';
import Link from 'next/link';

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
  tax_remittance: number;
  owner_payout: number;
  num_stays: number;
  nights_booked: number;
  has_guesty_statement: boolean;
  has_platform_csv: boolean;
  has_bank_csv: boolean;
  confidence: string;
  notes: string | null;
  reservations?: Reservation[];
  cleaning_events?: CleaningEvent[];
  data_gaps?: DataGap[];
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
  email_drafted_at: string | null;
  email_sent_at: string | null;
  owner_transfer_done_at: string | null;
  mgmt_sweep_done_at: string | null;
  notes: string | null;
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
  lines.push('-'.repeat(60));
  rows.forEach(r => {
    lines.push(`  ${r.owner.padEnd(28)} ${dollars(r.payout).padStart(12)}   (${r.property})`);
  });
  lines.push('-'.repeat(60));
  lines.push(`  ${'TOTAL OWNER PAYOUTS'.padEnd(28)} ${dollars(totalPayout).padStart(12)}`);
  lines.push('');
  lines.push('MANAGEMENT SWEEP (to Rising Tide operating account)');
  lines.push('-'.repeat(60));
  rows.forEach(r => {
    lines.push(`  ${r.owner.padEnd(28)} ${dollars(r.mgmtFee).padStart(12)}   (${r.property})`);
  });
  lines.push('-'.repeat(60));
  lines.push(`  ${'TOTAL MGMT SWEEP'.padEnd(28)} ${dollars(totalMgmt).padStart(12)}`);
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

function CheckTask({ label, done, onToggle }: { label: string; done: boolean; onToggle: (next: boolean) => void }) {
  return (
    <button
      onClick={() => onToggle(!done)}
      title={label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: 'transparent', border: 'none', cursor: 'pointer',
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

function Toast({ tone, onDismiss, children }: { tone: 'positive' | 'tide' | 'negative'; onDismiss: () => void; children: React.ReactNode }) {
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
        <button
          onClick={onDismiss}
          style={{ color: 'var(--ink-4)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}
          aria-label="dismiss"
        >
          <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
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

function EditorialButton({
  onClick, disabled, busy, label, meta, icon,
}: {
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  label: string;
  meta?: string;
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
        <span style={{ color: 'var(--ink-4)', fontWeight: 400, letterSpacing: 0, textTransform: 'none', fontSize: 10 }}>
          &middot; {meta}
        </span>
      )}
    </button>
  );
}

/* ─── Property Card ─── */
function PropertyCard({ prop, month }: { prop: PropertyStatement; month: string }) {
  const [expanded, setExpanded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const gaps = prop.data_gaps?.filter(g => !g.resolved) || [];
  const reservations = prop.reservations || [];
  const cleaning = prop.cleaning_events || [];
  const bankMatched = reservations.filter(r => r.bank_match_status === 'matched').length;
  const pctMatched = reservations.length > 0 ? Math.round((bankMatched / reservations.length) * 100) : 0;

  function downloadStatement(e: React.MouseEvent) {
    e.stopPropagation();
    window.open(`/statement?id=${prop.id}&month=${month}`, '_blank');
  }

  const gtySum = reservations.reduce((s, r) => s + r.guesty_rental_income, 0);
  const stripeSum = reservations.reduce((s, r) => s + r.stripe_fee, 0);
  const adrNum = prop.nights_booked > 0 ? prop.rental_revenue / prop.nights_booked : 0;

  return (
    <div
      style={{
        background: 'var(--paper)',
        borderTop: '1px solid var(--ink)',
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
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3, letterSpacing: '.02em' }}>
                {prop.owner_name} &middot; {prop.management_fee_pct}% management fee
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
          {/* Sources + bank verified */}
          <div className="flex items-center gap-2 flex-wrap" style={{
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

          {/* Financial summary + performance */}
          <div className="rt-two-col" style={{
            display: 'grid',
            gridTemplateColumns: '1.15fr 1fr',
            gap: 40,
            padding: '20px 0 8px',
          }}>
            <div>
              <SectionHead num="01" title="Financials" meta={`Net ${fmt(prop.owner_payout)}`} />
              <table className="w-full tabular-nums" style={{ borderCollapse: 'collapse', fontSize: 12, color: 'var(--ink-2)' }}>
                <tbody>
                  <FinRow label="Gross Revenue" value={fmt(prop.rental_revenue)} />
                  <FinRow label={`Mgmt Fee (${prop.management_fee_pct}%)`} value={`−${fmt(prop.management_fee)}`} negative />
                  <FinRow label="Cleaning" value={`−${fmt(prop.cleaning_total)}`} negative />
                  {prop.repairs_total > 0 && <FinRow label="Repairs" value={`−${fmt(prop.repairs_total)}`} negative />}
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
            <div>
              <SectionHead num="02" title="Performance" />
              <div className="rule-top rule-bottom" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)' }}>
                <Insight label="Stays" value={String(prop.num_stays)} />
                <Insight label="Nights" value={String(prop.nights_booked)} last />
                <Insight label="Mgmt Fee" value={fmtCompact(prop.management_fee)} accent />
                <Insight label="ADR" value={adrNum > 0 ? fmtCompact(adrNum) : '—'} sub="avg. daily rate" last />
              </div>
            </div>
          </div>

          {/* Reservations */}
          {reservations.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <SectionHead num="03" title="Reservations" meta={`${reservations.length} stays`} />
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
                      <td style={{ padding: '10px 6px', color: 'var(--ink)', fontFamily: 'var(--font-fraunces)', fontWeight: 500 }}>{r.guest_name}</td>
                      <td style={{ padding: '10px 6px', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{fmtDate(r.check_in)} → {fmtDate(r.check_out)}</td>
                      <td style={{ padding: '10px 6px', textAlign: 'center', color: 'var(--ink-3)' }}>{r.nights}</td>
                      <td style={{ padding: '10px 6px', textAlign: 'center' }}><PlatformBadge platform={r.platform} /></td>
                      <td style={{ padding: '10px 6px', textAlign: 'right', color: 'var(--ink-3)' }}>{fmt(r.guesty_rental_income)}</td>
                      <td style={{ padding: '10px 6px', textAlign: 'right', color: r.stripe_fee > 0 ? 'var(--negative)' : 'var(--ink-4)' }}>
                        {r.stripe_fee > 0 ? `−${fmt(r.stripe_fee)}` : '—'}
                      </td>
                      <td style={{ padding: '10px 6px', textAlign: 'right', color: 'var(--ink)', fontFamily: 'var(--font-fraunces)', fontSize: 13 }}>{fmt(r.adjusted_revenue)}</td>
                      <td style={{ padding: '10px 6px', textAlign: 'center' }}>
                        {r.bank_match_status === 'matched' ? (
                          <span style={{ color: 'var(--positive)' }}>✓</span>
                        ) : (
                          <span style={{ color: 'var(--ink-4)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-2)' }}>
                    <td style={{ padding: '10px 6px', borderTop: '1px solid var(--ink)' }} colSpan={4}>Totals</td>
                    <td style={{ padding: '10px 6px', textAlign: 'right', borderTop: '1px solid var(--ink)' }}>{fmt(gtySum)}</td>
                    <td style={{ padding: '10px 6px', textAlign: 'right', borderTop: '1px solid var(--ink)', color: stripeSum > 0 ? 'var(--negative)' : 'var(--ink-4)' }}>
                      {stripeSum > 0 ? `−${fmt(stripeSum)}` : '—'}
                    </td>
                    <td style={{ padding: '10px 6px', textAlign: 'right', borderTop: '1px solid var(--ink)' }}>{fmt(prop.rental_revenue)}</td>
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
              <SectionHead num="04" title="Cleaning Charges" meta={`${fmt(prop.cleaning_total)} total`} />
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
                        {ce.guest_name || (ce.invoice_no ? `Invoice ${ce.invoice_no}` : 'Unmatched charge')}
                      </span>
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
                      <span className="font-serif tabular-nums" style={{ fontWeight: 500, color: 'var(--ink)' }}>{fmt(ce.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Data Gaps */}
          {gaps.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <SectionHead num="05" title="Data Gaps" meta={`${gaps.length} flag${gaps.length > 1 ? 's' : ''}`} signal />
              <div>
                {gaps.map((gap) => (
                  <div key={gap.id} style={{
                    padding: '12px 14px',
                    marginBottom: 8,
                    background: 'var(--paper-2)',
                    borderLeft: `3px solid ${gap.severity === 'critical' ? 'var(--negative)' : gap.severity === 'warning' ? 'var(--signal)' : 'var(--ink-4)'}`,
                    fontSize: 12,
                    color: 'var(--ink-2)',
                  }}>
                    <div style={{ fontWeight: 500, color: 'var(--ink)' }}>{gap.description}</div>
                    {gap.expected_data && <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3 }}>{gap.expected_data}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

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
              href="/upload"
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
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main Dashboard ─── */
function DashboardContent() {
  const searchParams = useSearchParams();
  const [period, setPeriod] = useState<StatementPeriod | null>(null);
  const [periods, setPeriods] = useState<{ month: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [inputCode, setInputCode] = useState('');
  const [authError, setAuthError] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ total: number; matched: number; inserted: number; skipped: number } | null>(null);
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
  const [lastSync, setLastSync] = useState<Record<string, string>>({});
  const [fundsSentDate, setFundsSentDate] = useState<string>('');
  const [closeTasks, setCloseTasks] = useState<Record<string, CloseTask>>({});
  const [previewPropertyId, setPreviewPropertyId] = useState<string | null>(null);
  const [draftingProperty, setDraftingProperty] = useState<string | null>(null);
  const [draftResult, setDraftResult] = useState<
    | { url: string; property: string; attachedPdf: boolean; warnings: string[] }
    | string
    | null
  >(null);
  const [transferListOpen, setTransferListOpen] = useState(false);
  const [uploadingCsv, setUploadingCsv] = useState(false);
  const [csvResult, setCsvResult] = useState<
    | { parsed: number; reservations: number; reviews: number; unmatched: number }
    | string
    | null
  >(null);

  const expectedToken = process.env.NEXT_PUBLIC_PORTAL_TOKEN;
  const urlToken = searchParams.get('key');

  useEffect(() => {
    const cookie = document.cookie.split('; ').find(c => c.startsWith('rt_auth='));
    if (cookie && cookie.split('=')[1] === '1') {
      setAuthenticated(true);
      return;
    }
    if (urlToken && urlToken === expectedToken) {
      setAuthenticated(true);
      document.cookie = 'rt_auth=1; path=/; max-age=86400; SameSite=Lax';
    }
    if (!expectedToken) setAuthenticated(true);
  }, [urlToken, expectedToken]);

  const loadPeriod = useCallback(async (month: string) => {
    setLoading(true);
    try {
      const { data: periodData, error: periodError } = await supabase
        .from('statement_periods').select('*').eq('month', month).single();
      if (periodError) throw periodError;

      const { data: props, error: propsError } = await supabase
        .from('property_statements').select('*').eq('period_id', periodData.id).order('property_name');
      if (propsError) throw propsError;

      const enrichedProps = await Promise.all(
        (props || []).map(async (prop: PropertyStatement) => {
          const [resResult, cleanResult, gapResult] = await Promise.all([
            supabase.from('reservations').select('*').eq('property_statement_id', prop.id).order('check_out'),
            supabase.from('cleaning_events').select('*').eq('property_statement_id', prop.id),
            supabase.from('data_gaps').select('*').eq('property_statement_id', prop.id),
          ]);
          return { ...prop, reservations: resResult.data || [], cleaning_events: cleanResult.data || [], data_gaps: gapResult.data || [] };
        })
      );

      setPeriod({ ...periodData, property_statements: enrichedProps });
      setSelectedMonth(month);
      await loadCloseState(periodData.id, month);
    } catch (err) {
      setError('load_failed: ' + (err instanceof Error ? err.message : JSON.stringify(err)));
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadLastSync = useCallback(async () => {
    const { data } = await supabase.from('sync_status').select('source, last_synced_at');
    const map: Record<string, string> = {};
    (data || []).forEach((r: { source: string; last_synced_at: string }) => { map[r.source] = r.last_synced_at; });
    setLastSync(map);
  }, []);

  const loadCloseState = useCallback(async (periodId: string, month: string) => {
    const [{ data: tasks }, { data: periodRow }] = await Promise.all([
      supabase.from('close_tasks').select('*').eq('period_id', periodId),
      supabase.from('statement_periods').select('funds_sent_date').eq('id', periodId).single(),
    ]);
    const map: Record<string, CloseTask> = {};
    (tasks || []).forEach((t: CloseTask) => { map[t.property_id] = t; });
    setCloseTasks(map);
    setFundsSentDate(periodRow?.funds_sent_date || defaultFundsSentDate(month));
  }, []);

  async function saveFundsSentDate(iso: string) {
    setFundsSentDate(iso);
    if (!period) return;
    await supabase.from('statement_periods').update({ funds_sent_date: iso }).eq('id', period.id);
  }

  async function createGmailDraft(propertyId: string) {
    if (!period) return;
    setDraftingProperty(propertyId);
    setDraftResult(null);
    try {
      const tmpl = closeTasks[propertyId]?.email_template || 'monthly';
      const res = await fetch('/api/draft-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: propertyId,
          month: selectedMonth,
          template: tmpl,
          funds_sent_date: fundsSentDate,
          period_id: period.id,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setDraftResult(data.error || 'Draft creation failed');
      } else {
        const propName = PROPERTIES[propertyId]?.name || propertyId;
        setDraftResult({
          url: data.draft_url,
          property: propName,
          attachedPdf: !!data.attached_pdf,
          warnings: Array.isArray(data.warnings) ? data.warnings : [],
        });
        // Reflect the server-side stamp locally so the checkbox updates without a reload.
        setCloseTasks(prev => {
          const existing = prev[propertyId];
          return {
            ...prev,
            [propertyId]: {
              period_id: period.id,
              property_id: propertyId,
              email_template: (existing?.email_template || 'monthly') as CloseTask['email_template'],
              email_drafted_at: new Date().toISOString(),
              email_sent_at: existing?.email_sent_at || null,
              owner_transfer_done_at: existing?.owner_transfer_done_at || null,
              mgmt_sweep_done_at: existing?.mgmt_sweep_done_at || null,
              notes: existing?.notes || null,
            },
          };
        });
        setPreviewPropertyId(null);
      }
    } catch (err) {
      setDraftResult(err instanceof Error ? err.message : 'Draft creation failed');
    } finally {
      setDraftingProperty(null);
    }
  }

  async function saveCloseTaskField(propertyId: string, patch: Partial<CloseTask>) {
    if (!period) return;
    const existing = closeTasks[propertyId];
    const merged: CloseTask = {
      period_id: period.id,
      property_id: propertyId,
      email_template: existing?.email_template || 'monthly',
      email_drafted_at: existing?.email_drafted_at || null,
      email_sent_at: existing?.email_sent_at || null,
      owner_transfer_done_at: existing?.owner_transfer_done_at || null,
      mgmt_sweep_done_at: existing?.mgmt_sweep_done_at || null,
      notes: existing?.notes || null,
      ...patch,
    };
    setCloseTasks(prev => ({ ...prev, [propertyId]: merged }));
    await supabase.from('close_tasks').upsert(merged, { onConflict: 'period_id,property_id' });
  }

  useEffect(() => {
    if (!authenticated) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      try {
        const { data, error: err } = await supabase
          .from('statement_periods')
          .select('month, status')
          .order('month', { ascending: false })
          .limit(24);
        if (err) throw err;
        if (!data || data.length === 0) { setError('no_data'); setLoading(false); return; }
        setPeriods(data);
        await loadPeriod(selectedMonth || data[0].month);
        await loadLastSync();
      } catch (err) {
        setError('load_failed: ' + (err instanceof Error ? err.message : JSON.stringify(err)));
      } finally {
        setLoading(false);
      }
    })();
  }, [authenticated, loadLastSync]);

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
        await loadPeriod(selectedMonth);
      } else {
        setSyncResult({ total: 0, matched: 0, inserted: 0, skipped: 0 });
      }
    } catch {
      setSyncResult({ total: 0, matched: 0, inserted: 0, skipped: 0 });
    } finally {
      setSyncing(false);
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

  /* ─── Login Screen (editorial) ─── */
  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--paper)' }}>
        <div style={{ width: '100%', maxWidth: 380, padding: '0 24px' }}>
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/rising-tide-logo.png" alt="Rising Tide" style={{ width: 56, height: 56, margin: '0 auto 20px' }} />
            <h1 className="font-serif" style={{ fontSize: 32, fontWeight: 400, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
              Rising <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>Tide</em>
            </h1>
            <div className="eyebrow" style={{ marginTop: 8 }}>Owner Statement Portal</div>
          </div>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (inputCode === expectedToken) {
              setAuthenticated(true);
              setAuthError(false);
              document.cookie = 'rt_auth=1; path=/; max-age=86400; SameSite=Lax';
            } else {
              setAuthError(true);
            }
          }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Access Code</div>
            <input
              type="password"
              value={inputCode}
              onChange={(e) => { setInputCode(e.target.value); setAuthError(false); }}
              style={{
                width: '100%',
                padding: '12px 14px',
                background: 'transparent',
                border: 'none',
                borderBottom: `1px solid ${authError ? 'var(--negative)' : 'var(--ink)'}`,
                color: 'var(--ink)',
                fontSize: 18,
                fontFamily: 'var(--font-mono-dash)',
                letterSpacing: '0.12em',
                textAlign: 'center',
                outline: 'none',
              }}
              autoFocus
            />
            {authError && (
              <p style={{ color: 'var(--negative)', fontSize: 11, textAlign: 'center', marginTop: 8, letterSpacing: '.08em', textTransform: 'uppercase' }}>
                Invalid access code
              </p>
            )}
            <button type="submit" style={{
              width: '100%', marginTop: 20,
              background: 'var(--ink)', color: 'var(--paper)',
              fontSize: 11, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase',
              padding: '14px 0',
              border: 'none', cursor: 'pointer',
            }}>
              Continue
            </button>
          </form>
          <p style={{ textAlign: 'center', color: 'var(--ink-4)', fontSize: 10, letterSpacing: '.2em', textTransform: 'uppercase', marginTop: 32 }}>
            Rising Tide &middot; Cape Ann MA
          </p>
        </div>
      </div>
    );
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
          <Link href="/upload" style={{
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

  if (error && error.startsWith('load_failed')) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--paper)' }}>
        <div style={{ textAlign: 'center', maxWidth: 480, padding: '0 24px' }}>
          <div className="eyebrow" style={{ marginBottom: 14, color: 'var(--negative)' }}>Connection Error</div>
          <h1 className="font-serif" style={{ fontSize: 28, fontWeight: 300, color: 'var(--ink)', lineHeight: 1.2 }}>
            Could not reach the database.
          </h1>
          <p style={{ color: 'var(--ink-3)', fontSize: 13, marginTop: 14 }}>Check your connection and try again.</p>
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
          }}>{error}</pre>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center" style={{ background: 'var(--paper)', gap: 14 }}>
        <span style={{
          width: 24, height: 24, borderRadius: '50%',
          border: '2px solid var(--ink)', borderTopColor: 'transparent',
          animation: 'spin 0.8s linear infinite',
        }} />
        <p className="eyebrow">Loading statements</p>
      </div>
    );
  }

  if (!period) return null;

  const props = period.property_statements || [];
  const totalPayout = props.reduce((s, p) => s + p.owner_payout, 0);
  const totalRevenue = props.reduce((s, p) => s + p.rental_revenue, 0);
  const totalMgmt = props.reduce((s, p) => s + p.management_fee, 0);
  const totalCleaning = props.reduce((s, p) => s + p.cleaning_total, 0);
  const totalGaps = props.reduce((s, p) => s + (p.data_gaps?.filter(g => !g.resolved).length || 0), 0);
  const totalStays = props.reduce((s, p) => s + p.num_stays, 0);
  const totalNights = props.reduce((s, p) => s + p.nights_booked, 0);

  return (
    <div className="min-h-screen" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      {/* ─── MASTHEAD ─── */}
      <header className="sticky top-0 z-50" style={{ background: 'var(--paper)', borderBottom: '1px solid var(--ink)' }}>
        <div className="max-w-[1100px] mx-auto px-10">
          {/* Top strip: brand + period */}
          <div className="rt-masthead-top flex items-center justify-between" style={{ padding: '16px 0 12px', borderBottom: '1px solid var(--rule)' }}>
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/rising-tide-logo.png" alt="Rising Tide" style={{ width: 28, height: 28 }} />
              <div className="flex items-baseline gap-3">
                <span className="font-serif" style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--ink)' }}>Rising Tide</span>
                <span style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 500 }}>Owner Statement Portal</span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="eyebrow">Period</div>
              {periods.length > 1 ? (
                <select
                  value={selectedMonth}
                  onChange={(e) => loadPeriod(e.target.value)}
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
                </select>
              ) : (
                <span className="font-serif" style={{ fontSize: 15, fontWeight: 500 }}>{monthLabel(selectedMonth)}</span>
              )}
            </div>
          </div>

          {/* Actions strip */}
          <div className="rt-masthead-actions flex items-center justify-between gap-3" style={{ padding: '10px 0' }}>
            <div className="flex items-center gap-2">
              <EditorialButton
                onClick={syncInvoices}
                disabled={syncing}
                busy={syncing}
                label={syncing ? 'Syncing…' : 'Sync Invoices'}
                meta={lastSync['gmail-invoices'] ? relativeTime(lastSync['gmail-invoices']) : undefined}
                icon={<IconSync className="w-3 h-3" />}
              />
              <EditorialButton
                onClick={syncGuesty}
                disabled={syncingGuesty}
                busy={syncingGuesty}
                label={syncingGuesty ? 'Syncing…' : 'Sync Bookings'}
                meta={lastSync['guesty-reviews'] ? relativeTime(lastSync['guesty-reviews']) : undefined}
                icon={<IconSync className="w-3 h-3" />}
              />
              <label
                title={lastSync['csv-fallback'] ? `CSV uploaded ${relativeTime(lastSync['csv-fallback'])}` : 'Upload Guesty reservations CSV (fallback if API is unavailable)'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  border: '1px solid var(--rule)',
                  background: uploadingCsv ? 'var(--paper-2)' : 'transparent',
                  color: 'var(--ink-3)',
                  fontSize: 11, fontWeight: 500, letterSpacing: '.08em', textTransform: 'uppercase',
                  padding: '6px 12px',
                  cursor: uploadingCsv ? 'wait' : 'pointer',
                  transition: 'background .15s',
                }}
              >
                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {uploadingCsv ? 'Uploading' : 'Upload CSV'}
                {lastSync['csv-fallback'] && !uploadingCsv && (
                  <span style={{ color: 'var(--ink-4)', fontWeight: 400, letterSpacing: 0, textTransform: 'none', fontSize: 10 }}>&middot; {relativeTime(lastSync['csv-fallback'])}</span>
                )}
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  disabled={uploadingCsv}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
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
            <Link href="/upload" style={{
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
      </header>

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
          <Insight label="Properties" value={String(props.length)} sub={`${totalNights} nights booked`} />
          <Insight label="Stays" value={String(totalStays)} sub={props.length > 0 ? `${(totalStays / props.length).toFixed(1)} avg/property` : undefined} />
          <Insight label="Revenue" value={fmtCompact(totalRevenue)} sub={totalNights > 0 ? `${fmtCompact(totalRevenue / totalNights)}/night` : undefined} />
          <Insight label="Mgmt Fees" value={fmtCompact(totalMgmt)} sub={totalRevenue > 0 ? `${((totalMgmt / totalRevenue) * 100).toFixed(1)}% eff.` : undefined} accent />
          <Insight label="Cleaning" value={fmtCompact(totalCleaning)} sub={totalStays > 0 ? `${fmtCompact(totalCleaning / totalStays)} avg/stay` : undefined} />
          <Insight label="Owner Payouts" value={fmtCompact(totalPayout)} sub={totalRevenue > 0 ? `${((totalPayout / totalRevenue) * 100).toFixed(0)}% of revenue` : undefined} last />
        </div>

        {/* Gaps line */}
        {totalGaps > 0 && (
          <div className="flex items-center gap-2" style={{ marginTop: 14, fontSize: 11, color: 'var(--signal)' }}>
            <IconWarning className="w-3.5 h-3.5 shrink-0" />
            <span>
              <strong style={{ fontWeight: 600 }}>{totalGaps}</strong> data gap{totalGaps > 1 ? 's' : ''} across <strong style={{ fontWeight: 600 }}>{props.filter(p => (p.data_gaps?.filter(g => !g.resolved).length || 0) > 0).length}</strong> propert{props.filter(p => (p.data_gaps?.filter(g => !g.resolved).length || 0) > 0).length === 1 ? 'y' : 'ies'} requiring attention
            </span>
          </div>
        )}
      </section>

      {/* ─── CLOSE-OUT PANEL ─── */}
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
              <span className="font-mono" style={{ fontSize: 10, color: 'var(--signal)', letterSpacing: '.08em' }}>06</span>
              <h2 className="font-serif" style={{ fontSize: 18, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>
                Close out <em style={{ color: 'var(--tide-deep)' }}>{monthLong(selectedMonth)}</em>
              </h2>
              <span style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.14em' }}>
                Execution
              </span>
            </div>

            {/* Top strip: funds sent date + totals + actions */}
            <div className="rt-closeout-top" style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto auto',
              gap: 20,
              alignItems: 'center',
              padding: '10px 0',
              borderBottom: '1px dotted var(--rule)',
              marginBottom: 12,
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
            </div>

            {/* Per-property rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {props.map((p) => {
                const cfg = PROPERTIES[p.property_id];
                const task = closeTasks[p.property_id];
                const tmpl = (task?.email_template || 'monthly') as EmailTemplate;
                const emailsMissing = !cfg || cfg.owner_emails.length === 0;
                return (
                  <div key={p.id} className="rt-closeout-row" style={{
                    display: 'grid',
                    gridTemplateColumns: '1.6fr 1.2fr auto auto auto auto auto',
                    gap: 16,
                    alignItems: 'center',
                    padding: '10px 0',
                    borderBottom: '1px dotted var(--rule)',
                    fontSize: 12,
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="font-serif" style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{p.property_name}</div>
                      <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 2 }}>
                        {cfg?.owner_greeting || p.owner_name}
                        {emailsMissing && (
                          <span style={{ color: 'var(--signal)', marginLeft: 6, letterSpacing: '.08em', textTransform: 'uppercase', fontSize: 9 }}>
                            &middot; no email
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="tabular-nums font-serif" style={{ fontSize: 14, color: 'var(--ink)' }}>{fmtCompact(p.owner_payout)}</div>
                      <div style={{ fontSize: 10, color: 'var(--signal)' }}>+ {fmtCompact(p.management_fee)} mgmt</div>
                    </div>
                    <select
                      value={tmpl}
                      onChange={(e) => saveCloseTaskField(p.property_id, { email_template: e.target.value as EmailTemplate })}
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
                    <button
                      onClick={() => setPreviewPropertyId(p.property_id)}
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
                      done={!!task?.email_drafted_at}
                      onToggle={(next) => saveCloseTaskField(p.property_id, { email_drafted_at: next ? new Date().toISOString() : null })}
                    />
                    <CheckTask
                      label="Owner sent"
                      done={!!task?.owner_transfer_done_at}
                      onToggle={(next) => saveCloseTaskField(p.property_id, { owner_transfer_done_at: next ? new Date().toISOString() : null })}
                    />
                    <CheckTask
                      label="Mgmt swept"
                      done={!!task?.mgmt_sweep_done_at}
                      onToggle={(next) => saveCloseTaskField(p.property_id, { mgmt_sweep_done_at: next ? new Date().toISOString() : null })}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Email preview modal */}
      {previewPropertyId && (() => {
        const prop = props.find(p => p.property_id === previewPropertyId);
        const cfg = PROPERTIES[previewPropertyId];
        if (!prop || !cfg) return null;
        const task = closeTasks[previewPropertyId];
        const tmpl = (task?.email_template || 'monthly') as EmailTemplate;
        const { subject, body } = renderEmail({
          greeting: cfg.owner_greeting,
          monthName: monthLabel(selectedMonth),
          propertyShort: cfg.name,
          fundsSentIso: fundsSentDate,
          template: tmpl,
        });
        return (
          <PreviewModal onClose={() => setPreviewPropertyId(null)}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Email preview · {tmpl.replace('_', '-')}</div>
            <h3 className="font-serif" style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>{cfg.owner_full}</h3>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
              To: {cfg.owner_emails.length > 0 ? cfg.owner_emails.join(', ') : <em style={{ color: 'var(--signal)' }}>no email on file</em>}
              <br />
              Cc: {ALWAYS_CC.join(', ')}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 6 }}>From: {SEND_FROM.name} &lt;{SEND_FROM.email}&gt;</div>

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
                owner: PROPERTIES[p.property_id]?.owner_full || p.owner_name,
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
                </div>
              </>
            );
          })()}
        </PreviewModal>
      )}

      {/* ─── Sync toasts ─── */}
      {syncResult && (
        <Toast tone="positive" onDismiss={() => setSyncResult(null)}>
          Invoice sync complete: <strong>{syncResult.total}</strong> found, <strong>{syncResult.matched}</strong> matched, <strong>{syncResult.inserted}</strong> new, <strong>{syncResult.skipped}</strong> skipped
        </Toast>
      )}
      {guestySyncResult && (
        typeof guestySyncResult === 'string' ? (
          <Toast tone="negative" onDismiss={() => setGuestySyncResult(null)}>
            Guesty sync failed: {guestySyncResult}. If urgent, click <strong>Upload CSV</strong>.
          </Toast>
        ) : (
          <Toast tone="tide" onDismiss={() => setGuestySyncResult(null)}>
            Synced from Guesty: <strong>{guestySyncResult.listings}</strong> listings,{' '}
            {guestySyncResult.reviews?.error
              ? <span style={{ color: 'var(--signal)' }}>reviews failed ({guestySyncResult.reviews.error})</span>
              : <><strong>{guestySyncResult.reviews?.upserted ?? 0}</strong> reviews</>}
            ,{' '}
            {guestySyncResult.reservations?.error
              ? <span style={{ color: 'var(--signal)' }}>reservations failed ({guestySyncResult.reservations.error})</span>
              : <><strong>{guestySyncResult.reservations?.upserted ?? 0}</strong> bookings</>}
          </Toast>
        )
      )}
      {csvResult && (
        typeof csvResult === 'string' ? (
          <Toast tone="negative" onDismiss={() => setCsvResult(null)}>CSV upload failed: {csvResult}</Toast>
        ) : (
          <Toast tone="positive" onDismiss={() => setCsvResult(null)}>
            CSV ingested: <strong>{csvResult.parsed}</strong> rows, <strong>{csvResult.reservations}</strong> reservations, <strong>{csvResult.reviews}</strong> reviews
            {csvResult.unmatched > 0 && <span style={{ color: 'var(--signal)' }}> ({csvResult.unmatched} unmatched)</span>}
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
              : <> (no PDF attached — see warnings). </>}
            <a href={draftResult.url} target="_blank" rel="noopener" style={{ color: 'var(--tide-deep)', textDecoration: 'underline' }}>
              Open in Gmail →
            </a>
            {draftResult.warnings.length > 0 && (
              <span style={{ display: 'block', marginTop: 4, color: 'var(--signal)', fontSize: 11 }}>
                {draftResult.warnings.join(' · ')}
              </span>
            )}
          </Toast>
        )
      )}

      {/* ─── Property list ─── */}
      <main className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 8, paddingBottom: 40 }}>
        {props.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>No properties this month</div>
            <h2 className="font-serif" style={{ fontSize: 24, fontWeight: 300, color: 'var(--ink)' }}>
              Nothing uploaded for {monthLabel(selectedMonth)}.
            </h2>
            <Link href="/upload" style={{
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
            {props.map((prop) => <PropertyCard key={prop.id} prop={prop} month={selectedMonth} />)}
            <div style={{ borderTop: '1px solid var(--ink)' }} />
          </div>
        )}
      </main>

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
