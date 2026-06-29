'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  loadGuestyFieldsAction,
  pushGuestyFieldsAction,
  type FieldKey,
  type FieldRow,
  type LoadFieldsResult,
} from './actions';

const HAIRLINE = '1px solid rgba(30,46,52,0.12)';

/** Long-form fields get a textarea; the wifi pair stays single-line. */
const MULTILINE: ReadonlySet<FieldKey> = new Set<FieldKey>(['parkingInstructions', 'trashCollectedOn']);

/** Live state of one field once the operator may have edited it. */
type Computed = 'fill' | 'overwrite' | 'same' | 'empty';

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** What WOULD happen if this edited value were pushed, vs what's in Guesty now. */
function computeStatus(edited: string, guestyValue: string): Computed {
  const v = edited.trim();
  if (!v) return 'empty';
  if (norm(v) === norm(guestyValue)) return 'same';
  if (!guestyValue) return 'fill';
  return 'overwrite';
}

function StatusChip({ status }: { status: Computed }) {
  const map: Record<Computed, { label: string; fg: string; bg: string }> = {
    fill: { label: 'Will fill', fg: 'var(--tide-deep)', bg: 'rgba(30,99,110,0.10)' },
    overwrite: { label: 'Will overwrite', fg: 'var(--signal)', bg: 'var(--signal-soft)' },
    same: { label: 'Already matches', fg: 'var(--ink-3)', bg: 'rgba(30,46,52,0.06)' },
    empty: { label: 'Empty', fg: 'var(--ink-4)', bg: 'rgba(30,46,52,0.04)' },
  };
  const s = map[status];
  return (
    <span
      style={{
        fontSize: 10,
        letterSpacing: '.1em',
        textTransform: 'uppercase',
        fontWeight: 600,
        color: s.fg,
        background: s.bg,
        padding: '3px 8px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      {s.label}
    </span>
  );
}

const FIELD_LABEL_STYLE: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-4)',
  marginBottom: 4,
};

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: HAIRLINE,
  borderRadius: 8,
  padding: '8px 10px',
  fontFamily: 'inherit',
  resize: 'vertical',
};

export function SyncGuestyClient({ propertyId }: { propertyId: string }) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<LoadFieldsResult | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Set<FieldKey>>(new Set());
  const [revealPw, setRevealPw] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setPushMsg(null);
    const res = await loadGuestyFieldsAction(propertyId);
    setResult(res);
    if (res.ok) {
      const v: Record<string, string> = {};
      for (const r of res.rows) v[r.key] = r.helmValue;
      setValues(v);
      setChecked(new Set(res.rows.filter((r) => r.recommend).map((r) => r.key)));
    }
    setLoading(false);
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows: FieldRow[] = result?.ok ? result.rows : [];

  const setValue = (key: FieldKey, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const toggle = (key: FieldKey) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectable = useCallback(
    (row: FieldRow) => {
      const s = computeStatus(values[row.key] ?? '', row.guestyValue);
      return s === 'fill' || s === 'overwrite';
    },
    [values],
  );

  const selectedCount = useMemo(
    () => rows.filter((r) => checked.has(r.key) && selectable(r)).length,
    [rows, checked, selectable],
  );

  const push = async () => {
    if (!result?.ok) return;
    const selections = rows
      .filter((r) => checked.has(r.key) && selectable(r))
      .map((r) => ({ key: r.key, value: values[r.key] ?? '' }));
    if (selections.length === 0) return;
    setPushing(true);
    setPushMsg(null);
    const res = await pushGuestyFieldsAction(propertyId, selections);
    setPushing(false);
    if (res.ok) {
      setPushMsg({
        ok: true,
        text: `Pushed ${res.pushed.length} field${res.pushed.length === 1 ? '' : 's'} to Guesty.`,
      });
      await load();
    } else {
      setPushMsg({ ok: false, text: res.error });
    }
  };

  if (loading) {
    return <p style={{ fontSize: 14, color: 'var(--ink-3)' }}>Reading Helm and the Guesty listing…</p>;
  }

  if (!result || !result.ok) {
    const error = result && !result.ok ? result.error : 'Something went wrong.';
    return (
      <div
        style={{
          border: HAIRLINE,
          borderRadius: 12,
          padding: 24,
          background: 'var(--card)',
          fontSize: 14,
          color: 'var(--ink-2)',
          lineHeight: 1.6,
        }}
      >
        {error}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map((row) => {
          const val = values[row.key] ?? '';
          const status = computeStatus(val, row.guestyValue);
          const canSelect = status === 'fill' || status === 'overwrite';
          const isChecked = checked.has(row.key) && canSelect;
          const isPw = row.sensitive;
          const guestyDisplay = isPw && !revealPw && row.guestyValue ? '••••••••' : row.guestyValue;
          const multiline = MULTILINE.has(row.key);
          return (
            <div
              key={row.key}
              style={{
                border: HAIRLINE,
                borderRadius: 12,
                padding: '16px 18px',
                background: 'var(--card)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: canSelect ? 'pointer' : 'default', flex: 1 }}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={!canSelect}
                    onChange={() => toggle(row.key)}
                    style={{ width: 16, height: 16, accentColor: 'var(--tide-deep)', cursor: canSelect ? 'pointer' : 'default' }}
                  />
                  <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>{row.label}</span>
                </label>
                {isPw && (
                  <button
                    type="button"
                    onClick={() => setRevealPw((v) => !v)}
                    style={{
                      fontSize: 11,
                      color: 'var(--ink-3)',
                      background: 'transparent',
                      border: HAIRLINE,
                      borderRadius: 6,
                      padding: '3px 8px',
                      cursor: 'pointer',
                    }}
                  >
                    {revealPw ? 'Hide' : 'Reveal'}
                  </button>
                )}
                <StatusChip status={status} />
              </div>
              <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={FIELD_LABEL_STYLE}>Value to push · editable</div>
                  {multiline ? (
                    <textarea
                      value={val}
                      onChange={(e) => setValue(row.key, e.target.value)}
                      rows={Math.min(8, Math.max(2, val.split('\n').length + 1))}
                      style={INPUT_STYLE}
                    />
                  ) : (
                    <input
                      type={isPw && !revealPw ? 'password' : 'text'}
                      value={val}
                      onChange={(e) => setValue(row.key, e.target.value)}
                      style={INPUT_STYLE}
                    />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={FIELD_LABEL_STYLE}>In Guesty now</div>
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: row.guestyValue ? 'var(--ink)' : 'var(--ink-4)',
                      fontStyle: row.guestyValue ? 'normal' : 'italic',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      paddingTop: 8,
                    }}
                  >
                    {guestyDisplay || 'empty'}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          marginTop: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={push}
          disabled={pushing || selectedCount === 0}
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--paper)',
            background: selectedCount === 0 || pushing ? 'var(--ink-4)' : 'var(--tide-deep)',
            border: 'none',
            borderRadius: 8,
            padding: '10px 20px',
            cursor: pushing || selectedCount === 0 ? 'default' : 'pointer',
          }}
        >
          {pushing
            ? 'Pushing…'
            : selectedCount === 0
              ? 'Nothing selected'
              : `Push ${selectedCount} to Guesty`}
        </button>
        {pushMsg && (
          <span style={{ fontSize: 13, color: pushMsg.ok ? 'var(--tide-deep)' : 'var(--signal)' }}>
            {pushMsg.text}
          </span>
        )}
      </div>
    </div>
  );
}
