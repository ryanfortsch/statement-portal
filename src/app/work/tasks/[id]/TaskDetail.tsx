'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  type TaskRow,
  type TaskCommentRow,
  type TaskScope,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/work-types';
import { updateTask, deleteTask, addTaskComment, deleteTaskComment } from '../../actions';
import { TeamPicker } from '@/components/TeamPicker';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';

type PropertyForPicker = { id: string; name: string; title: string | null; city: string; is_active: boolean };

type Props = {
  task: TaskRow;
  comments: TaskCommentRow[];
  properties: PropertyForPicker[];
  myEmail: string;
};

export function TaskDetail({ task, comments, properties, myEmail }: Props) {
  const softRefresh = useSoftRefresh();
  const [isPending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [scope, setScope] = useState<TaskScope>(task.scope);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [assignedToEmail, setAssignedToEmail] = useState<string | null>(task.assigned_to_email ?? null);
  const [dueDate, setDueDate] = useState(task.due_date ?? '');
  const [propertyIds, setPropertyIds] = useState<string[]>(task.property_ids ?? []);
  const [tagsInput, setTagsInput] = useState((task.tags ?? []).join(', '));

  // Comments
  const [commentList, setCommentList] = useState<TaskCommentRow[]>(comments);
  const [commentBody, setCommentBody] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const saving = useRef(false);
  const posting = useRef(false);
  const deletingTask = useRef(false);
  const deletingComments = useRef(new Set<string>());
  const [commentDeletePending, setCommentDeletePending] = useState<string[]>([]);
  const [commentDeleteErrors, setCommentDeleteErrors] = useState<Record<string, string>>({});
  const snapshot = JSON.stringify([title, description, scope, priority, status, assignedToEmail, dueDate, propertyIds, tagsInput]);
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
  const dirty = snapshot !== savedSnapshot;
  useUnsavedWorkGuard(dirty || submitting || commentBody !== '' || commentSubmitting || commentDeletePending.length > 0 || deleting);

  async function save() {
    if (saving.current || deletingTask.current) return;
    saving.current = true;
    setError(null);
    setSavedAt(null);
    setSubmitting(true);
    const submittedSnapshot = snapshot;
    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
    try {
      const res = await updateTask({
      id: task.id,
      title,
      description: description || null,
      scope,
      property_ids: scope === 'property' ? propertyIds : null,
      assigned_to_email: assignedToEmail,
      priority,
      status,
      due_date: dueDate || null,
      tags: tags.length > 0 ? tags : null,
      });
      if (!res.ok) { setError(res.error); return; }
      setSavedSnapshot(submittedSnapshot);
      setSavedAt(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
      softRefresh();
    } catch {
      setError('Could not confirm the task save. Your edits are kept. Retry to apply them.');
    } finally {
      saving.current = false;
      setSubmitting(false);
    }
  }

  async function postComment() {
    if (posting.current || deletingTask.current || !commentBody.trim()) return;
    posting.current = true;
    const body = commentBody.trim();
    setCommentError(null);
    setCommentSubmitting(true);
    try {
      const res = await addTaskComment({ task_id: task.id, body });
      if (!res.ok) { setCommentError(res.error); return; }
      setCommentList((prev) => [
        ...prev,
        { id: res.id, task_id: task.id, author_email: myEmail, body, created_at: new Date().toISOString() },
      ]);
      setCommentBody('');
      softRefresh();
    } catch {
      setCommentError('Could not confirm whether the comment posted. Your draft is kept. Check the saved comments in another tab before retrying to avoid a duplicate.');
    } finally {
      posting.current = false;
      setCommentSubmitting(false);
    }
  }

  function removeComment(c: TaskCommentRow) {
    if (deletingTask.current || deletingComments.current.has(c.id) || c.author_email !== myEmail) return;
    if (!confirm('Delete this comment?')) return;
    deletingComments.current.add(c.id);
    setCommentDeletePending([...deletingComments.current]);
    setCommentDeleteErrors((prev) => ({ ...prev, [c.id]: '' }));
    startTransition(async () => {
      try {
        const res = await deleteTaskComment({ id: c.id, task_id: task.id });
        if (!res.ok) { setCommentDeleteErrors((prev) => ({ ...prev, [c.id]: res.error })); return; }
        setCommentList((prev) => prev.filter((x) => x.id !== c.id));
      } catch {
        setCommentDeleteErrors((prev) => ({ ...prev, [c.id]: 'Could not confirm deletion. Retry to remove this comment.' }));
      } finally {
        deletingComments.current.delete(c.id);
        setCommentDeletePending([...deletingComments.current]);
      }
    });
  }

  function handleDelete() {
    if (deletingTask.current || saving.current || posting.current || deletingComments.current.size) return;
    if (!confirm('Delete this task and its comments? This cannot be undone.')) return;
    deletingTask.current = true;
    // Dedicated flag: the shared transition also covers comment removal,
    // and the Delete button shouldn't read "Deleting…" during those.
    setDeleting(true);
    startTransition(async () => {
      try {
        await deleteTask({ id: task.id });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to delete');
        setDeleting(false);
        deletingTask.current = false;
      }
    });
  }

  return (
    <div className="max-w-[860px] mx-auto px-10" style={{ paddingTop: 24, paddingBottom: 80, width: '100%', flex: 1 }}>
      <Link
        href="/work"
        style={{
          fontSize: 11,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
          textDecoration: 'none',
        }}
      >
        ← All Work
      </Link>

      <fieldset disabled={submitting || deleting} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {/* HERO */}
      <section style={{ paddingTop: 24, paddingBottom: 24 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          Helm &middot; Task &middot; {scope === 'corporate' ? 'Corporate' : 'Property'}
        </div>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          className="font-serif"
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            borderBottom: '1px solid var(--rule)',
            padding: '6px 0',
            fontSize: 36,
            fontWeight: 300,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            outline: 'none',
          }}
        />
        <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: 14 }}>
          <Pill color={statusColor(status)}>{status.replace('_', ' ')}</Pill>
          <Pill color={priorityColor(priority)}>{priority}</Pill>
          <Pill color="var(--ink-3)">{scope}</Pill>
        </div>
      </section>

      {/* CORE */}
      <Section title="Detail">
        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            style={textareaStyle()}
            placeholder="Acceptance criteria, links, context…"
          />
        </Field>

        <div className="flex gap-3">
          <div style={{ flex: 1 }}>
            <Field label="Scope">
              <select value={scope} onChange={(e) => setScope(e.target.value as TaskScope)} style={selectStyle()}>
                <option value="corporate">Corporate</option>
                <option value="property">Property</option>
              </select>
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Priority">
              <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} style={selectStyle()}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} style={selectStyle()}>
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="blocked">Blocked</option>
                <option value="done">Done</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
          </div>
        </div>

        {scope === 'property' && (
          <Field label="Properties">
            <select
              multiple
              value={propertyIds}
              onChange={(e) => setPropertyIds(Array.from(e.target.selectedOptions).map((o) => o.value))}
              style={{ ...selectStyle(), minHeight: 140 }}
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <p style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)' }}>Hold ⌘ to select multiple.</p>
          </Field>
        )}

        <div className="flex gap-3">
          <div style={{ flex: 1 }}>
            <Field label="Assignee">
              <TeamPicker
                value={assignedToEmail}
                onChange={setAssignedToEmail}
                myEmail={myEmail}
                placeholder="Unassigned"
              />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Due date">
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={inputStyle()} />
            </Field>
          </div>
        </div>

        <Field label="Tags (comma-separated)">
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="e.g. marketing, hires"
            style={inputStyle()}
          />
        </Field>
      </Section>

      </fieldset>
      {/* COMMENTS */}
      <Section title={`Comments · ${commentList.length}`}>
        {commentList.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--ink-4)' }}>No comments yet. First one sets the tone.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {commentList.map((c) => (
              <div
                key={c.id}
                style={{
                  padding: '12px 14px',
                  border: '1px solid var(--rule)',
                  background: 'var(--paper-2)',
                }}
              >
                <div className="flex items-baseline justify-between" style={{ marginBottom: 6 }}>
                  <span style={{ fontSize: 11, letterSpacing: '.08em', color: 'var(--ink-3)' }}>
                    {c.author_email || 'You'} &middot; {formatTimestamp(c.created_at)}
                  </span>
                  {c.author_email === myEmail && <button
                    type="button"
                    onClick={() => removeComment(c)}
                    disabled={deleting || commentDeletePending.includes(c.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 10,
                      color: 'var(--ink-4)',
                      letterSpacing: '.14em',
                      textTransform: 'uppercase',
                    }}
                    title="Delete"
                  >
                    {commentDeletePending.includes(c.id) ? 'Deleting…' : '✕'}
                  </button>}
                </div>
                <p style={{ fontSize: 13, color: 'var(--ink)', whiteSpace: 'pre-wrap', margin: 0 }}>{c.body}</p>
                {commentDeleteErrors[c.id] && <p role="alert" style={{ color: 'var(--negative)', fontSize: 12 }}>{commentDeleteErrors[c.id]}</p>}
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <Field label="Add a comment">
            <textarea
              value={commentBody}
              disabled={commentSubmitting || deleting}
              onChange={(e) => setCommentBody(e.target.value)}
              rows={3}
              placeholder="What's the latest?"
              style={textareaStyle()}
            />
          </Field>
          <div className="flex justify-end" style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={postComment}
              disabled={deleting || commentSubmitting || !commentBody.trim()}
              style={{ ...primaryBtn(), opacity: commentBody.trim() ? 1 : 0.5 }}
            >
              {commentSubmitting ? 'Posting…' : 'Post comment'}
            </button>
          </div>
          {commentError && <p role="alert" style={{ color: 'var(--negative)', fontSize: 12 }}>{commentError} <a href={`/work/tasks/${task.id}`} target="_blank" rel="noopener noreferrer">View saved comments</a></p>}
          {commentBody && <button type="button" disabled={commentSubmitting || deleting} onClick={() => { setCommentBody(''); setCommentError(null); }} style={{ fontSize: 12 }}>Discard comment draft</button>}
        </div>
      </Section>

      {/* AUDIT */}
      <Section title="Audit">
        <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 32px', fontSize: 12, color: 'var(--ink-3)' }}>
          <Detail term="Created by" definition={task.created_by_email} />
          <Detail term="Created at" definition={formatTimestamp(task.created_at)} />
          <Detail term="Updated at" definition={formatTimestamp(task.updated_at)} />
          <Detail term="Task ID" definition={task.id} mono />
        </dl>
      </Section>

      {error && (
        <div
          style={{
            marginTop: 24,
            padding: '10px 14px',
            borderLeft: '3px solid var(--negative)',
            background: 'var(--paper-2)',
            fontSize: 12,
            color: 'var(--negative)',
          }}
        >
          {error}
        </div>
      )}

      <div
        className="flex items-center justify-between flex-wrap gap-3"
        style={{
          marginTop: 32,
          paddingTop: 18,
          borderTop: '1px solid var(--ink)',
        }}
      >
        <button type="button" onClick={handleDelete} disabled={deleting || isPending || submitting || commentSubmitting || commentDeletePending.length > 0} style={dangerBtn()}>
          {deleting ? 'Deleting…' : 'Delete task'}
        </button>
        <div className="flex items-center gap-3">
          {savedAt && !dirty && <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>Saved {savedAt}</span>}
          {dirty && <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>Unsaved changes</span>}
          <Link href="/work" style={ghostBtn()}>Cancel</Link>
          <button type="button" onClick={save} disabled={submitting || deleting} style={primaryBtn()}>
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 36 }}>
      <h2
        className="font-serif"
        style={{
          fontSize: 18,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          color: 'var(--ink)',
          margin: 0,
          marginBottom: 14,
          paddingBottom: 8,
          borderBottom: '1px solid var(--rule)',
        }}
      >
        {title}
      </h2>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      {children}
    </label>
  );
}

function Detail({ term, definition, mono = false }: { term: string; definition: string; mono?: boolean }) {
  return (
    <div>
      <dt className="eyebrow" style={{ marginBottom: 4 }}>{term}</dt>
      <dd className={mono ? 'font-mono' : ''} style={{ color: 'var(--ink)', fontSize: mono ? 11 : 13, margin: 0 }}>
        {definition}
      </dd>
    </div>
  );
}

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10,
        letterSpacing: '.16em',
        textTransform: 'uppercase',
        fontWeight: 700,
        color,
        border: `1px solid ${color}`,
        padding: '4px 10px',
      }}
    >
      {children}
    </span>
  );
}

function statusColor(s: TaskStatus): string {
  switch (s) {
    case 'done': return 'var(--positive)';
    case 'in_progress': return 'var(--tide-deep)';
    case 'blocked': return 'var(--negative)';
    case 'archived': return 'var(--ink-4)';
    default: return 'var(--ink)';
  }
}

function priorityColor(p: TaskPriority): string {
  switch (p) {
    case 'high': return 'var(--negative)';
    case 'low': return 'var(--ink-4)';
    default: return 'var(--ink-3)';
  }
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function inputStyle(): React.CSSProperties {
  return {
    width: '100%',
    background: 'transparent',
    border: '1px solid var(--rule)',
    padding: '8px 12px',
    fontSize: 14,
    color: 'var(--ink)',
    outline: 'none',
  };
}

function textareaStyle(): React.CSSProperties {
  return { ...inputStyle(), fontFamily: 'inherit', resize: 'vertical' };
}

function selectStyle(): React.CSSProperties {
  return {
    ...inputStyle(),
    cursor: 'pointer',
    appearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%23506068' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 10px center',
    backgroundSize: '16px',
    paddingRight: 32,
  };
}

function primaryBtn(): React.CSSProperties {
  return {
    background: 'var(--ink)',
    color: 'var(--paper)',
    border: 'none',
    padding: '10px 18px',
    fontSize: 11,
    letterSpacing: '.16em',
    textTransform: 'uppercase',
    fontWeight: 600,
    cursor: 'pointer',
  };
}

function ghostBtn(): React.CSSProperties {
  return {
    background: 'transparent',
    border: '1px solid var(--rule)',
    padding: '10px 16px',
    fontSize: 11,
    letterSpacing: '.16em',
    textTransform: 'uppercase',
    color: 'var(--ink-3)',
    cursor: 'pointer',
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
  };
}

function dangerBtn(): React.CSSProperties {
  return {
    background: 'transparent',
    border: '1px solid var(--negative)',
    padding: '10px 14px',
    fontSize: 11,
    letterSpacing: '.16em',
    textTransform: 'uppercase',
    color: 'var(--negative)',
    cursor: 'pointer',
  };
}
