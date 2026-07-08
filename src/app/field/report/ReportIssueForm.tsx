'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { PhotoUploader } from '@/components/PhotoUploader';
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
  const [state, formAction, isPending] = useActionState<ReportState, FormData>(reportFieldWorkSlip, { ok: false });
  const [selected, setSelected] = useState(visits.length === 1 ? visits[0].propertyId : '');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [photos, setPhotos] = useState<string[]>([]);

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
    <form action={formAction} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <input type="hidden" name="priority" value={priority} />
      <input type="hidden" name="photo_urls" value={JSON.stringify(photos)} />

      {/* Which home */}
      <div>
        <label htmlFor="rf-prop" style={label}>Which home?</label>
        <div style={{ position: 'relative' }}>
          <select
            id="rf-prop"
            name="property_id"
            required
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
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
        <input id="rf-title" name="title" required minLength={3} maxLength={200} autoComplete="off" placeholder="e.g. Master bath faucet is dripping" style={field} />
      </div>

      {/* Where */}
      <div>
        <label htmlFor="rf-loc" style={label}>Where in the home? <span style={optional}>(optional)</span></label>
        <input id="rf-loc" name="location" maxLength={200} autoComplete="off" placeholder="e.g. Master bathroom" style={field} />
      </div>

      {/* Details */}
      <div>
        <label htmlFor="rf-desc" style={label}>Anything else? <span style={optional}>(optional)</span></label>
        <textarea id="rf-desc" name="description" rows={3} maxLength={4000} placeholder="A sentence of detail helps the team come prepared." style={{ ...field, resize: 'vertical', lineHeight: 1.5 }} />
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
        <PhotoUploader value={photos} onChange={setPhotos} folder="field-maintenance" />
      </div>

      {state.error && (
        <div style={{ fontSize: 13.5, color: 'var(--signal)', background: 'rgba(200,90,58,0.07)', border: '1px solid var(--signal)', borderRadius: 8, padding: '10px 13px', lineHeight: 1.5 }}>
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        style={{
          background: 'var(--ink)',
          color: 'var(--paper)',
          border: 'none',
          borderRadius: 8,
          cursor: isPending ? 'wait' : 'pointer',
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          padding: '16px 24px',
          minHeight: 52,
          opacity: isPending ? 0.8 : 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
        }}
      >
        {isPending && <span aria-hidden className="animate-spin" style={{ display: 'inline-block', width: 13, height: 13, border: '2px solid rgba(245,239,226,0.4)', borderTopColor: 'var(--paper)', borderRadius: '50%' }} />}
        {isPending ? 'Sending to the office…' : 'Send to the office'}
      </button>
    </form>
  );
}
