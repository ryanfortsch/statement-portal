'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import type { ShootCalCell, ShootCalRow } from '@/lib/creative-calendar';
import { weatherLine, type DayWeather } from '@/lib/weather-types';
import { WeatherGlyph, GRADE_TINT, GRADE_WORD } from '@/components/WeatherGlyph';
import { offerShootDay } from './actions';

/**
 * The property x day grid for sending a contributor to a home, in the
 * packets board's language (InspectionCalendar): one hue per meaning, TODAY
 * marked, a red left edge on the day a guest arrives. Green is a day the
 * shoot rails will also call clear (same report as the brief and the 8 AM
 * go/no-go text); clicking one opens the send bar underneath. A booked cell
 * carries the contributor's initials and opens that shoot.
 *
 * One pick, one offer: a shoot is one contributor at one home on one day.
 *
 * The grid OFFERS; it does not book. Picking a cell and sending invites the
 * contributor, who accepts or passes from their own brief. A cell with an
 * unanswered offer reads "pending" and is not clickable: to give the day to
 * someone else, withdraw the offer first, so two people are never sent to
 * one door. A declined day goes back to green on its own.
 *
 * The forecast rides above the grid as its own row, one mark per day. It
 * is advisory and only advisory: a poor sky never greys out a day or
 * blocks an offer, because shooting in the rain is the operator's call (and
 * then the contributor's), not the software's. Past the National Weather
 * Service's seven days the row is simply blank -- an empty column means
 * nobody knows yet, and must never be read as fair weather.
 */

const OPEN_BG = 'rgba(63,153,34,0.22)';
const CHECKOUT_BG = 'rgba(63,153,34,0.10)';
const BOOKED_BG = 'rgba(58,107,138,0.34)';
/** An offer out and unanswered: the same blue, hollowed out, because it is
 *  not yet a booking. */
const PENDING_BG = 'rgba(58,107,138,0.10)';
const OCCUPIED_BG = 'rgba(30,46,52,0.10)';
const HELD_BG = 'repeating-linear-gradient(45deg, rgba(30,46,52,0.16) 0 4px, rgba(30,46,52,0.05) 4px 8px)';

export type PlannerContributor = { id: string; name: string };

function dayHead(d: string): { wd: string; n: string } {
  try {
    const dt = new Date(`${d}T00:00:00`);
    return { wd: dt.toLocaleDateString('en-US', { weekday: 'short' }), n: dt.toLocaleDateString('en-US', { day: 'numeric' }) };
  } catch {
    return { wd: '', n: d };
  }
}
function fmtDay(d: string): string {
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}
function fmtShort(d: string): string {
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}

function availabilityLine(cell: ShootCalCell): string {
  const next = cell.nextCheckin ? `; next guests ${fmtShort(cell.nextCheckin)}` : '';
  if (cell.state === 'checkout') return `Guests leave ~11 AM, so the home is empty after checkout${next}.`;
  return `Empty all day${next}.`;
}

export function ShootPlanner({
  days,
  rows,
  contributors,
  today,
  weather,
}: {
  days: string[];
  rows: ShootCalRow[];
  contributors: PlannerContributor[];
  /** Today in ET, from the server, so the TODAY column can't drift on a
   *  browser in another zone. */
  today: string;
  /** Forecast by date. Missing days (past the 7-day horizon, or a forecast
   *  we couldn't reach) simply have no entry. */
  weather: Record<string, DayWeather>;
}) {
  const [sel, setSel] = useState<{ propertyId: string; date: string } | null>(null);
  // One contributor to send. Pre-picked when there's exactly one on the crew.
  const [contractorId, setContractorId] = useState<string>(contributors.length === 1 ? contributors[0].id : '');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [sending, setSending] = useState(false);
  // Why the last send went nowhere, from the server, in the operator's words
  // ("3 Locust isn't free Thu, Sep 24: a guest is in the house"). Stays beside
  // her pick until she changes it; never rides the URL, so a refresh can't
  // replay it.
  const [error, setError] = useState<string | null>(null);
  const softRefresh = useSoftRefresh();

  const selRow = sel ? (rows.find((r) => r.propertyId === sel.propertyId) ?? null) : null;
  const selCell = sel && selRow ? (selRow.cells.find((c) => c.date === sel.date) ?? null) : null;
  const selWeather = sel ? (weather[sel.date] ?? null) : null;
  const who = contributors.find((c) => c.id === contractorId) ?? null;

  function pick(row: ShootCalRow, cell: ShootCalCell) {
    setError(null);
    if (sel && sel.propertyId === row.propertyId && sel.date === cell.date) {
      setSel(null);
      return;
    }
    setSel({ propertyId: row.propertyId, date: cell.date });
    // The title defaults to the home's name, which is also what keeps the
    // title/property guard on the server quiet.
    setTitle(row.propertyName);
    setNotes('');
  }

  if (rows.length === 0) {
    return <p style={{ color: 'var(--ink-3)', fontSize: 14, marginTop: 12 }}>No managed homes in the registry yet.</p>;
  }

  const gridCols = `170px repeat(${days.length}, minmax(40px, 1fr))`;

  return (
    <div>
      <div style={{ overflowX: 'auto', border: '1px solid var(--rule)', borderRadius: 10, background: 'var(--paper-2, #fff)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: gridCols, minWidth: 640 }}>
          <div style={{ borderBottom: '1px solid var(--rule)' }} />
          {days.map((d) => {
            const h = dayHead(d);
            const isSel = sel?.date === d;
            const isToday = d === today;
            return (
              <div
                key={d}
                style={{
                  textAlign: 'center',
                  padding: '8px 2px',
                  borderBottom: '1px solid var(--rule)',
                  borderLeft: '1px solid var(--rule)',
                  background: isSel ? 'rgba(200,90,58,0.08)' : isToday ? 'rgba(11,37,69,0.06)' : 'transparent',
                  borderTop: isToday ? '2px solid var(--tide-deep)' : '2px solid transparent',
                  lineHeight: 1.2,
                }}
              >
                <div style={{ fontSize: 10, color: isToday ? 'var(--tide-deep)' : 'var(--ink-4)', fontWeight: isToday ? 700 : 400, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {isToday ? 'TODAY' : h.wd}
                </div>
                <div style={{ fontSize: 13, color: isToday ? 'var(--tide-deep)' : 'var(--ink-3)', fontWeight: isToday ? 700 : 400 }}>{h.n}</div>
              </div>
            );
          })}

          {/* The forecast band. Inside the same grid as the day headers, so
              a column's weather is always over that column's days. */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)', borderBottom: '1px solid var(--rule)', minHeight: 40 }}>
            Forecast
          </div>
          {days.map((d) => {
            const w = weather[d];
            const isSel = sel?.date === d;
            return (
              <div
                key={d}
                title={w ? `${fmtDay(d)}: ${weatherLine(w)} \u00b7 ${GRADE_WORD[w.grade]}` : `No forecast for ${fmtDay(d)} yet`}
                style={{
                  minHeight: 40,
                  borderBottom: '1px solid var(--rule)',
                  borderLeft: '1px solid var(--rule)',
                  background: isSel ? 'rgba(200,90,58,0.08)' : 'transparent',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 1,
                  color: w ? GRADE_TINT[w.grade] : 'var(--ink-4)',
                }}
              >
                {w ? (
                  <>
                    <WeatherGlyph sky={w.sky} size={14} />
                    {w.highF != null && (
                      <span className="font-mono" style={{ fontSize: 10, lineHeight: 1 }}>{w.highF}&deg;</span>
                    )}
                  </>
                ) : (
                  <span style={{ fontSize: 11, opacity: 0.45 }}>&middot;</span>
                )}
              </div>
            );
          })}

          {rows.map((r) => (
            <PlannerRow key={r.propertyId} row={r} sel={sel} today={today} onPick={pick} />
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: 'var(--ink-3)', marginTop: 10, alignItems: 'center' }}>
        <Swatch bg={OPEN_BG} label="empty all day" />
        <Swatch bg={CHECKOUT_BG} label="empty after the 11 AM checkout" />
        <Swatch bg={BOOKED_BG} label="shoot booked (initials)" />
        <Swatch bg={PENDING_BG} label="offered, waiting on their answer (CN?)" />
        <Swatch bg={OCCUPIED_BG} label="guest in house" />
        <Swatch bg={HELD_BG} label="owner / blocked" />
        <Swatch bg="var(--signal)" label="picked" />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink-4)', marginTop: 6 }}>
        <span style={{ width: 4, height: 14, background: 'var(--signal)', flexShrink: 0 }} />
        A red left edge is the day a guest checks in (~3 PM). The 8 AM day-of check calls that day a hold, so it isn&apos;t offered.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 11, color: 'var(--ink-4)', marginTop: 6 }}>
        <span>Forecast, National Weather Service, seven days out:</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: GRADE_TINT.good }}><WeatherGlyph sky="clear" size={13} /> good light</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: GRADE_TINT.fair }}><WeatherGlyph sky="cloudy" size={13} /> workable</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: GRADE_TINT.poor }}><WeatherGlyph sky="rain" size={13} /> poor for filming</span>
        <span>A blank column is a day past the forecast, not a fair one. It never stops you sending.</span>
      </div>

      {error && selCell && (
        <div
          role="alert"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 16, border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', color: 'var(--signal)', padding: '10px 14px', borderRadius: 8, fontSize: 13, lineHeight: 1.5 }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              setError(null);
              softRefresh();
            }}
            style={{ font: 'inherit', fontSize: 12, fontWeight: 600, color: 'var(--signal)', background: 'var(--paper-2, #fff)', border: '1px solid var(--signal)', borderRadius: 999, padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Refresh the board
          </button>
        </div>
      )}

      {sel && selRow && selCell && (
        <form
          action={async (fd: FormData) => {
            setSending(true);
            setError(null);
            try {
              // Redirects to the board with a one-line result on success;
              // hands back a reason on failure, with the pick left in place
              // so she can see what was refused.
              const res = await offerShootDay(fd);
              if (res && !res.ok) {
                setError(res.message);
                return;
              }
              setSel(null);
              setTitle('');
              setNotes('');
            } finally {
              setSending(false);
            }
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            border: '2px solid var(--signal)',
            borderRadius: 12,
            padding: '14px 18px',
            marginTop: 16,
            background: 'rgba(200,90,58,0.05)',
          }}
        >
          <input type="hidden" name="property_id" value={sel.propertyId} />
          <input type="hidden" name="shoot_date" value={sel.date} />
          <input type="hidden" name="contractor_id" value={contractorId} />
          <div style={{ flex: '1 1 280px', minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>
              {selRow.propertyName} · {fmtDay(sel.date)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{availabilityLine(selCell)}</div>
            {/* The sky, where the decision is actually made. Advisory: a
                poor forecast is said plainly and the Send button still
                works, because shooting it anyway is a real choice. */}
            <div style={{ fontSize: 12, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, color: selWeather ? GRADE_TINT[selWeather.grade] : 'var(--ink-4)' }}>
              {selWeather ? (
                <>
                  <WeatherGlyph sky={selWeather.sky} size={14} />
                  <span>{weatherLine(selWeather)} · {GRADE_WORD[selWeather.grade]}</span>
                </>
              ) : (
                <span>No forecast that far out yet.</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <input
                name="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                aria-label="Shoot title"
                placeholder={selRow.propertyName}
                style={{ ...inp, flex: '0 1 200px' }}
              />
              <input
                name="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={4000}
                aria-label="Notes for the brief"
                placeholder="For the brief: shot list, what to feature (optional)"
                style={{ ...inp, flex: '1 1 240px' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {contributors.length === 0 ? (
              <span style={{ fontSize: 12.5, color: 'var(--signal)' }}>
                No active contributors yet.{' '}
                <Link href="/fieldwork/roster?trade=creative" style={{ color: 'var(--signal)' }}>Invite one from the roster →</Link>
              </span>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Who to send">
                <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>Ask</span>
                {contributors.map((c) => {
                  const on = c.id === contractorId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setContractorId(c.id)}
                      aria-pressed={on}
                      title={`Offer ${selRow.propertyName} to ${c.name}`}
                      style={{
                        font: 'inherit',
                        fontSize: 12.5,
                        cursor: 'pointer',
                        borderRadius: 999,
                        padding: '6px 11px',
                        border: `1px solid ${on ? 'var(--tide-deep)' : 'var(--rule)'}`,
                        background: on ? 'rgba(58,107,138,0.12)' : 'var(--paper-2, #fff)',
                        color: on ? 'var(--tide-deep)' : 'var(--ink-3)',
                        fontWeight: on ? 600 : 400,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {on ? '✓ ' : ''}{c.name.split(' ')[0]}
                    </button>
                  );
                })}
              </div>
            )}
            <button
              type="submit"
              disabled={sending || !contractorId}
              style={{
                background: 'var(--signal)',
                color: 'var(--paper)',
                border: 'none',
                borderRadius: 8,
                cursor: sending || !contractorId ? 'default' : 'pointer',
                opacity: sending || !contractorId ? 0.6 : 1,
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                padding: '11px 20px',
                whiteSpace: 'nowrap',
              }}
            >
              {sending ? 'Sending…' : who ? `Offer to ${who.name.split(' ')[0]} →` : 'Pick who to ask'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function PlannerRow({
  row,
  sel,
  today,
  onPick,
}: {
  row: ShootCalRow;
  sel: { propertyId: string; date: string } | null;
  today: string;
  onPick: (row: ShootCalRow, cell: ShootCalCell) => void;
}) {
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 6,
          padding: '0 12px',
          fontSize: 13,
          color: 'var(--ink)',
          borderBottom: '1px solid var(--rule)',
          minHeight: 34,
          minWidth: 0,
        }}
      >
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.propertyName}</span>
        <span
          title={row.lastShot ? `Last shoot here: ${fmtDay(row.lastShot)}` : 'No shoot logged here yet'}
          style={{ fontSize: 10, color: row.lastShot ? 'var(--ink-4)' : 'var(--signal)', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          {row.lastShot ? fmtShort(row.lastShot) : 'never'}
        </span>
      </div>
      {row.cells.map((c) => {
        const isSel = sel?.propertyId === row.propertyId && sel?.date === c.date;
        const base: React.CSSProperties = {
          minHeight: 34,
          margin: 2,
          borderRadius: 4,
          borderWidth: 0,
          borderLeft: c.state === 'checkin' ? '3px solid var(--signal)' : undefined,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          textDecoration: 'none',
        };
        if (c.shoot) {
          // Booked or offered: the office's own record, so the cell opens the
          // shoot whatever the calendar says underneath (a hold that landed
          // after the booking is exactly what she needs to see). A pending
          // offer is drawn hollow and dashed: nobody has agreed to it yet.
          const pending = c.shoot.pending;
          return (
            <Link
              key={c.date}
              href={`/fieldwork/shoots/${c.shoot.id}`}
              title={
                pending
                  ? `Offered to ${c.shoot.contractorName}, no answer yet · open to nudge or withdraw`
                  : `${c.shoot.contractorName} · ${c.shoot.title} · open the shoot`
              }
              style={{
                ...base,
                background: pending ? PENDING_BG : BOOKED_BG,
                border: pending ? '1px dashed var(--tide-deep)' : undefined,
                color: 'var(--tide-deep)',
                fontWeight: 700,
                fontSize: 10,
                letterSpacing: '0.04em',
                opacity: pending ? 0.9 : 1,
              }}
            >
              {pending ? `${c.shoot.who}?` : c.shoot.who}
            </Link>
          );
        }
        // A day that has passed can't be sent (the action refuses it), so it
        // reads as history: booked cells still show, the rest go quiet.
        const past = c.date < today;
        const clickable = !past && (c.state === 'open' || c.state === 'checkout');
        let bg = 'rgba(30,46,52,0.03)';
        if (isSel) bg = 'var(--signal)';
        else if (past) bg = 'rgba(30,46,52,0.03)';
        else if (c.state === 'open') bg = OPEN_BG;
        else if (c.state === 'checkout') bg = CHECKOUT_BG;
        else if (c.state === 'held') bg = HELD_BG;
        else bg = OCCUPIED_BG;
        const hint = clickable
          ? `${row.propertyName} is free ${fmtDay(c.date)}${c.state === 'checkout' ? ' after the ~11 AM checkout' : ''} — click to send someone`
          : past
            ? `${fmtDay(c.date)} has passed`
            : c.reason
              ? `${row.propertyName}: ${c.reason}`
              : undefined;
        return (
          <button
            key={c.date}
            type="button"
            disabled={!clickable}
            onClick={() => clickable && onPick(row, c)}
            title={hint}
            style={{ ...base, background: bg, cursor: clickable ? 'pointer' : 'default', color: '#fff' }}
          >
            {isSel ? '✓' : ''}
          </button>
        );
      })}
    </>
  );
}

function Swatch({ bg, label }: { bg: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 14, height: 14, borderRadius: 3, background: bg }} /> {label}
    </span>
  );
}

const inp: React.CSSProperties = {
  font: 'inherit',
  fontSize: 13,
  color: 'var(--ink)',
  background: 'var(--paper-2, #fff)',
  border: '1px solid var(--rule)',
  borderRadius: 8,
  padding: '7px 10px',
  minWidth: 0,
};
