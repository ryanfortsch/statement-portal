'use client';

import { useActionState, useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import { useFieldFormDraft, FieldDraftStatus } from '@/components/FieldFormDraft';
import { PhotoUploader, useClearPhotoDraft } from '@/components/PhotoUploader';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { reportFieldWorkSlip, type ReportState } from '../actions';

export type VisitOption = {
  propertyId: string;
  propertyName: string;
  city: string | null;
  agoLabel: string;
  leftLabel: string;
};

const PRIORITIES: Array<{ value: 'low' | 'normal' | 'high'; label: string; hint: string }> = [
  { value: 'low', label: 'Whenever', hint: 'no rush' },
  { value: 'normal', label: 'Normal', hint: 'before the next guest' },
  { value: 'high', label: 'Soon', hint: 'needs attention' },
];

const card: React.CSSProperties = {
  border: '1px solid var(--rule)',
  borderRadius: 12,
  background: 'var(--paper-2, #fff)',
  padding: 'clamp(20px,5vw,30px)',
  maxWidth: 620,
};
const label: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--ink)',
  marginBottom: 7,
};
const optional: React.CSSProperties = { color: 'var(--ink-4)', fontWeight: 400 };
const field: React.CSSProperties = {
  width: '100%',
  font: 'inherit',
  fontSize: 16, // 16px so iOS doesn't zoom on focus
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  borderRadius: 8,
  padding: '11px 13px',
  outline: 'none',
};

export function ReportIssueForm({ visits, windowHours }: { visits: VisitOption[]; windowHours: number }) {
  const submitting = useRef(false);
  const [state, formAction, isPending] = useActionState<ReportState, FormData>(async (previous, data) => {
    try {
      return await reportFieldWorkSlip(previous, data);
    } catch {
      // The request may have reached the office even if its response was lost.
      // Keep the draft and avoid automatically sending a duplicate report.
      return { ok: false, error: 'Could not confirm whether the report was filed. Your details are still here. Check with the office before trying again.' };
    } finally {
      submitting.current = false;
    }
  }, { ok: false });
  const [initialSelected] = useState(visits.length === 1 ? visits[0].propertyId : '');
  const selectionDraft = useFieldFormDraft('report-selection', { selected: initialSelected });
  const { selected } = selectionDraft.value;
  const setSelected = (v: string) => selectionDraft.set('selected', v);
  const formDraft = useFieldFormDraft(selected ? `report:${selected}` : undefined, { priority: 'normal' as 'low' | 'normal' | 'high', title: '', location: '', description: '', expenseDollars: '' });
  const { priority, ...details } = formDraft.value;
  const setPriority = (v: 'low' | 'normal' | 'high') => formDraft.set('priority', v);
  const draftKey = selected ? `report:${selected}` : '';
  const clearDraft = useClearPhotoDraft(draftKey);
  const [photos, setPhotos] = useState<string[]>([]);
  const clearForm = formDraft.clear, clearSelection = selectionDraft.clear;
  useEffect(() => { if (state.ok) { clearForm(); clearSelection(); void clearDraft(photos); } }, [state.ok, photos, clearDraft, clearForm, clearSelection]);
  // Controlled values survive React's form reset after a returned action error.
  const [uploading, setUploading] = useState(false);
  const dirty = selected !== initialSelected || priority !== 'normal' || photos.length > 0
    || Object.values(details).some(value => value.length > 0);
  useUnsavedWorkGuard(!state.ok && (dirty || uploading || isPending));

  const chosen = visits.find((v) => v.propertyId === selected) ?? null;

  if (state.ok) {
    return (
      <div style={{ ...card, borderLeft: '3px solid var(--positive, #2e7d4f)' }}>
        <div style={{ fontSize: 34, lineHeight: 1, marginBottom: 12 }}>✓</div>
        <div className="font-serif" style={{ fontSize: 23, color: 'var(--ink)', marginBottom: 8 }}>
          Flagged. The office has it.
        </div>
        <p style={{ fontSize: 14.5, color: 'var(--ink-3)', lineHeight: 1.6, margin: '0 0 20px' }}>
          Thanks for catching it{state.home ? <> at <strong style={{ color: 'var(--ink)' }}>{state.home}</strong></> : ''}.
          It&apos;s now a work order on the team&apos;s board. If it&apos;s urgent, a quick text to the office never hurts.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link href="/field/report" style={{ display: 'inline-block', background: 'var(--ink)', color: 'var(--paper)', textDecoration: 'none', fontSize: 12, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', padding: '13px 24px', borderRadius: 6 }}>
            Flag another
          </Link>
          <Link href="/field" style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--ink-3)', textDecoration: 'none', fontSize: 13, fontWeight: 600, padding: '13px 8px' }}>
            Back to work
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} onSubmit={event => {
      if (!formDraft.ready || !chosen || submitting.current || uploading) {
        event.preventDefault();
        return;
      }
      submitting.current = true;
    }} style={card}>
      <fieldset disabled={isPending || !selectionDraft.ready || !formDraft.ready} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <input type="hidden" name="priority" value={priority} />
      <input type="hidden" name="photo_urls" value={JSON.stringify(photos)} />

      <FieldDraftStatus status={formDraft.status} />
      {selected && !chosen && <p role="alert">This home is no longer in your reporting window. Your draft is kept; contact the office before reporting it elsewhere.</p>}
      {/* Which home */}
      <div>
        <label htmlFor="rf-prop" style={label}>Which home?</label>
        <div style={{ position: 'relative' }}>
          <select
            id="rf-prop"
            name="property_id"
            required
            value={selected}
            onChange={(e) => (setPhotos([]), setSelected(e.target.value))}
            style={{ ...field, appearance: 'none', paddingRight: 38, color: selected ? 'var(--ink)' : 'var(--ink-4)', cursor: 'pointer' }}
          >
            <option value="" disabled>Choose a home you visited</option>
            {visits.map((v) => (
              <option key={v.propertyId} value={v.propertyId} style={{ color: 'var(--ink)' }}>
                {v.propertyName}{v.city ? ` · ${v.city}` : ''} — {v.agoLabel}
              </option>
            ))}
          </select>
          <span aria-hidden style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--ink-4)', fontSize: 12 }}>▾</span>
        </div>
        <div style={{ fontSize: 12, color: chosen ? 'var(--signal)' : 'var(--ink-4)', marginTop: 7, minHeight: 16 }}>
          {chosen
            ? `${chosen.leftLabel} · only homes you visited in the last ${windowHours}h show here`
            : `Only homes you visited in the last ${windowHours} hours can be flagged.`}
        </div>
      </div>

      {/* What */}
      <div>
        <label htmlFor="rf-title" style={label}>What needs attention?</label>
        <input id="rf-title" name="title" disabled={!selected} value={details.title} onChange={e => formDraft.set('title', e.target.value)} required minLength={3} maxLength={200} autoComplete="off" placeholder="e.g. Master bath faucet is dripping" style={field} />
      </div>

      {/* Where */}
      <div>
        <label htmlFor="rf-loc" style={label}>Where in the home? <span style={optional}>(optional)</span></label>
        <input id="rf-loc" name="location" disabled={!selected} value={details.location} onChange={e => formDraft.set('location', e.target.value)} maxLength={200} autoComplete="off" placeholder="e.g. Master bathroom" style={field} />
      </div>

      {/* Details */}
      <div>
        <label htmlFor="rf-desc" style={label}>Anything else? <span style={optional}>(optional)</span></label>
        <textarea id="rf-desc" name="description" disabled={!selected} value={details.description} onChange={e => formDraft.set('description', e.target.value)} rows={3} maxLength={4000} placeholder="A sentence of detail helps the team come prepared." style={{ ...field, resize: 'vertical', lineHeight: 1.5 }} />
      </div>

      {/* How soon */}
      <div>
        <span style={label}>How soon?</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PRIORITIES.map((p) => {
            const on = priority === p.value;
            return (
              <button
                key={p.value}
                type="button"
                disabled={!selected}
                onClick={() => setPriority(p.value)}
                aria-pressed={on}
                style={{
                  flex: '1 1 120px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  padding: '11px 14px',
                  borderRadius: 8,
                  border: on ? '1px solid var(--ink)' : '1px solid var(--rule)',
                  background: on ? 'var(--ink)' : 'var(--paper)',
                  color: on ? 'var(--paper)' : 'var(--ink)',
                  transition: 'background .12s, color .12s, border-color .12s',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600 }}>{p.label}</div>
                <div style={{ fontSize: 11.5, color: on ? 'rgba(245,239,226,0.72)' : 'var(--ink-4)', marginTop: 2 }}>{p.hint}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Photo */}
      <div>
        <span style={label}>Add a photo <span style={optional}>(optional, but it helps)</span></span>
        <PhotoUploader draftKey={draftKey || undefined} value={photos} onChange={setPhotos} folder="field-maintenance" disabled={isPending || !selected} onUploadingChange={setUploading} />
      </div>

      {/* Receipt — bought something for the house out of pocket? The amount
          rides the visit's payout, same rail as receipts on task completions.
          Before this field, reimbursements arrived as prose in the description
          and never reached pay (Delaney's $27.60 TP holders, Aug 23). */}
      <div>
        <span style={label}>
          Receipt total $ <span style={optional}>(optional — if you bought something for the house, this is added to your payout)</span>
        </span>
        <input
          name="expense_dollars"
          disabled={!selected} value={details.expenseDollars}
          onChange={e => formDraft.set('expenseDollars', e.target.value)}
          type="number"
          min={0}
          max={500}
          step="0.01"
          placeholder="e.g. 27.60"
          style={{ display: 'block', width: 140, font: 'inherit', fontSize: 15, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 8, padding: '10px 12px', marginTop: 6 }}
        />
      </div>

      {state.error && (
        <div role="alert" style={{ fontSize: 13.5, color: 'var(--signal)', background: 'rgba(200,90,58,0.07)', border: '1px solid var(--signal)', borderRadius: 8, padding: '10px 13px', lineHeight: 1.5 }}>
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending || uploading}
        style={{
          background: 'var(--ink)',
          color: 'var(--paper)',
          border: 'none',
          borderRadius: 8,
          cursor: isPending || uploading ? 'wait' : 'pointer',
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          padding: '16px 24px',
          minHeight: 52,
          opacity: isPending || uploading ? 0.8 : 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
        }}
      >
        {isPending && <span aria-hidden className="animate-spin" style={{ display: 'inline-block', width: 13, height: 13, border: '2px solid rgba(245,239,226,0.4)', borderTopColor: 'var(--paper)', borderRadius: '50%' }} />}
        {isPending ? 'Sending to the office…' : uploading ? 'Wait for photos…' : 'Send to the office'}
      </button>
      {(dirty || uploading) && !isPending && !state.error && (
        <p role="status" style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          Your report has not been sent yet.
        </p>
      )}
      </fieldset>
    </form>
  );
}
