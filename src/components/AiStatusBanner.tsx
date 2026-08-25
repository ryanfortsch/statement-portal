import { getAiStatus, isStayConciergeConfigured } from '@/lib/stay-concierge';

/**
 * States out loud that the drafting AI is down.
 *
 * On 2026-08-25 the Anthropic credit balance hit zero at 11:13 and every
 * classify/draft call failed for ten minutes. Helm showed nothing: the queue
 * simply stopped filling, which is indistinguishable from a quiet morning.
 * Dotti found out because a guest message she was expecting never appeared.
 *
 * An outage that presents as ABSENCE cannot be left to inference, so this
 * renders whenever the concierge reports the AI unreachable. It is a server
 * component that returns null when healthy, so a working day costs one cheap
 * local read on the concierge and no visual noise.
 */
export async function AiStatusBanner() {
  if (!isStayConciergeConfigured()) return null;
  const res = await getAiStatus();
  // A failed health check is NOT evidence of an outage (the concierge being
  // briefly unreachable already has its own surface); stay quiet.
  if (!res.ok || res.data.ok) return null;

  const { reason, since, kind } = res.data;
  const sinceLabel = since
    ? new Date(since).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York',
      })
    : '';

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 16 }}>
      <div
        role="alert"
        style={{
          border: '1px solid var(--signal)',
          borderLeft: '4px solid var(--signal)',
          background: 'var(--paper-2)',
          padding: '14px 16px',
        }}
      >
        <div
          className="eyebrow"
          style={{ color: 'var(--signal)', fontWeight: 700, marginBottom: 6 }}
        >
          Drafts paused{sinceLabel ? ` · since ${sinceLabel}` : ''}
        </div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--ink-2)' }}>
          {reason ||
            'The drafting AI is unreachable, so new guest messages are not being drafted.'}
        </p>
        {kind === 'billing' && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>
            An empty queue right now means nothing was drafted, not that nothing came in.
          </p>
        )}
      </div>
    </section>
  );
}
