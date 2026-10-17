import { PACKET_STEPS, PACKET_STEP_LABEL, packetStep } from '@/lib/field-packet-status';

/**
 * The packet pipeline as one small strip, lit at the current step:
 * Draft · Open · Claimed · On site · Submitted · Approved · Paid.
 *
 * The same component sits on every board row and in the packet header, so
 * the office reads one vocabulary from the list to the page and never a
 * stored value (UI/UX audit, 2026-10-17: "published" in code, "Open ·
 * unclaimed" on the chip, "Out to contractors" as the heading, in_progress
 * raw on the page). Cancelled is the exit, not a step, and renders as one
 * chip.
 *
 * `sm` (board rows): one dot per step with the current step's word beside
 * it; the whole line rides in the tooltip. `md` (the packet header): every
 * word printed, the current one lit, so the page that gets the most visits
 * teaches the line.
 */
export function PacketStatusStrip({
  status,
  paidAt,
  size = 'sm',
}: {
  status: string;
  paidAt?: string | null;
  size?: 'sm' | 'md';
}) {
  const step = packetStep(status, paidAt);
  if (step === 'cancelled') {
    return (
      <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, padding: '3px 9px', borderRadius: 6, background: 'rgba(30,46,52,0.06)', color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>
        Cancelled
      </span>
    );
  }
  const at = PACKET_STEPS.indexOf(step);
  const litColor = step === 'approved' || step === 'paid' ? 'var(--positive)' : 'var(--signal)';
  const line = PACKET_STEPS.map((s) => PACKET_STEP_LABEL[s]).join(' · ');
  const aria = `${PACKET_STEP_LABEL[step]}, step ${at + 1} of ${PACKET_STEPS.length}: ${line}`;

  if (size === 'md') {
    return (
      <span role="img" aria-label={aria} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {PACKET_STEPS.map((s, i) => {
          const lit = i === at;
          const done = i < at;
          return (
            <span key={s} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
              {i > 0 && <span aria-hidden style={{ color: 'var(--rule)', fontSize: 10 }}>·</span>}
              <span
                style={{
                  fontSize: lit ? 11 : 10,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  fontWeight: lit ? 700 : 500,
                  color: lit ? litColor : done ? 'var(--ink-3)' : 'var(--ink-4)',
                  opacity: lit || done ? 1 : 0.55,
                  whiteSpace: 'nowrap',
                }}
              >
                {PACKET_STEP_LABEL[s]}
              </span>
            </span>
          );
        })}
      </span>
    );
  }

  return (
    <span role="img" aria-label={aria} title={line} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
      {PACKET_STEPS.map((s, i) => {
        const lit = i === at;
        const done = i < at;
        return (
          <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span
              aria-hidden
              style={{
                width: lit ? 8 : 6,
                height: lit ? 8 : 6,
                borderRadius: '50%',
                background: lit ? litColor : done ? 'var(--ink-3)' : 'transparent',
                border: `1px solid ${lit ? litColor : done ? 'var(--ink-3)' : 'var(--rule)'}`,
                boxSizing: 'border-box',
              }}
            />
            {lit && (
              <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, color: litColor, marginRight: 2 }}>
                {PACKET_STEP_LABEL[s]}
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}
