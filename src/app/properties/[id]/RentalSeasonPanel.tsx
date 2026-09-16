'use client';

import { useActionState, useState } from 'react';
import { saveRentalPeriods, type SaveRentalPeriodsState } from './rental-period-actions';
import { describePeriods, type RentalPeriodRow } from '@/lib/rental-periods';

/**
 * Rental season panel (Operations tab).
 *
 * Records when this home is open for rental. Nothing else in Helm knew this:
 * Guesty calendar blocks cannot tell "nobody has booked December yet" from
 * "this home does not rent in December", because an owner who never blocks
 * the dark months looks open either way.
 *
 * /revenue's Pacing view reads it twice. A home's open nights are the
 * denominator its occupancy target is taken against, and only open nights can
 * be projected to fill. Leave a home year-round and it projects exactly as it
 * did before this panel existed.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_LENGTHS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

type Draft = {
  key: number;
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
  note: string;
};

export function RentalSeasonPanel({
  propertyId,
  periods,
}: {
  propertyId: string;
  periods: RentalPeriodRow[];
}) {
  const action = saveRentalPeriods.bind(null, propertyId);
  const [state, formAction, pending] = useActionState<SaveRentalPeriodsState, FormData>(action, {
    error: null,
  });

  const [yearRound, setYearRound] = useState(periods.length === 0);
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    periods.map((p, i) => ({
      key: i,
      startMonth: p.startMonth,
      startDay: p.startDay,
      endMonth: p.endMonth,
      endDay: p.endDay,
      note: p.note ?? '',
    })),
  );
  const [nextKey, setNextKey] = useState(periods.length);

  const update = (key: number, patch: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const addWindow = () => {
    setDrafts((ds) => [
      ...ds,
      { key: nextKey, startMonth: 5, startDay: 1, endMonth: 10, endDay: 31, note: '' },
    ]);
    setNextKey((k) => k + 1);
    setYearRound(false);
  };

  const current = describePeriods(periods);
  // A window whose start falls after its end runs through New Year. Worth
  // saying out loud, because it looks like a mistake until you know.
  const anyWrap = drafts.some(
    (d) => d.startMonth * 100 + d.startDay > d.endMonth * 100 + d.endDay,
  );

  return (
    <div style={{ paddingBottom: 6 }}>
      <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, marginTop: 0, marginBottom: 14 }}>
        When this home is open for rental. The Pacing view on Revenue projects a month toward
        Rising Tide&apos;s occupancy benchmark using only the nights the home is open, so a home
        with nothing booked yet still gets a forecast and a home that is shut does not.
      </p>

      <div style={statusStyle}>
        Currently <strong style={{ color: 'var(--ink)' }}>{current}</strong>.
      </div>

      <form action={formAction} style={{ borderTop: '1px solid var(--ink)', paddingTop: 18 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16 }}>
          <input
            type="checkbox"
            name="year_round"
            checked={yearRound}
            onChange={(e) => setYearRound(e.target.checked)}
          />
          <span style={{ fontSize: 13, color: 'var(--ink)' }}>Open year-round</span>
        </label>

        {!yearRound && (
          <>
            <input type="hidden" name="window_count" value={nextKey} />
            {drafts.length === 0 && (
              <div style={noteStyle}>
                No windows yet. Add one, or leave &ldquo;Open year-round&rdquo; ticked.
              </div>
            )}
            {drafts.map((d) => (
              <div key={d.key} style={rowStyle}>
                <input type="hidden" name={`w${d.key}_present`} value="1" />
                <DatePair
                  label="Opens"
                  monthName={`w${d.key}_start_month`}
                  dayName={`w${d.key}_start_day`}
                  month={d.startMonth}
                  day={d.startDay}
                  onMonth={(m) => update(d.key, { startMonth: m, startDay: Math.min(d.startDay, MONTH_LENGTHS[m - 1]) })}
                  onDay={(v) => update(d.key, { startDay: v })}
                />
                <DatePair
                  label="Closes after"
                  monthName={`w${d.key}_end_month`}
                  dayName={`w${d.key}_end_day`}
                  month={d.endMonth}
                  day={d.endDay}
                  onMonth={(m) => update(d.key, { endMonth: m, endDay: Math.min(d.endDay, MONTH_LENGTHS[m - 1]) })}
                  onDay={(v) => update(d.key, { endDay: v })}
                />
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 160px' }}>
                  <span style={labelStyle}>Note</span>
                  <input
                    name={`w${d.key}_note`}
                    value={d.note}
                    onChange={(e) => update(d.key, { note: e.target.value })}
                    placeholder="optional"
                    style={inputStyle}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
                  style={removeBtn}
                >
                  Remove
                </button>
              </div>
            ))}
            <button type="button" onClick={addWindow} style={ghostBtn}>
              Add a window
            </button>
            {anyWrap && (
              <div style={noteStyle}>
                A window that opens later in the year than it closes runs through New Year, so
                November 1 to April 30 means the home is open all winter and shut all summer.
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 18 }}>
          <button type="submit" disabled={pending} style={primaryBtn(pending)}>
            {pending ? 'Saving…' : 'Save rental season'}
          </button>
          {state.ok && !state.error && (
            <span style={{ fontSize: 12, color: 'var(--positive)' }}>Saved.</span>
          )}
        </div>

        {state.error && <div style={errorStyle}>{state.error}</div>}
      </form>
    </div>
  );
}

function DatePair({
  label,
  monthName,
  dayName,
  month,
  day,
  onMonth,
  onDay,
}: {
  label: string;
  monthName: string;
  dayName: string;
  month: number;
  day: number;
  onMonth: (m: number) => void;
  onDay: (d: number) => void;
}) {
  const days = MONTH_LENGTHS[month - 1];
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 210px' }}>
      <span style={labelStyle}>{label}</span>
      <span style={{ display: 'flex', gap: 8 }}>
        <select
          name={monthName}
          value={month}
          onChange={(e) => onMonth(parseInt(e.target.value, 10))}
          style={{ ...inputStyle, flex: '1 1 auto' }}
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <select
          name={dayName}
          value={day}
          onChange={(e) => onDay(parseInt(e.target.value, 10))}
          style={{ ...inputStyle, flex: '0 0 82px' }}
        >
          {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--rule)',
  borderBottom: '1px solid var(--ink)',
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 14,
  padding: '9px 11px',
  outline: 'none',
  boxSizing: 'border-box',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 14,
  alignItems: 'flex-end',
  marginBottom: 16,
  paddingBottom: 16,
  borderBottom: '1px solid var(--rule)',
};

const statusStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--ink-3)',
  marginBottom: 14,
  lineHeight: 1.5,
};

const noteStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--ink-3)',
  background: 'var(--paper-2)',
  borderLeft: '3px solid var(--rule)',
  padding: '10px 14px',
  marginBottom: 16,
  lineHeight: 1.5,
};

const errorStyle: React.CSSProperties = {
  marginTop: 14,
  padding: '12px 16px',
  borderLeft: '3px solid var(--negative)',
  background: 'var(--paper-2)',
  fontSize: 13,
  color: 'var(--negative)',
  lineHeight: 1.5,
};

const ghostBtn: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  fontWeight: 600,
  padding: '9px 16px',
  border: '1px solid var(--rule)',
  background: 'transparent',
  color: 'var(--ink-2)',
  cursor: 'pointer',
};

const removeBtn: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '.12em',
  textTransform: 'uppercase',
  fontWeight: 600,
  padding: '9px 12px',
  border: 'none',
  background: 'transparent',
  color: 'var(--ink-3)',
  cursor: 'pointer',
  flex: '0 0 auto',
};

function primaryBtn(pending: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    letterSpacing: '.16em',
    textTransform: 'uppercase',
    fontWeight: 600,
    padding: '10px 20px',
    border: '1px solid var(--ink)',
    background: pending ? 'transparent' : 'var(--ink)',
    color: pending ? 'var(--ink-3)' : 'var(--paper)',
    cursor: pending ? 'default' : 'pointer',
  };
}
