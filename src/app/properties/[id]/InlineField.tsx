'use client';

import { useState } from 'react';
import { applyPropertyCaptureAction } from '@/app/properties/actions';
import { captureColumn, isHighStakesColumn } from '@/lib/property-capture-catalog';
import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { useSoftRefresh } from '@/lib/use-soft-refresh';

/**
 * Fill a blank fact, or correct a written one, without leaving the page.
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
  current,
  mono,
}: {
  propertyId: string;
  column: string;
  label: string;
  /**
   * The value on file. Present means the row shows it with a quiet Edit that
   * opens the field prefilled; absent means a blank with Add.
   */
  current?: string | null;
  /** Codes and passwords read in the mono face, as the fact sheet prints them. */
  mono?: boolean;
}) {
  const softRefresh = useSoftRefresh();
  const [open, setOpen] = useState(false);
  const shown = (current ?? '').trim();
  const [value, setValue] = useState('');
  const dirty = value.trim() !== '' && value.trim() !== shown;
  const { pending, busy, error, setError, run } = useRecoverableAction();

  useUnsavedWorkGuard(pending || (open && dirty));

  const col = captureColumn(column);
  const numeric = col?.type === 'int' || col?.type === 'float';
  const highStakes = isHighStakesColumn(column);

  function save() {
    if (busy.current) return;
    const raw = value.trim();
    if (!raw) return;
    if (raw === shown) {
      setOpen(false);
      return;
    }
    setError(null);
    run(async () => {
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
    }, 'Could not confirm this field was saved. Your value is kept; try again.');
  }

  const openWith = () => {
    setValue(shown);
    setOpen(true);
  };

  if (!open) {
    if (shown) {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
          <span
            className={mono ? 'font-mono' : undefined}
            style={{ color: 'var(--ink)', fontSize: mono ? 12 : 14, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
          >
            {shown}
          </span>
          <button
            type="button"
            onClick={openWith}
            aria-label={`Edit ${label}`}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: 11,
              color: 'var(--ink-4)',
              fontFamily: 'inherit',
              letterSpacing: '.04em',
            }}
          >
            Edit
          </button>
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={openWith}
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
          disabled={pending}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (busy.current) return;
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            if (e.key === 'Escape' && (!dirty || confirm('Discard this field edit?'))) {
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
          disabled={pending || !dirty}
          style={{
            fontSize: 10,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            padding: '5px 10px',
            border: '1px solid var(--ink)',
            background: 'var(--ink)',
            color: 'var(--paper)',
            cursor: pending ? 'wait' : 'pointer',
            opacity: pending || !dirty ? 0.6 : 1,
          }}
        >
          {pending ? 'Saving' : 'Save'}
        </button>
        {/* A phone has no Escape key. */}
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (dirty && !confirm('Discard this field edit?')) return;
            setOpen(false);
            setValue('');
            setError(null);
          }}
          style={{
            fontSize: 10,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            padding: '5px 4px',
            border: 'none',
            background: 'none',
            color: 'var(--ink-4)',
            cursor: 'pointer',
          }}
        >
          Cancel
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
