'use client';

/**
 * The Maintenance runs board, hosted on its own Work tab (/work/maintenance
 * — as a rail on /work it crowded the triage queue off the screen).
 *
 * The planner (lib/maintenance-runs.ts) scans open handyman-scope slips +
 * property calendars and lays draft maintenance packets on empty days.
 * This board is where those plans surface for the operator: suggested runs
 * to publish, live runs in flight, the 'pro' slips that need a vendor
 * booked, and the backlog that hasn't earned a run yet.
 *
 * Any run or vendor group can be emailed as an organized work order —
 * jobs numbered, photos attached with matching filenames — to a roster
 * recipient (CRM contacts + field contractors). The composer creates a
 * Gmail DRAFT (from dotti@, cc allie@ + ryan@, statement-workflow rhythm);
 * the operator reviews and hits Send in Gmail, never here.
 */

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import type { RunsBoardData, MaintenanceRunCard, RosterPerson, VendorNeededSlip } from '@/lib/work-types';
import { planRunsNow, publishRun, emailWorkOrder, markRunScheduled } from './runs-actions';
import { useSoftRefresh } from '@/lib/use-soft-refresh';

const LABEL: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  fontWeight: 700,
};

function fmtDate(iso: string | null): string {
  if (!iso) return 'unscheduled';
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function fmtPrice(cents: number | null): string {
  if (cents == null) return '';
  return `$${Math.round(cents / 100)}`;
}

const STATUS_LABEL: Record<string, string> = {
  published: 'Published',
  claimed: 'Claimed',
  in_progress: 'In progress',
};

function PriorityDot({ priority }: { priority: string }) {
  const color =
    priority === 'high' ? 'var(--negative)' : priority === 'low' ? 'var(--ink-4)' : 'var(--tide-deep)';
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: 3,
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

/** Recipient picker + note + send. Rendered under a run card or a vendor
 *  property group when its Email button is toggled on. */
function WorkOrderComposer({
  slipIds,
  visitDate,
  roster,
  contextLabel,
  onClose,
}: {
  slipIds: string[];
  visitDate: string | null;
  roster: RosterPerson[];
  contextLabel: string;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(roster.length > 0 ? roster[0].email : 'custom');
  const [customName, setCustomName] = useState('');
  const [customEmail, setCustomEmail] = useState('');
  const [note, setNote] = useState('');
  const [sending, startSending] = useTransition();
  const [done, setDone] = useState<{ message: string; draftUrl: string } | null>(null);
  const [error, setError] = useState('');
  // Close-out step: once the vendor confirms the day, one click stamps
  // every slip Scheduled + due + vendor-labeled.
  const softRefresh = useSoftRefresh();
  const [schedDate, setSchedDate] = useState(visitDate ?? '');
  const [marking, startMarking] = useTransition();
  const [marked, setMarked] = useState('');
  const [markError, setMarkError] = useState('');

  const person = roster.find((r) => r.email === selected) ?? null;
  const toName = person ? person.name : customName;
  const toEmail = person ? person.email : customEmail;

  function onMarkScheduled() {
    startMarking(async () => {
      setMarkError('');
      const res = await markRunScheduled({
        slipIds,
        scheduledDate: schedDate || null,
        vendorName: toName,
        vendorOrganization: person?.organization ?? null,
      });
      if (!res.ok) {
        setMarkError(res.error);
        return;
      }
      setMarked(
        `${res.updated} ${res.updated === 1 ? 'slip' : 'slips'} scheduled${schedDate ? ` for ${fmtDate(schedDate)}` : ''} · ${res.label}`,
      );
      softRefresh();
    });
  }

  function onSend() {
    startSending(async () => {
      setError('');
      const res = await emailWorkOrder({ slipIds, toName, toEmail, note, visitDate });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const w = res.warnings.length > 0 ? ` (${res.warnings.join('; ')})` : '';
      setDone({
        message: `Draft ready for ${toEmail} — ${res.jobCount} jobs, ${res.photoCount} photos, cc Allie + Ryan${w}`,
        draftUrl: res.draftUrl,
      });
      // The whole point is reviewing in Gmail — take her straight there.
      window.open(res.draftUrl, '_blank', 'noopener');
    });
  }

  if (done) {
    return (
      <div style={{ borderTop: '1px solid var(--rule-soft)', paddingTop: 10, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--positive)' }}>{done.message}</span>
          <a
            href={done.draftUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12, color: 'var(--tide-deep)', textDecoration: 'underline', textUnderlineOffset: 3 }}
          >
            Review in Gmail →
          </a>
        </div>
        {marked ? (
          <span style={{ fontSize: 12, color: 'var(--positive)' }}>{marked}</span>
        ) : (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ ...LABEL, color: 'var(--ink-3)' }}>Vendor confirmed?</span>
            <input
              type="date"
              value={schedDate}
              onChange={(e) => setSchedDate(e.target.value)}
              style={{ border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', fontSize: 12, padding: '4px 6px' }}
            />
            <button
              type="button"
              onClick={onMarkScheduled}
              disabled={marking}
              style={{
                background: 'var(--ink)',
                color: 'var(--paper)',
                border: '1px solid var(--ink)',
                padding: '4px 10px',
                ...LABEL,
                cursor: marking ? 'default' : 'pointer',
                opacity: marking ? 0.6 : 1,
              }}
            >
              {marking ? 'Saving…' : 'Mark scheduled'}
            </button>
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              stamps each slip: Scheduled · due that day · {toName ? `Vendor: ${toName}` : 'vendor-labeled'}
            </span>
            {markError && <span style={{ fontSize: 11, color: 'var(--negative)' }}>{markError}</span>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ borderTop: '1px solid var(--rule-soft)', paddingTop: 10, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ ...LABEL, color: 'var(--ink-3)' }}>Email work order — {contextLabel}</span>
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        style={{
          border: '1px solid var(--rule)',
          background: 'var(--paper)',
          color: 'var(--ink)',
          fontSize: 12.5,
          padding: '6px 8px',
        }}
      >
        {roster.map((r) => (
          <option key={r.email} value={r.email}>
            {r.name}
            {r.organization ? ` · ${r.organization}` : ''} ({r.email})
          </option>
        ))}
        <option value="custom">Someone else…</option>
      </select>
      {!person && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            placeholder="Name"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            style={{ border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', fontSize: 12.5, padding: '6px 8px', flex: 1, minWidth: 110 }}
          />
          <input
            placeholder="email@example.com"
            type="email"
            value={customEmail}
            onChange={(e) => setCustomEmail(e.target.value)}
            style={{ border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', fontSize: 12.5, padding: '6px 8px', flex: 2, minWidth: 160 }}
          />
        </div>
      )}
      <textarea
        placeholder="Optional note for the email (access, timing, parts…)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        style={{ border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', fontSize: 12.5, padding: '6px 8px', resize: 'vertical' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onSend}
          disabled={sending || !toEmail.trim() || !toName.trim()}
          style={{
            background: 'var(--ink)',
            color: 'var(--paper)',
            border: '1px solid var(--ink)',
            padding: '5px 12px',
            ...LABEL,
            cursor: sending ? 'default' : 'pointer',
            opacity: sending || !toEmail.trim() || !toName.trim() ? 0.5 : 1,
          }}
        >
          {sending ? 'Drafting…' : 'Create Gmail draft'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          drafts in Gmail, you hit send · from dotti@ · cc allie@ + ryan@ · photos attached
        </span>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'var(--ink-3)', fontSize: 11, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}
        >
          Cancel
        </button>
        {error && <span style={{ fontSize: 11, color: 'var(--negative)' }}>{error}</span>}
      </div>
    </div>
  );
}

function RunCard({ run, roster }: { run: MaintenanceRunCard; roster: RosterPerson[] }) {
  const softRefresh = useSoftRefresh();
  const [publishing, startPublish] = useTransition();
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState('');

  function onPublish() {
    startPublish(async () => {
      setError('');
      const res = await publishRun(run.packetId);
      if (!res.ok) setError(res.error);
      else softRefresh();
    });
  }

  const statusLabel = run.suggested ? 'Suggested' : (STATUS_LABEL[run.status] ?? (run.status === 'draft' ? 'Draft' : run.status));

  return (
    <div
      style={{
        border: '1px solid var(--rule)',
        background: 'var(--paper)',
        padding: '14px 16px',
        minWidth: 260,
        flex: '1 1 260px',
        maxWidth: 400,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span className="font-serif" style={{ fontSize: 16, fontWeight: 500, flex: 1, minWidth: 120 }}>
          {run.title.replace(/^Maintenance · /, '')}
        </span>
        <span
          style={{
            ...LABEL,
            color: run.status === 'draft' ? 'var(--tide-deep)' : 'var(--positive)',
          }}
        >
          {statusLabel}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
        {fmtDate(run.visitDate)}
        {run.postedPriceCents != null && <span> · {fmtPrice(run.postedPriceCents)}</span>}
        <span> · {run.slips.length} {run.slips.length === 1 ? 'job' : 'jobs'}</span>
        {run.closedSlipCount > 0 && (
          <span style={{ color: 'var(--ink-4)' }}>
            {' '}· {run.closedSlipCount} already closed
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {run.slips.slice(0, 4).map((s) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5 }}>
            <PriorityDot priority={s.priority} />
            <Link
              href={`/work/${s.id}`}
              prefetch={false}
              style={{ color: 'var(--ink)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {s.title}
            </Link>
          </div>
        ))}
        {run.slips.length > 4 && (
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>+{run.slips.length - 4} more</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 2, flexWrap: 'wrap' }}>
        {run.status === 'draft' && (
          <button
            type="button"
            onClick={onPublish}
            disabled={publishing}
            style={{
              background: 'var(--ink)',
              color: 'var(--paper)',
              border: '1px solid var(--ink)',
              padding: '4px 10px',
              ...LABEL,
              cursor: publishing ? 'default' : 'pointer',
              opacity: publishing ? 0.6 : 1,
            }}
          >
            {publishing ? 'Publishing…' : 'Publish'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setComposing((v) => !v)}
          style={{
            background: 'none',
            border: '1px solid var(--rule)',
            color: 'var(--ink)',
            padding: '4px 10px',
            ...LABEL,
            cursor: 'pointer',
          }}
        >
          Email…
        </button>
        <Link
          href={`/fieldwork/packets/${run.packetId}`}
          prefetch={false}
          style={{ fontSize: 11, color: 'var(--tide-deep)', textDecoration: 'underline', textUnderlineOffset: 3 }}
        >
          Open packet →
        </Link>
        {error && <span style={{ fontSize: 11, color: 'var(--negative)' }}>{error}</span>}
      </div>
      {composing && (
        <WorkOrderComposer
          slipIds={run.slips.map((s) => s.id)}
          visitDate={run.visitDate}
          roster={roster}
          contextLabel={run.title.replace(/^Maintenance · /, '')}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}

function VendorGroup({ propertyName, slips, roster }: { propertyName: string; slips: VendorNeededSlip[]; roster: RosterPerson[] }) {
  const [composing, setComposing] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span className="font-serif" style={{ fontSize: 14, fontWeight: 500 }}>{propertyName}</span>
        <button
          type="button"
          onClick={() => setComposing((v) => !v)}
          style={{
            background: 'none',
            border: '1px solid var(--rule)',
            color: 'var(--ink)',
            padding: '2px 8px',
            ...LABEL,
            cursor: 'pointer',
          }}
        >
          Email…
        </button>
      </div>
      {slips.map((s) => (
        <div key={s.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12.5, flexWrap: 'wrap' }}>
          <PriorityDot priority={s.priority} />
          <Link href={`/work/${s.id}`} prefetch={false} style={{ color: 'var(--ink)', textDecoration: 'none' }}>
            {s.title}
          </Link>
          {s.note && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{s.note}</span>}
        </div>
      ))}
      {composing && (
        <WorkOrderComposer
          slipIds={slips.map((s) => s.id)}
          visitDate={null}
          roster={roster}
          contextLabel={`${propertyName} vendor list`}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}

export function RunsRail({ data, standalone }: { data: RunsBoardData; standalone?: boolean }) {
  const softRefresh = useSoftRefresh();
  const [planning, startPlanning] = useTransition();
  const [note, setNote] = useState('');

  const vendorGroups = useMemo(() => {
    const byProp = new Map<string, VendorNeededSlip[]>();
    for (const s of data.vendorNeeded) {
      if (!byProp.has(s.propertyId)) byProp.set(s.propertyId, []);
      byProp.get(s.propertyId)!.push(s);
    }
    return [...byProp.entries()].map(([pid, slips]) => ({
      propertyId: pid,
      propertyName: slips[0]?.propertyName ?? pid,
      slips,
    }));
  }, [data.vendorNeeded]);

  const hasAnything =
    data.runs.length > 0 ||
    data.vendorNeeded.length > 0 ||
    data.backlog.length > 0 ||
    data.unclassifiedCount > 0;

  function onPlanNow() {
    startPlanning(async () => {
      setNote('');
      const res = await planRunsNow();
      if (!res.ok) setNote(res.error);
      else {
        const parts: string[] = [];
        if (res.created) parts.push(`${res.created} planned`);
        if (res.kept) parts.push(`${res.kept} unchanged`);
        if (res.noVacancy) parts.push(`${res.noVacancy} waiting on an empty day`);
        if (res.classifying) parts.push(`triaging ${res.classifying} new slips in the background — check back in a few minutes`);
        setNote(parts.length ? parts.join(' · ') : 'Nothing to plan right now');
        softRefresh();
      }
    });
  }

  // Embedded with nothing to show: disappear. On the dedicated tab the
  // header + Plan now button stay so an empty board explains itself.
  if (!hasAnything && !standalone) return null;

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: standalone ? 28 : 18 }}>
      <div style={{ borderBottom: standalone ? 'none' : '1px solid var(--rule)', paddingBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <h2 className="font-serif" style={{ fontSize: standalone ? 26 : 20, fontWeight: 500, flex: 1, minWidth: 160 }}>
            Maintenance runs
          </h2>
          {note && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{note}</span>}
          <button
            type="button"
            onClick={onPlanNow}
            disabled={planning}
            style={{
              background: 'none',
              border: '1px solid var(--rule)',
              color: 'var(--ink)',
              padding: '4px 10px',
              ...LABEL,
              cursor: planning ? 'default' : 'pointer',
              opacity: planning ? 0.6 : 1,
            }}
          >
            {planning ? 'Planning…' : 'Plan now'}
          </button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>
          Substantive fixes bundled onto days the house is empty — publish for a handyman to claim, or email the work order out.
        </p>

        {data.runs.length > 0 && (
          <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
            {data.runs.map((r) => (
              <RunCard key={r.packetId} run={r} roster={data.roster} />
            ))}
          </div>
        )}

        {vendorGroups.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <span style={{ ...LABEL, color: 'var(--signal)' }}>Book a vendor</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
              {vendorGroups.map((g) => (
                <VendorGroup key={g.propertyId} propertyName={g.propertyName} slips={g.slips} roster={data.roster} />
              ))}
            </div>
          </div>
        )}

        {standalone && !hasAnything && (
          <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 18 }}>
            Nothing to plan right now — no open handyman-scope work anywhere. New slips are triaged
            automatically; hit Plan now to force a pass.
          </p>
        )}

        {(data.backlog.length > 0 || data.unclassifiedCount > 0) && (
          <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 14 }}>
            {data.backlog.length > 0 && (
              <>
                Waiting for enough work or an empty day:{' '}
                {data.backlog
                  .slice(0, 5)
                  .map((b) => `${b.propertyName} (${b.count})`)
                  .join(', ')}
                {data.backlog.length > 5 ? ` +${data.backlog.length - 5} more` : ''}
                .
              </>
            )}{' '}
            {data.unclassifiedCount > 0 && (
              <>{data.unclassifiedCount} new {data.unclassifiedCount === 1 ? 'slip' : 'slips'} awaiting triage.</>
            )}
          </p>
        )}
      </div>
    </section>
  );
}
