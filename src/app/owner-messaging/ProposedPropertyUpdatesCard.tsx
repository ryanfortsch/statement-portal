'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Section } from '@/components/Section';
import { captureColumn, type CaptureItem } from '@/lib/property-capture-catalog';
import type { ProposedPropertyUpdate } from '@/lib/stay-concierge';
import {
  parseProposedUpdate,
  applyProposedUpdate,
  dismissProposedUpdate,
} from './proposed-updates-actions';

/**
 * "Proposed property updates" — durable property facts owners shared in their
 * messages (a new wifi password, a gate code, a trash day), detected by the
 * stay-concierge owner extractor. The operator reviews each one and, in one
 * pass, applies it to the property record. Applying routes the text through
 * Helm's existing Quick Capture parse + apply, so a wifi password lands in the
 * RLS-locked property_access table and a wifi name on the properties table,
 * exactly as a hand-dictated note would. Nothing writes until the operator
 * approves the routing.
 */

type Props = {
  initial: ProposedPropertyUpdate[];
  initialError: string | null;
  properties: { id: string; name: string }[];
  /** Who shared these facts; drives the card copy only. The owner page
   * omits it (default 'owner'); the cleaner page passes 'cleaner'. */
  source?: 'owner' | 'cleaner';
};

export function ProposedPropertyUpdatesCard({ initial, initialError, properties, source = 'owner' }: Props) {
  const items = initial ?? [];
  const right =
    items.length > 0 ? (
      <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
        {items.length} waiting
      </span>
    ) : undefined;

  return (
    <Section
      title="Proposed property updates"
      eyebrow={`Facts ${source}s shared, ready to file to the property`}
      paddingTop={36}
      right={right}
    >
      {initialError ? (
        <div
          style={{
            borderTop: '1px solid var(--rule)',
            paddingTop: 18,
            fontSize: 13,
            color: 'var(--ink-3)',
            lineHeight: 1.6,
          }}
        >
          {initialError}
        </div>
      ) : items.length === 0 ? (
        <div
          style={{
            borderTop: '1px solid var(--rule)',
            paddingTop: 18,
            fontSize: 13,
            color: 'var(--ink-4)',
            lineHeight: 1.6,
          }}
        >
          Nothing to review. When {source === 'cleaner' ? 'a cleaner texts' : 'an owner texts or emails'} a
          durable property fact (a wifi change, a code, a trash day), it shows
          up here to file in one tap.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid var(--rule)', paddingTop: 18 }}>
          {properties.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--signal)', lineHeight: 1.6 }}>
              Property list unavailable, so filing is disabled. Reload the page or check access; you can still dismiss.
            </div>
          )}
          {items.map((u) => (
            <CandidateCard key={u.id} candidate={u} properties={properties} source={source} />
          ))}
        </div>
      )}
    </Section>
  );
}

type EditItem = CaptureItem & { include: boolean; _id: number };
type Phase = 'idle' | 'review' | 'done';

function CandidateCard({
  candidate,
  properties,
  source,
}: {
  candidate: ProposedPropertyUpdate;
  properties: { id: string; name: string }[];
  source: 'owner' | 'cleaner';
}) {
  const router = useRouter();
  const known = properties.some((p) => p.id === candidate.property_id);
  const [propertyId, setPropertyId] = useState(known ? candidate.property_id : '');
  const [phase, setPhase] = useState<Phase>('idle');
  const [items, setItems] = useState<EditItem[]>([]);
  const [current, setCurrent] = useState<Record<string, string | null>>({});
  const [unrouted, setUnrouted] = useState<string | null>(null);
  const [doneSummary, setDoneSummary] = useState<{ columns: number; notes: number; skipped: string[]; warning?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const dot =
    candidate.confidence === 'high'
      ? 'var(--positive)'
      : candidate.confidence === 'medium'
        ? 'var(--tide-deep)'
        : 'var(--ink-4)';

  function onReview() {
    setError(null);
    start(async () => {
      const res = await parseProposedUpdate(propertyId, candidate.fact_text);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.items.length === 0 && !res.unrouted) {
        setError('Helm could not route that into a property field or note. Dismiss it, or edit the property record by hand.');
        return;
      }
      setItems(res.items.map((it, i) => ({ ...it, include: true, _id: i })));
      setCurrent(res.currentValues);
      setUnrouted(res.unrouted);
      setPhase('review');
    });
  }

  function patchItem(id: number, patch: Partial<EditItem>) {
    setItems((prev) => prev.map((it) => (it._id === id ? { ...it, ...patch } : it)));
  }

  function onApply() {
    setError(null);
    const included: CaptureItem[] = items
      .filter((i) => i.include)
      .map(({ include, _id, ...rest }) => {
        void include;
        void _id;
        return rest;
      });
    if (included.length === 0) {
      setError('Nothing checked to apply.');
      return;
    }
    start(async () => {
      const res = await applyProposedUpdate(candidate.id, propertyId, included, candidate.category);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDoneSummary({ columns: res.columns, notes: res.notes, skipped: res.skipped, warning: res.warning });
      setPhase('done');
      router.refresh();
    });
  }

  function onDismiss() {
    setError(null);
    start(async () => {
      const res = await dismissProposedUpdate(candidate.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPhase('done');
      setDoneSummary(null);
      router.refresh();
    });
  }

  const includedCount = items.filter((i) => i.include).length;

  if (phase === 'done') {
    return (
      <div style={{ border: '1px solid var(--rule)', background: 'var(--paper-2)', padding: '14px 16px' }}>
        <span style={{ fontSize: 13, color: 'var(--ink)' }}>
          {doneSummary ? (
            <>
              <span style={{ color: 'var(--positive)', fontWeight: 600 }}>Filed.</span>{' '}
              {doneSummary.columns > 0 && `${doneSummary.columns} field${doneSummary.columns === 1 ? '' : 's'} updated`}
              {doneSummary.columns > 0 && doneSummary.notes > 0 && ', '}
              {doneSummary.notes > 0 && `${doneSummary.notes} note${doneSummary.notes === 1 ? '' : 's'} added`}.
              {doneSummary.skipped.length > 0 && (
                <span style={{ color: 'var(--signal)' }}> Could not read a value for {doneSummary.skipped.join(', ')}.</span>
              )}
              {doneSummary.warning && (
                <span style={{ color: 'var(--signal)' }}> {doneSummary.warning}</span>
              )}
            </>
          ) : (
            <span style={{ color: 'var(--ink-3)' }}>Dismissed.</span>
          )}
        </span>
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid var(--rule)', background: 'var(--paper-2)', padding: '14px 16px' }}>
      {/* Header: owner + property + category */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} title={`${candidate.confidence} confidence`} />
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            color: 'var(--tide-deep)',
            border: '1px solid var(--tide-deep)',
            padding: '2px 8px',
            whiteSpace: 'nowrap',
          }}
        >
          {candidate.category.replace(/_/g, ' ')}
        </span>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {candidate.owner_name || (source === 'cleaner' ? 'A cleaner' : 'An owner')}
          {candidate.property_name ? ` · ${candidate.property_name}` : ''}
        </span>
      </div>

      {/* The distilled fact + the owner's actual words */}
      <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.5 }}>{candidate.fact_text}</div>
      {candidate.raw_quote && (
        <div style={{ marginTop: 5, fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic', lineHeight: 1.5 }}>
          from: &ldquo;{candidate.raw_quote}&rdquo;
        </div>
      )}

      {/* Property targeting (defaults to the synced slug; correctable) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
          File to
        </span>
        <select
          value={propertyId}
          onChange={(e) => {
            setPropertyId(e.target.value);
            if (phase === 'review') {
              setPhase('idle');
              setItems([]);
            }
          }}
          style={{
            fontSize: 13,
            padding: '6px 8px',
            background: 'var(--paper)',
            color: 'var(--ink)',
            border: '1px solid var(--rule)',
            borderRadius: 3,
            outline: 'none',
          }}
        >
          <option value="">Select property…</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {!known && (
          <span className="eyebrow" style={{ color: 'var(--signal)' }}>
            Confirm the property
          </span>
        )}
      </div>

      {/* Actions */}
      {phase === 'idle' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14 }}>
          <button
            type="button"
            onClick={onReview}
            disabled={pending || !propertyId}
            style={{ ...primaryBtn, opacity: pending || !propertyId ? 0.5 : 1, cursor: pending ? 'wait' : 'pointer' }}
          >
            {pending ? 'Sorting…' : 'Review & file'}
          </button>
          <button type="button" onClick={onDismiss} disabled={pending} style={linkBtn}>
            Dismiss
          </button>
        </div>
      )}

      {/* Review: the parsed routing, mirrors Quick Capture */}
      {phase === 'review' && (
        <div style={{ marginTop: 14 }}>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
            Here is how Helm would file it. Edit anything, uncheck what you do not want, then apply. Credentials route to
            secured storage automatically.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map((it) => (
              <ItemRow
                key={it._id}
                item={it}
                currentValue={it.column ? current[it.column] ?? null : null}
                onPatch={(p) => patchItem(it._id, p)}
              />
            ))}
          </div>
          {unrouted && (
            <div style={{ marginTop: 10, padding: '8px 12px', borderLeft: '3px solid var(--ink-4)', background: 'var(--paper)', fontSize: 12, color: 'var(--ink-3)' }}>
              Could not place: &ldquo;{unrouted}&rdquo;
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14 }}>
            <button
              type="button"
              onClick={onApply}
              disabled={pending || includedCount === 0}
              style={{ ...primaryBtn, opacity: pending || includedCount === 0 ? 0.5 : 1, cursor: pending ? 'wait' : 'pointer' }}
            >
              {pending ? 'Saving…' : `Apply ${includedCount} change${includedCount === 1 ? '' : 's'}`}
            </button>
            <button type="button" onClick={() => setPhase('idle')} style={linkBtn} disabled={pending}>
              Back
            </button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 12, padding: '8px 12px', borderLeft: '3px solid var(--signal)', background: 'var(--paper)', fontSize: 12, color: 'var(--signal)', lineHeight: 1.5 }}>
          {error}
        </div>
      )}
    </div>
  );
}

function ItemRow({
  item,
  currentValue,
  onPatch,
}: {
  item: EditItem;
  currentValue: string | null;
  onPatch: (p: Partial<EditItem>) => void;
}) {
  const col = item.target === 'column' && item.column ? captureColumn(item.column) : undefined;
  const destChip =
    item.target === 'column'
      ? col
        ? `${col.section} · ${col.label}`
        : 'Field'
      : item.guestFacing
        ? 'Guest note'
        : 'Internal note';
  const chipColor = item.target === 'column' ? 'var(--ink)' : item.guestFacing ? 'var(--tide-deep)' : 'var(--ink-3)';

  return (
    <div
      style={{
        border: '1px solid var(--rule)',
        background: item.include ? 'var(--paper)' : 'var(--paper-2)',
        opacity: item.include ? 1 : 0.6,
        padding: '10px 12px',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
      }}
    >
      <input
        type="checkbox"
        checked={item.include}
        onChange={(e) => onPatch({ include: e.target.checked })}
        style={{ marginTop: 4, accentColor: 'var(--tide-deep)', width: 15, height: 15, flexShrink: 0 }}
        aria-label={`Include ${destChip}`}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '.16em',
              textTransform: 'uppercase',
              color: chipColor,
              border: `1px solid ${chipColor}`,
              padding: '2px 8px',
              whiteSpace: 'nowrap',
            }}
          >
            {destChip}
          </span>
          {item.target === 'note' && (
            <ToggleGuest guestFacing={item.guestFacing} onChange={(g) => onPatch({ guestFacing: g })} />
          )}
        </div>

        {item.target === 'column' ? (
          <>
            <input value={item.value ?? ''} onChange={(e) => onPatch({ value: e.target.value })} style={fieldInput} />
            {currentValue && (
              <div style={{ marginTop: 5, fontSize: 11, color: 'var(--signal)' }}>
                Replaces current value: <span className="font-mono">{currentValue}</span>
              </div>
            )}
          </>
        ) : (
          <>
            <input
              value={item.noteTitle ?? ''}
              onChange={(e) => onPatch({ noteTitle: e.target.value })}
              placeholder="Note title"
              style={{ ...fieldInput, fontWeight: 500 }}
            />
            <textarea
              value={item.noteBody ?? ''}
              onChange={(e) => onPatch({ noteBody: e.target.value })}
              placeholder="Detail"
              rows={2}
              style={{ ...fieldInput, marginTop: 6, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
            />
            <input
              value={item.noteTag ?? ''}
              onChange={(e) => onPatch({ noteTag: e.target.value })}
              placeholder="tag (optional)"
              style={{ ...fieldInput, marginTop: 6, fontSize: 12 }}
            />
          </>
        )}
      </div>
    </div>
  );
}

function ToggleGuest({ guestFacing, onChange }: { guestFacing: boolean; onChange: (g: boolean) => void }) {
  return (
    <span
      role="group"
      aria-label="Note audience"
      title="Guest = added to the guest-messaging knowledge base. Internal = ops-only."
      style={{ display: 'inline-flex', border: '1px solid var(--rule)', overflow: 'hidden' }}
    >
      {([['Guest', true], ['Internal', false]] as const).map(([label, val]) => {
        const on = guestFacing === val;
        return (
          <button
            key={label}
            type="button"
            onClick={() => onChange(val)}
            aria-pressed={on}
            style={{
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
              padding: '3px 9px',
              border: 'none',
              cursor: 'pointer',
              background: on ? (val ? 'var(--tide-deep)' : 'var(--ink-3)') : 'transparent',
              color: on ? 'var(--paper)' : 'var(--ink-4)',
            }}
          >
            {label}
          </button>
        );
      })}
    </span>
  );
}

const fieldInput: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--rule)',
  borderBottom: '1px solid var(--ink)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  fontSize: 14,
  padding: '8px 10px',
  outline: 'none',
  boxSizing: 'border-box',
};

const primaryBtn: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  color: 'var(--paper)',
  background: 'var(--ink)',
  border: '1px solid var(--ink)',
  padding: '9px 16px',
  fontWeight: 600,
};

const linkBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  fontSize: 11,
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  cursor: 'pointer',
  fontWeight: 500,
  padding: 0,
};
