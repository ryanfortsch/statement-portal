import { guestyWritesSentence, type GuestyWriteScope } from '@/lib/guesty-writes';

/**
 * The sentence at the top of every Channels page while Guesty runs the home
 * (or homes) the page writes to. Renders nothing on a Helm-run home.
 */
export function GuestyWritesNotice({ scope, compact = false }: { scope: GuestyWriteScope; compact?: boolean }) {
  const sentence = guestyWritesSentence(scope);
  if (!sentence) return null;
  return (
    <section className={compact ? 'pricing-authority-note' : 'max-w-[1100px] mx-auto px-10'} style={{ width: '100%', paddingTop: compact ? 8 : 18 }}>
      <p
        role="note"
        style={{
          margin: 0,
          padding: compact ? '0' : '10px 14px',
          borderLeft: compact ? undefined : '3px solid var(--signal)',
          background: compact ? undefined : 'var(--paper-2)',
          fontSize: compact ? 11 : 13,
          lineHeight: 1.5,
          color: compact ? '#68716e' : 'var(--ink)',
        }}
      >
        {sentence}
      </p>
    </section>
  );
}
