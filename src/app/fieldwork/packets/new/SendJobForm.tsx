'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { JOB_KIND_LABEL, type JobKind, type JobTrade } from '@/lib/field-job-kinds';
import { sendJobAction } from '../actions';
import { OfferToPicker, type OfferableContractor } from '../OfferToPicker';

/**
 * The one "Send a job" form. The kind select (the same three words as the
 * packet page's Add a stop) decides which fields show; the fields a kind
 * shares keep what was typed when the kind changes.
 *
 * Keep native fields mounted after returned errors. Manual submission avoids
 * React's automatic form reset, while successful server redirects still run.
 * The old server-rendered forms fired void actions that silently re-landed
 * on failure, which is how the ad_hoc enum bug (#1205) hid for a month.
 *
 * Property setup has a third way out, Record a past setup: open, the fold is
 * the mode. It hides Publish and Save as draft, shows Record past visit, and
 * makes "Done by" required at the input.
 */

/** Inline error that scrolls itself into view: after submitting, the eye is
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

type Mode = 'publish' | 'draft' | 'record';

export type JobProperty = {
  id: string;
  name: string;
  city: string | null;
  /** The setup option text: size and the suggested pay, ready made. */
  setupLabel?: string;
};

export function SendJobForm({
  trade,
  kinds,
  initialKind,
  initialPropertyId,
  properties,
  offerable,
  contractors = [],
}: {
  trade: JobTrade;
  kinds: JobKind[];
  initialKind: JobKind;
  initialPropertyId?: string;
  properties: JobProperty[];
  /** Who could claim it today, for the Offer to chips. */
  offerable: OfferableContractor[];
  /** Who could have done a past setup. */
  contractors?: { id: string; name: string }[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const original = useRef('');
  const lock = useRef(false);
  const [kind, setKind] = useState<JobKind>(initialKind);
  const [dirty, setDirty] = useState(false);
  const [offerIds, setOfferIds] = useState<string[]>([]);
  const [pickerKey, setPickerKey] = useState(0);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [mode, setMode] = useState<Mode>('publish');
  const [recordOpen, setRecordOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const recording = kind === 'setup' && recordOpen;
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
        const result = await sendJobAction({ error: '' }, data);
        setError(result.error);
      } catch (err) {
        unstable_rethrow(err);
        setUncertain(true);
        setError('Could not confirm whether the job was created. Your details are kept. Check the job list before retrying to avoid a duplicate or another contractor notification.');
      } finally {
        lock.current = false;
      }
    });
  }

  function discard() {
    if (lock.current) return;
    formRef.current?.reset();
    setKind(initialKind); setRecordOpen(false);
    setOfferIds([]); setPickerKey((key) => key + 1);
    setDirty(false); setUncertain(false); setError('');
  }

  const payLabel =
    kind === 'adhoc' ? <>Pay $ *</>
    : kind === 'setup' ? <>Pay $ <span style={hint}>(blank prices it by home size at $40/hr)</span></>
    : <>Pay $ <span style={hint}>(blank uses the suggested price)</span></>;

  return (
    <form ref={formRef} onSubmit={submit} onChange={(e) => setDirty(snapshot(e.currentTarget) !== original.current)} style={{ maxWidth: 560 }}>
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <input type="hidden" name="trade" value={trade} />
      <label style={lbl}>
        What kind of job? *
        <select name="kind" value={kind} onChange={(e) => { setKind(e.target.value as JobKind); setError(''); }} style={inp}>
          {kinds.map((k) => (
            <option key={k} value={k}>{JOB_KIND_LABEL[k]}</option>
          ))}
        </select>
      </label>
      {kind === 'adhoc' && (
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
      )}
      <label style={lbl}>
        Property *
        <select name="property_id" required defaultValue={initialPropertyId ?? ''} style={inp}>
          <option value="" disabled>Choose the home…</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {kind === 'setup' && p.setupLabel ? p.setupLabel : `${p.name}${p.city ? ` · ${p.city.split(',')[0]}` : ''}`}
            </option>
          ))}
        </select>
      </label>
      <label style={lbl}>
        {recording ? 'Day it happened *' : 'Day *'}
        <input type="date" name="visit_date" required style={inp} />
      </label>
      {kind !== 'inspection' && (
        <label style={lbl}>
          Earliest start <span style={hint}>(optional; blank means any time that day)</span>
          <input type="time" name="visit_time" style={inp} />
        </label>
      )}
      <label style={lbl}>
        {payLabel}
        <input
          type="number"
          name="price_dollars"
          min={kind === 'adhoc' ? 1 : 0}
          step={1}
          required={kind === 'adhoc'}
          placeholder={kind === 'adhoc' ? 'e.g. 25' : 'auto'}
          style={inp}
        />
      </label>
      {kind !== 'inspection' && (
        <label style={lbl}>
          {kind === 'setup' ? 'Scope' : 'Details'} <span style={hint}>({kind === 'setup' ? 'what they walk in to do' : 'what exactly to do'})</span>
          <textarea
            name="scope"
            rows={kind === 'setup' ? 5 : 4}
            placeholder={
              kind === 'setup'
                ? 'e.g. Stage every room for the photo shoot (beds made hotel-style, pillows karate-chopped, counters clear). Unbox and place the linen + towel sets. Stock the kitchen starter kit, bathroom consumables, and the supply bin. Hang the house manual and wifi card. Flag anything missing or damaged with photos.'
                : 'e.g. The plumber (Cape Ann Plumbing) is scheduled 1 to 3 PM to fix the guest-bath faucet. Let them in, stay while they work, take a photo of the finished repair, and lock up. Text the office if anything comes up.'
            }
            style={{ ...inp, resize: 'vertical' }}
          />
        </label>
      )}
      {kind === 'adhoc' && (
        <label style={lbl}>
          Bring <span style={hint}>(optional; added to the supply bag list)</span>
          <input type="text" name="bring_list" maxLength={2000} placeholder="e.g. a spare furnace filter" style={inp} />
        </label>
      )}
      {!recording && (
        <>
          <OfferToPicker key={pickerKey} contractors={offerable} onChange={setOfferIds} />
          {kind !== 'inspection' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-3)', margin: '2px 0 4px' }}>
              <input type="checkbox" name="supply_run" />
              Start with a supply-closet bag pickup at 85 Eastern Ave
            </label>
          )}
        </>
      )}
      <div style={{ marginTop: 16 }}>
        <InlineError error={error} />
        {uncertain && <a href={`/fieldwork/packets?trade=${trade}`} target="_blank" rel="noopener noreferrer">View saved jobs</a>}
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
      {kind === 'setup' && (
        <details
          open={recordOpen}
          onToggle={(e) => setRecordOpen((e.currentTarget as HTMLDetailsElement).open)}
          style={{ marginTop: 22, borderTop: '1px solid var(--rule)', paddingTop: 14 }}
        >
          <summary style={{ fontSize: 13, color: 'var(--tide-deep)', fontWeight: 600, cursor: 'pointer' }}>
            Already happened? Record a past setup ▾
          </summary>
          <div style={{ height: 12 }} />
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
      )}
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
