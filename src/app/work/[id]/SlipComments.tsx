'use client';

import { useState, useTransition } from 'react';
import type { WorkSlipCommentRow } from '@/lib/work-types';
import { displayNameForEmail } from '@/lib/team';
import { addWorkSlipComment, deleteWorkSlipComment } from '../actions';

type Props = {
  slipId: string;
  initialComments: WorkSlipCommentRow[];
  myEmail: string;
};

/**
 * Threaded comment surface for a single work slip. Mirrors the comment
 * pattern shipped on tasks (#132). Optimistic insert keeps the input
 * snappy; author-scoped delete (the server action enforces it too).
 */
export function SlipComments({ slipId, initialComments, myEmail }: Props) {
  const [comments, setComments] = useState<WorkSlipCommentRow[]>(initialComments);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const trimmed = body.trim();
    if (!trimmed) return;
    setSubmitting(true);

    // Optimistic insert: render the comment immediately with a temp id.
    const tempId = `temp-${Date.now()}`;
    const optimistic: WorkSlipCommentRow = {
      id: tempId,
      work_slip_id: slipId,
      author_email: myEmail,
      body: trimmed,
      created_at: new Date().toISOString(),
    };
    setComments((prev) => [...prev, optimistic]);
    setBody('');

    const res = await addWorkSlipComment({ work_slip_id: slipId, body: trimmed });
    setSubmitting(false);
    if (!res.ok) {
      setErr(res.error);
      // Roll back the optimistic insert.
      setComments((prev) => prev.filter((c) => c.id !== tempId));
      return;
    }
    // Replace the temp with the real id so future deletes target the right row.
    setComments((prev) => prev.map((c) => (c.id === tempId ? { ...c, id: res.id } : c)));
  }

  function remove(id: string) {
    const prevList = comments;
    setComments((curr) => curr.filter((c) => c.id !== id));
    startTransition(async () => {
      const res = await deleteWorkSlipComment({ id, work_slip_id: slipId });
      if (!res.ok) {
        setErr(res.error);
        // Restore on failure.
        setComments(prevList);
      }
    });
  }

  return (
    <div>
      {comments.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '4px 0 18px' }}>
          No comments yet. Use this thread to capture context — what was bought, who was called, owner decisions, etc.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 18px' }}>
          {comments.map((c) => (
            <li
              key={c.id}
              style={{
                padding: '12px 0',
                borderBottom: '1px solid var(--rule-soft)',
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, color: 'var(--ink-3)' }}>{displayNameForEmail(c.author_email)}</span>
                  {' · '}
                  {formatRelative(c.created_at)}
                </div>
                <p style={{ fontSize: 14, color: 'var(--ink)', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {c.body}
                </p>
              </div>
              {c.author_email === myEmail && (
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  aria-label="Delete comment"
                  title="Delete (only you can delete your own comments)"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--ink-4)',
                    fontSize: 14,
                    padding: 0,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Add a comment…"
          maxLength={2000}
          style={{
            width: '100%',
            background: 'transparent',
            border: '1px solid var(--rule)',
            padding: '10px 12px',
            fontSize: 13,
            color: 'var(--ink)',
            fontFamily: 'inherit',
            resize: 'vertical',
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <span style={{ fontSize: 11, color: err ? 'var(--negative)' : 'var(--ink-4)' }}>
            {err ?? `Posting as ${displayNameForEmail(myEmail)}`}
          </span>
          <button
            type="submit"
            disabled={submitting || !body.trim()}
            style={{
              background: submitting || !body.trim() ? 'var(--ink-4)' : 'var(--ink)',
              color: 'var(--paper)',
              border: 'none',
              padding: '8px 16px',
              fontSize: 11,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              fontWeight: 600,
              cursor: submitting || !body.trim() ? 'default' : 'pointer',
            }}
          >
            {submitting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </form>
    </div>
  );
}

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso);
    const diffMs = Date.now() - then.getTime();
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}
