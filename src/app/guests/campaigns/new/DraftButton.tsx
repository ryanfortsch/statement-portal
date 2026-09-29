'use client';

/** Shared pending state prevents competing campaign creation requests. */
export function DraftButton({ pending, disabled }: { pending: boolean; disabled: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      aria-busy={pending}
      style={{
        background: 'var(--ink)',
        color: 'var(--paper)',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        padding: '14px 28px',
        border: 'none',
        cursor: pending ? 'wait' : 'pointer',
        opacity: pending ? 0.7 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      {pending ? (
        <>
          <span aria-hidden="true" className="animate-spin" style={{
            display: 'inline-block',
            width: 14,
            height: 14,
            border: '2px solid rgba(250, 247, 241, 0.35)',
            borderTopColor: 'var(--paper)',
            borderRadius: '50%',
          }} />
          <span>Drafting (10 to 20 seconds)</span>
        </>
      ) : (
        <span>Draft with Helm →</span>
      )}
    </button>
  );
}
