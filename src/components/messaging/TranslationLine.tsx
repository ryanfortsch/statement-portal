import type { ReactNode } from 'react';
import { englishLineText } from '@/lib/translation-line';

/**
 * A quiet English line under text written in another language. The concierge
 * answers a guest in the language they wrote in; the approver reads English
 * (Spanish at 73 Rocky Neck, 2026-10-17). Same look as the cleaner card's
 * Portuguese audit line.
 */
export function TranslationLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        marginTop: 8,
        paddingTop: 8,
        borderTop: '1px dashed var(--rule)',
        fontSize: 12,
        lineHeight: 1.55,
        color: 'var(--ink-3)',
        fontStyle: 'italic',
        whiteSpace: 'pre-wrap',
      }}
    >
      <span className="eyebrow" style={{ fontStyle: 'normal', color: 'var(--ink-4)', marginRight: 6 }}>
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * The English for one side of a guest card, or a note that it is on its way.
 * Renders nothing for text that was already English.
 */
export function EnglishLine({
  text,
  translating,
  label = 'English',
}: {
  text?: string | null;
  translating?: boolean | null;
  label?: string;
}) {
  const line = englishLineText(text, translating);
  return line ? <TranslationLine label={label}>{line}</TranslationLine> : null;
}
