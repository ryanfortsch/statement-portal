import { SubmitButton } from '@/components/SubmitButton';
import { fmtTouchDate } from './Pipeline';

/**
 * The one manual override on a prospect's stages. When a stage's work
 * happened somewhere Helm cannot see (the deck went out by text, the
 * contract was signed on paper, the owner gave the intake by phone), this
 * marks the stage done; Undo takes the mark back. The same words and the
 * same Undo on every stage, and no explanation under it: the stage it sits
 * in says what is done.
 */
export const DONE_OUTSIDE_HELM = 'Done outside Helm';

export function DoneOutsideHelm({
  doneAt,
  mark,
  undo,
}: {
  /** When the stage was marked done outside Helm, or null. */
  doneAt: string | null;
  mark: () => Promise<void>;
  undo: () => Promise<void>;
}) {
  if (doneAt) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
        <span style={{ fontSize: 12, color: 'var(--positive)', fontWeight: 500 }}>
          ✓ {DONE_OUTSIDE_HELM} {fmtTouchDate(doneAt)}
        </span>
        <form action={undo} style={{ display: 'inline-block' }}>
          <SubmitButton label="Undo" busyLabel="Undoing…" spinnerTone="ink" style={{ ...buttonStyle, fontSize: 10, padding: '7px 12px' }} />
        </form>
      </div>
    );
  }
  return (
    <form action={mark} style={{ display: 'inline-block', marginTop: 14 }}>
      <SubmitButton label={DONE_OUTSIDE_HELM} busyLabel="Saving…" spinnerTone="ink" style={buttonStyle} />
    </form>
  );
}

const buttonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '11px 16px',
  border: '1px solid var(--ink)',
  cursor: 'pointer',
};
