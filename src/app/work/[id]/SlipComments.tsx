'use client';

import { useRef, useState } from 'react';
import type { WorkSlipCommentRow } from '@/lib/work-types';
import { displayNameForEmail } from '@/lib/team';
import { addWorkSlipComment, deleteWorkSlipComment } from '../actions';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';

type Props = {
  slipId: string;
  initialComments: WorkSlipCommentRow[];
  myEmail: string;
};

/**
 * Keep drafts and existing comments until their writes are confirmed.
 * Author-scoped delete is also enforced by the server action.
 */
export function SlipComments({ slipId, initialComments, myEmail }: Props) {
  const [comments, setComments] = useState<WorkSlipCommentRow[]>(initialComments);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [postUncertain, setPostUncertain] = useState(false);
  const [deleting, setDeleting] = useState<string[]>([]);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string | null>>({});
  const posting = useRef(false);
  const deletingIds = useRef(new Set<string>());
  // Almost no slip has a thread, so the compose box stays behind a quiet
  // "+ Comment" line until asked for (or until a thread exists).
  const [composeOpen, setComposeOpen] = useState(false);

  useUnsavedWorkGuard(body.length > 0 || submitting || deleting.length > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (posting.current) return;
    const trimmed = body.trim();
    if (!trimmed) return;
    posting.current = true;
    setErr(null);
    setPostUncertain(false);
    setSubmitting(true);
    try {
      const res = await addWorkSlipComment({ work_slip_id: slipId, body: trimmed });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      const comment: WorkSlipCommentRow = {
        id: res.id,
        work_slip_id: slipId,
        author_email: myEmail,
        body: trimmed,
        created_at: new Date().toISOString(),
      };
      setComments((prev) => [...prev, comment]);
      setBody('');
    } catch {
      setPostUncertain(true);
      setErr('Could not confirm whether this comment posted. Your text is still here. Check saved comments before posting again to avoid a duplicate.');
    } finally {
      posting.current = false;
      setSubmitting(false);
    }
  }

  async function remove(id: string) {
    if (deletingIds.current.has(id)) return;
    deletingIds.current.add(id);
    setDeleting((prev) => [...prev, id]);
    setDeleteErrors((prev) => ({ ...prev, [id]: null }));
    try {
      const res = await deleteWorkSlipComment({ id, work_slip_id: slipId });
      if (!res.ok) {
        setDeleteErrors((prev) => ({ ...prev, [id]: res.error }));
        return;
      }
      // Remove only this confirmed row, preserving posts and other deletions
      // that may have completed while this request was in flight.
      setComments((prev) => prev.filter((comment) => comment.id !== id));
    } catch {
      setDeleteErrors((prev) => ({ ...prev, [id]: 'Could not confirm deletion. You can retry deleting this comment.' }));
    } finally {
      deletingIds.current.delete(id);
      setDeleting((prev) => prev.filter((pendingId) => pendingId !== id));
    }
  }

  if (comments.length === 0 && !composeOpen && !body && !submitting && !err) {
    return (
      <button
        type="button"
        onClick={() => setComposeOpen(true)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          fontSize: 11,
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          fontWeight: 600,
          color: 'var(--ink-3)',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        + Comment
        <span style={{ marginLeft: 8, letterSpacing: 0, textTransform: 'none', color: 'var(--ink-4)', fontWeight: 400 }}>
          what was bought, who was called, owner decisions
        </span>
      </button>
    );
  }

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: comments.length > 0 ? 4 : 8 }}>
        Comments{comments.length > 0 ? ` · ${comments.length}` : ''}
      </div>
      {comments.length === 0 ? null : (
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
                {deleteErrors[c.id] && (
                  <p role="alert" style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--negative)' }}>{deleteErrors[c.id]}</p>
                )}
              </div>
              {c.author_email === myEmail && (
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  disabled={deleting.includes(c.id)}
                  aria-label="Delete comment"
                  title="Delete (only you can delete your own comments)"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: deleting.includes(c.id) ? 'wait' : 'pointer',
                    color: 'var(--ink-4)',
                    fontSize: 14,
                    padding: 0,
                    lineHeight: 1,
                  }}
                >
                  {deleting.includes(c.id) ? 'Deleting…' : '×'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit}>
        <textarea
          value={body}
          disabled={submitting}
          aria-label="Comment"
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
          <span role={err ? 'alert' : undefined} style={{ fontSize: 11, color: err ? 'var(--negative)' : 'var(--ink-4)' }}>
            {err ?? `Posting as ${displayNameForEmail(myEmail)}`}
            {postUncertain && (
              <> <a href={`/work/${encodeURIComponent(slipId)}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>Check saved comments in a new tab</a></>
            )}
          </span>
          {comments.length === 0 && (
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                if (posting.current) return;
                setComposeOpen(false); setBody(''); setErr(null); setPostUncertain(false);
              }}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                marginLeft: 'auto',
                marginRight: 14,
                fontSize: 11,
                letterSpacing: '.16em',
                textTransform: 'uppercase',
                color: 'var(--ink-4)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          )}
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
