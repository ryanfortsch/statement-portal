'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  loadGuestyFieldsAction,
  pushGuestyFieldsAction,
  type FieldKey,
  type FieldRow,
  type LoadFieldsResult,
} from './actions';

const HAIRLINE = '1px solid rgba(30,46,52,0.12)';

/** A field is actionable (selectable to push) when Helm has a value that
 *  isn't already identical in Guesty. */
function selectable(row: FieldRow): boolean {
  return row.status === 'guesty-empty' || row.status === 'differs';
}

function StatusChip({ status }: { status: FieldRow['status'] }) {
  const map: Record<FieldRow['status'], { label: string; fg: string; bg: string }> = {
    'guesty-empty': { label: 'Will fill', fg: 'var(--tide-deep)', bg: 'rgba(30,99,110,0.10)' },
    differs: { label: 'Will overwrite', fg: 'var(--signal)', bg: 'var(--signal-soft)' },
    same: { label: 'Already matches', fg: 'var(--ink-3)', bg: 'rgba(30,46,52,0.06)' },
    'helm-empty': { label: 'No Helm data', fg: 'var(--ink-4)', bg: 'rgba(30,46,52,0.04)' },
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

function ValueBlock({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        style={{
          fontSize: 10,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.5,
          color: muted ? 'var(--ink-4)' : 'var(--ink)',
          fontStyle: value ? 'normal' : 'italic',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {value || 'empty'}
      </div>
    </div>
  );
}

export function SyncGuestyClient({ propertyId }: { propertyId: string }) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<LoadFieldsResult | null>(null);
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
      setChecked(new Set(res.rows.filter((r) => r.recommend).map((r) => r.key)));
    }
    setLoading(false);
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (key: FieldKey) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const push = async () => {
    if (!result?.ok) return;
    const selections = result.rows
      .filter((r) => checked.has(r.key) && selectable(r))
      .map((r) => ({ key: r.key, value: r.helmValue }));
    if (selections.length === 0) return;
    setPushing(true);
    setPushMsg(null);
    const res = await pushGuestyFieldsAction(propertyId, selections);
    setPushing(false);
    if (res.ok) {
      setPushMsg({ ok: true, text: `Pushed ${res.pushed.length} field${res.pushed.length === 1 ? '' : 's'} to Guesty.` });
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

  const selectedCount = result.rows.filter((r) => checked.has(r.key) && selectable(r)).length;

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {result.rows.map((row) => {
          const canSelect = selectable(row);
          const isChecked = checked.has(row.key);
          const isPw = row.sensitive;
          const helmDisplay = isPw && !revealPw && row.helmValue ? '••••••••' : row.helmValue;
          const guestyDisplay = isPw && !revealPw && row.guestyValue ? '••••••••' : row.guestyValue;
          return (
            <div
              key={row.key}
              style={{
                border: HAIRLINE,
                borderRadius: 12,
                padding: '16px 18px',
                background: 'var(--card)',
                opacity: canSelect ? 1 : 0.7,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: canSelect ? 'pointer' : 'default', flex: 1 }}>
                  <input
                    type="checkbox"
                    checked={isChecked && canSelect}
                    disabled={!canSelect}
                    onChange={() => toggle(row.key)}
                    style={{ width: 16, height: 16, accentColor: 'var(--tide-deep)', cursor: canSelect ? 'pointer' : 'default' }}
                  />
                  <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>{row.label}</span>
                </label>
                {isPw && (row.helmValue || row.guestyValue) && (
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
                <StatusChip status={row.status} />
              </div>
              <div style={{ display: 'flex', gap: 24 }}>
                <ValueBlock label="In Helm" value={helmDisplay} muted={!row.helmValue} />
                <ValueBlock label="In Guesty now" value={guestyDisplay} muted={!row.guestyValue} />
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
