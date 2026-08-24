import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { WorkSlipRow, WorkSlipCommentRow } from '@/lib/work-types';
import {
  WORK_SLIP_CATEGORY_LABELS,
} from '@/lib/work-types';
import { BackToBoardLink } from './BackToBoardLink';
import { SlipPhotoEditor } from './SlipPhotoEditor';
import { SlipAssignEditor } from './SlipAssignEditor';
import { SlipScopeEditor } from './SlipScopeEditor';
import { SlipComments } from './SlipComments';
import { SlipTitleEditor } from './SlipTitleEditor';
import { SlipBringListEditor } from './SlipBringListEditor';
import { SlipClosePanel } from './SlipClosePanel';
import { SlipOwnerActionEditor } from './SlipOwnerActionEditor';

export const dynamic = 'force-dynamic';

type PropertyMini = { id: string; name: string; title: string | null; city: string };
type InspectionMini = { id: string; inspector_name: string; started_at: string | null };
type InspectionItemMini = { id: string; title: string; category: string };

async function getWorkSlip(id: string): Promise<{
  slip: WorkSlipRow;
  property: PropertyMini | null;
  inspection: InspectionMini | null;
  inspectionItem: InspectionItemMini | null;
  comments: WorkSlipCommentRow[];
} | null> {
  const { data: slip, error } = await supabase
    .from('work_slips')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error || !slip) return null;

  const ws = slip as WorkSlipRow;

  const [{ data: property }, { data: inspection }, { data: inspectionItem }, { data: comments }] = await Promise.all([
    supabase
      .from('properties')
      .select('id, name, title, city')
      .eq('id', ws.property_id)
      .maybeSingle(),
    ws.inspection_id
      ? supabase
          .from('inspections')
          .select('id, inspector_name, started_at')
          .eq('id', ws.inspection_id)
          .maybeSingle()
      : Promise.resolve({ data: null as InspectionMini | null }),
    ws.inspection_item_id
      ? supabase
          .from('inspection_items')
          .select('id, title, category')
          .eq('id', ws.inspection_item_id)
          .maybeSingle()
      : Promise.resolve({ data: null as InspectionItemMini | null }),
    supabase
      .from('work_slip_comments')
      .select('*')
      .eq('work_slip_id', id)
      .order('created_at', { ascending: true }),
  ]);

  return {
    slip: ws,
    property: (property as PropertyMini) ?? null,
    inspection: (inspection as InspectionMini) ?? null,
    inspectionItem: (inspectionItem as InspectionItemMini) ?? null,
    comments: (comments ?? []) as WorkSlipCommentRow[],
  };
}

type Params = { id: string };

export default async function WorkSlipDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const [data, session] = await Promise.all([getWorkSlip(id), auth()]);
  if (!data) notFound();
  const myEmail = session?.user?.email ?? '';

  const { slip, property, inspection, inspectionItem, comments } = data;

  // A slip carrying an out-of-pocket receipt: say whether the money is riding
  // a payout or still needs a home, so a contractor's reimbursement can never
  // silently die in a description ("$27.60 TP holders", 2026-08-23).
  const receiptPacket =
    (slip.expense_cents ?? 0) > 0 && slip.reported_from_packet_id
      ? ((await supabase
          .from('inspection_packets')
          .select('id, title, visit_date, paid_at')
          .eq('id', slip.reported_from_packet_id)
          .maybeSingle()).data as { id: string; title: string; visit_date: string; paid_at: string | null } | null)
      : null;

  const priorityColor =
    slip.priority === 'high' ? 'var(--negative)' :
    slip.priority === 'low' ? 'var(--ink-4)' :
    'var(--ink-3)';

  const statusColor =
    slip.status === 'done'        ? 'var(--positive)' :
    slip.status === 'in_progress' ? 'var(--signal)'   :
    slip.status === 'scheduled'   ? 'var(--tide-deep)' :
    slip.status === 'blocked'     ? 'var(--negative)' :
    slip.status === 'dismissed'   ? 'var(--ink-4)' :
    'var(--ink-3)';

  // Cold-load back target: open this property's group on the board. A
  // snoozed slip's group only renders under the Snoozed pill, so carry
  // that filter too or the anchor would point at nothing.
  const isSnoozed = !!slip.snoozed_until && slip.snoozed_until > new Date().toISOString().slice(0, 10);
  const backFallbackHref = `/work?open=${slip.property_id}${isSnoozed ? '&filter=snoozed' : ''}#prop-${slip.property_id}`;

  const hasPhotos = (slip.photo_urls ?? []).length > 0;

  return (
    <>
      {/* BACK — returns to the board as you left it (filter/tab/expanded
          groups restored from the board's own URL mirror), with this slip's
          property group opened and scrolled into view. */}
      <div className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 24, width: '100%' }}>
        <BackToBoardLink
          fallbackHref={backFallbackHref}
          propertyId={slip.property_id}
        />
      </div>

      {/* HERO */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 24, paddingBottom: 28, width: '100%' }}>
        <SlipTitleEditor slipId={slip.id} initialTitle={slip.title} />
        <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: 14 }}>
          <Pill color={statusColor} label={slip.status.replace('_', ' ').toUpperCase()} solid />
          <Pill color={priorityColor} label={`${slip.priority.toUpperCase()} priority`} />
          <Pill color="var(--ink-4)" label={WORK_SLIP_CATEGORY_LABELS[slip.category] ?? slip.category} />
        </div>
      </section>

      {/* STAT GRID — assignment lives here as an inline picker instead of
          its own section (only 1-in-25 slips is ever assigned). */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 48, width: '100%' }}>
        <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)' }}>
          {/* auto-fit lets the cells wrap on narrow viewports; the
              TeamPicker cell is wider than plain text and would overflow
              a rigid four-column track on a phone. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <Stat
              label="Property"
              value={property ? property.name : slip.property_id}
              sub={slip.location || undefined}
              href={property ? `/properties/${property.id}` : undefined}
            />
            <Stat
              label="Created"
              value={formatDate(slip.created_at)}
              sub={slip.created_by_email.split('@')[0]}
            />
            <Stat
              label={slip.completed_at ? 'Completed' : 'Status'}
              value={slip.completed_at ? formatDate(slip.completed_at) : slip.status.replace('_', ' ')}
              sub={
                slip.scheduled_date && !slip.completed_at
                  ? `due ${formatDate(slip.scheduled_date)}`
                  : undefined
              }
            />
            <StatCell label="Assigned" last>
              <SlipAssignEditor
                slipId={slip.id}
                initialAssignedToEmail={slip.assigned_to_email}
                myEmail={myEmail}
              />
            </StatCell>
          </div>
        </div>
      </section>

      {/* DESCRIPTION */}
      {(slip.description || slip.action_summary) && (
        <Section title="Details" eyebrow="What's needed">
          {slip.action_summary && (
            <div style={{ marginBottom: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 6, color: 'var(--signal)' }}>Action summary</div>
              <p style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.5, margin: 0 }}>
                {slip.action_summary}
              </p>
            </div>
          )}
          {slip.description && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Description</div>
              <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55, margin: 0, whiteSpace: 'pre-wrap' }}>
                {slip.description}
              </p>
            </div>
          )}
        </Section>
      )}

      {/* OUT-OF-POCKET RECEIPT — where the money stands, always. */}
      {(slip.expense_cents ?? 0) > 0 && (
        <Section title="Receipt" eyebrow="Out of pocket">
          <div style={{ fontSize: 14.5, lineHeight: 1.6 }}>
            <span className="font-mono" style={{ fontWeight: 600 }}>${((slip.expense_cents ?? 0) / 100).toFixed(2)}</span>
            {receiptPacket && !receiptPacket.paid_at ? (
              <span style={{ color: 'var(--positive)' }}>
                {' '}· riding the payout for{' '}
                <Link href={`/fieldwork/packets/${receiptPacket.id}`} style={{ color: 'var(--tide-deep)', fontWeight: 600, textDecoration: 'none' }}>
                  {receiptPacket.title}
                </Link>
                {' '}— paid out with that visit.
              </span>
            ) : (
              <span style={{ color: 'var(--signal)', fontWeight: 600 }}>
                {' '}· not in any payout yet — add it at their next packet&apos;s approval (bonus or final).
              </span>
            )}
          </div>
        </Section>
      )}

      {/* SOURCE INSPECTION */}
      {inspection && (
        <Section title="Source" eyebrow="Created from inspection">
          <Link
            href={`/inspections/${inspection.id}/summary`}
            style={{
              display: 'block',
              padding: '14px 16px',
              border: '1px solid var(--rule)',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
              Inspection by {inspection.inspector_name}
              {inspection.started_at && ` · ${formatDate(inspection.started_at)}`}
            </div>
            {inspectionItem && (
              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)' }}>
                Card: {inspectionItem.category} &middot; {inspectionItem.title}
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
              View inspection summary →
            </div>
          </Link>
        </Section>
      )}

      {/* WHO DOES THIS — maintenance-run triage */}
      {slip.category === 'maintenance' && (
        <Section title="Who does this" eyebrow="Run triage">
          <SlipScopeEditor
            slipId={slip.id}
            initialScope={slip.run_scope ?? null}
            initialNote={slip.run_scope_note ?? null}
          />
        </Section>
      )}

      {/* OWNER INPUT — same shape as Photos: a full section only when the
          slip is flagged; arming it lives in the quiet row below. This is
          the writer for the whole owner-action rail (board filter, OWNER
          badges, daily brief, Draft-owner-email bundler). */}
      {slip.owner_action_required && (
        <Section
          title="Owner input"
          eyebrow={
            slip.owner_status === 'approved'
              ? 'Owner approved'
              : slip.owner_status === 'declined'
                ? 'Owner declined'
                : slip.owner_status === 'questions'
                  ? 'Owner has questions'
                  : slip.owner_status === 'sent'
                    ? 'Asked, awaiting reply'
                    : 'Not asked yet'
          }
        >
          <SlipOwnerActionEditor
            slipId={slip.id}
            propertyId={slip.property_id}
            initialType={slip.owner_action_type ?? null}
            initialNotes={slip.owner_action_notes ?? null}
            ownerStatus={slip.owner_status ?? null}
            ownerLastContactedAt={slip.owner_last_contacted_at ?? null}
          />
        </Section>
      )}

      {/* PHOTOS — a full section only when there are photos to show;
          otherwise adding one lives in the quiet row below. */}
      {hasPhotos && (
        <Section title="Photos" eyebrow={`${slip.photo_urls.length} attached`}>
          <SlipPhotoEditor
            slipId={slip.id}
            propertyId={slip.property_id}
            initialUrls={slip.photo_urls ?? []}
          />
        </Section>
      )}

      {/* CLOSE OUT — notes + the operator's actual verbs (Mark done,
          Dismiss, Snooze, Reopen). Machine states like in_progress and
          scheduled still display in the hero pill; they were never
          buttons anyone pressed. */}
      <Section
        title="Wrap up"
        eyebrow={
          // Closed beats snoozed: a done slip can carry a stale snooze
          // date, and "Snoozed until" over a completed slip reads wrong.
          slip.status === 'done'
            ? 'Completed'
            : slip.status === 'dismissed'
              ? 'Dismissed'
              : isSnoozed
                ? `Snoozed until ${slip.snoozed_until}`
                : 'When it’s handled'
        }
      >
        <SlipClosePanel
          workSlipId={slip.id}
          propertyId={slip.property_id}
          initialStatus={slip.status}
          initialResolutionNotes={slip.resolution_notes ?? null}
          initialSnoozedUntil={slip.snoozed_until ?? null}
        />
      </Section>

      {/* THE QUIET ROW — rarely-used extras collapse to one line each
          until they have content: supply run (3% of slips), photos when
          none yet, comments (1% of slips). */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 48, width: '100%' }}>
        <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SlipBringListEditor slipId={slip.id} initialBringList={slip.bring_list ?? null} />
          {!slip.owner_action_required && (
            <SlipOwnerActionEditor
              slipId={slip.id}
              propertyId={slip.property_id}
              initialType={null}
              initialNotes={null}
              ownerStatus={slip.owner_status ?? null}
              ownerLastContactedAt={slip.owner_last_contacted_at ?? null}
              collapsed
            />
          )}
          {!hasPhotos && (
            <SlipPhotoEditor
              slipId={slip.id}
              propertyId={slip.property_id}
              initialUrls={[]}
              collapsed
            />
          )}
          <SlipComments slipId={slip.id} initialComments={comments} myEmail={myEmail} />
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop: '1px solid var(--ink)', marginTop: 'auto' }}>
        <div
          className="max-w-[1100px] mx-auto px-10 flex items-center justify-between"
          style={{
            padding: '14px 40px',
            fontSize: 10,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-4)',
          }}
        >
          <span>Rising Tide &middot; Work Slip {slip.id.slice(0, 8)}</span>
          <span style={{ fontStyle: 'italic', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-3)', fontSize: 11 }}>
            Source: Helm
          </span>
        </div>
      </footer>
    </>
  );
}

function Section({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 48, width: '100%' }}>
      <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
        <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
          {title}
        </h2>
        <span className="eyebrow">{eyebrow}</span>
      </div>
      <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 18 }}>{children}</div>
    </section>
  );
}

function StatCell({
  label,
  children,
  last = false,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      style={{
        padding: '20px 22px',
        borderRight: last ? 'none' : '1px solid var(--rule)',
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  href,
  last = false,
}: {
  label: string;
  value: string;
  sub?: string;
  href?: string;
  last?: boolean;
}) {
  const inner = (
    <StatCell label={label} last={last}>
      <div className="font-serif" style={{ fontSize: 18, fontWeight: 400, color: 'var(--ink)', lineHeight: 1.2 }}>
        {value}
      </div>
      {sub && (
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)' }}>{sub}</div>
      )}
    </StatCell>
  );
  if (href) {
    return (
      <Link href={href} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
        {inner}
      </Link>
    );
  }
  return inner;
}

function Pill({ color, label, solid = false }: { color: string; label: string; solid?: boolean }) {
  return (
    <span
      style={{
        background: solid ? color : 'transparent',
        color: solid ? 'var(--paper)' : color,
        border: `1.5px solid ${color}`,
        padding: '4px 12px',
        fontSize: 10,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  );
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  try {
    // Bare DATE values (scheduled_date) parse as UTC midnight and would
    // render a day early in Eastern time; anchor them to local noon.
    const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return value;
  }
}
