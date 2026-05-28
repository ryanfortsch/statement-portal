'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { parseLayoutFromProseAction } from './actions';

/**
 * Free-form layout entry. Describe the house in prose, hit Parse, and
 * Claude turns it into ordered zones appended to this property's layout.
 * Existing zones are untouched (this only adds), so it composes with the
 * manual "Add Zone" form below — operator can use either or both.
 */
export function LayoutProseInput({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const [prose, setProse] = useState('');
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    { kind: 'idle' } | { kind: 'success'; added: number } | { kind: 'error'; msg: string }
  >({ kind: 'idle' });

  function handleParse() {
    setStatus({ kind: 'idle' });
    startTransition(async () => {
      const res = await parseLayoutFromProseAction({ propertyId, prose });
      if (res.ok) {
        setStatus({ kind: 'success', added: res.data?.added ?? 0 });
        setProse('');
        // Revalidate the page so the new zones show in the list below.
        router.refresh();
      } else {
        setStatus({ kind: 'error', msg: res.error });
      }
    });
  }

  return (
    <section className="max-w-[900px] mx-auto px-10" style={{ paddingBottom: 18, width: '100%' }}>
      <div
        style={{
          padding: 16,
          border: '1px solid var(--rule)',
          background: 'var(--paper-2)',
        }}
      >
        <div
          className="eyebrow"
          style={{ marginBottom: 8, color: 'var(--tide-deep)', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <span>Describe the house · Claude maps the zones</span>
        </div>
        <p style={{ marginTop: 0, marginBottom: 10, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          Type the house in walking order. Example:{' '}
          <em style={{ color: 'var(--ink-4)' }}>
            &ldquo;Main floor has a kitchen, living room, half-bath, and back deck. Upstairs: primary bedroom with ensuite, two more bedrooms, shared bath. Basement: laundry and media room.&rdquo;
          </em>
        </p>
        <textarea
          value={prose}
          onChange={(e) => setProse(e.target.value)}
          disabled={isPending}
          rows={4}
          placeholder="Describe the house in walking order…"
          style={{
            width: '100%',
            padding: '10px 12px',
            border: '1px solid var(--rule)',
            background: 'var(--paper)',
            color: 'var(--ink)',
            fontSize: 13,
            lineHeight: 1.5,
            fontFamily: 'inherit',
            resize: 'vertical',
            minHeight: 84,
          }}
        />
        <div className="flex items-center justify-between" style={{ marginTop: 10, gap: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-4)', flex: 1, minHeight: 16 }}>
            {status.kind === 'success' && (
              <span style={{ color: 'var(--positive)' }}>
                Added {status.added} zone{status.added === 1 ? '' : 's'} at the bottom of the walk.
              </span>
            )}
            {status.kind === 'error' && (
              <span style={{ color: 'var(--negative)' }}>{status.msg}</span>
            )}
            {status.kind === 'idle' && !isPending && (
              <span>Appends to existing zones. You can edit or reorder after.</span>
            )}
            {isPending && <span>Reading the house…</span>}
          </div>
          <button
            type="button"
            onClick={handleParse}
            disabled={isPending || prose.trim().length === 0}
            style={{
              background: isPending || prose.trim().length === 0 ? 'var(--ink-4)' : 'var(--tide-deep)',
              color: 'var(--paper)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              padding: '12px 18px',
              border: 'none',
              cursor: isPending || prose.trim().length === 0 ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {isPending ? 'Parsing…' : 'Parse with Claude'}
          </button>
        </div>
      </div>
    </section>
  );
}
