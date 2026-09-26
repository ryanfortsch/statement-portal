'use client';

import { useState, useTransition } from 'react';
import { applyPropertyCaptureAction } from '@/app/properties/actions';
import { captureColumn, isHighStakesColumn } from '@/lib/property-capture-catalog';
import { useSoftRefresh } from '@/lib/use-soft-refresh';

/**
 * Fill one blank fact without leaving the page.
 *
 * Reading a wrong or missing value on Facts and fixing it used to be a trip
 * to the edit form, a hunt for the field, a save and a bounce back. For a
 * Wi-Fi typo that is a six-step round trip to change four characters.
 *
 * This deliberately does NOT add a write path. It reuses
 * applyPropertyCaptureAction, the same server action Quick Capture applies
 * through, with a single-item payload. That action already checks the
 * session, uses the capture catalog as its column allowlist (an unknown key
 * is skipped rather than written), coerces by the column's declared type,
 * and routes the write to `properties` or to the RLS-locked
 * `property_access` depending on which table owns the column. A second
 * writer would have had to get all four of those right again, and the
 * access upsert's own docblock records an incident where column writes were
 * silently dropped.
 *
 * Two consequences of that reuse, both deliberate:
 *
 *  - Only columns in the capture catalog are editable here. Identity and
 *    billing (name, address, management_fee_pct, owner_emails) are excluded
 *    from it on purpose and keep their guarded edit paths.
 *  - An empty value cannot CLEAR a field: the action skips blank values. So
 *    this fills a blank or corrects a value; clearing one stays on the form,
 *    where the intent is unambiguous.
 */
export function InlineField({
  propertyId,
  column,
  label,
}: {
  propertyId: string;
  column: string;
  label: string;
}) {
  const softRefresh = useSoftRefresh();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const col = captureColumn(column);
  const numeric = col?.type === 'int' || col?.type === 'float';
  const highStakes = isHighStakesColumn(column);

  function save() {
    const raw = value.trim();
    if (!raw) return;
    setError(null);
    start(async () => {
      const res = await applyPropertyCaptureAction(propertyId, [
        {
          target: 'column',
          column,
          value: raw,
          noteTitle: null,
          noteBody: null,
          noteTag: null,
          guestFacing: false,
          sourceText: `Typed into ${label} on the property page`,
          confidence: 'high',
        },
      ]);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // The action skips a value it cannot coerce (a numeric field with no
      // readable number) and reports it rather than writing nonsense. Say so
      // instead of closing on a save that did not happen.
      if (res.columns === 0) {
        setError(
          numeric ? 'That did not read as a number, so nothing was saved.' : 'Nothing was saved.',
        );
        return;
      }
      setOpen(false);
      setValue('');
      softRefresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontSize: 12,
          color: 'var(--signal)',
          fontFamily: 'inherit',
        }}
      >
        Add &rarr;
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') {
              setOpen(false);
              setValue('');
              setError(null);
            }
          }}
          inputMode={numeric ? 'numeric' : undefined}
          aria-label={label}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            padding: '5px 8px',
            border: '1px solid var(--rule)',
            background: 'var(--paper)',
            color: 'var(--ink)',
            fontFamily: 'inherit',
          }}
        />
        <button
          type="button"
          onClick={save}
          disabled={pending || !value.trim()}
          style={{
            fontSize: 10,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            padding: '5px 10px',
            border: '1px solid var(--ink)',
            background: 'var(--ink)',
            color: 'var(--paper)',
            cursor: pending ? 'wait' : 'pointer',
            opacity: pending || !value.trim() ? 0.6 : 1,
          }}
        >
          {pending ? 'Saving' : 'Save'}
        </button>
      </div>
      {highStakes && (
        <span style={{ fontSize: 10, color: 'var(--ink-4)', lineHeight: 1.4 }}>
          This is how a cleaner or inspector gets in. A wrong value here is the instruction they follow.
        </span>
      )}
      {error && <span style={{ fontSize: 11, color: 'var(--negative)' }}>{error}</span>}
    </div>
  );
}
