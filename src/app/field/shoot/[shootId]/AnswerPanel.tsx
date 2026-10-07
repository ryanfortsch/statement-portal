'use client';

import { useState } from 'react';
import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { useDraftNavigationGuard } from '@/lib/use-draft-navigation-guard';
import { acceptShoot, declineShoot } from '@/app/field/actions';

/**
 * Yes or no on an offered shoot day.
 *
 * The office proposes a day; this is where the contributor takes it or
 * passes. Both answers are equally easy to give on purpose: a decline
 * hidden behind a hard-to-find link is not really a choice, and a
 * contributor who feels obliged to accept is being scheduled, not offered.
 *
 * Declining opens one optional line for a reason. Optional, and theirs: no
 * explanation is owed for turning down work.
 */
export function AnswerPanel({ shootId, when, what }: { shootId: string; when: string; what: string }) {
  const [passing, setPassing] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, pending, error, setError, run } = useRecoverableAction();
  useDraftNavigationGuard(passing && reason.length > 0, pending);
  function reply(data: FormData, action: typeof acceptShoot) {
    if (busy.current) return;
    run(async () => {
      const result = await action(data);
      if (result?.error) setError(result.error);
    }, 'Could not confirm your reply. Your text is kept. Refresh to check the offer before retrying.');
  }
  function back() {
    if (busy.current || (reason && !confirm('Discard your reason for passing?'))) return;
    setPassing(false); setReason(''); setError(null);
  }

  return (
    <div
      style={{
        marginTop: 18,
        border: '1px solid var(--signal)',
        borderRadius: 12,
        background: 'rgba(200,90,58,0.05)',
        padding: '16px 18px',
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--signal)', fontWeight: 600 }}>
        Can you take it?
      </div>
      <p style={{ fontSize: 14.5, lineHeight: 1.55, margin: '6px 0 0', color: 'var(--ink)' }}>
        We would like you at {what} on {when}. Nothing is booked until you accept, and the door code comes through once you do.
      </p>

      {!passing ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 14 }}>
          <form action={async data => { reply(data, acceptShoot); }} style={{ margin: 0 }}>
            <input type="hidden" name="shoot_id" value={shootId} />
            <button type="submit" disabled={pending} style={btnGo}>{pending ? 'Confirming…' : "Yes, I'll take it"}</button>
          </form>
          <button type="button" disabled={pending} onClick={() => { if (!busy.current) { setPassing(true); setError(null); } }} style={btnPass}>
            Can&apos;t make it
          </button>
        </div>
      ) : (
        <form action={async data => { reply(data, declineShoot); }} style={{ marginTop: 14 }}>
          <input type="hidden" name="shoot_id" value={shootId} />
          <label style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 6 }}>
            Anything you want us to know? Optional.
          </label>
          <input
            name="reason"
            aria-label="Reason for passing"
            value={reason}
            onChange={event => setReason(event.target.value)}
            disabled={pending}
            maxLength={500}
            placeholder="e.g. away that week, or try me Thursday"
            style={{
              font: 'inherit',
              fontSize: 14,
              width: '100%',
              color: 'var(--ink)',
              background: 'var(--paper-2, #fff)',
              border: '1px solid var(--rule)',
              borderRadius: 8,
              padding: '9px 11px',
            }}
          />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
            <button type="submit" disabled={pending} style={btnPassSolid}>{pending ? 'Sending…' : 'Send my pass'}</button>
            <button type="button" disabled={pending} onClick={back} style={btnQuiet}>
              Back
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert" style={{ color: 'var(--negative)', fontSize: 13 }}>{error}</p>}
    </div>
  );
}

const btnGo: React.CSSProperties = {
  background: 'var(--positive)',
  color: 'var(--paper)',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: '0.06em',
  padding: '12px 22px',
};
const btnPass: React.CSSProperties = {
  background: 'var(--paper-2, #fff)',
  color: 'var(--ink-3)',
  border: '1px solid var(--rule)',
  borderRadius: 8,
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 13,
  padding: '12px 18px',
};
const btnPassSolid: React.CSSProperties = { ...btnPass, borderColor: 'var(--ink-4)' };
const btnQuiet: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--ink-4)',
  font: 'inherit',
  fontSize: 12.5,
  textDecoration: 'underline',
  textUnderlineOffset: 3,
  padding: 0,
};
