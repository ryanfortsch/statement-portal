'use client';
import { useRef, useState } from 'react';
import { messageControlSchema, messageControlResultSchema, type MessageControl } from '@/lib/channex-messaging/message-control';
export function MessageHoldControl({ sendId, bookingId }: { sendId: string; bookingId: string }) {
  const [control, setControl] = useState<MessageControl | null>(null), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(''), [confirming, setConfirming] = useState(false);
  const locked = useRef(false), cancel = useRef<HTMLButtonElement>(null), review = useRef<HTMLButtonElement>(null);
  const valid = (raw: unknown) => { const v = messageControlSchema.parse(raw);
    if (v.sendId !== sendId || v.bookingId !== bookingId) throw Error(); return v; };
  async function load() {
    if (locked.current) return; locked.current = true; setBusy(true); setConfirming(false); setNotice('');
    try {
      const r = await fetch(`/api/channex/message-control?sendId=${encodeURIComponent(sendId)}`, { cache: 'no-store' });
      if (!r.ok) throw Error(); const data = await r.json();
      if (!data.control) { setControl(null); setNotice('No controllable Helm schedule was found.'); }
      else setControl(valid(data.control));
    } catch { setControl(null); setNotice('Hold status unavailable. Nothing was changed.'); }
    finally { locked.current = false; setBusy(false); }
  }
  async function save() {
    if (locked.current || !control || !confirming) return;
    const request = { sendId, expected: control.token, held: !control.held };
    locked.current = true; setBusy(true); setConfirming(false);
    try {
      const r = await fetch('/api/channex/message-control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
      if (!r.ok) throw Error(); const result = messageControlResultSchema.parse(await r.json());
      const next = result.control ? valid(result.control) : null;
      if (result.state === 'changed' && (!next || next.held !== request.held || next.token === request.expected)) throw Error();
      setControl(next);
      setNotice(result.state === 'changed' ? request.held ? 'Hold saved. Helm cannot claim this message while held.'
        : 'Hold removed. The automatic sender will recheck eligibility; this does not confirm a send.'
        : 'The schedule changed or is no longer eligible. Review its current status before another decision.');
    } catch {
      setControl(null); setNotice('The save outcome is uncertain. Refresh hold status before another decision. Do not repeat the old request.');
    } finally { locked.current = false; setBusy(false); review.current?.focus(); }
  }
  return <div className="mt-3 space-y-2 text-sm">
    <button ref={review} type="button" onClick={load} disabled={busy} className="underline underline-offset-4 disabled:opacity-50">{busy ? 'Checking…' : control ? 'Refresh hold status' : 'Review hold'}</button>
    {control && <div className="rounded-lg border p-3" style={{ borderColor: 'var(--rule)' }}>
      <p className="font-semibold">{control.held ? 'On hold' : 'Not held'}</p>
      <p className="mt-1 text-xs leading-5" style={{ color: 'var(--muted-foreground)' }}>A hold only stops an unclaimed Helm message. It cannot recall an accepted message or affect Guesty’s queue. Removing it does not extend the original send window.</p>
      {(control.canHold || control.canResume) && !confirming && <button type="button" disabled={busy} className="mt-3 rounded border px-3 py-2 font-medium"
        onClick={() => { setConfirming(true); setTimeout(() => cancel.current?.focus(), 0); }}>{control.held ? 'Review resume' : 'Hold message'}</button>}
      {!control.canHold && !control.canResume && <p className="mt-2 text-xs">{control.held ? 'This message cannot resume in its current state. Its send window or stay details need review.' : 'A hold cannot change this message in its current state.'}</p>}
      {confirming && <div role="alertdialog" aria-label={control.held ? 'Confirm removing hold' : 'Confirm message hold'} className="mt-3 border-t pt-3"
        onKeyDown={e => { if (e.key === 'Escape') { setConfirming(false); review.current?.focus(); } }}>
        <p>{control.held ? 'Remove this hold? If the sender is enabled and the message is due, it can send on the next automatic check.' : 'Hold this message until an owner removes the hold? A dispatch already in progress cannot be recalled.'}</p>
        <div className="mt-3 flex flex-wrap gap-3"><button ref={cancel} type="button" className="rounded border px-3 py-2" onClick={() => { setConfirming(false); review.current?.focus(); }}>Cancel</button>
          <button type="button" className="rounded border px-3 py-2 font-semibold" onClick={save}>{control.held ? 'Remove hold' : 'Confirm hold'}</button></div>
      </div>}
    </div>}
    {notice && <p role="status" className="rounded-lg bg-slate-100 p-3 text-sm text-slate-800">{notice}</p>}
  </div>;
}
