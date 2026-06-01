'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { parseLayoutFromProseAction } from './actions';

/**
 * Describe the house in walking order; Claude builds the entire inspection
 * layout — zones + the right items pre-attached to each zone — in one shot,
 * REPLACING whatever's currently there. No manual checkboxes.
 *
 * Re-running with a better description gives a clean re-mapping rather than
 * piling new zones on top of the old, which is what makes this feel like
 * "tell me the flow" instead of "click 72 boxes."
 */
export function LayoutProseInput({
  propertyId,
  existingZoneCount,
}: {
  propertyId: string;
  existingZoneCount: number;
}) {
  const router = useRouter();
  const [prose, setProse] = useState('');
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'success'; zones: number; items: number; unknown: string[] }
    | { kind: 'error'; msg: string }
  >({ kind: 'idle' });

  function handleParse() {
    if (existingZoneCount > 0) {
      const ok = window.confirm(
        `This will REPLACE the ${existingZoneCount} existing zone${existingZoneCount === 1 ? '' : 's'} (and their item assignments) with the layout Claude builds from your description. Proceed?`,
      );
      if (!ok) return;
    }
    setStatus({ kind: 'idle' });
    startTransition(async () => {
      const res = await parseLayoutFromProseAction({ propertyId, prose });
      if (res.ok) {
        setStatus({
          kind: 'success',
          zones: res.data?.zonesAdded ?? 0,
          items: res.data?.itemsAttached ?? 0,
          unknown: res.data?.unknownTitles ?? [],
        });
        setProse('');
        router.refresh();
      } else {
        setStatus({ kind: 'error', msg: res.error });
      }
    });
  }

  const buttonLabel = isPending
    ? 'Mapping the house…'
    : existingZoneCount > 0
      ? 'Replace layout with this'
      : 'Map the house';

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
          style={{ marginBottom: 8, color: 'var(--tide-deep)' }}
        >
          Describe the flow · Claude builds the whole layout
        </div>
        <p style={{ marginTop: 0, marginBottom: 10, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          Tell me how an inspector walks the house. Claude builds the zones in that order and pre-fills the right items per room — no checkboxes. Example:{' '}
          <em style={{ color: 'var(--ink-4)' }}>
            &ldquo;Kitchen is right when you walk in, then living room, half-bath off the hallway. Upstairs: primary with ensuite, two more bedrooms, shared bath. Out back: deck.&rdquo;
          </em>
        </p>
        <textarea
          value={prose}
          onChange={(e) => setProse(e.target.value)}
          disabled={isPending}
          rows={5}
          placeholder="Walk me through the house…"
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
            minHeight: 100,
          }}
        />
        <div className="flex items-center justify-between" style={{ marginTop: 10, gap: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-4)', flex: 1, minHeight: 16 }}>
            {status.kind === 'success' && (
              status.items === 0 && status.zones > 0 ? (
                <span style={{ color: 'var(--signal)' }}>
                  Mapped {status.zones} zone{status.zones === 1 ? '' : 's'} but couldn&rsquo;t attach any items. Try a more detailed description (e.g. name each room and its purpose) and Parse again.
                </span>
              ) : (
                <span style={{ color: 'var(--positive)' }}>
                  Mapped {status.zones} zone{status.zones === 1 ? '' : 's'}, {status.items} item{status.items === 1 ? '' : 's'} attached.
                  {status.unknown.length > 0 && (
                    <span style={{ color: 'var(--ink-4)' }}>
                      {' '}Skipped {status.unknown.length} title{status.unknown.length === 1 ? '' : 's'} I couldn&rsquo;t match.
                    </span>
                  )}
                </span>
              )
            )}
            {status.kind === 'error' && (
              <span style={{ color: 'var(--negative)' }}>{status.msg}</span>
            )}
            {status.kind === 'idle' && !isPending && (
              <span>
                {existingZoneCount > 0
                  ? `Will replace ${existingZoneCount} existing zone${existingZoneCount === 1 ? '' : 's'}.`
                  : 'Starting fresh — no zones yet.'}
              </span>
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
            {buttonLabel}
          </button>
        </div>
      </div>
    </section>
  );
}
