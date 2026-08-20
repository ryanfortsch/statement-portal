'use client';

import { useActionState, useEffect, useRef } from 'react';
import { SubmitButton } from '@/components/SubmitButton';
import { createAdHocPacketAction, type AdhocState } from '../actions';

/**
 * The one-off job form, as a client component with useActionState (same
 * pattern as field/apply's ApplyForm): a failure renders a specific inline
 * error above the buttons and the form stays mounted with everything typed.
 * The old server-rendered form fired a void action that silently re-landed
 * here on failure, which is how the ad_hoc enum bug (#1205) hid for a month.
 */

/** Inline error that scrolls itself into view — after submitting, the eye is
 *  at the bottom of the form, so an error rendered off-screen reads as a
 *  dead button. */
function InlineError({ error }: { error: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [error]);
  if (!error) return null;
  return (
    <div
      ref={ref}
      role="alert"
      style={{ border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', color: 'var(--signal)', padding: '10px 14px', fontSize: 14, marginBottom: 16, borderRadius: 6 }}
    >
      {error}
    </div>
  );
}

export function AdhocForm({ properties }: { properties: { id: string; name: string; city: string | null }[] }) {
  const [state, formAction] = useActionState<AdhocState, FormData>(createAdHocPacketAction, { error: '' });

  return (
    <form action={formAction} style={{ maxWidth: 560 }}>
      <label style={lbl}>
        What&apos;s the job? *
        <input
          type="text"
          name="title"
          required
          maxLength={200}
          placeholder="e.g. Let the plumber in and lock up after"
          style={inp}
        />
      </label>
      <label style={lbl}>
        Property *
        <select name="property_id" required defaultValue="" style={inp}>
          <option value="" disabled>Choose the home…</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.city ? ` · ${p.city.split(',')[0]}` : ''}
            </option>
          ))}
        </select>
      </label>
      <label style={lbl}>
        Day *
        <input type="date" name="visit_date" required style={inp} />
      </label>
      <label style={lbl}>
        Earliest start <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(optional; they can begin any time from here, blank means anytime that day)</span>
        <input type="time" name="visit_time" style={inp} />
      </label>
      <label style={lbl}>
        Pay $ *
        <input type="number" name="price_dollars" min={1} step={1} required placeholder="e.g. 25" style={inp} />
      </label>
      <label style={lbl}>
        Details <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(what exactly to do)</span>
        <textarea
          name="scope"
          rows={4}
          placeholder={'e.g. The plumber (Cape Ann Plumbing) is scheduled 1 to 3 PM to fix the guest-bath faucet. Let them in, stay while they work, take a photo of the finished repair, and lock up. Text the office if anything comes up.'}
          style={{ ...inp, resize: 'vertical' }}
        />
      </label>
      <label style={lbl}>
        Bring <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(optional; folds into the supply-run pick list)</span>
        <input type="text" name="bring_list" maxLength={2000} placeholder="e.g. a spare furnace filter" style={inp} />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-3)', margin: '2px 0 4px' }}>
        <input type="checkbox" name="supply_run" />
        Start with a supply-closet bag pickup at 85 Eastern Ave
      </label>
      <div style={{ marginTop: 16 }}>
        <InlineError error={state.error} />
        <div style={{ display: 'flex', gap: 10 }}>
          <SubmitButton name="mode" value="publish" label="Publish to contractors" busyLabel="Publishing…" style={btnDark} />
          <SubmitButton name="mode" value="draft" label="Save as draft" busyLabel="Saving…" spinnerTone="ink" style={btnGhost} />
        </div>
      </div>
    </form>
  );
}

const lbl: React.CSSProperties = { fontSize: 13, color: 'var(--ink-3)', display: 'block', marginBottom: 18, fontWeight: 500 };
const inp: React.CSSProperties = {
  display: 'block',
  width: '100%',
  font: 'inherit',
  fontSize: 14,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  borderRadius: 6,
  padding: '10px 12px',
  marginTop: 6,
  boxSizing: 'border-box',
};
const btnDark: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  padding: '12px 22px',
};
const btnGhost: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  border: '1px solid var(--rule)',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  padding: '12px 22px',
};
