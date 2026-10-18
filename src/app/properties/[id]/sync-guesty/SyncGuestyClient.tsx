'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import {
  loadGuestyFieldsAction,
  pullGuestyFieldsAction,
  pushGuestyFieldsAction,
  type FieldKey,
  type FieldRow,
  type LoadFieldsResult,
  type PullRow,
} from './actions';
import type { PullKey } from '@/lib/guesty-fields';

/**
 * The Guesty fields screen: Helm on the left, the live Guesty listing on the
 * right, and between them an arrow per field for the way it moves. Helm to
 * Guesty (the guest-facing Wi-Fi, parking and trash fields) and Guesty to
 * Helm (the house's size, type and map pin, blanks only) used to be two
 * tools with two names; the arrow now says the direction.
 */

/** Long-form fields get a textarea; the Wi-Fi pair stays single-line. */
const MULTILINE: ReadonlySet<FieldKey> = new Set<FieldKey>(['parkingInstructions', 'trashCollectedOn']);

/** What pushing this (possibly edited) value would do to Guesty. */
type PushEffect = 'fill' | 'overwrite' | 'same' | 'empty';

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function pushEffect(edited: string, guestyValue: string): PushEffect {
  const v = edited.trim();
  if (!v) return 'empty';
  if (norm(v) === norm(guestyValue)) return 'same';
  if (!guestyValue) return 'fill';
  return 'overwrite';
}

const PUSH_WORD: Record<PushEffect, string> = {
  fill: 'fills Guesty',
  overwrite: 'replaces Guesty',
  same: 'matches',
  empty: 'nothing to send',
};
const PULL_WORD: Record<PullRow['status'], string> = {
  fill: 'fills Helm',
  same: 'matches',
  kept: 'Helm keeps its own',
  'guesty-empty': 'Guesty has none',
};

const rule = '1px solid var(--rule)';
const labelStyle: CSSProperties = { fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600 };
const inputStyle: CSSProperties = {
  width: '100%',
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: rule,
  padding: '8px 10px',
  fontFamily: 'inherit',
  resize: 'vertical',
};
const btnBase: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '.04em',
  padding: '10px 16px',
  border: '1px solid var(--ink)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  cursor: 'pointer',
};
const btnPrimary: CSSProperties = { ...btnBase, background: 'var(--ink)', color: 'var(--paper)' };
const valueText = (v: string): CSSProperties => ({
  fontSize: 13,
  lineHeight: 1.5,
  color: v ? 'var(--ink)' : 'var(--ink-4)',
  fontStyle: v ? 'normal' : 'italic',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
});

// Field | Helm | arrow | Guesty from 640px; stacked on a phone, where the
// arrow turns to point down (Helm above Guesty) or up.
const gridCss = `
.rt-gf-row { display: grid; grid-template-columns: 150px minmax(0,1fr) 92px minmax(0,1fr); gap: 14px; align-items: start; padding: 14px 0; border-bottom: ${rule}; }
.rt-gf-head { padding: 0 0 8px; border-bottom: 1px solid var(--ink); }
.rt-gf-arrow-v { display: none; }
@media (max-width: 640px) {
  .rt-gf-row { grid-template-columns: 1fr; gap: 6px; }
  .rt-gf-head { display: none; }
  .rt-gf-arrow-h { display: none; }
  .rt-gf-arrow-v { display: inline; }
  .rt-gf-side::before { content: attr(data-side); display: block; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-4); font-weight: 600; margin-bottom: 2px; }
}`;

function Arrow({ direction, checked, disabled, onChange, word, label }: {
  direction: 'push' | 'pull';
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
  word: string;
  label: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: disabled ? 'default' : 'pointer', paddingTop: 4 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} aria-label={label} style={{ width: 16, height: 16, accentColor: 'var(--ink)' }} />
        <span aria-hidden style={{ fontSize: 20, lineHeight: 1, color: disabled ? 'var(--ink-4)' : 'var(--ink)' }}>
          <span className="rt-gf-arrow-h">{direction === 'push' ? '→' : '←'}</span>
          <span className="rt-gf-arrow-v">{direction === 'push' ? '↓' : '↑'}</span>
        </span>
      </span>
      <span style={{ fontSize: 11, color: 'var(--ink-3)', textAlign: 'center', lineHeight: 1.3 }}>{word}</span>
    </label>
  );
}

export function SyncGuestyClient({ propertyId }: { propertyId: string }) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<LoadFieldsResult | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Set<FieldKey>>(new Set());
  const [pullChecked, setPullChecked] = useState<Set<PullKey>>(new Set());
  const [revealPw, setRevealPw] = useState(false);
  const [busy, setBusy] = useState<'push' | 'pull' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (keepMessage = false) => {
    setLoading(true);
    if (!keepMessage) setMsg(null);
    try {
      const res = await loadGuestyFieldsAction(propertyId);
      setResult(res);
      if (res.ok) {
        const v: Record<string, string> = {};
        for (const r of res.rows) v[r.key] = r.helmValue;
        setValues(v);
        setChecked(new Set(res.rows.filter((r) => r.recommend).map((r) => r.key)));
        setPullChecked(new Set(res.pull.filter((r) => r.recommend).map((r) => r.key)));
      }
    } catch {
      setResult({ ok: false, error: 'Could not read Helm and the Guesty listing. Reload to try again.' });
    }
    setLoading(false);
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows: FieldRow[] = result?.ok ? result.rows : [];
  const pull: PullRow[] = result?.ok ? result.pull : [];

  const canPush = useCallback((row: FieldRow) => {
    const e = pushEffect(values[row.key] ?? '', row.guestyValue);
    return e === 'fill' || e === 'overwrite';
  }, [values]);
  const pushCount = useMemo(() => rows.filter((r) => checked.has(r.key) && canPush(r)).length, [rows, checked, canPush]);
  const pullCount = pull.filter((r) => pullChecked.has(r.key) && r.status === 'fill').length;

  const toggle = <K,>(set: (fn: (prev: Set<K>) => Set<K>) => void, key: K) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const push = async () => {
    const selections = rows.filter((r) => checked.has(r.key) && canPush(r)).map((r) => ({ key: r.key, value: values[r.key] ?? '' }));
    if (selections.length === 0 || busy) return;
    setBusy('push');
    setMsg(null);
    try {
      const res = await pushGuestyFieldsAction(propertyId, selections);
      if (res.ok) {
        setMsg({ ok: true, text: `Sent ${res.pushed.length} field${res.pushed.length === 1 ? '' : 's'} to Guesty.` });
        await load(true);
      } else setMsg({ ok: false, text: res.error });
    } catch {
      setMsg({ ok: false, text: 'Could not confirm the Guesty write. Reload to see what Guesty holds now.' });
    } finally {
      setBusy(null);
    }
  };

  const fill = async () => {
    const keys = pull.filter((r) => pullChecked.has(r.key) && r.status === 'fill').map((r) => r.key);
    if (keys.length === 0 || busy) return;
    setBusy('pull');
    setMsg(null);
    try {
      const res = await pullGuestyFieldsAction(propertyId, keys);
      if (res.ok) {
        setMsg({
          ok: true,
          text: res.filled.length
            ? `Filled ${res.filled.join(', ').toLowerCase()} in Helm.`
            : 'Nothing filled: those fields were set in Helm meanwhile.',
        });
        await load(true);
      } else setMsg({ ok: false, text: res.error });
    } catch {
      setMsg({ ok: false, text: 'Could not confirm the Helm save. Reload to see what Helm holds now.' });
    } finally {
      setBusy(null);
    }
  };

  if (loading && !result) {
    return <p style={{ fontSize: 14, color: 'var(--ink-3)' }}>Reading Helm and the Guesty listing…</p>;
  }

  if (!result || !result.ok) {
    const error = result && !result.ok ? result.error : 'Something went wrong.';
    const needsListing = !!(result && !result.ok && result.needsListing);
    return (
      <div role="alert" style={{ border: rule, padding: '18px 20px', fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6 }}>
        <div>{error}</div>
        {needsListing && (
          <div style={{ marginTop: 8 }}>
            The Guesty listing ID is set in the Stay Cape Ann launcher, Step 1.{' '}
            <Link href={`/properties/${propertyId}/stay-cape-ann`} style={{ color: 'var(--tide-deep)' }}>
              Set the Guesty listing ID →
            </Link>
          </div>
        )}
      </div>
    );
  }

  const disabled = loading || busy !== null;

  return (
    <div>
      <style>{gridCss}</style>
      <div className="rt-gf-row rt-gf-head" aria-hidden>
        <span style={labelStyle}>Field</span>
        <span style={labelStyle}>Helm</span>
        <span style={{ ...labelStyle, textAlign: 'center' }}>Moves</span>
        <span style={labelStyle}>Guesty</span>
      </div>

      {rows.map((row) => {
        const val = values[row.key] ?? '';
        const effect = pushEffect(val, row.guestyValue);
        const selectable = effect === 'fill' || effect === 'overwrite';
        const isPw = row.sensitive;
        const guestyDisplay = isPw && !revealPw && row.guestyValue ? '••••••••' : row.guestyValue;
        return (
          <div key={row.key} className="rt-gf-row">
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', paddingTop: 6 }}>
              {row.label}
              {isPw && (
                <button type="button" onClick={() => setRevealPw((v) => !v)} style={{ ...btnBase, padding: '2px 8px', fontSize: 10, marginLeft: 8 }}>
                  {revealPw ? 'Hide' : 'Show'}
                </button>
              )}
            </div>
            <div className="rt-gf-side" data-side="Helm">
              {MULTILINE.has(row.key) ? (
                <textarea
                  value={val}
                  disabled={disabled}
                  onChange={(e) => setValues((p) => ({ ...p, [row.key]: e.target.value }))}
                  rows={Math.min(8, Math.max(2, val.split('\n').length + 1))}
                  style={inputStyle}
                  aria-label={`${row.label} in Helm`}
                />
              ) : (
                <input
                  type={isPw && !revealPw ? 'password' : 'text'}
                  value={val}
                  disabled={disabled}
                  onChange={(e) => setValues((p) => ({ ...p, [row.key]: e.target.value }))}
                  style={inputStyle}
                  aria-label={`${row.label} in Helm`}
                />
              )}
            </div>
            <Arrow
              direction="push"
              checked={checked.has(row.key) && selectable}
              disabled={disabled || !selectable}
              onChange={() => toggle(setChecked, row.key)}
              word={PUSH_WORD[effect]}
              label={`Send ${row.label} from Helm to Guesty`}
            />
            <div className="rt-gf-side" data-side="Guesty" style={{ ...valueText(row.guestyValue), paddingTop: 8 }}>
              {guestyDisplay || 'empty'}
            </div>
          </div>
        );
      })}

      {pull.map((row) => (
        <div key={row.key} className="rt-gf-row">
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', paddingTop: 6 }}>{row.label}</div>
          <div className="rt-gf-side" data-side="Helm" style={{ ...valueText(row.helmValue), paddingTop: 8 }}>
            {row.helmValue || 'blank'}
          </div>
          <Arrow
            direction="pull"
            checked={pullChecked.has(row.key) && row.status === 'fill'}
            disabled={disabled || row.status !== 'fill'}
            onChange={() => toggle(setPullChecked, row.key)}
            word={PULL_WORD[row.status]}
            label={`Fill ${row.label} in Helm from Guesty`}
          />
          <div className="rt-gf-side" data-side="Guesty" style={{ ...valueText(row.guestyValue), paddingTop: 8 }}>
            {row.guestyValue || 'empty'}
          </div>
        </div>
      ))}

      <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={push} disabled={disabled || pushCount === 0} style={{ ...btnPrimary, opacity: disabled || pushCount === 0 ? 0.5 : 1 }}>
          {busy === 'push' ? 'Sending…' : `Send ${pushCount} to Guesty →`}
        </button>
        <button type="button" onClick={fill} disabled={disabled || pullCount === 0} style={{ ...btnBase, opacity: disabled || pullCount === 0 ? 0.5 : 1 }}>
          {busy === 'pull' ? 'Filling…' : `← Fill ${pullCount} in Helm`}
        </button>
        {msg && (
          <span role="status" style={{ fontSize: 13, color: msg.ok ? 'var(--positive)' : 'var(--negative)' }}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
