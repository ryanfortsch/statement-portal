import { notFound } from 'next/navigation';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { HelmPropertyRow } from '@/lib/properties';
import type { WorkSlipRow } from '@/lib/work-types';
import { ACTIVE_WORK_SLIP_STATUSES } from '@/lib/work-types';
import {
  groupSlipsByLane,
  LANE_HINTS,
  LANE_LABELS,
  laneCounts,
  slipDetailLine,
  slipDisplayTitle,
  slipSourceLabel,
  supplyChipLabel,
  type WorkLane,
} from '@/lib/work-slip-lanes';
import { loadWorkBrief, type WorkBriefRow } from '@/lib/work-briefs';
import { PrintButton } from './PrintButton';
import { SlipRow, type PrintSlip } from './SlipRow';

export const dynamic = 'force-dynamic';

type Params = { id: string };
type Search = { auto?: string };

async function getData(id: string): Promise<{
  property: HelmPropertyRow;
  slips: WorkSlipRow[];
  brief: WorkBriefRow | null;
} | null> {
  const { data: property } = await supabase
    .from('properties')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!property) return null;

  const todayIso = new Date().toISOString().slice(0, 10);
  const { data: slipsData } = await supabase
    .from('work_slips')
    .select('*')
    .eq('property_id', id)
    .in('status', ACTIVE_WORK_SLIP_STATUSES)
    .or(`snoozed_until.is.null,snoozed_until.lte.${todayIso}`)
    // Lane order, priority and clustering are applied in memory
    // (groupSlipsByLane); the read just needs a stable base order.
    .order('created_at', { ascending: true });

  const brief = await loadWorkBrief(supabase, id).catch(() => null);
  return {
    property: property as HelmPropertyRow,
    slips: (slipsData ?? []) as WorkSlipRow[],
    brief,
  };
}

const OWNER_ASK_LABELS: Record<string, string> = {
  purchase: 'Purchase',
  approve: 'Approval',
  schedule: 'Scheduling',
  decide: 'Decision',
  reimburse: 'Reimbursement',
};

function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
}

/** The meta line under a printed row: where it came from and when, whether
 *  someone standing in the home has confirmed it is still open, the date
 *  it is for, and for an owner item where the ask stands. */
function metaLine(slip: WorkSlipRow, lane: WorkLane, today: string): string {
  const parts: string[] = [];
  const opened = shortDate(slip.created_at);
  parts.push(`From ${slipSourceLabel(slip)}${opened ? ` · ${opened}` : ''}`);
  if (slip.scheduled_date) {
    parts.push(slip.scheduled_date < today ? `overdue since ${shortDate(slip.scheduled_date)}` : `for ${shortDate(slip.scheduled_date)}`);
  }
  if (slip.last_verified_open_at) parts.push(`still open ${shortDate(slip.last_verified_open_at)}`);
  if (slip.status === 'in_progress') parts.push('started');
  if (lane === 'owner') {
    const ask = slip.owner_action_type ? OWNER_ASK_LABELS[slip.owner_action_type] ?? slip.owner_action_type : 'Owner input';
    const stand =
      slip.owner_status === 'approved'
        ? 'approved'
        : slip.owner_status === 'declined'
          ? 'declined'
          : slip.owner_status === 'questions'
            ? 'owner has questions'
            : slip.owner_last_contacted_at
              ? `asked ${shortDate(slip.owner_last_contacted_at)}`
              : 'not asked yet';
    parts.push(`${ask} · ${stand}`);
  }
  if (slip.location) parts.push(slip.location);
  return parts.join(' · ');
}

export default async function WorkSlipsPrintPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const { id } = await params;
  const { auto } = await searchParams;
  const data = await getData(id);
  if (!data) notFound();

  const { property, slips, brief } = data;
  const todayIso = new Date().toISOString().slice(0, 10);
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const lanes = groupSlipsByLane(slips);
  const counts = laneCounts(slips);
  const visitCount = counts.supply + counts.visit;
  const waitingCount = counts.handyman + counts.pro + counts.owner + counts.office;
  const summaryBits = [
    counts.supply && `${counts.supply} to bring`,
    counts.visit && `${counts.visit} for this visit`,
    counts.handyman && `${counts.handyman} for a handyman run`,
    counts.pro && `${counts.pro} for a pro`,
    counts.owner && `${counts.owner} waiting on the owner`,
    counts.office && `${counts.office} for the office`,
  ].filter(Boolean) as string[];

  // Row numbers run across the whole sheet so a phone call can say "number
  // 14" and both people find it; the lane header carries its own count.
  let number = 0;
  const sections = lanes.map(({ lane, slips: laneSlips }) => {
    const rows: Array<{ slip: PrintSlip; groupLabel: string | null }> = [];
    let lastGroup: string | null = null;
    for (const s of laneSlips) {
      number += 1;
      const group = s.organize_group ?? null;
      rows.push({
        slip: {
          id: s.id,
          number,
          title: slipDisplayTitle(s.title, property.name),
          detail: lane === 'office' ? null : slipDetailLine(s, property.name, 260),
          meta: metaLine(s, lane, todayIso),
          priority: s.priority,
          categoryLabel: null,
          done: s.status === 'done',
        },
        // A cluster header prints once, above the first member of a run of
        // slips that share a group inside this lane.
        groupLabel: group && group !== lastGroup ? s.organize_group_label ?? group.replace(/-/g, ' ') : null,
      });
      lastGroup = group;
    }
    return { lane, rows };
  });

  return (
    <>
      {/* Print-specific styles. Inline so this file is self-contained
          and the print page never depends on layout.tsx chrome. */}
      <style>{`
        @page { size: letter; margin: 0.6in 0.5in; }
        @media print {
          [data-no-print] { display: none !important; }
          .ws-pdf-sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; }
          .ws-pdf-page { background: white !important; }
          .ws-pdf-row { break-inside: avoid; opacity: 1 !important; }
          .ws-pdf-lane-head { break-after: avoid; break-inside: avoid; }
          .ws-pdf-group { break-after: avoid; }
          /* Paper always prints pristine — tick boxes empty, no strikethrough,
             regardless of what got tapped on screen. */
          .ws-pdf-row-done { opacity: 1 !important; }
          .ws-pdf-row-body { text-decoration: none !important; }
          .ws-tick { background: transparent !important; color: transparent !important; }
          .ws-tick-mark { display: none !important; }
        }
        .ws-pdf-page {
          background: var(--paper-2);
          min-height: 100vh;
          padding: 32px 16px;
        }
        .ws-pdf-sheet {
          background: var(--paper);
          color: var(--ink);
          width: 100%;
          max-width: 7.5in;
          margin: 0 auto;
          padding: 56px 64px;
          box-shadow: 0 6px 28px rgba(0,0,0,0.08);
        }
      `}</style>

      <div className="ws-pdf-page">
        {/* Action bar (screen-only) */}
        <div
          data-no-print
          style={{
            maxWidth: '7.5in',
            margin: '0 auto 18px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <a
            href={`/properties/${id}`}
            style={{
              fontSize: 11,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
              textDecoration: 'none',
            }}
          >
            ← Property folder
          </a>
          <PrintButton autoPrint={auto === '1'} />
        </div>

        <article className="ws-pdf-sheet">
          {/* MASTHEAD */}
          <header
            style={{
              borderBottom: '1px solid var(--ink)',
              paddingBottom: 16,
              marginBottom: 28,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <div
              className="font-mono"
              style={{
                fontSize: 10,
                letterSpacing: '.22em',
                textTransform: 'uppercase',
                color: 'var(--ink-3)',
              }}
            >
              Rising Tide · Work Slip Checklist
            </div>
            <div
              className="font-mono"
              style={{
                fontSize: 10,
                letterSpacing: '.22em',
                textTransform: 'uppercase',
                color: 'var(--ink-4)',
              }}
            >
              {today}
            </div>
          </header>

          {/* HERO */}
          <section style={{ marginBottom: 28 }}>
            <div
              style={{
                fontSize: 10,
                letterSpacing: '.22em',
                textTransform: 'uppercase',
                color: 'var(--signal)',
                marginBottom: 12,
                fontWeight: 600,
              }}
            >
              Open work
            </div>
            <h1
              className="font-serif"
              style={{
                fontSize: 38,
                lineHeight: 1.05,
                fontWeight: 300,
                letterSpacing: '-0.02em',
                color: 'var(--ink)',
                margin: 0,
              }}
            >
              {property.name}
            </h1>
            <p style={{ marginTop: 6, fontSize: 13, color: 'var(--ink-3)' }}>
              {property.address || property.title || property.city}
              {property.owner_last && ` · ${property.owner_last}`}
            </p>
            {/* The brief leads: the paragraph a seasoned operations manager
                would write about this home (lib/work-briefs.ts). The old
                one-line count stands in when no brief has been written yet. */}
            <p
              className={brief?.brief && slips.length > 0 ? 'font-serif' : undefined}
              style={{
                marginTop: 18,
                fontSize: brief?.brief && slips.length > 0 ? 15 : 14,
                color: 'var(--ink-2)',
                lineHeight: 1.55,
                fontStyle: brief?.brief && slips.length > 0 ? 'normal' : 'italic',
                maxWidth: 600,
              }}
            >
              {slips.length === 0
                ? 'No open work slips. Nothing to bring.'
                : brief?.brief
                  ? brief.brief
                  : visitCount > 0
                    ? `${visitCount} ${visitCount === 1 ? 'item' : 'items'} for this visit${waitingCount > 0 ? `, ${waitingCount} waiting on someone else` : ''}.`
                    : `Nothing for a routine visit. ${waitingCount} ${waitingCount === 1 ? 'item is' : 'items are'} waiting on someone else.`}
            </p>
            {summaryBits.length > 1 && (
              <p style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
                {summaryBits.join(' · ')}
              </p>
            )}
          </section>

          {/* CHECKLIST, one section per lane in walk order */}
          {sections.map(({ lane, rows }) => (
            <section key={lane} style={{ marginBottom: 22 }}>
              <div
                className="ws-pdf-lane-head"
                style={{
                  borderTop: '1px solid var(--ink)',
                  paddingTop: 12,
                  paddingBottom: 6,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: 16,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      letterSpacing: '.2em',
                      textTransform: 'uppercase',
                      fontWeight: 700,
                      color: lane === 'owner' || lane === 'pro' ? 'var(--signal)' : lane === 'supply' ? 'var(--tide-deep)' : 'var(--ink)',
                    }}
                  >
                    {LANE_LABELS[lane]}
                  </div>
                  <div style={{ marginTop: 3, fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' }}>
                    {LANE_HINTS[lane]}
                  </div>
                </div>
                <div className="font-mono" style={{ fontSize: 10, letterSpacing: '.14em', color: 'var(--ink-4)' }}>
                  {rows.length}
                </div>
              </div>
              {lane === 'supply' && (
                <div className="ws-pdf-row" style={{ display: 'grid', gridTemplateColumns: '36px 1fr', gap: 18, padding: '12px 0', borderBottom: '1px solid var(--rule)' }}>
                  <span aria-hidden style={{ width: 28, height: 28, marginTop: 2, border: '1.5px solid var(--ink)', display: 'block' }} />
                  <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.5 }}>
                    <span style={{ fontWeight: 500 }}>Bring: </span>
                    {lanes
                      .find((l) => l.lane === 'supply')!
                      .slips.map((s) => `${supplyChipLabel(s, property.name)}${s.priority === 'high' ? ' (high)' : ''}`)
                      .join(', ')}
                  </div>
                </div>
              )}
              {/* Office items are for the office, not for whoever carries
                  this sheet, and a concierge title can name a guest. A
                  count is all the sheet says; the property page lists them. */}
              {lane === 'office' && (
                <div style={{ padding: '10px 0 12px', borderBottom: '1px solid var(--rule)', fontSize: 12, color: 'var(--ink-4)', fontStyle: 'italic' }}>
                  {rows.length} office {rows.length === 1 ? 'item' : 'items'} on the property page, not on this sheet.
                </div>
              )}
              {lane !== 'supply' && lane !== 'office' && rows.map(({ slip, groupLabel }) => (
                <div key={slip.id}>
                  {groupLabel && (
                    <div
                      className="ws-pdf-group"
                      style={{
                        marginTop: 10,
                        fontSize: 10,
                        letterSpacing: '.16em',
                        textTransform: 'uppercase',
                        fontWeight: 600,
                        color: 'var(--ink-3)',
                      }}
                    >
                      ↳ {groupLabel}
                    </div>
                  )}
                  <SlipRow slip={slip} />
                </div>
              ))}
            </section>
          ))}

          {/* COLOPHON */}
          <footer
            style={{
              marginTop: 36,
              paddingTop: 16,
              borderTop: '1px solid var(--ink)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <span
              className="font-mono"
              style={{
                fontSize: 9,
                letterSpacing: '.22em',
                textTransform: 'uppercase',
                color: 'var(--ink-4)',
              }}
            >
              Rising Tide · Helm
            </span>
            <span
              style={{
                fontSize: 10,
                color: 'var(--ink-4)',
                fontStyle: 'italic',
              }}
            >
              Snapshot generated {today}
            </span>
          </footer>
        </article>
      </div>
    </>
  );
}
