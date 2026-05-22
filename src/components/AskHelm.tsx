'use client';

/**
 * Ask Helm — natural-language Q&A panel inside the Cmd+K palette's
 * "Ask" mode. Posts the question to /api/ask (Claude + read-only query
 * tools) and renders the plain-language answer plus clickable source
 * records the operator can open to verify.
 *
 * Non-streaming for v1: the answer comes back after Claude runs its
 * tool calls, so we show an "Asking Helm…" state and then the result.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

type Source = { label: string; href: string };

// Fallback prompts for the global Cmd+K palette, where there are no live
// dashboard stats. The home page passes data-driven suggestions instead.
const SUGGESTIONS = [
  'How much did 53 Rocky Neck make last month?',
  'Which prospects haven’t signed their contract yet?',
  'What has high-priority work right now?',
  'What’s checking in over the next 7 days?',
];

export function AskHelm({
  autoFocus,
  suggestions,
}: {
  autoFocus?: boolean;
  suggestions?: string[];
}) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Prefer live, data-driven prompts from the caller; fall back to the
  // static set when none are passed (e.g. the Cmd+K palette).
  const tips = suggestions && suggestions.length > 0 ? suggestions : SUGGESTIONS;

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    setSources([]);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Something went wrong.');
        return;
      }
      setAnswer(String(data?.answer ?? ''));
      setSources(Array.isArray(data?.sources) ? data.sources : []);
    } catch {
      setError('Network error. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <textarea
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            // Enter submits; Shift+Enter inserts a newline.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(question);
            }
          }}
          rows={2}
          placeholder="Ask Helm anything about the business…"
          style={{
            width: '100%',
            resize: 'none',
            border: '1px solid var(--ink)',
            background: 'var(--paper)',
            color: 'var(--ink)',
            fontFamily: 'inherit',
            fontSize: 15,
            lineHeight: 1.5,
            padding: '12px 14px',
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
            Reads your data live. Always verify the figures.
          </span>
          <button
            type="submit"
            disabled={loading || !question.trim()}
            style={{
              background: 'var(--ink)',
              color: 'var(--paper)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '.16em',
              textTransform: 'uppercase',
              padding: '9px 18px',
              border: 'none',
              cursor: loading || !question.trim() ? 'default' : 'pointer',
              opacity: loading || !question.trim() ? 0.55 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {loading && (
              <span
                aria-hidden
                style={{
                  width: 11,
                  height: 11,
                  border: '1.5px solid currentColor',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  display: 'inline-block',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
            )}
            {loading ? 'Asking' : 'Ask'}
          </button>
        </div>
      </form>

      {/* Idle state: a few example questions to teach what's possible. */}
      {!loading && !answer && !error && (
        <div style={{ marginTop: 18 }}>
          <div className="eyebrow" style={{ color: 'var(--ink-4)', marginBottom: 10 }}>Try asking</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {tips.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setQuestion(s);
                  ask(s);
                }}
                style={{
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--rule)',
                  padding: '9px 2px',
                  fontSize: 13,
                  color: 'var(--ink-2)',
                  cursor: 'pointer',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <p style={{ marginTop: 18, fontSize: 13, color: 'var(--ink-3)', fontStyle: 'italic' }}>
          Asking Helm. Checking the data…
        </p>
      )}

      {error && (
        <p
          role="alert"
          style={{
            marginTop: 18,
            fontSize: 13,
            color: 'var(--negative)',
            borderLeft: '3px solid var(--negative)',
            paddingLeft: 12,
          }}
        >
          {error}
        </p>
      )}

      {answer && !loading && (
        <div style={{ marginTop: 18 }}>
          <div
            style={{
              fontSize: 14,
              lineHeight: 1.6,
              color: 'var(--ink)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {answer}
          </div>
          {sources.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--rule)' }}>
              <div className="eyebrow" style={{ color: 'var(--ink-4)', marginBottom: 8 }}>Sources</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {sources.map((s) => (
                  <Link
                    key={s.href + s.label}
                    href={s.href}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '5px 11px',
                      border: '1px solid var(--rule)',
                      color: 'var(--tide-deep)',
                      textDecoration: 'none',
                      fontSize: 12,
                    }}
                  >
                    {s.label}
                    <span aria-hidden style={{ opacity: 0.6 }}>→</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
