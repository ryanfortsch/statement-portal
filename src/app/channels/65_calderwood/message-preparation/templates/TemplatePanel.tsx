'use client';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import Link from 'next/link';
import { Button } from '@/components/Button';
import { templateReferenceSchema, templateReviewSchema, type TemplateReference, type TemplateReview } from '@/lib/channex-messaging/template-workflow-contract';

const endpoint = '/api/channex/message-preparation/templates';
const storageKey = 'helm-calderwood-template-release:v1';
type Reference = TemplateReference & { releaseId?: string };
const referenceSchema = templateReferenceSchema.extend({ releaseId: z.uuid().optional() }).strict();
const stamp = (s: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(s));
async function call(body: unknown, signal?: AbortSignal) {
  const res = await fetch(endpoint, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: signal ?? AbortSignal.timeout(35000) });
  if (!res.ok) throw Error();
  const out = await res.json(); if (out.canSend !== false) throw Error(); return out;
}
function remember(reference: Reference) {
  // Save before a release POST. Keep the same request after timeout or refresh.
  localStorage.setItem(storageKey, JSON.stringify(reference));
  const url = new URL(window.location.href);
  url.search = new URLSearchParams(reference).toString();
  window.history.replaceState(null, '', url);
}
export function TemplatePanel({ initialReference }: { initialReference: Reference | null }) {
  const [reference, setReference] = useState(initialReference), [review, setReview] = useState<TemplateReview | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [acknowledged, setAcknowledged] = useState(false), [confirmed, setConfirmed] = useState(false);
  const running = useRef(false);
  // Reads only. Opening or refreshing this page never archives or releases rules.
  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(async () => {
      let saved = initialReference;
      if (!saved) {
        const stored = referenceSchema.safeParse(JSON.parse(localStorage.getItem(storageKey) ?? 'null'));
        if (stored.success) saved = stored.data;
      }
      if (!saved || controller.signal.aborted) return;
      setReference(saved);
      const out = await call({ action: 'review', captureId: saved.captureId, rulesSha256: saved.rulesSha256 },
        AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]));
      if (out.state !== 'review') throw Error();
      const next = templateReviewSchema.parse(out.review);
      if (next.captureId !== saved.captureId || next.rulesSha256 !== saved.rulesSha256) throw Error();
      if (!controller.signal.aborted) setReview(next);
    })
      .catch(() => { if (!controller.signal.aborted) setError('The saved review could not be loaded. Refresh the review before continuing.'); });
    return () => controller.abort();
  }, [initialReference]);
  async function refresh(target = reference) {
    if (!target) return;
    const out = await call({ action: 'review', captureId: target.captureId, rulesSha256: target.rulesSha256 });
    if (out.state !== 'review') throw Error();
    const next = templateReviewSchema.parse(out.review);
    if (next.captureId !== target.captureId || next.rulesSha256 !== target.rulesSha256) throw Error();
    setReview(next); setAcknowledged(false);
  }
  async function run(action: 'capture' | 'refresh' | 'release') {
    if (running.current) return;
    running.current = true; setBusy(true); setError(''); setMessage('');
    try {
      if (action === 'capture') {
        const out = await call({ action });
        if (out.state !== 'captured') throw Error();
        const saved = templateReferenceSchema.parse(out.reference);
        remember(saved); setReference(saved); await refresh(saved);
        setMessage('The six original templates are archived. Review the timing and release scope below.');
      } else if (action === 'refresh') {
        await refresh();
      } else {
        if (!reference || !review || !acknowledged || review.configuration === 'changed') throw Error();
        const saved = await navigator.locks.request(storageKey, () => {
          const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
          const existing = stored === null ? null : referenceSchema.parse(stored);
          if (existing && (existing.captureId !== reference.captureId || existing.rulesSha256 !== reference.rulesSha256)) throw Error();
          if (existing?.releaseId && reference.releaseId && existing.releaseId !== reference.releaseId) throw Error();
          const next = { ...reference, releaseId: reference.releaseId ?? existing?.releaseId ?? crypto.randomUUID() };
          // An existing released configuration needs its original request ID.
          if (review.configuration === 'released' && !reference.releaseId && !existing?.releaseId) throw Error();
          remember(next); return next;
        });
        setReference(saved);
        const out = await call({ action: 'release', ...saved, confirmation: 'release_four_guest_templates_only' });
        if (!['released', 'existing'].includes(out.state) || out.releaseId !== saved.releaseId || out.guestRules !== 4) throw Error();
        setConfirmed(true);
        try { await refresh(saved); }
        catch { setError('Release receipt confirmed, but the current configuration could not be read back. Refresh the saved review.'); }
        setMessage('Release receipt confirmed. Four guest templates are configured for the dedicated scheduler. Guesty handover and live activation are still separate.');
      }
    } catch {
      setAcknowledged(false);
      setError(action === 'release'
        ? 'The release was not confirmed. Refresh the review, then use the same saved request to confirm it. Do not create a replacement request.'
        : action === 'capture' ? 'The archive was not confirmed. Trying again will reuse an unchanged saved archive; it will not release templates.'
          : 'The review could not be refreshed. The last view is not current.');
    } finally { running.current = false; setBusy(false); }
  }
  const canRelease = review && ((review.configuration === 'released' && Boolean(reference?.releaseId)) || (review.configuration === 'prepared'
    && review.authority === 'guesty' && !review.automationsEnabled));
  return <>
    <section className="mt-6 rounded-2xl border p-6 sm:p-8" style={{ borderColor: 'var(--rule)', background: 'var(--paper-2)' }}>
      <p className="eyebrow" style={{ color: 'var(--signal)' }}>Original templates · 65 Calderwood</p>
      <h2 className="mt-2 text-2xl font-semibold">Preserve the wording. Keep the timing.</h2>
      <p className="mt-3 max-w-2xl text-sm leading-6" style={{ color: 'var(--ink-3)' }}>
        Archive the six prepared Guesty templates, then review a separate release of the four guest templates to Helm’s dedicated scheduler.</p>
      <ol className="mt-6 grid gap-3 sm:grid-cols-3">
        {['Archive all six originals', 'Review four guest templates', 'Record the template release'].map((label, i) =>
          <li key={label} className="rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--rule)', background: 'var(--paper)' }}>
            <span className="text-xs" style={{ color: 'var(--ink-3)' }}>STEP {i + 1}</span><p className="mt-2 font-semibold">{label}</p></li>)}
      </ol>
      <p className="mt-5 text-sm leading-6">This changes template configuration only. It does not switch calendar control, enable the home’s sender, clear Guesty’s queue, schedule messages or send them. The two cleaner templates stay disabled.</p>
      {!reference && <div className="mt-6"><Button variant="primary" pending={busy} watchdog={false} onClick={() => run('capture')}
        confirm={{ title: 'Archive the original templates?', body: 'Save an immutable copy of all six prepared Calderwood templates. No templates are enabled and no messages are created.' }}>Archive original templates</Button></div>}
      {reference && <div className="mt-6"><Button onClick={() => run('refresh')} pending={busy} watchdog={false}>Refresh saved review</Button></div>}
    </section>
    {error && <p role="alert" className="mt-5 border-l-4 p-4 text-sm" style={{ borderColor: 'var(--negative)' }}>{error}</p>}
    {message && <p role="status" className="mt-5 rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--rule)' }}>{message}</p>}
    {review && <section className="mt-8" aria-labelledby="template-review">
      <div className="mb-5 flex flex-wrap justify-between gap-4"><div><h2 id="template-review" className="text-xl font-semibold">Six originals, one retained archive</h2>
        <p className="mt-2 text-sm" style={{ color: 'var(--ink-3)' }}>Archived {stamp(review.capturedAt)} · Reviewed {stamp(review.observedAt)}</p></div>
        <span className="self-start rounded-full px-3 py-1 text-xs" style={{ background: 'var(--paper-2)' }}>{review.configuration === 'prepared'
          ? 'Originals unchanged' : review.configuration === 'released' ? 'Four guest templates configured' : 'Configuration needs review'}</span></div>
      <div className="grid gap-3 sm:grid-cols-2">{review.workflows.map(flow => <article key={flow.key} className="rounded-xl border p-5" style={{ borderColor: 'var(--rule)' }}>
        <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--ink-3)' }}>{flow.audience === 'guest' ? 'Guest · included in release' : 'Cleaner · stays disabled'}</p>
        <h3 className="mt-2 font-semibold">{flow.label}</h3><p className="mt-2 text-sm">{flow.timing}</p>
        <p className="mt-3 text-xs" style={{ color: 'var(--ink-3)' }}>{flow.characterCount.toLocaleString()} characters · wording retained</p>
      </article>)}</div>
      <div className="mt-6 rounded-xl border p-5" style={{ borderColor: 'var(--rule)', background: 'var(--paper-2)' }}>
        <h3 className="font-semibold">Review the release</h3><p className="mt-2 text-sm leading-6">The four guest templates become enabled for the dedicated scheduler. Their wording and timing are retained. Sending requires the separate handover and runtime activation.</p>
        {review.configuration === 'released' && !reference?.releaseId && <p className="mt-3 text-sm">These templates are already configured. To confirm the original receipt, reopen the saved review link that includes its release request. This page cannot create a replacement request.</p>}
        {!confirmed && <><label className="mt-4 flex gap-3 items-start text-sm leading-6"><input type="checkbox" className="mt-1" checked={acknowledged}
          disabled={busy || !canRelease || Boolean(error)} onChange={e => setAcknowledged(e.target.checked)} />
          I reviewed the four guest templates and understand this does not activate sending.</label>
          <Button className="mt-4" variant="primary" pending={busy} watchdog={false} disabled={!acknowledged || !canRelease || Boolean(error)}
            onClick={() => run('release')} confirm={{ title: reference?.releaseId ? 'Confirm the saved release request?' : 'Record this template release?',
              body: review.configuration === 'released' ? 'Read back the original release receipt using the same saved request. This does not change the current sender or send messages.'
                : 'Enable exactly four guest templates for the dedicated scheduler. The home sender stays off, cleaner templates stay disabled, and no messages are scheduled or sent.' }}>
            {reference?.releaseId ? 'Confirm saved release request' : 'Release four guest templates'}</Button></>}
        {confirmed && <p className="mt-4 text-sm font-medium">Release receipt confirmed.</p>}
        <Link href="/channels/65_calderwood/message-preparation/timing-review" className="mt-5 block text-sm underline underline-offset-4">View saved timing and handover status →</Link>
      </div>
    </section>}
    {reference && <details className="mt-6 text-xs" style={{ color: 'var(--ink-3)' }}><summary className="cursor-pointer">Archive and release references</summary>
      <p className="mt-2 break-all">Archive: {reference.captureId}<br />Digest: {reference.rulesSha256}<br />Release request: {reference.releaseId ?? 'Not submitted'}</p></details>}
  </>;
}
