import { guestyWritesSentence, type GuestyWriteScope } from '@/lib/guesty-writes';

/**
 * The sentence at the top of every Channels page while Guesty runs the home
 * (or homes) the page writes to. Renders nothing on a Helm-run home.
 */
export function GuestyWritesNotice({ scope }: { scope: GuestyWriteScope }) {
  const sentence = guestyWritesSentence(scope);
  if (!sentence) return null;
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 18 }}>
      <p
        role="note"
        style={{
          margin: 0,
          padding: '10px 14px',
          borderLeft: '3px solid var(--signal)',
          background: 'var(--paper-2)',
          fontSize: 13,
          lineHeight: 1.5,
          color: 'var(--ink)',
        }}
      >
        {sentence}
      </p>
    </section>
  );
}
