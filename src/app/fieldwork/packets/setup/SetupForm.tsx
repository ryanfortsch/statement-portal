'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { createSetupPacketAction } from '../actions';
import { OfferToPicker, type OfferableContractor } from '../OfferToPicker';

/**
 * The property-setup form, on AdhocForm's pattern: the action RETURNS an
 * inline error and the fields stay mounted, instead of a void action that
 * re-rendered the page with nothing to say (the audit found a missing
 * property, a future record date and a failed create all landing silent).
 *
 * Three ways out of one form: Publish, Save as draft, or Record a past
 * setup. The record fold is a mode: open, it hides Publish and Save as
 * draft, shows Record past visit, and makes "Done by" required at the
 * input, so a blank cannot slip through to the server.
 */

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

type Mode = 'publish' | 'draft' | 'record';

export function SetupForm({
  properties,
  contractors,
  offerable,
}: {
  /** Each home with its option text (size and the suggested pay) ready made. */
  properties: { id: string; label: string }[];
  /** Who could have done a past setup. */
  contractors: { id: string; name: string }[];
  offerable: OfferableContractor[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const original = useRef('');
  const lock = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [offerIds, setOfferIds] = useState<string[]>([]);
  const [pickerKey, setPickerKey] = useState(0);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [mode, setMode] = useState<Mode>('publish');
  const [recording, setRecording] = useState(false);
  const [pending, startTransition] = useTransition();
  const snapshot = (form: HTMLFormElement) => JSON.stringify([...new FormData(form).entries()].filter(([name]) => name !== 'offer_to'));
  useEffect(() => { if (formRef.current) original.current = snapshot(formRef.current); }, []);
  useUnsavedWorkGuard(dirty || offerIds.length > 0 || pending || uncertain);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (lock.current) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const submitted: Mode = submitter?.value === 'draft' ? 'draft' : submitter?.value === 'record' ? 'record' : 'publish';
    const data = new FormData(e.currentTarget);
    data.set('mode', submitted);
    lock.current = true;
    setMode(submitted); setError(''); setUncertain(false);
    startTransition(async () => {
      try {
        const result = await createSetupPacketAction({ error: '' }, data);
        setError(result.error);
      } catch (err) {
        unstable_rethrow(err);
        setUncertain(true);
        setError('Could not confirm whether the setup was created. Your details are kept. Check the board before retrying to avoid a duplicate or another contractor notification.');
      } finally {
        lock.current = false;
      }
    });
  }

  function discard() {
    if (lock.current) return;
    formRef.current?.reset();
    setOfferIds([]); setPickerKey((key) => key + 1);
    setDirty(false); setUncertain(false); setError('');
  }

  return (
    <form ref={formRef} onSubmit={submit} onChange={(e) => setDirty(snapshot(e.currentTarget) !== original.current)} style={{ maxWidth: 560 }}>
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <label style={lbl}>
        Property *
        <select name="property_id" required defaultValue="" style={inp}>
          <option value="" disabled>Choose the home…</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>
      <label style={lbl}>
        {recording ? 'Day it happened *' : 'Setup day *'}
        <input type="date" name="visit_date" required style={inp} />
      </label>
      <label style={lbl}>
        Earliest start <span style={hint}>(optional; blank means any time that day)</span>
        <input type="time" name="visit_time" style={inp} />
      </label>
      <label style={lbl}>
        Pay $ <span style={hint}>(leave blank to price by home size at $40/hr)</span>
        <input type="number" name="price_dollars" min={0} step={1} placeholder="auto" style={inp} />
      </label>
      <label style={lbl}>
        Scope <span style={hint}>(what they walk in to do)</span>
        <textarea
          name="scope"
          rows={5}
          placeholder={'e.g. Stage every room for the photo shoot (beds made hotel-style, pillows karate-chopped, counters clear). Unbox and place the linen + towel sets. Stock the kitchen starter kit, bathroom consumables, and the supply bin. Hang the house manual and wifi card. Flag anything missing or damaged with photos.'}
          style={{ ...inp, resize: 'vertical' }}
        />
      </label>
      {!recording && (
        <>
          <OfferToPicker key={pickerKey} contractors={offerable} onChange={setOfferIds} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-3)', margin: '2px 0 4px' }}>
            <input type="checkbox" name="supply_run" />
            Include a supply-closet bag pickup at 85 Eastern Ave as stop 1
          </label>
        </>
      )}

      <div style={{ marginTop: 16 }}>
        <InlineError error={error} />
        {uncertain && <a href="/fieldwork/packets" target="_blank" rel="noopener noreferrer">View the board</a>}
        {!recording && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="submit" name="mode" value="publish" style={btnDark}>{pending && mode === 'publish' ? 'Publishing…' : 'Publish to contractors'}</button>
            <button type="submit" name="mode" value="draft" style={btnGhost}>{pending && mode === 'draft' ? 'Saving…' : 'Save as draft'}</button>
            {(dirty || offerIds.length > 0 || uncertain) && <button type="button" onClick={discard} style={btnGhost}>Discard changes</button>}
          </div>
        )}
      </div>

      {/* The forgot-to-put-one-in path: the setup already happened and the
          office is recording it after the fact. Lands SUBMITTED, awarded to
          whoever did it, straight in the approve queue; never published, no
          texts, no door codes. Open, the fold IS the mode. */}
      <details
        onToggle={(e) => setRecording((e.currentTarget as HTMLDetailsElement).open)}
        style={{ marginTop: 22, borderTop: '1px solid var(--rule)', paddingTop: 14 }}
      >
        <summary style={{ fontSize: 13, color: 'var(--tide-deep)', fontWeight: 600, cursor: 'pointer' }}>
          Already happened? Record a past setup ▾
        </summary>
        <div style={{ fontSize: 12.5, color: 'var(--ink-4)', margin: '10px 0 12px' }}>
          Lands in the approve queue. Nothing is published and nobody is texted.
        </div>
        <label style={lbl}>
          Done by *
          <select name="done_by" required={recording} defaultValue="" style={inp}>
            <option value="" disabled>Who did the work…</option>
            {contractors.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        {recording && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="submit" name="mode" value="record" style={btnDark}>{pending && mode === 'record' ? 'Recording…' : 'Record past visit'}</button>
            {(dirty || uncertain) && <button type="button" onClick={discard} style={btnGhost}>Discard changes</button>}
          </div>
        )}
      </details>
      </fieldset>
    </form>
  );
}

const hint: React.CSSProperties = { color: 'var(--ink-4)', fontWeight: 400 };
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
