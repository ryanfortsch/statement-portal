'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { ApprovalCard, BodyText, sentAgoLabel } from '@/components/messaging/card/ApprovalCard';
import type { QueueCardHelpers } from '@/components/messaging/card/ApprovalQueue';
import { OutlineChip, PrimaryButton, SecondaryButton } from '@/components/messaging/card/buttons';
import type { AlsoItem, WaitReason } from '@/components/messaging/card/types';
import type { VendorVisitCardData } from '@/lib/vendor-visit-cards';
import { describeHold } from '@/lib/vendor-visit-core';
import { fmtClock, fmtDay } from '@/lib/vendor-visit-dates';
import { approveVendorVisitAction, editVendorVisitAction, markVendorVisitHandledAction } from './vendor-visit-actions';

type PropertyOption = { id: string; name: string };

/** Mark handled's reasons for a vendor visit: what the operator did instead. */
export const VENDOR_VISIT_HANDLED_REASONS = ['Not a visit', 'Held it myself', 'Wrong home or day'] as const;

const LANE_WORDS: Record<string, string> = { pro: 'pro', handyman: 'handyman', visit: 'visit', owner: 'owner' };

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
  const [ticked, setTicked] = useState(() => new Set(card.slips.filter((s) => s.ticked).map((s) => s.id)));
  const home = card.property?.name ?? null;
  const vendor = card.vendorName;

  const nights = plan ? [...(nightBefore && plan.nightBefore.offered ? [plan.nightBefore.date] : []), ...plan.holdNights] : [];
  const where = card.property?.authority === 'helm' ? 'in Helm' : 'in Guesty, so Airbnb, VRBO and Booking.com stop selling it';
  const approveBlocked = !card.property
    ? 'Pick the home first.'
    : !card.start
      ? 'Pick the day first.'
      : card.status === 'approving' && !card.stuck
        ? 'Someone is approving this card right now.'
        : undefined;

  const editor = <ChangeVisit card={card} properties={properties} onSaved={() => helpers.onResolved()} />;
  const also: AlsoItem[] = [];

  // 1. The hold, or the question that stands in front of it.
  if (!card.property || !card.start) {
    also.push({
      key: 'hold',
      line: !card.property
        ? <>Which home? {vendor} did not say, and nothing we sent names one.</>
        : <>Which day? {sentence(card.askReason ?? `${vendor} did not name one`)}</>,
      status: !card.property ? 'Pick the home' : 'Pick the day',
      attention: true,
      body: (
        <>
          {card.property && card.candidates.length > 0 && <PickDay card={card} onSaved={() => helpers.onResolved()} />}
          {editor}
        </>
      ),
    });
  } else if (card.planError || !plan) {
    also.push({
      key: 'hold',
      line: <>The calendar for {home} could not be read just now. Approve reads it again before holding anything.</>,
      status: 'Unread',
      attention: true,
      body: editor,
    });
  } else {
    also.push({
      key: 'hold',
      line: nights.length > 0
        ? <>Holds {home} {describeHold(nights)} {where}</>
        : <>Nothing to hold at {home}: {plan.alreadyHeld.length > 0 ? 'the nights are already closed' : 'a guest has the nights'}</>,
      status: nights.length > 0 ? 'On approve' : 'No hold',
      body: (
        <>
          {plan.nightBefore.offered && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-2)', marginBottom: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={nightBefore} onChange={(e) => setNightBefore(e.target.checked)} style={{ width: 14, height: 14 }} />
              Also hold the night before ({fmtDay(plan.nightBefore.date)}):{' '}
              {card.startTime ? `${vendor} comes at ${fmtClock(card.startTime)}, before the ${fmtClock(card.checkoutTime)} checkout` : `${vendor} gave no time`}
            </label>
          )}
          {plan.alreadyHeld.length > 0 && (
            <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
              Already closed, left as it is: {plan.alreadyHeld.map((h) => `${fmtDay(h.date)} (${h.reason})`).join('; ')}.
            </p>
          )}
          {editor}
        </>
      ),
    });
  }

  // 2. The slips the visit covers.
  if (card.property) {
    const total = card.slips.length;
    also.push({
      key: 'slips',
      line: total === 0
        ? <>No open slip at {home} for {card.tradeLabel?.toLowerCase() ?? 'this trade'} or a licensed pro</>
        : ticked.size > 0
          ? <>Schedules {ticked.size} slip{ticked.size === 1 ? '' : 's'} for {vendor}{card.start ? ` on ${fmtDay(card.start)}` : ''}</>
          : <>Schedules no slip</>,
      status: total > 0 ? `${ticked.size} of ${total}` : undefined,
      body: total > 0 ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {card.slips.map((s) => (
            <li key={s.id}>
              <label style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={ticked.has(s.id)}
                  onChange={(e) => {
                    const next = new Set(ticked);
                    if (e.target.checked) next.add(s.id);
                    else next.delete(s.id);
                    setTicked(next);
                  }}
                  style={{ width: 14, height: 14 }}
                />
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  {s.title}{' '}
                  <OutlineChip>{LANE_WORDS[s.lane] ?? s.lane}</OutlineChip>
                  {s.note && <span style={{ color: 'var(--signal)', fontSize: 12 }}> {s.note}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : undefined,
    });
  }

  // 3. What the calendar says first.
  if (plan && plan.warnings.length > 0) {
    also.push({
      key: 'calendar',
      line: <>{plan.warnings[0]}{plan.warnings.length > 1 ? ` And ${plan.warnings.length - 1} more.` : ''}</>,
      status: 'Read first',
      attention: true,
      body: plan.warnings.length > 1 ? (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>
          {plan.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      ) : undefined,
    });
  }

  const wait: WaitReason | null = card.stuck
    ? { tone: 'stale', text: 'An approve started and did not finish. Check the calendar, then approve again.' }
    : card.status === 'approving'
      ? { tone: 'held', text: 'Being approved right now.' }
      : card.lastError
        ? { tone: 'failed', text: card.lastError }
        : null;

  const reading = card.start
    ? `${card.end && card.end !== card.start ? `${fmtDay(card.start)} to ${fmtDay(card.end)}` : fmtDay(card.start)}${card.timeLabel ? `, ${card.timeLabel}` : ''}`
    : null;

  return (
    <ApprovalCard
      id={card.id}
      status="pending"
      name={vendor}
      property={home ?? undefined}
      channel="SMS"
      preview={card.messageBody}
      reviewLabel="Review hold"
      chips={
        <>
          {audienceChip}
          {card.tradeLabel && <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>{card.tradeLabel}</span>}
          {card.lineLabel && <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>{card.lineLabel}</span>}
        </>
      }
      ageMinutes={card.ageMinutes}
      createdAt={card.createdAt}
      shortId={card.id.slice(0, 8)}
      wait={wait}
      layout="stacked"
      said={{
        label: `${vendor} wrote`,
        sub: sentAgoLabel(card.messageAt),
        subTitle: card.messageAt,
        body: <BodyText>{card.messageBody}</BodyText>,
      }}
      between={
        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink-2)' }}>
          <div>
            <span className="eyebrow" style={{ color: 'var(--ink-4)', marginRight: 8 }}>Reads as</span>
            {reading ? <strong style={{ color: 'var(--ink)' }}>{reading}</strong> : <em>no day yet</em>}
            {home ? <> at <strong style={{ color: 'var(--ink)' }}>{home}</strong></> : <> at <em>no home yet</em></>}
            {card.dateBasis && <span style={{ color: 'var(--ink-4)' }}> · {card.dateBasis}</span>}
            {plan?.outsideOffer === false && <span style={{ color: 'var(--ink-4)' }}> · inside the window you offered</span>}
          </div>
          {card.offer && (
            <div style={{ marginTop: 4, color: 'var(--ink-3)', fontSize: 12 }} title={card.offer.text}>
              Answers what you sent {sentAgoLabel(card.offer.at).replace(/^sent /, '') || 'recently'}: “{card.offer.text.length > 160 ? `${card.offer.text.slice(0, 159)}…` : card.offer.text}”
            </div>
          )}
        </div>
      }
      reply={null}
      also={also}
      verbs={{
        approve: () =>
          approveVendorVisitAction(card.id, {
            propertyId: card.property?.id ?? '',
            start: card.start ?? '',
            end: card.end ?? card.start ?? '',
            startTime: card.startTime,
            endTime: card.endTime,
            slipIds: [...ticked],
            holdNightBefore: nightBefore && !!plan?.nightBefore.offered,
          }),
        markHandled: (capture) => markVendorVisitHandledAction(card.id, capture?.reason),
      }}
      handledReasons={VENDOR_VISIT_HANDLED_REASONS}
      pastePlaceholder="Paste what you told the vendor, if anything"
      approveBlocked={approveBlocked}
      footer={(ctl) => (
        <>
          <PrimaryButton
            onClick={ctl.approve}
            disabled={ctl.busy || !!approveBlocked}
            loading={ctl.pending === 'approve'}
            loadingLabel="Holding"
            title={approveBlocked ?? 'Hold the nights and schedule the ticked slips. Nothing is sent to the vendor.'}
          >
            {nights.length > 0 ? 'Approve hold' : 'Approve visit'}
          </PrimaryButton>
          <div className="rt-message-quiet">{ctl.parts.handled}</div>
        </>
      )}
      onResolved={helpers.onResolved}
      onDecided={helpers.onDecided}
      onRegenerating={() => {}}
      regenStalled={false}
    />
  );
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
function ChangeVisit({ card, properties, onSaved }: { card: VendorVisitCardData; properties: PropertyOption[]; onSaved: () => void }) {
  const [open, setOpen] = useState(!card.property || !card.start);
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
