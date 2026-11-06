'use client';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { monthLabel, type EndingRow, type EndingYear } from '@/lib/forecast-contract-endings';
import type { ForecastYear } from '@/lib/forecast-model';
import { saveContractEnding } from './actions';

/**
 * Contracts that may end: the prospects pipeline in reverse. One line with
 * the year's expected loss (the same figure as Monthly Detail's row), then
 * each home carrying a chance, editable in place, and a row to add one.
 * The numbers save to the home (properties.contract_end_pct / _month) and
 * the page re-reads, so every figure on it moves together.
 */
export function ContractEndingsPanel({
  yearKey,
  data,
  fyLoss,
  homes,
  monthOptions,
  defaultMonth,
  loadError,
}: {
  yearKey: ForecastYear;
  data: EndingYear;
  /** The year's expected loss as Monthly Detail carries it, positive. */
  fyLoss: number;
  /** Managed homes, for the add row. */
  homes: ReadonlyArray<{ id: string; name: string }>;
  monthOptions: readonly string[];
  defaultMonth: string;
  loadError: string | null;
}) {
  const taken = new Set(data.rows.map((r) => r.propertyId));
  const addable = homes.filter((h) => !taken.has(h.id));
  const n = data.count;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          borderTop: '1px solid var(--ink)',
          borderBottom: '1px solid var(--rule)',
          padding: '12px 0',
          fontSize: 13,
          color: 'var(--ink-2)',
        }}
      >
        <span>
          <span className="eyebrow" style={{ marginRight: 12 }}>Contracts that may end · {yearKey}</span>
          {loadError
            ? 'Could not read the chances entered, so this year reads as if every home stays. Reload to try again.'
            : data.rows.length === 0
              ? 'Every home is forecast to stay.'
              : n === 0
                ? `None in ${yearKey}; the first is ${monthLabel(earliest(data.rows))}.`
                : `${n} home${n === 1 ? '' : 's'} · (${usd(fyLoss)}) mgmt fee, weighted by chance of ending`}
        </span>
      </div>

      {data.rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <Head align="left">Home</Head>
                <Head>Chance it ends</Head>
                <Head>Gone from</Head>
                <Head title={`Management fee the home is projected to earn in ${yearKey} from that month, if it stays`}>If it stays</Head>
                <Head title="If it stays × the chance it ends">Expected loss</Head>
                <Head>&nbsp;</Head>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <EndingRowEditor
                  key={`${r.propertyId}:${r.pct}:${r.fromMonth}`}
                  row={r}
                  monthOptions={withMonth(monthOptions, r.fromMonth)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addable.length > 0 && !loadError && (
        <AddEnding homes={addable} monthOptions={withMonth(monthOptions, defaultMonth)} defaultMonth={defaultMonth} />
      )}
    </div>
  );
}

function EndingRowEditor({ row, monthOptions }: { row: EndingRow; monthOptions: readonly string[] }) {
  const [pct, setPct] = useState(String(row.pct));
  const [month, setMonth] = useState(row.fromMonth);
  const { pending, error, setError, run } = useRecoverableAction();
  const softRefresh = useSoftRefresh();
  const dirty = pct.trim() !== String(row.pct) || month !== row.fromMonth;

  function save(nextPct: string | null) {
    setError(null);
    run(async () => {
      const res = await saveContractEnding(row.propertyId, nextPct, month);
      if (res.ok) softRefresh();
      else setError(res.error);
    }, 'Could not confirm the change was saved. Try again.');
  }

  return (
    <tr>
      <td style={cell({ textAlign: 'left', fontWeight: 500, color: 'var(--ink-2)' })}>
        {row.name}
        {error && <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--negative, #b13b2a)' }}>{error}</div>}
      </td>
      <td style={cell()}>
        <PctInput value={pct} onChange={setPct} label={`Chance the ${row.name} contract ends`} />
      </td>
      <td style={cell()}>
        <MonthSelect value={month} onChange={setMonth} options={monthOptions} label={`First month ${row.name} would be gone`} />
      </td>
      <td style={cell({ color: row.ifStays > 0 ? 'var(--ink)' : 'var(--ink-4)' })}>{row.ifStays > 0 ? usd(row.ifStays) : '—'}</td>
      <td style={cell({ color: row.expectedLoss > 0 ? 'var(--negative, #b13b2a)' : 'var(--ink-4)', fontWeight: 600 })}>
        {row.expectedLoss > 0 ? `(${usd(row.expectedLoss)})` : '—'}
      </td>
      <td style={cell({ whiteSpace: 'nowrap' })}>
        {dirty ? (
          <Button variant="primary" size="sm" pending={pending} pendingLabel="Saving" onClick={() => save(pct)}>
            Save
          </Button>
        ) : (
          <Button variant="quiet" size="sm" pending={pending} pendingLabel="Removing" onClick={() => save(null)}>
            Remove
          </Button>
        )}
      </td>
    </tr>
  );
}

function AddEnding({
  homes,
  monthOptions,
  defaultMonth,
}: {
  homes: ReadonlyArray<{ id: string; name: string }>;
  monthOptions: readonly string[];
  defaultMonth: string;
}) {
  const [home, setHome] = useState('');
  const [pct, setPct] = useState('');
  const [month, setMonth] = useState(defaultMonth);
  const { pending, error, setError, run } = useRecoverableAction();
  const softRefresh = useSoftRefresh();

  function add() {
    if (!home) {
      setError('Pick a home.');
      return;
    }
    setError(null);
    run(async () => {
      const res = await saveContractEnding(home, pct, month);
      if (res.ok) {
        setHome('');
        setPct('');
        softRefresh();
      } else setError(res.error);
    }, 'Could not confirm the change was saved. Try again.');
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 0', fontSize: 12, color: 'var(--ink-3)' }}>
      <select
        aria-label="Home that may not stay"
        value={home}
        onChange={(e) => setHome(e.target.value)}
        style={{ ...control, minWidth: 170 }}
      >
        <option value="">Add a home…</option>
        {homes.map((h) => (
          <option key={h.id} value={h.id}>{h.name}</option>
        ))}
      </select>
      <PctInput value={pct} onChange={setPct} label="Chance the contract ends" />
      <span>from</span>
      <MonthSelect value={month} onChange={setMonth} options={monthOptions} label="First month it would be gone" />
      <Button variant="secondary" size="sm" pending={pending} pendingLabel="Adding" onClick={add} disabled={!home || pct.trim() === ''}>
        Add
      </Button>
      {error && <span style={{ fontSize: 11, color: 'var(--negative, #b13b2a)' }}>{error}</span>}
    </div>
  );
}

function PctInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <input
        type="number"
        min={1}
        max={100}
        step={5}
        inputMode="numeric"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...control, width: 58, textAlign: 'right' }}
      />
      <span style={{ color: 'var(--ink-3)' }}>%</span>
    </span>
  );
}

function MonthSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  label: string;
}) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={control}>
      {options.map((ym) => (
        <option key={ym} value={ym}>{monthLabel(ym)}</option>
      ))}
    </select>
  );
}

function Head({ children, align = 'right', title }: { children: React.ReactNode; align?: 'left' | 'right'; title?: string }) {
  return (
    <th
      title={title}
      style={{
        textAlign: align,
        padding: '8px 10px',
        fontFamily: 'var(--font-mono-dash), monospace',
        fontSize: 9.5,
        fontWeight: 500,
        letterSpacing: '.14em',
        textTransform: 'uppercase',
        color: 'var(--ink-4)',
        borderBottom: '1px solid var(--rule)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  );
}

function cell(extra?: React.CSSProperties): React.CSSProperties {
  return {
    padding: '7px 10px',
    textAlign: 'right',
    borderBottom: '1px solid var(--rule)',
    fontVariantNumeric: 'tabular-nums',
    verticalAlign: 'middle',
    ...extra,
  };
}

const control: React.CSSProperties = {
  fontSize: 12,
  padding: '3px 6px',
  border: '1px solid var(--rule)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  fontVariantNumeric: 'tabular-nums',
};

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function earliest(rows: readonly EndingRow[]): string {
  return rows.reduce((min, r) => (r.fromMonth < min ? r.fromMonth : min), rows[0].fromMonth);
}

/** The picker's months, with `ym` added in order when it is not already one. */
function withMonth(options: readonly string[], ym: string): string[] {
  return options.includes(ym) ? [...options] : [...options, ym].sort();
}
