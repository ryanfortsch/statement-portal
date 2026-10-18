'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  type TaskRow,
  type TaskCommentRow,
  type TaskPriority,
  type TaskStatus,
  OFFICE_TODO_LABEL,
  TASK_CLOSED_STATUSES,
  TASK_DISMISSED_STATUS,
  TASK_PICKER_STATUSES,
  TASK_STATUS_LABELS,
  WORK_PRIORITIES,
  WORK_PRIORITY_LABELS,
} from '@/lib/work-types';
import { updateTask, deleteTask, addTaskComment, deleteTaskComment } from '../../actions';
import { BackToBoardLink } from '../../[id]/BackToBoardLink';
import { chipHintStyle, chipStyle, smallGhostButton } from '../../[id]/slip-controls';
import { TeamPicker } from '@/components/TeamPicker';
import { displayNameForEmail } from '@/lib/team';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { GLOUCESTER_TZ } from '@/lib/stable-time';

type PropertyForPicker = { id: string; name: string; title: string | null; city: string; is_active: boolean };

type Props = {
  task: TaskRow;
  comments: TaskCommentRow[];
  properties: PropertyForPicker[];
  myEmail: string;
};

/** The fields the page saves one at a time, each on its own gesture. */
type FieldKey = 'title' | 'description' | 'priority' | 'status' | 'assigned_to_email' | 'due_date';
type FieldValue = string | null;

const FIELD_LABELS: Record<FieldKey, string> = {
  title: 'Title',
  description: 'Description',
  priority: 'Priority',
  status: 'Status',
  assigned_to_email: 'Assignment',
  due_date: 'Due date',
};

/** A pause in typing this long writes the description. */
const DESCRIPTION_AUTOSAVE_MS = 1200;

const STATUS_HINTS: Partial<Record<TaskStatus, string>> = {
  open: 'Not started.',
  in_progress: 'Someone is on it.',
  blocked: 'Waiting on something outside the office. Say what in a comment.',
};

/**
 * One office to-do: desk work that belongs to no house (work at a house is
 * a work slip). The page works the way a slip's page does: every field
 * saves on its own (a chip on tap, the assignee and due date on pick, the
 * title on Save, the description as you type), closing is Mark done or
 * Dismiss in Wrap up, comments carry short names, and the back link
 * restores the board on the Office to-dos tab. There is no form-wide Save.
 */
export function TaskDetail({ task, comments, properties, myEmail }: Props) {
  const softRefresh = useSoftRefresh();
  const [isPending, startTransition] = useTransition();

  // The confirmed to-do: what the server last accepted, field by field.
  const [saved, setSaved] = useState<TaskRow>(task);
  const [saving, setSaving] = useState<FieldKey | null>(null);
  const [fieldError, setFieldError] = useState<{ key: FieldKey; message: string; value: FieldValue } | null>(null);
  const lock = useRef(false);

  // Title: Edit, then Save or Cancel, as on a slip.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const titleInput = useRef<HTMLInputElement>(null);

  // Description: saves itself after a pause in typing or on leaving the box.
  const [description, setDescription] = useState(task.description ?? '');
  const [descriptionSaved, setDescriptionSaved] = useState(false);
  const [autosaveHeld, setAutosaveHeld] = useState(false);
  const descriptionDirty = description.trim() !== (saved.description ?? '').trim();

  // Delete asks once, in words, on the page.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deletingTask = useRef(false);

  // Comments
  const [commentList, setCommentList] = useState<TaskCommentRow[]>(comments);
  const [commentBody, setCommentBody] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const posting = useRef(false);
  const deletingComments = useRef(new Set<string>());
  const [commentDeletePending, setCommentDeletePending] = useState<string[]>([]);
  const [commentDeleteErrors, setCommentDeleteErrors] = useState<Record<string, string>>({});

  const titleDirty = editingTitle && titleDraft.trim() !== saved.title;
  useUnsavedWorkGuard(
    titleDirty || descriptionDirty || saving !== null || fieldError !== null ||
    commentBody !== '' || commentSubmitting || commentDeletePending.length > 0 || deleting,
  );

  const isClosed = TASK_CLOSED_STATUSES.includes(saved.status);
  const busy = saving !== null || deleting;

  async function saveField(key: FieldKey, value: FieldValue): Promise<boolean> {
    if (lock.current || deletingTask.current) return false;
    lock.current = true;
    setSaving(key);
    setFieldError(null);
    try {
      const res = await updateTask({ id: task.id, [key]: value } as Parameters<typeof updateTask>[0]);
      if (!res.ok) {
        setFieldError({ key, message: res.error, value });
        return false;
      }
      const stored = typeof value === 'string' ? value.trim() || null : value;
      setSaved((prev) => ({ ...prev, [key]: stored }) as TaskRow);
      softRefresh();
      return true;
    } catch {
      setFieldError({ key, message: 'Could not confirm the change. Showing the last confirmed value.', value });
      return false;
    } finally {
      lock.current = false;
      setSaving(null);
    }
  }

  async function retryField() {
    if (!fieldError) return;
    if (fieldError.key === 'title') return saveTitle();
    if (fieldError.key === 'description') return saveDescription();
    await saveField(fieldError.key, fieldError.value);
  }

  function beginTitleEdit() {
    setTitleDraft(saved.title);
    setEditingTitle(true);
    setTimeout(() => {
      titleInput.current?.focus();
      titleInput.current?.select();
    }, 0);
  }

  async function saveTitle() {
    const next = titleDraft.trim();
    if (!next) return;
    if (next === saved.title) {
      setEditingTitle(false);
      if (fieldError?.key === 'title') setFieldError(null);
      return;
    }
    if (await saveField('title', next)) setEditingTitle(false);
  }

  async function saveDescription() {
    // Another field's save holds the lock: wait for the next pause or blur
    // rather than treat the skip as a failure.
    if (lock.current) return;
    const submitted = description;
    const ok = await saveField('description', submitted);
    if (ok) setDescriptionSaved(true);
    else setAutosaveHeld(true);
  }

  // Keep the autosave timer on the latest saveDescription() without
  // re-arming it on every render (a ref written in render trips the lint rule).
  const saveDescriptionRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    saveDescriptionRef.current = saveDescription;
  });
  useEffect(() => {
    if (!descriptionDirty || saving !== null || autosaveHeld || deleting) return;
    const timer = setTimeout(() => {
      void saveDescriptionRef.current();
    }, DESCRIPTION_AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [description, descriptionDirty, saving, autosaveHeld, deleting]);

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
    if (deletingTask.current || lock.current || posting.current || deletingComments.current.size) return;
    deletingTask.current = true;
    // Dedicated flag: the shared transition also covers comment removal,
    // and the Delete button shouldn't read "Deleting…" during those.
    setDeleting(true);
    setDeleteError(null);
    startTransition(async () => {
      try {
        await deleteTask({ id: task.id });
      } catch (e) {
        setDeleteError(e instanceof Error ? e.message : 'Failed to delete');
        setDeleting(false);
        deletingTask.current = false;
      }
    });
  }

  const propertyNames = (saved.property_ids ?? [])
    .map((id) => properties.find((p) => p.id === id)?.name ?? id);

  // A status error prints beside the control that made it: Wrap up for
  // Mark done, Dismiss and Reopen, the status chips for the rest.
  const closeVerbError = fieldError?.key === 'status' &&
    (TASK_CLOSED_STATUSES.includes(fieldError.value as TaskStatus) || (fieldError.value === 'open' && isClosed));

  function errorFor(key: FieldKey, where: 'chips' | 'wrap' = 'chips') {
    if (fieldError?.key !== key) return null;
    if (key === 'status' && (where === 'wrap') !== closeVerbError) return null;
    return (
      <div role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--negative)' }}>
        {FIELD_LABELS[key]}: {fieldError.message}
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button type="button" disabled={busy} onClick={() => void retryField()} style={smallGhostButton}>Retry</button>
          <button type="button" disabled={busy} onClick={() => setFieldError(null)} style={smallGhostButton}>Dismiss</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 24, width: '100%' }}>
        {/* Back to the board as it was left, on the Office to-dos tab, the
            same way a slip's back link restores its view. */}
        <BackToBoardLink fallbackHref="/work?tab=tasks" tab="tasks" />
      </div>

      {/* HERO */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 24, paddingBottom: 28, width: '100%' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
          <div className="eyebrow">{OFFICE_TODO_LABEL}</div>
          {!editingTitle && (
            <button type="button" onClick={beginTitleEdit} disabled={busy} style={quietButton(saving === 'title')}>
              {saving === 'title' ? 'Saving…' : 'Edit Title'}
            </button>
          )}
        </div>
        {editingTitle ? (
          <div>
            <input
              ref={titleInput}
              type="text"
              value={titleDraft}
              disabled={busy}
              maxLength={200}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void saveTitle(); }
                if (e.key === 'Escape' && !busy) { setEditingTitle(false); if (fieldError?.key === 'title') setFieldError(null); }
              }}
              aria-label="To-do title"
              className="font-serif"
              style={{ ...TITLE_STYLE, display: 'block', width: '100%', background: 'transparent', border: 'none', borderBottom: '1px dashed var(--ink-3)', padding: 0, outline: 'none' }}
            />
            <div className="flex items-center gap-2" style={{ marginTop: 10 }}>
              <button type="button" onClick={() => void saveTitle()} disabled={busy || !titleDraft.trim()} style={smallSolidButton}>
                {saving === 'title' ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => { setEditingTitle(false); if (fieldError?.key === 'title') setFieldError(null); }}
                disabled={busy}
                style={smallGhostButton}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <h1 className="font-serif" style={TITLE_STYLE}>{saved.title}</h1>
        )}
        {errorFor('title')}
        <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: 14 }}>
          <Pill color={statusColor(saved.status)} label={(TASK_STATUS_LABELS[saved.status] ?? saved.status).toUpperCase()} solid />
          <Pill color={priorityColor(saved.priority)} label={`${WORK_PRIORITY_LABELS[saved.priority] ?? saved.priority} priority`} />
        </div>
      </section>

      {/* STAT GRID: created, due and who, the last two editable in place. */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 48, width: '100%' }}>
        <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <StatCell label="Created">
              <div className="font-serif" style={{ fontSize: 18, fontWeight: 400, color: 'var(--ink)', lineHeight: 1.2 }}>
                {formatDate(task.created_at)}
              </div>
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)' }}>{displayNameForEmail(task.created_by_email)}</div>
            </StatCell>
            <StatCell label="Due">
              <input
                type="date"
                aria-label="Due date"
                value={saved.due_date ?? ''}
                disabled={busy}
                onChange={(e) => void saveField('due_date', e.target.value || null)}
                style={{ ...inputStyle(), padding: '6px 10px' }}
              />
              {saving === 'due_date' && <div role="status" style={statusLine}>Saving due date…</div>}
              {errorFor('due_date')}
            </StatCell>
            <StatCell label="Assigned" last>
              <TeamPicker
                value={saved.assigned_to_email}
                onChange={(next) => void saveField('assigned_to_email', next?.trim() || null)}
                myEmail={myEmail}
                placeholder="Unassigned"
                disabled={busy}
              />
              {saving === 'assigned_to_email' && <div role="status" style={statusLine}>Saving assignment…</div>}
              {errorFor('assigned_to_email')}
            </StatCell>
          </div>
        </div>
      </section>

      {/* DETAILS: the description saves as you type. */}
      <Section title="Details" eyebrow="What's needed">
        <textarea
          value={description}
          aria-label="Description"
          // An autosave must not lock the box mid-sentence; other saves do.
          disabled={deleting || (saving !== null && saving !== 'description')}
          onChange={(e) => {
            setDescription(e.target.value);
            setDescriptionSaved(false);
            setAutosaveHeld(false);
          }}
          onBlur={() => {
            if (descriptionDirty && saving === null) void saveDescription();
          }}
          rows={4}
          placeholder="Links, context, what done looks like… Saves as you type."
          style={textareaStyle()}
        />
        {(saving === 'description' || (descriptionSaved && !descriptionDirty)) && (
          <div role="status" style={statusLine}>{saving === 'description' ? 'Saving…' : 'Saved.'}</div>
        )}
        {errorFor('description')}
        {propertyNames.length > 0 && (
          <p style={{ ...chipHintStyle, marginTop: 14 }}>Filed against {propertyNames.join(', ')}.</p>
        )}
        {(saved.tags ?? []).length > 0 && (
          <p style={chipHintStyle}>Tags: {(saved.tags ?? []).join(', ')}</p>
        )}
      </Section>

      {/* WHERE IT STANDS: the slip page's chip idiom. */}
      <Section title="Where it stands" eyebrow={isClosed ? TASK_STATUS_LABELS[saved.status] : `${WORK_PRIORITY_LABELS[saved.priority] ?? saved.priority} priority`}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Priority</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {WORK_PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={saved.priority === p}
              disabled={busy}
              onClick={() => { if (saved.priority !== p) void saveField('priority', p as TaskPriority); }}
              style={chipStyle(saved.priority === p, busy)}
            >
              {WORK_PRIORITY_LABELS[p]}
            </button>
          ))}
        </div>
        {errorFor('priority')}
        {!isClosed && (
          <>
            <div className="eyebrow" style={{ marginTop: 20, marginBottom: 8 }}>Status</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {TASK_PICKER_STATUSES.map((st) => (
                <button
                  key={st}
                  type="button"
                  aria-pressed={saved.status === st}
                  disabled={busy}
                  onClick={() => { if (saved.status !== st) void saveField('status', st); }}
                  style={chipStyle(saved.status === st, busy)}
                >
                  {TASK_STATUS_LABELS[st]}
                </button>
              ))}
            </div>
            {STATUS_HINTS[saved.status] && <p style={chipHintStyle}>{STATUS_HINTS[saved.status]}</p>}
          </>
        )}
        {errorFor('status', 'chips')}
      </Section>

      {/* WRAP UP: the operator's verbs, the same ones a slip has. */}
      <Section
        title="Wrap up"
        eyebrow={saved.status === 'done' ? 'Completed' : saved.status === TASK_DISMISSED_STATUS ? 'Dismissed' : 'When it’s handled'}
      >
        <div className="flex items-center gap-3 flex-wrap">
          {isClosed ? (
            <>
              <button type="button" onClick={() => void saveField('status', 'open')} disabled={busy} style={ghostButton()}>
                {saving === 'status' ? 'Saving…' : 'Reopen'}
              </button>
              <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                {saved.status === TASK_DISMISSED_STATUS
                  ? 'Dismissed: closed without doing it. Reopen puts it back on the list.'
                  : 'Reopen puts it back on the list.'}
              </span>
            </>
          ) : (
            <>
              <button type="button" onClick={() => void saveField('status', 'done')} disabled={busy} style={solidButton()}>
                {saving === 'status' ? 'Saving…' : 'Mark Done'}
              </button>
              <button type="button" onClick={() => void saveField('status', TASK_DISMISSED_STATUS)} disabled={busy} style={ghostButton()}>
                Dismiss
              </button>
              <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>Dismiss closes it without doing it: a duplicate, or no longer needed.</span>
            </>
          )}
        </div>
        {errorFor('status', 'wrap')}
      </Section>

      {/* COMMENTS */}
      <Section title="Comments" eyebrow={`${commentList.length} ${commentList.length === 1 ? 'comment' : 'comments'}`}>
        {commentList.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--ink-4)', margin: 0 }}>No comments yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {commentList.map((c) => (
              <div key={c.id} style={{ padding: '12px 14px', border: '1px solid var(--rule)', background: 'var(--paper-2)' }}>
                <div className="flex items-baseline justify-between" style={{ marginBottom: 6 }}>
                  <span style={{ fontSize: 11, letterSpacing: '.08em', color: 'var(--ink-3)' }}>
                    <span style={{ fontWeight: 600 }}>{c.author_email ? displayNameForEmail(c.author_email) : 'You'}</span> &middot; {formatTimestamp(c.created_at)}
                  </span>
                  {c.author_email === myEmail && <button
                    type="button"
                    onClick={() => removeComment(c)}
                    disabled={deleting || commentDeletePending.includes(c.id)}
                    aria-label="Delete comment"
                    style={smallGhostButton}
                  >
                    {commentDeletePending.includes(c.id) ? 'Deleting…' : 'Delete'}
                  </button>}
                </div>
                <p style={{ fontSize: 13, color: 'var(--ink)', whiteSpace: 'pre-wrap', margin: 0 }}>{c.body}</p>
                {commentDeleteErrors[c.id] && <p role="alert" style={{ color: 'var(--negative)', fontSize: 12 }}>{commentDeleteErrors[c.id]}</p>}
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <label style={{ display: 'block' }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Add a comment</div>
            <textarea
              value={commentBody}
              disabled={commentSubmitting || deleting}
              onChange={(e) => setCommentBody(e.target.value)}
              rows={3}
              placeholder="What's the latest?"
              style={textareaStyle()}
            />
          </label>
          <div className="flex justify-end" style={{ marginTop: 8, gap: 8 }}>
            {commentBody && <button type="button" disabled={commentSubmitting || deleting} onClick={() => { setCommentBody(''); setCommentError(null); }} style={ghostButton()}>Discard comment draft</button>}
            <button
              type="button"
              onClick={postComment}
              disabled={deleting || commentSubmitting || !commentBody.trim()}
              style={{ ...solidButton(), opacity: commentBody.trim() ? 1 : 0.5 }}
            >
              {commentSubmitting ? 'Posting…' : 'Post comment'}
            </button>
          </div>
          {commentError && <p role="alert" style={{ color: 'var(--negative)', fontSize: 12 }}>{commentError} <a href={`/work/tasks/${task.id}`} target="_blank" rel="noopener noreferrer">View saved comments</a></p>}
        </div>
      </Section>

      {/* DELETE: asks once, in words, and says it is for good. */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 48, width: '100%' }}>
        <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 18 }}>
          {confirmingDelete ? (
            <div role="group" aria-label="Confirm delete" className="flex items-center gap-3 flex-wrap">
              <span style={{ fontSize: 13, color: 'var(--ink)' }}>
                Delete this to-do{commentList.length > 0 ? ` and its ${commentList.length} comment${commentList.length === 1 ? '' : 's'}` : ''}? This cannot be undone.
              </span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting || isPending || saving !== null || commentSubmitting || commentDeletePending.length > 0}
                style={{ ...dangerButton(), background: 'var(--negative)', color: 'var(--paper)' }}
              >
                {deleting ? 'Deleting…' : 'Delete for good'}
              </button>
              <button type="button" onClick={() => setConfirmingDelete(false)} disabled={deleting} style={ghostButton()}>
                Keep it
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy || isPending || commentSubmitting || commentDeletePending.length > 0}
              style={dangerButton()}
            >
              Delete to-do
            </button>
          )}
          {deleteError && <div role="alert" style={{ marginTop: 10, fontSize: 12, color: 'var(--negative)' }}>{deleteError}</div>}
        </div>
      </section>
    </>
  );
}

// ─── Sub-components ──────────────────────────────────────────────

const TITLE_STYLE: React.CSSProperties = {
  fontSize: 38,
  lineHeight: 1.05,
  fontWeight: 300,
  letterSpacing: '-0.02em',
  color: 'var(--ink)',
  maxWidth: 720,
  margin: 0,
};

const statusLine: React.CSSProperties = { marginTop: 6, fontSize: 11, color: 'var(--ink-4)' };

function Section({ title, eyebrow, children }: { title: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 48, width: '100%' }}>
      <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
        <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
          {title}
        </h2>
        <span className="eyebrow">{eyebrow}</span>
      </div>
      <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 18 }}>{children}</div>
    </section>
  );
}

function StatCell({ label, children, last = false }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ padding: '20px 22px', borderRight: last ? 'none' : '1px solid var(--rule)' }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );
}

function Pill({ color, label, solid = false }: { color: string; label: string; solid?: boolean }) {
  return (
    <span
      style={{
        background: solid ? color : 'transparent',
        color: solid ? 'var(--paper)' : color,
        border: `1.5px solid ${color}`,
        padding: '4px 12px',
        fontSize: 10,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  );
}

function statusColor(s: TaskStatus): string {
  switch (s) {
    case 'done': return 'var(--positive)';
    case 'in_progress': return 'var(--tide-deep)';
    case 'blocked': return 'var(--negative)';
    case 'archived': return 'var(--ink-4)';
    default: return 'var(--ink-3)';
  }
}

function priorityColor(p: TaskPriority): string {
  switch (p) {
    case 'high': return 'var(--negative)';
    case 'low': return 'var(--ink-4)';
    default: return 'var(--ink-3)';
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: GLOUCESTER_TZ });
  } catch {
    return iso;
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
      timeZone: GLOUCESTER_TZ,
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

const smallSolidButton: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: '1px solid var(--ink)',
  padding: '5px 14px',
  fontSize: 10,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  fontWeight: 600,
  cursor: 'pointer',
};

function quietButton(busy: boolean): React.CSSProperties {
  return { ...smallGhostButton, cursor: busy ? 'wait' : 'pointer' };
}

function solidButton(): React.CSSProperties {
  return {
    background: 'var(--ink)',
    color: 'var(--paper)',
    border: '1.5px solid var(--ink)',
    padding: '10px 22px',
    fontSize: 11,
    letterSpacing: '.18em',
    textTransform: 'uppercase',
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: 42,
  };
}

function ghostButton(): React.CSSProperties {
  return {
    background: 'transparent',
    color: 'var(--ink-3)',
    border: '1px solid var(--rule)',
    padding: '10px 18px',
    fontSize: 11,
    letterSpacing: '.18em',
    textTransform: 'uppercase',
    fontWeight: 500,
    cursor: 'pointer',
    minHeight: 42,
  };
}

function dangerButton(): React.CSSProperties {
  return {
    background: 'transparent',
    border: '1px solid var(--negative)',
    padding: '10px 14px',
    fontSize: 11,
    letterSpacing: '.16em',
    textTransform: 'uppercase',
    color: 'var(--negative)',
    cursor: 'pointer',
    minHeight: 42,
  };
}
