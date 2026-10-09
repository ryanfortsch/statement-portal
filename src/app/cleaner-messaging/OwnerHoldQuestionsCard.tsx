import { Section } from '@/components/Section';
import { SubmitButton } from '@/components/SubmitButton';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { formatTime12 } from '@/lib/checkout-schedule';
import { holdNights } from '@/lib/owner-hold-questions-core';
import { loadOwnerHoldQuestions, type OwnerHoldQuestionCard } from '@/lib/owner-hold-questions';
import { decideOwnerHoldAction } from '../turnovers/schedule/actions';

/**
 * "Owner block: clean after?" The loud card. Every upcoming owner block in
 * Guesty is listed here until the operator answers; the stay is on the
 * cleaner schedule meanwhile, so an unanswered question costs a possibly
 * redundant stop, never a missed one. Answered blocks stay listed, quietly,
 * until their checkout passes, with a button to change the answer.
 *
 * Rendered on /cleaner-messaging above the digest card (Dotti, 2026-10-08:
 * "serve it up loudly, I need to see it") and, pending ones only, on the
 * home feed. Nothing here renders when there is no upcoming owner block.
 */

const DATE_FMT = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const SHORT_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
function fmt(date: string, f: Intl.DateTimeFormat = DATE_FMT): string {
  return f.format(new Date(`${date}T12:00:00Z`));
}

const NOTICE: Record<string, string> = {
  clean: 'Noted: the crew cleans after that block. It stays on the schedule.',
  no_clean: 'Noted: no cleaning after that block. It is off the route; the crew sees it struck through.',
  no_clean_sent: 'Noted: no cleaning after that block. That day already went out to the crew: use Send update on the schedule card to tell them.',
  bad_hold: 'That did not save: the block could not be read. Try again.',
  save_failed: 'That did not save. Try again.',
};

export async function OwnerHoldQuestionsCard({ notice }: { notice?: string | null }) {
  let data: Awaited<ReturnType<typeof loadOwnerHoldQuestions>>;
  try {
    data = await loadOwnerHoldQuestions(supabase);
  } catch (e) {
    return (
      <Section id="owner-holds" title="Owner blocks · clean after?" eyebrow="Could not be read">
        <div style={{ borderTop: '1px solid var(--ink)', padding: '12px 0', fontSize: 12, color: 'var(--signal)', fontWeight: 600 }}>
          The calendar mirror could not be read just now. <span style={{ fontFamily: 'var(--font-mono), monospace', fontWeight: 400 }}>{e instanceof Error ? e.message : String(e)}</span>
        </div>
      </Section>
    );
  }
  if (data.cards.length === 0 && !notice) return null;
  const pending = data.pending;
  const answered = data.cards.filter((c) => c.status !== 'pending');

  return (
    <Section
      id="owner-holds"
      title="Owner blocks · clean after?"
      eyebrow={pending.length > 0 ? `${pending.length} to answer` : 'All answered'}
    >
      <div style={{ borderTop: pending.length > 0 ? '2px solid var(--signal)' : '1px solid var(--ink)', padding: '14px 0 6px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {notice && NOTICE[notice] && (
          <div style={{ marginBottom: 8, fontSize: 12, color: notice.startsWith('bad') || notice === 'save_failed' ? 'var(--signal)' : 'var(--ink-3)', fontWeight: 600 }}>
            {NOTICE[notice]}
          </div>
        )}
        {pending.length > 0 && (
          <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6, marginBottom: 6 }}>
            Guesty has these homes blocked for the owner. Each is on the cleaner schedule for the morning after
            the block until you say otherwise.
          </div>
        )}
        {pending.map((c) => (
          <HoldRow key={`${c.propertyId}|${c.checkIn}`} card={c} today={data.today} />
        ))}
        {answered.length > 0 && (
          <details style={{ marginTop: pending.length > 0 ? 10 : 0 }} open={pending.length === 0}>
            <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600, listStyle: 'none', padding: '6px 0' }}>
              Answered · {answered.length} upcoming
            </summary>
            {answered.map((c) => (
              <HoldRow key={`${c.propertyId}|${c.checkIn}`} card={c} today={data.today} />
            ))}
          </details>
        )}
      </div>
    </Section>
  );
}

/** One owner block with its answer buttons. Shared with the home feed. */
export function HoldRow({ card: c, today, back = 'card' }: { card: OwnerHoldQuestionCard; today: string; back?: 'card' | 'home' | 'page' }) {
  const pending = c.status === 'pending';
  const nights = holdNights(c.checkIn, c.checkOut);
  const noteText = [c.reason, c.note].filter((s): s is string => !!s && s.trim().length > 0).join(' · ');
  const when = c.checkOut === today ? 'today' : fmt(c.checkOut);
  return (
    <div
      id={`owner-hold-${c.propertyId}-${c.checkIn}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexWrap: 'wrap',
        padding: '10px 0',
        borderTop: '1px solid var(--rule)',
        scrollMarginTop: 100,
        opacity: pending ? 1 : 0.8,
      }}
    >
      <div style={{ flex: 1, minWidth: 260 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{c.propertyName}</span>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            {fmt(c.checkIn, SHORT_FMT)} to {fmt(c.checkOut, SHORT_FMT)} · {nights} night{nights === 1 ? '' : 's'}
          </span>
          {noteText && <span style={{ fontSize: 12, color: 'var(--ink-4)', fontStyle: 'italic' }}>Guesty: {noteText}</span>}
          {!pending && (
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: c.status === 'clean' ? 'var(--ink-3)' : 'var(--signal)', border: `1px solid ${c.status === 'clean' ? 'var(--rule)' : 'var(--signal)'}`, borderRadius: 3, padding: '2px 7px' }}>
              {c.status === 'clean' ? 'clean after' : 'no cleaning'}
              {c.decidedBy ? ` · ${c.decidedBy.split('@')[0]}` : ''}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: pending ? 'var(--ink)' : 'var(--ink-3)', marginTop: 3 }}>
          Checkout lands {when} at {formatTime12(c.checkoutTime)}
          {c.arrivingGuest ? `, and ${c.arrivingGuest} arrives that afternoon` : ''}.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {c.status !== 'clean' && (
          <form action={decideOwnerHoldAction}>
            <HiddenFields card={c} decision="clean" back={back} />
            <SubmitButton
              label={pending ? 'Clean after' : 'Clean after all'}
              busyLabel="Saving..."
              style={{ fontSize: 12, fontWeight: 600, padding: '8px 14px', background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 5, cursor: 'pointer' }}
            />
          </form>
        )}
        {c.status !== 'no_clean' && (
          <form action={decideOwnerHoldAction}>
            <HiddenFields card={c} decision="no_clean" back={back} />
            <SubmitButton
              label="No cleaning"
              busyLabel="Saving..."
              spinnerTone="ink"
              style={{ fontSize: 12, fontWeight: 600, padding: '8px 14px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--ink)', borderRadius: 5, cursor: 'pointer' }}
            />
          </form>
        )}
      </div>
    </div>
  );
}

function HiddenFields({ card: c, decision, back }: { card: OwnerHoldQuestionCard; decision: 'clean' | 'no_clean'; back: string }) {
  return (
    <>
      <input type="hidden" name="propertyId" value={c.propertyId} />
      <input type="hidden" name="stayCheckIn" value={c.checkIn} />
      <input type="hidden" name="checkOut" value={c.checkOut} />
      <input type="hidden" name="decision" value={decision} />
      <input type="hidden" name="holdReason" value={c.reason ?? ''} />
      <input type="hidden" name="holdNote" value={c.note ?? ''} />
      <input type="hidden" name="back" value={back} />
    </>
  );
}
