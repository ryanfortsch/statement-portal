'use client';

import { useMemo, useState } from 'react';
import { useConfirm } from '@/components/ConfirmDialog';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { displayNameForEmail, hueForEmail, initialsForEmail, teamMemberForAnyEmail } from '@/lib/team';
import {
  composeVisitGrid,
  deadlineChip,
  type GridCell,
  type GridHome,
  type GridPlan,
  type GridStay,
} from '@/lib/visit-grid';
import { claimWalk, releaseWalk } from './plan-actions';

/**
 * The week grid: who is going where (lib/visit-grid.ts decides every word
 * and every tap). A tap on an open day before an arrival writes the stay's
 * inspection plan with your name on it and the mark appears at once; a tap
 * on your own mark lets it go. Someone else's mark asks first: take it, or
 * remove the plan. Every write goes through plan-actions.ts, the one writer
 * of inspection plans, so the board's walk column, the home feed and the
 * Field packet board all read the same tap.
 */
type Props = {
  today: string;
  days: string[];
  homes: GridHome[];
  stays: GridStay[];
  myEmail: string;
};

type Outcome = { ok: true; id?: string } | { ok: false; error: string };

/** A teammate reads the same whichever address she worked under: her
 *  Field contractor address before 11/1 and her Workspace email after. */
const nameFor = (e: string): string => teamMemberForAnyEmail(e)?.short ?? displayNameForEmail(e);
const initialsFor = (e: string): string => teamMemberForAnyEmail(e)?.initials ?? initialsForEmail(e);
const hueFor = (e: string): string => teamMemberForAnyEmail(e)?.hue ?? hueForEmail(e);
const identityFor = (e: string): string => teamMemberForAnyEmail(e)?.email ?? e;

export function VisitGrid({ today, days, homes, stays, myEmail }: Props) {
  const { choose } = useConfirm();
  const softRefresh = useSoftRefresh();
  // Taps the server has not confirmed yet, layered over the stays the page
  // sent, so a mark shows the moment it is tapped. Dropped once fresh props
  // carry the saved plan, except for a tap still in flight.
  const source = JSON.stringify(stays.map((s) => [s.reservationId, s.plan]));
  const [over, setOver] = useState<{ source: string; plans: Record<string, GridPlan | null> }>({ source, plans: {} });
  const [pending, setPending] = useState<Record<string, true>>({});
  const [error, setError] = useState<string | null>(null);
  if (over.source !== source) {
    const kept: Record<string, GridPlan | null> = {};
    for (const [id, p] of Object.entries(over.plans)) if (pending[id]) kept[id] = p;
    setOver({ source, plans: kept });
  }

  const shown = useMemo(
    () => stays.map((s) => (s.reservationId in over.plans ? { ...s, plan: over.plans[s.reservationId] } : s)),
    [stays, over.plans],
  );
  const grid = useMemo(
    () =>
      composeVisitGrid({
        today,
        days,
        homes,
        stays: shown,
        myEmail,
        nameFor,
        initialsFor,
        identityFor,
      }),
    [today, days, homes, shown, myEmail],
  );

  function minePlan(date: string, stay: GridStay): GridPlan {
    return {
      id: stay.plan?.id ?? `pending-${stay.reservationId}`,
      date,
      assignee: myEmail,
      plannedBy: stay.plan?.plannedBy ?? myEmail,
      hasNotes: stay.plan?.hasNotes ?? false,
    };
  }

  async function run(rid: string, optimistic: GridPlan | null, act: () => Promise<Outcome>) {
    setPending((p) => ({ ...p, [rid]: true }));
    setOver((o) => ({ ...o, plans: { ...o.plans, [rid]: optimistic } }));
    const revert = () =>
      setOver((o) => {
        const plans = { ...o.plans };
        delete plans[rid];
        return { ...o, plans };
      });
    try {
      const res = await act();
      if (!res.ok) {
        revert();
        setError(`Could not save the walk (${res.error}).`);
        return;
      }
      if (optimistic && res.id) {
        const saved = { ...optimistic, id: res.id };
        setOver((o) => ({ ...o, plans: { ...o.plans, [rid]: saved } }));
      }
      // No refresh here: the action revalidated the page and its response
      // already carries the fresh tree, which drops this override.
    } catch {
      revert();
      setError('Could not reach Helm. The grid shows what was saved before your tap; try again.');
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[rid];
        return next;
      });
    }
  }

  async function tap(home: string, cell: GridCell) {
    const t = cell.tap;
    if (t.kind === 'none') return;
    const rid = t.stay.reservationId;
    if (pending[rid]) return;
    setError(null);
    const claim = () =>
      run(rid, minePlan(cell.date, t.stay), () =>
        claimWalk({ reservationId: rid, propertyId: t.stay.propertyId, checkIn: t.stay.checkIn, checkOut: t.stay.checkOut, date: cell.date }),
      );
    if (t.kind === 'release') {
      // Someone else's plan, or one with a note, keeps its day: only the
      // name comes off (plan-actions decides the same way on the server).
      return run(rid, t.keep && t.stay.plan ? { ...t.stay.plan, assignee: null } : null, () => releaseWalk(t.planId));
    }
    if (t.kind === 'take') {
      const who = nameFor(t.holder);
      const sameDay = t.holderDay === cell.date;
      const past = !!t.holderDay && t.holderDay < today;
      const choice = await choose<'take' | 'remove'>({
        title: `${who} ${past ? 'was down to walk' : 'is walking'} ${home}${t.holderDay ? ` ${dayWord(t.holderDay, today)}` : ''}.`,
        body: sameDay
          ? 'Take it over, or remove the plan so the day needs someone again.'
          : `Take it and walk it ${dayWord(cell.date, today)} instead, or remove the plan.`,
        choices: [
          { value: 'take', label: 'Take it' },
          { value: 'remove', label: 'Remove plan', tone: 'danger' },
        ],
        cancelLabel: 'Leave it',
      });
      if (!choice) return;
      if (choice === 'remove') return run(rid, null, () => releaseWalk(t.planId, { remove: true }));
      return claim();
    }
    return claim();
  }

  if (grid.rows.length === 0) {
    return (
      <p style={{ color: 'var(--ink-3)', fontSize: 14, margin: 0 }}>
        No arrivals to walk in the next two weeks.
      </p>
    );
  }

  const columns = `var(--vg-name) repeat(${days.length}, minmax(var(--vg-day), 1fr))`;
  const minWidth = `calc(var(--vg-name) + ${days.length} * var(--vg-day))`;

  return (
    <div className="rt-vg">
      <div className="rt-vg-scroll">
        <div className="rt-vg-grid" style={{ gridTemplateColumns: columns, minWidth }}>
          <div className="rt-vg-corner" />
          {days.map((d) => {
            const isToday = d === today;
            return (
              <div key={d} className="rt-vg-head" data-today={isToday || undefined}>
                <div className="rt-vg-dow">
                  {isToday ? (
                    <>
                      <span className="rt-vg-dow-today">Today</span>
                      <span className="rt-vg-dow-day">{dow(d)}</span>
                    </>
                  ) : (
                    dow(d)
                  )}
                </div>
                <div className="rt-vg-dn">{dayNumber(d)}</div>
              </div>
            );
          })}
          {grid.rows.map((row) => {
            const chip = deadlineChip(row.nextNeed, today);
            return (
              <Row key={row.propertyId} name={row.propertyName} chip={chip} cells={row.cells} today={today} pending={pending} onTap={(cell) => tap(row.propertyName, cell)} />
            );
          })}
        </div>
      </div>

      <div className="rt-vg-legend">
        <span><span className="rt-vg-sw" style={{ background: 'rgba(63,153,34,0.22)' }} /> open, needs someone</span>
        <span><span className="rt-vg-sw" style={{ background: 'rgba(30,46,52,0.14)' }} /> guest in house</span>
        <span>
          <span className="rt-vg-sw" style={{ background: 'repeating-linear-gradient(45deg, rgba(30,46,52,0.16) 0 4px, rgba(30,46,52,0.05) 4px 8px)' }} /> owner / hold
        </span>
        <span><span style={{ width: 3, height: 14, background: 'var(--signal)', flexShrink: 0 }} /> guest arrives</span>
        <span>
          <span className="rt-vg-mark" style={{ ['--vg-hue' as string]: hueFor(myEmail), width: 18, height: 18, fontSize: 9, boxShadow: 'none' }}>{initialsFor(myEmail)}</span>
          who&rsquo;s going
        </span>
        {grid.mine > 0 && (
          <span style={{ marginLeft: 'auto', color: 'var(--ink)', fontWeight: 600 }}>
            Yours · {grid.mine}
          </span>
        )}
      </div>
      <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>
        Tap an open day to walk it. Tap your mark to let it go.
      </p>

      {error && (
        <div
          role="alert"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 12, border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', color: 'var(--signal)', padding: '10px 14px', borderRadius: 8, fontSize: 13, lineHeight: 1.5 }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              setError(null);
              softRefresh();
            }}
            style={{ font: 'inherit', fontSize: 12, fontWeight: 600, color: 'var(--signal)', background: 'var(--paper-2)', border: '1px solid var(--signal)', borderRadius: 999, padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Refresh the grid
          </button>
        </div>
      )}
    </div>
  );
}

function Row({
  name,
  chip,
  cells,
  today,
  pending,
  onTap,
}: {
  name: string;
  chip: string | null;
  cells: GridCell[];
  today: string;
  pending: Record<string, true>;
  onTap: (cell: GridCell) => void;
}) {
  return (
    <>
      <div className="rt-vg-name">
        <span className="rt-vg-nm">{name}</span>
        {chip && (
          <span className="rt-vg-chip" title={`Guest arrives ${chip === 'today' ? 'today' : `in ${chip.replace('d', '')} day${chip === '1d' ? '' : 's'}`} and nobody is down to walk it`}>
            {chip}
          </span>
        )}
      </div>
      {cells.map((cell) => {
        const tappable = cell.tap.kind !== 'none';
        const stayId = cell.tap.kind !== 'none' ? cell.tap.stay.reservationId : null;
        const text = cellText(name, cell, today);
        return (
          <button
            key={cell.date}
            type="button"
            className="rt-vg-cell"
            disabled={!tappable}
            data-today={cell.date === today || undefined}
            data-needs={cell.needs || undefined}
            data-tap={tappable || undefined}
            data-cont={cell.continues || undefined}
            data-pending={(stayId && pending[stayId]) || undefined}
            title={text}
            aria-label={text}
            onClick={() => onTap(cell)}
          >
            {cell.state !== 'open' ? (
              <span className="rt-vg-bar" data-half="full" data-block={cell.state === 'blocked' || undefined} aria-hidden />
            ) : (
              <>
                {cell.am && <span className="rt-vg-bar" data-half="am" data-end="" data-block={cell.am === 'block' || undefined} aria-hidden />}
                {cell.pm && <span className="rt-vg-bar" data-half="pm" data-start="" data-block={cell.pm === 'block' || undefined} aria-hidden />}
              </>
            )}
            {cell.badges.length > 0 && (
              <span className="rt-vg-marks" data-n={cell.badges.length > 1 ? '2' : undefined} aria-hidden>
                {cell.badges.slice(0, 2).map((b, i) => (
                  <span
                    key={`${b.stayId}-${b.kind}-${i}`}
                    className="rt-vg-mark"
                    data-kind={b.kind}
                    data-mine={b.mine || undefined}
                    data-late={b.late || undefined}
                    style={b.email ? ({ ['--vg-hue' as string]: hueFor(b.email) } as React.CSSProperties) : undefined}
                  >
                    {b.initials}
                  </span>
                ))}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}

/** The sentence under the pointer, and what a screen reader hears. */
function cellText(home: string, cell: GridCell, today: string): string {
  const when = dayLong(cell.date);
  const who = cell.badges.map((b) => (b.kind === 'walked' ? `walked by ${b.name}` : b.kind === 'walking' ? `${b.name} walking now` : b.kind === 'field' ? b.name : b.kind === 'unassigned' ? b.name : `${b.name}${b.late ? ', was due earlier' : ''}`));
  const lead = `${home} · ${when}`;
  if (cell.state === 'occupied') return `${lead}: guest in house${who.length ? ` · ${who.join(', ')}` : ''}`;
  if (cell.state === 'blocked') return `${lead}: owner / hold${who.length ? ` · ${who.join(', ')}` : ''}`;
  const events = [cell.leaving ? 'guest leaves' : null, cell.arriving ? 'guest arrives' : null].filter(Boolean).join(', ');
  const t = cell.tap;
  switch (t.kind) {
    case 'release':
      return `${lead}: you're walking it ${dayWord(cell.date, today)}. Tap to let it go.`;
    case 'move':
      return `${lead}: tap to walk it ${dayWord(cell.date, today)} instead.`;
    case 'take': {
      const past = !!t.holderDay && t.holderDay < today;
      return `${lead}: ${nameFor(t.holder)} ${past ? 'was down to walk it' : 'is walking it'}${t.holderDay ? ` ${dayWord(t.holderDay, today)}` : ''}. Tap to take it.`;
    }
    case 'claim':
      return `${lead}: ${events ? `${events}, ` : ''}open. Tap to walk it ${dayWord(cell.date, today)}.`;
    default:
      if (cell.fieldOpen) return `${lead}: ${events ? `${events}, ` : ''}out to Field, nobody has claimed it yet.`;
      return `${lead}: ${events || 'open'}${who.length ? ` · ${who.join(', ')}` : ', nothing to prep'}`;
  }
}

function dow(date: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}
function dayNumber(date: string): string {
  return String(Number(date.slice(8, 10)));
}
function dayLong(date: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}
/** "today", "tomorrow", "Thu" within the week, else "Nov 5". */
function dayWord(date: string, today: string): string {
  const n = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n > 1 && n <= 6) return dow(date);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}
