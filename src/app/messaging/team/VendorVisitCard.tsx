'use client';

import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { ApprovalCard, BodyText, sentAgoLabel } from '@/components/messaging/card/ApprovalCard';
import type { QueueCardHelpers } from '@/components/messaging/card/ApprovalQueue';
import { PrimaryButton, SecondaryButton } from '@/components/messaging/card/buttons';
import type { AlsoItem, WaitReason } from '@/components/messaging/card/types';
import type { VendorVisitCardData } from '@/lib/vendor-visit-cards';
import { describeHold } from '@/lib/vendor-visit-core';
import { fmtClock, fmtDay } from '@/lib/vendor-visit-dates';
import { visitTiming } from '@/lib/vendor-visit-follow-through';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { completeVendorVisitAction, approveVendorVisitAction, editVendorVisitAction, markVendorVisitHandledAction } from './vendor-visit-actions';

type PropertyOption = { id: string; name: string };

/** Mark handled's reasons for a vendor visit: what the operator did instead. */
export const VENDOR_VISIT_HANDLED_REASONS = ['Not a visit', 'Already arranged', 'Wrong home or day'] as const;

const field = { fontSize: 13, padding: '6px 8px', background: 'var(--paper)', color: 'var(--ink)', border: '1px solid var(--rule)', outline: 'none' } as const;

/** The reader's reason as a sentence after "Which day?". */
function sentence(text: string): string {
  const t = text.trim();
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.?!]$/.test(t) ? '' : '.'}`;
}

/** A small caption over an input, so three date and time boxes say which is which. */
function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>{label}</span>
      {children}
    </label>
  );
}

/**
 * A trade vendor's confirmed day on the one approval card (2026-10-18).
 * There is no reply to send: the card proposes the calendar hold and the
 * slips the visit covers, and Approve is the only thing that writes them.
 * "Schedule block should be for my approval" (Dotti). See
 * docs/vendor-visit-holds.md.
 */
export function VendorVisitCard({
  card,
  properties,
  helpers,
  audienceChip,
}: {
  card: VendorVisitCardData;
  properties: PropertyOption[];
  helpers: QueueCardHelpers;
  audienceChip?: ReactNode;
}) {
  const plan = card.plan;
  const [nightBefore, setNightBefore] = useState(!!plan?.nightBefore.suggested);
  const [ticked, setTicked] = useState(() => new Set(card.slips.filter(s => s.ticked).map(s => s.id)));
  const [completing, setCompleting] = useState(false);
  const [editingVisit, setEditingVisit] = useState(false);
  const [saving, startSaving] = useTransition();
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [timing, setTiming] = useState(card.timing ?? { elapsed: false, deadline: null });
  useUnsavedWorkGuard(completing || card.slips.some(s => ticked.has(s.id) !== s.ticked) || nightBefore !== !!plan?.nightBefore.suggested);
  useEffect(() => {
    const refresh = () => setTiming(visitTiming(card.start, card.end, [card.timing?.deadline, card.endTime], new Date()));
    // The server's answer is authoritative on first render. The clock still
    // advances when a card stays open across its deadline.
    setTiming(card.timing ?? { elapsed: false, deadline: null });
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [card.start, card.end, card.endTime, card.timing]);
  const selectedIds = card.slips.filter(s => ticked.has(s.id)).map(s => s.id);
  const home = card.property?.name ?? null;
  const vendor = card.vendorName;
  const nights = plan ? [...(nightBefore && plan.nightBefore.offered ? [plan.nightBefore.date] : []), ...plan.holdNights] : [];
  const approveBlocked = !card.property ? 'Pick the home first.' : !card.start ? 'Pick the day first.'
    : timing.elapsed ? 'This visit window has passed.'
    : card.status === 'approving' && !card.stuck ? 'Someone is updating this visit.' : undefined;
  const needsDetails = !card.property || !card.start;
  const reading = card.start ? `${fmtDay(card.start)}${card.end && card.end !== card.start ? ` to ${fmtDay(card.end)}` : ''}${card.timeLabel ? `, ${card.timeLabel}` : timing.deadline ? `, before ${fmtClock(timing.deadline)}` : ''}` : 'Date needed';
  const workPicker = <ul aria-label="Work for this visit" style={{ listStyle: 'none', padding: 0, margin: '8px 0', display: 'grid', gap: 10 }}>
    {card.slips.map(s => <li key={s.id}>
      <label style={{ display: 'flex', alignItems: 'baseline', gap: 8, cursor: 'pointer', fontSize: 14 }}>
        <input type="checkbox" checked={ticked.has(s.id)} disabled={saving} onChange={e => {
          const next = new Set(ticked); if (e.target.checked) next.add(s.id); else next.delete(s.id); setTicked(next);
        }} />
        <span>{s.title}{s.note && <small style={{ display: 'block', color: 'var(--ink-3)' }}>{s.note}</small>}</span>
      </label>
    </li>)}
  </ul>;
  const also: AlsoItem[] = [];
  if (!completing && !timing.elapsed) {
    if (nights.length) also.push({ key: 'hold', line: <>Blocks {describeHold(nights)} for this visit</>, body: plan?.nightBefore.offered ?
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={nightBefore} onChange={e => setNightBefore(e.target.checked)} />Also block {fmtDay(plan.nightBefore.date)}</label> : undefined });
    else if (plan?.nightBefore.offered) also.push({ key: 'hold', line: <>No calendar block needed</>, body:
      <label><input type="checkbox" checked={nightBefore} onChange={e => setNightBefore(e.target.checked)} /> Also block {fmtDay(plan.nightBefore.date)}</label> });
    if (card.slips.length) also.push({ key: 'slips', line: <>{selectedIds.length} job{selectedIds.length === 1 ? '' : 's'} selected</>, body: workPicker });
    if (plan?.warnings.length) also.push({ key: 'calendar', line: plan.warnings[0], attention: true,
      body: plan.warnings.length > 1 ? <ul>{plan.warnings.slice(1).map(w => <li key={w}>{w}</li>)}</ul> : undefined });
  }
  const wait: WaitReason | null = card.stuck ? { tone: 'stale', text: 'Saving did not finish. Check the calendar before trying again.' }
    : card.status === 'approving' ? { tone: 'held', text: 'Someone is updating this visit.' }
    : card.lastError ? { tone: 'failed', text: card.lastError }
    : card.planError ? { tone: 'failed', text: 'The calendar could not be checked. Try refreshing before scheduling.' } : null;
  const complete = () => startSaving(async () => {
    setCompletionError(null);
    try {
      const result = await completeVendorVisitAction(card.id, selectedIds);
      if (result.ok) { setCompleting(false); helpers.onResolved(result.warning); }
      else if (result.stale) helpers.onResolved();
      else setCompletionError(result.error);
    } catch { setCompletionError('Saving did not finish. Refresh to check the work before retrying.'); }
  });
  return <ApprovalCard
    id={card.id} status="pending" name={vendor} property={home ?? undefined} channel="SMS"
    preview={`${home ?? 'Home needed'} · ${reading}`} reviewLabel={timing.elapsed ? 'Review visit' : 'Review hold'}
    chips={audienceChip} ageMinutes={card.ageMinutes} createdAt={card.createdAt} shortId={card.id.slice(0, 8)}
    wait={wait} layout="stacked" externalBusy={saving}
    said={{ label: `${card.writer || vendor} wrote`, sub: sentAgoLabel(card.messageAt), subTitle: card.messageAt, body: <BodyText>{card.messageBody}</BodyText> }}
    between={<div style={{ fontSize: 14, lineHeight: 1.6 }}>
      <strong>{home ?? 'Home needed'} · {reading}</strong>
      {timing.elapsed && !completing && <p style={{ margin: '8px 0' }}>This visit window has passed. Was the work completed?</p>}
      {completing ? <div style={{ marginTop: 12 }}>
        <strong>{card.slips.length ? 'Which work was finished?' : 'Close this completed visit?'}</strong>
        {card.slips.length > 0 && workPicker}
        <p style={{ color: 'var(--ink-3)', margin: '8px 0' }}>{selectedIds.length ? `Marks ${selectedIds.length} selected job${selectedIds.length === 1 ? '' : 's'} complete and closes this visit.` : 'Closes the visit without changing any work items.'}</p>
        {completionError && <p role="alert">{completionError}</p>}
      </div> : <>
        {(needsDetails || editingVisit) && <div style={{ marginTop: 12 }}>
          {!card.property ? <p>Which home is this visit for?</p> : !card.start ? <p>Which day? {sentence(card.askReason ?? 'The date is not clear')}</p> : null}
          {card.property && !card.start && card.candidates.length > 0 && <PickDay card={card} onSaved={() => helpers.onResolved()} />}
          <ChangeVisit card={card} properties={properties} initiallyOpen onSaved={() => helpers.onResolved()} />
        </div>}
        {card.offer && <details style={{ marginTop: 8, color: 'var(--ink-3)', fontSize: 13 }}><summary style={{ cursor: 'pointer' }}>Original request</summary><p>{card.offer.text}</p></details>}
      </>}
    </div>}
    reply={null} also={also}
    verbs={{
      approve: timing.elapsed || completing ? undefined : () =>
        approveVendorVisitAction(card.id, { propertyId: card.property?.id ?? '', start: card.start ?? '', end: card.end ?? card.start ?? '', startTime: card.startTime, endTime: card.endTime, slipIds: selectedIds, holdNightBefore: nightBefore && !!plan?.nightBefore.offered }),
      markHandled: capture => markVendorVisitHandledAction(card.id, capture?.reason),
    }}
    handledReasons={VENDOR_VISIT_HANDLED_REASONS} approveBlocked={timing.elapsed || completing ? undefined : approveBlocked}
    footer={ctl => completing ? <>
      <PrimaryButton onClick={complete} disabled={ctl.busy} loading={saving} loadingLabel="Saving">{selectedIds.length ? 'Mark complete' : 'Close visit'}</PrimaryButton>
      <SecondaryButton onClick={() => setCompleting(false)} disabled={ctl.busy}>Cancel</SecondaryButton>
    </> : <>
      {timing.elapsed ? <PrimaryButton onClick={() => setCompleting(true)} disabled={ctl.busy || card.status === 'approving'}>Already done</PrimaryButton>
        : <PrimaryButton onClick={ctl.approve} disabled={ctl.busy || !!approveBlocked} loading={ctl.pending === 'approve'} loadingLabel="Saving">{nights.length ? 'Approve hold' : 'Approve visit'}</PrimaryButton>}
      <SecondaryButton onClick={() => setEditingVisit(v => !v)} disabled={ctl.busy}>Change visit</SecondaryButton>
      {!timing.elapsed && <SecondaryButton onClick={() => setCompleting(true)} disabled={ctl.busy || card.status === 'approving'}>Already done</SecondaryButton>}
      <div className="rt-message-quiet">{ctl.parts.handled}</div>
    </>}
    onResolved={helpers.onResolved} onDecided={helpers.onDecided} onRegenerating={() => {}} regenStalled={false}
  />;
}

/** One tap per day the reader could not choose between. */
function PickDay({ card, onSaved }: { card: VendorVisitCardData; onSaved: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
      <span className="eyebrow" style={{ color: 'var(--ink-3)' }}>Which day</span>
      {card.candidates.map((d) => (
        <SecondaryButton
          key={d}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await editVendorVisitAction(card.id, { propertyId: null, start: d, end: d, startTime: card.startTime, endTime: card.endTime });
              if (res.ok) onSaved();
              else setError(res.error);
            })
          }
        >
          {fmtDay(d)}
        </SecondaryButton>
      ))}
      {error && <span role="alert" style={{ fontSize: 12, color: 'var(--signal)' }}>{error}</span>}
    </div>
  );
}

/** Correct what the reader made of the text: the home, the days, the time. */
function ChangeVisit({ card, properties, onSaved, initiallyOpen = false }: { card: VendorVisitCardData; properties: PropertyOption[]; onSaved: () => void; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen || !card.property || !card.start);
  const [propertyId, setPropertyId] = useState(card.property?.id ?? '');
  const [startDay, setStartDay] = useState(card.start ?? '');
  const [endDay, setEndDay] = useState(card.end && card.end !== card.start ? card.end : '');
  const [time, setTime] = useState(card.startTime ?? '');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" className="rt-quiet-btn" onClick={() => setOpen(true)}>
        Change the home, day or time
      </button>
    );
  }
  const save = () =>
    start(async () => {
      setError(null);
      const res = await editVendorVisitAction(card.id, {
        propertyId: propertyId && propertyId !== card.property?.id ? propertyId : null,
        start: startDay || null,
        end: startDay ? endDay || startDay : null,
        startTime: time || null,
        endTime: time ? null : card.endTime,
      });
      if (res.ok) onSaved();
      else setError(res.error);
    });
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <Labeled label="Home">
        <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} style={field}>
          <option value="">Select home…</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </Labeled>
      <Labeled label="Day">
        <input type="date" value={startDay} onChange={(e) => setStartDay(e.target.value)} style={field} />
      </Labeled>
      <Labeled label="Last day, if more than one">
        <input type="date" value={endDay} min={startDay || undefined} onChange={(e) => setEndDay(e.target.value)} style={field} />
      </Labeled>
      <Labeled label="Arrives">
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={field} />
      </Labeled>
      <PrimaryButton onClick={save} disabled={pending || !propertyId || !startDay} loading={pending} loadingLabel="Saving">
        Save
      </PrimaryButton>
      {error && <span role="alert" style={{ fontSize: 12, color: 'var(--signal)' }}>{error}</span>}
    </div>
  );
}
