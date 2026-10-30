import Link from 'next/link';
import { Fragment } from 'react';
import type { WorkSlipRow } from '@/lib/work-types';
import {
  groupSlipsByLane,
  LANE_LABELS,
  laneCounts,
  slipDetailLine,
  slipDisplayTitle,
  supplyChipLabel,
  type WorkLane,
} from '@/lib/work-slip-lanes';
import type { WorkBriefRow } from '@/lib/work-brief-rules';
import { displayNameForEmail } from '@/lib/team';
import { PropertyAddSlipButton } from './PropertyAddSlipButton';
import { PropertyDraftOwnerEmailButton } from './PropertyDraftOwnerEmailButton';
import { MarkSlipDoneButton } from './MarkSlipDoneButton';

/**
 * The property page's Open Work section: the brief first, the ledger under
 * it.
 *
 * The brief is the paragraph a seasoned operations manager would write
 * about this home (lib/work-briefs.ts, nightly, rewritten only when the
 * slip set changes). The ledger is the receipts, dense on purpose: one line
 * per slip with the synthesized detail inline, the shopping list as one
 * row of chips, office items as one line, clustered slips under one
 * header, and no boilerplate (a claim-status word, an OPEN pill) on rows
 * where it says nothing. Lanes and labels are shared with the Work board and the
 * print sheet (lib/work-slip-lanes.ts).
 */
export function OpenWorkSection({
  property,
  slips,
  brief,
  myEmail,
  myMailbox,
}: {
  property: { id: string; name: string };
  slips: WorkSlipRow[];
  brief: WorkBriefRow | null;
  myEmail: string;
  /** The session's own Gmail for the owner-email draft, or null (copy). */
  myMailbox: string | null;
}) {
  const lanes = groupSlipsByLane(slips);
  const counts = laneCounts(slips);
  const ownerCount = slips.filter((s) => s.owner_action_required).length;
  const countBits = [
    counts.supply && `${counts.supply} to bring`,
    counts.visit && `${counts.visit} this visit`,
    counts.handyman && `${counts.handyman} handyman`,
    counts.pro && `${counts.pro} pro`,
    counts.owner && `${counts.owner} owner`,
    counts.office && `${counts.office} office`,
  ].filter(Boolean) as string[];

  return (
    <section id="open-work" className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 36, width: '100%' }}>
      <div className="flex items-baseline justify-between flex-wrap" style={{ marginBottom: 14, gap: 12 }}>
        <h2
          className="font-serif"
          style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}
        >
          Open Work
        </h2>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <span className="eyebrow">
            {slips.length} open{countBits.length > 1 ? ` · ${countBits.join(' · ')}` : ''}
          </span>
          <PropertyAddSlipButton propertyId={property.id} propertyName={property.name} myEmail={myEmail} />
          <PropertyDraftOwnerEmailButton propertyId={property.id} disabled={ownerCount === 0} myMailbox={myMailbox} />
          {slips.length > 0 && (
            <Link
              href={`/properties/${property.id}/work-slips/print`}
              style={{
                fontSize: 11,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                color: 'var(--ink)',
                textDecoration: 'none',
                border: '1px solid var(--ink)',
                padding: '8px 14px',
                fontWeight: 600,
              }}
            >
              Print →
            </Link>
          )}
        </div>
      </div>

      {/* THE BRIEF: bullets, each a lead (whose hands) and one clause. A
          brief written before bullets existed still shows as a paragraph. */}
      {brief && (brief.items?.length > 0 || brief.brief) && slips.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          {brief.items?.length > 0 ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxWidth: 820 }}>
              {brief.items.map((item, i) => (
                <li
                  key={`${item.lead}-${i}`}
                  style={{ display: 'flex', gap: 12, alignItems: 'baseline', padding: '5px 0', borderBottom: i < brief.items.length - 1 ? '1px dotted var(--rule-soft)' : 'none' }}
                >
                  <span
                    style={{
                      flex: '0 0 112px',
                      fontSize: 10,
                      letterSpacing: '.16em',
                      textTransform: 'uppercase',
                      fontWeight: 700,
                      color: /^urgent/i.test(item.lead) ? 'var(--negative)' : /^(owner|office)/i.test(item.lead) ? 'var(--signal)' : /^bring/i.test(item.lead) ? 'var(--tide-deep)' : 'var(--ink-3)',
                      paddingTop: 2,
                    }}
                  >
                    {item.lead}
                  </span>
                  <span className="font-serif" style={{ fontSize: 15, lineHeight: 1.45, color: 'var(--ink)' }}>
                    {item.text}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-serif" style={{ fontSize: 16, lineHeight: 1.55, color: 'var(--ink-2)', maxWidth: 780, margin: 0 }}>
              {brief.brief}
            </p>
          )}
        </div>
      )}

      {slips.length === 0 ? (
        <div style={{ borderTop: '1px solid var(--ink)', padding: '20px 0', color: 'var(--ink-4)', fontSize: 12 }}>
          No open work for this property.
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {lanes.map(({ lane, slips: laneSlips }) => (
            <Fragment key={lane}>
              <LaneLabel lane={lane} count={laneSlips.length} />
              {lane === 'supply' ? (
                <SupplyLine slips={laneSlips} propertyName={property.name} />
              ) : lane === 'office' ? (
                <OfficeLine slips={laneSlips} propertyName={property.name} />
              ) : (
                <LaneRows slips={laneSlips} lane={lane} property={property} />
              )}
            </Fragment>
          ))}
        </div>
      )}
    </section>
  );
}

function laneColor(lane: WorkLane): string {
  if (lane === 'owner' || lane === 'pro') return 'var(--signal)';
  if (lane === 'supply') return 'var(--tide-deep)';
  if (lane === 'office') return 'var(--ink-4)';
  return 'var(--ink-3)';
}

function LaneLabel({ lane, count }: { lane: WorkLane; count: number }) {
  return (
    <div
      style={{
        padding: '14px 0 4px',
        fontSize: 10,
        letterSpacing: '.16em',
        textTransform: 'uppercase',
        fontWeight: 700,
        color: laneColor(lane),
      }}
    >
      {LANE_LABELS[lane]} · {count}
    </div>
  );
}

/** The shopping list as one row of chips, each a link to its slip. */
function SupplyLine({ slips, propertyName }: { slips: WorkSlipRow[]; propertyName: string }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '4px 0 12px', borderBottom: '1px solid var(--rule)' }}>
      {slips.map((s) => (
        <Link
          key={s.id}
          href={`/work/${s.id}`}
          title={s.title}
          style={{
            fontSize: 12,
            color: 'var(--tide-deep)',
            border: '1px solid var(--tide)',
            background: 'rgba(78, 124, 158, 0.10)',
            padding: '3px 10px',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {supplyChipLabel(s, propertyName)}
          {s.priority === 'high' ? ' !' : ''}
        </Link>
      ))}
    </div>
  );
}

/** Desk work as one line: titles, who has it, nothing else. */
function OfficeLine({ slips, propertyName }: { slips: WorkSlipRow[]; propertyName: string }) {
  return (
    <div style={{ padding: '4px 0 12px', borderBottom: '1px solid var(--rule)', fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
      {slips.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 && <span> · </span>}
          <Link href={`/work/${s.id}`} style={{ color: 'var(--ink-2)', textDecoration: 'none' }}>
            {slipDisplayTitle(s.title, propertyName)}
          </Link>
          {(s.assigned_to_label || s.assigned_to_email) && (
            <span style={{ color: 'var(--ink-4)' }}> ({s.assigned_to_label || displayNameForEmail(s.assigned_to_email!)})</span>
          )}
        </Fragment>
      ))}
    </div>
  );
}

const OWNER_ASK: Record<string, string> = {
  purchase: 'owner · purchase',
  approve: 'owner · approve',
  schedule: 'owner · schedule',
  decide: 'owner · decide',
  reimburse: 'owner · reimburse',
};

function LaneRows({ slips, lane, property }: { slips: WorkSlipRow[]; lane: WorkLane; property: { id: string; name: string } }) {
  let lastGroup: string | null = null;
  return (
    <>
      {slips.map((s) => {
        const group = s.organize_group ?? null;
        const showGroup = !!group && group !== lastGroup;
        lastGroup = group;
        const detail = slipDetailLine(s, property.name, 180);
        const chips: Array<{ text: string; color: string }> = [];
        if (s.status === 'in_progress') chips.push({ text: 'started', color: 'var(--ink-3)' });
        if (s.status === 'scheduled') chips.push({ text: 'scheduled', color: 'var(--ink-3)' });
        if (s.status === 'blocked') chips.push({ text: 'blocked', color: 'var(--signal)' });
        if (s.coordinator_email) chips.push({ text: `Coordinator: ${displayNameForEmail(s.coordinator_email)}`, color: 'var(--ink-3)' });
        if (s.follow_up_date) chips.push({ text: `follow up ${shortDate(s.follow_up_date)}`, color: 'var(--tide-deep)' });
        if (s.scheduled_date) chips.push({ text: `for ${shortDate(s.scheduled_date)}`, color: 'var(--ink-3)' });
        if (s.assigned_to_label || s.assigned_to_email) {
          chips.push({ text: s.assigned_to_label || displayNameForEmail(s.assigned_to_email!), color: 'var(--ink-3)' });
        }
        if (s.owner_action_required) {
          const stand =
            s.owner_status === 'approved' ? ' · approved' : s.owner_status === 'declined' ? ' · declined' : s.owner_status === 'questions' ? ' · questions' : s.owner_last_contacted_at ? ' · asked' : '';
          chips.push({ text: `${OWNER_ASK[s.owner_action_type ?? ''] ?? 'owner'}${stand}`, color: 'var(--signal)' });
        }
        return (
          <Fragment key={s.id}>
            {showGroup && (
              <div style={{ paddingTop: 8, fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--ink-3)' }}>
                ↳ {s.organize_group_label ?? group!.replace(/-/g, ' ')}
              </div>
            )}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '9px 0',
                paddingLeft: group ? 14 : 0,
                borderBottom: '1px solid var(--rule)',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: s.priority === 'high' ? 'var(--negative)' : lane === 'owner' ? 'var(--signal)' : 'var(--ink-4)',
                }}
              />
              <Link href={`/work/${s.id}`} style={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit', fontSize: 13, lineHeight: 1.45 }}>
                <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{slipDisplayTitle(s.title, property.name)}</span>
                {detail && <span style={{ color: 'var(--ink-3)' }}> · {detail}</span>}
                {chips.map((c) => (
                  <span
                    key={c.text}
                    style={{
                      marginLeft: 8,
                      fontSize: 9,
                      letterSpacing: '.14em',
                      textTransform: 'uppercase',
                      fontWeight: 600,
                      color: c.color,
                      border: `1px solid ${c.color}`,
                      padding: '1px 6px',
                      whiteSpace: 'nowrap',
                      verticalAlign: 'middle',
                    }}
                  >
                    {c.text}
                  </span>
                ))}
              </Link>
              <MarkSlipDoneButton slipId={s.id} propertyId={property.id} />
            </div>
          </Fragment>
        );
      })}
    </>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
}
