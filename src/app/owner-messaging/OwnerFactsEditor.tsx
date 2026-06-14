'use client';

import { useState, useTransition } from 'react';
import { Section } from '@/components/Section';
import { saveOwnerFacts } from './actions';

type Props = {
  initialContent: string;
  initialBytes: number;
};

/**
 * Inline editor for curated_owner_facts.md. The owner responder reads
 * this file on every draft, so any changes here shape future drafts on
 * the next message that comes in — no reload required.
 *
 * V1 is intentionally a textarea, not the structured fact-row editor on
 * the guest side. Owner facts are relational notes (`Susan prefers SMS`,
 * `Bailey wants statements by the 5th`); a plain markdown file is enough
 * until the volume justifies structure.
 */
export function OwnerFactsEditor({ initialContent, initialBytes }: Props) {
  const [content, setContent] = useState(initialContent);
  const [savedContent, setSavedContent] = useState(initialContent);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = content !== savedContent;
  const bytes = new TextEncoder().encode(content).length;

  const onSave = () => {
    setStatus('idle');
    setError(null);
    startTransition(async () => {
      const res = await saveOwnerFacts(content);
      if (res.ok) {
        setSavedContent(content);
        setStatus('saved');
      } else {
        setStatus('error');
        setError(res.error);
      }
    });
  };

  return (
    <Section
      title="Owner facts"
      eyebrow="High-priority rules the owner drafter applies verbatim"
      paddingTop={36}
    >
      <div
        style={{
          borderTop: '1px solid var(--rule)',
          paddingTop: 18,
          fontSize: 13,
          color: 'var(--ink-3)',
          lineHeight: 1.6,
        }}
      >
        Edit the curated owner facts here. Changes apply to the next owner
        draft — no service reload needed. Format: one fact per line,
        optionally tagged with the property slug in square brackets, e.g.
        <code style={{ background: 'var(--paper-2)', padding: '1px 5px' }}>
          [21_horton] Susan prefers SMS over email.
        </code>
      </div>

      <textarea
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          if (status !== 'idle') setStatus('idle');
        }}
        spellCheck={false}
        style={{
          marginTop: 16,
          width: '100%',
          minHeight: 320,
          padding: 14,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: 13,
          lineHeight: 1.55,
          color: 'var(--ink)',
          background: 'var(--paper-2)',
          border: '1px solid var(--rule)',
          borderRadius: 4,
          resize: 'vertical',
          outline: 'none',
        }}
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginTop: 14,
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || pending}
          style={{
            all: 'unset',
            cursor: !dirty || pending ? 'default' : 'pointer',
            padding: '8px 18px',
            background: !dirty || pending ? 'var(--paper-3, var(--paper-2))' : 'var(--ink)',
            color: !dirty || pending ? 'var(--ink-4)' : 'var(--paper)',
            fontSize: 13,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
            borderRadius: 3,
          }}
        >
          {pending ? 'Saving...' : dirty ? 'Save facts' : 'Saved'}
        </button>
        <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
          {bytes.toLocaleString()} bytes
          {dirty && ' · unsaved changes'}
        </span>
        {status === 'saved' && (
          <span className="eyebrow" style={{ color: 'var(--ink-3)' }}>
            Saved. Next draft picks up the changes.
          </span>
        )}
        {status === 'error' && error && (
          <span className="eyebrow" style={{ color: 'var(--signal)' }}>
            {error}
          </span>
        )}
        <span className="eyebrow" style={{ color: 'var(--ink-4)', marginLeft: 'auto' }}>
          Loaded: {initialBytes.toLocaleString()} bytes
        </span>
      </div>
    </Section>
  );
}
