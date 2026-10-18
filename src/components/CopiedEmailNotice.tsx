'use client';

/**
 * What a drafting surface shows after Copy instead of Create (lib/copy-email):
 * one line saying where to paste it, or, when the browser refused the
 * clipboard, the email itself in a box to select and copy by hand.
 */
export function CopiedEmailNotice({
  copied,
  align = 'left',
}: {
  copied: { text: string; ok: boolean };
  align?: 'left' | 'right';
}) {
  if (copied.ok) {
    return (
      <span role="status" style={{ fontSize: 11, color: 'var(--ink-3)', maxWidth: 320, textAlign: align }}>
        Copied. Paste it into a new email in your own mail; To, Cc and Subject are at the top.
      </span>
    );
  }
  return (
    <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 420, alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>
      <span style={{ fontSize: 11, color: 'var(--ink-3)', textAlign: align }}>
        The browser did not allow copying. Select the text below and copy it.
      </span>
      <textarea
        readOnly
        aria-label="Email to copy"
        value={copied.text}
        rows={8}
        onFocus={(e) => e.currentTarget.select()}
        style={{ width: '100%', border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', fontSize: 12, padding: '6px 8px', fontFamily: 'inherit', resize: 'vertical' }}
      />
    </div>
  );
}
