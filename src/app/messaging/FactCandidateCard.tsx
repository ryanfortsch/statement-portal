'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/Button';
import { captureColumn, type CaptureItem } from '@/lib/property-capture-catalog';
import { AUDIENCE_LABEL, type AudienceUpdate } from '@/lib/proposed-facts';
import {
  parseProposedUpdate,
  applyProposedUpdate,
  dismissProposedUpdate,
} from '../owner-messaging/proposed-updates-actions';
import { useSoftRefresh } from '@/lib/use-soft-refresh';

/**
 * One proposed fact reviewed on its own: a cleaner's, a contractor's or an
 * owner's (a new wifi password, a gate code, a trash day), or a guest-reply
 * fact kb_triage has not reached. A row of the one proposed-facts list on
 * /messaging/quality (ProposedFacts.tsx), in the same face as the triaged
 * rows beside it.
 *
 * Applying routes the text through Helm's existing Quick Capture parse +
 * apply, so a wifi password lands in the RLS-locked property_access table and
 * a wifi name on the properties table, exactly as a hand-dictated note would.
 * Nothing writes until the operator approves the routing.
 *
 * Moved here from owner-messaging/ProposedPropertyUpdatesCard.tsx on
 * 2026-11-08 when the two proposed-facts designs became one. The three
 * server actions and their payloads are unchanged.
 */

type EditItem = CaptureItem & { include: boolean; _id: number };
type Phase = 'idle' | 'review' | 'done';

export function CandidateCard({
  candidate,
  properties,
}: {
  candidate: AudienceUpdate;
  properties: { id: string; name: string }[];
}) {
  const source = candidate.audience;
  const softRefresh = useSoftRefresh();
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
      softRefresh();
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
      softRefresh();
    });
  }

  const includedCount = items.filter((i) => i.include).length;

  if (phase === 'done') {
    return (
      <div style={ROW_FACE}>
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
    <div style={ROW_FACE}>
      {/* Header: whose words (the audience column), who, the category. The
          home is the block's header, so the row does not print it again. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} title={`${candidate.confidence} confidence`} />
        <span className="eyebrow" style={{ color: 'var(--tide-deep)', fontWeight: 600 }}>
          {AUDIENCE_LABEL[source]}
        </span>
        {candidate.owner_name && (
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{candidate.owner_name}</span>
        )}
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
          <Button
            variant="secondary"
            size="sm"
            onClick={onReview}
            disabled={pending || !propertyId}
            watchdog={false}
          >
            {pending ? 'Sorting…' : 'Review & file'}
          </Button>
          <Button variant="quiet" size="sm" onClick={onDismiss} disabled={pending}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Review: the parsed routing, mirrors Quick Capture */}
      {phase === 'review' && (
        <div style={{ marginTop: 14 }}>
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
            <Button
              variant="primary"
              size="sm"
              onClick={onApply}
              disabled={pending || includedCount === 0}
              watchdog={false}
            >
              {pending ? 'Saving…' : `Apply ${includedCount} change${includedCount === 1 ? '' : 's'}`}
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setPhase('idle')} disabled={pending}>
              Back
            </Button>
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
            <div style={{ marginBottom: 6, fontSize: 12, color: 'var(--ink-3)' }}>
              Current: <span className="font-mono">{currentValue ?? 'Not set'}</span>
            </div>
            <label style={{ display: 'block', fontSize: 12 }}>
              Proposed
              <input value={item.value ?? ''} onChange={(e) => onPatch({ value: e.target.value })} style={fieldInput} />
            </label>
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

/** The one row face of the proposed-facts list, shared with the triaged
 *  rulings in ProposedFacts.tsx. */
export const ROW_FACE: React.CSSProperties = {
  marginTop: 14,
  borderLeft: '3px solid var(--rule)',
  background: 'var(--paper-2)',
  padding: '12px 14px',
};
