'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type WorkSlipRow,
  type TaskRow,
  type WorkSlipCategory,
  type WorkSlipPriority,
  type TaskScope,
  type TaskPriority,
  WORK_SLIP_CATEGORY_LABELS,
} from '@/lib/work-types';
import { createWorkSlip, createTask, updateWorkSlipStatus, updateTaskStatus } from './actions';

type PropertyForPicker = {
  id: string;
  name: string;
  title: string | null;
  city: string;
  is_active: boolean;
};

type Props = {
  workSlips: WorkSlipRow[];
  tasks: TaskRow[];
  properties: PropertyForPicker[];
  myEmail: string;
};

type FilterId = 'all' | 'mine' | 'high' | 'due-today' | 'unclaimed';

export function QueueClient({ workSlips, tasks, properties, myEmail }: Props) {
  const [tab, setTab] = useState<'all' | 'slips' | 'tasks'>('all');
  const [filter, setFilter] = useState<FilterId>('all');
  const [showSlipModal, setShowSlipModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [slipPrefillProperty, setSlipPrefillProperty] = useState<string | null>(null);

  const propertyMap = useMemo(() => new Map(properties.map((p) => [p.id, p])), [properties]);
  const todayIso = new Date().toISOString().slice(0, 10);

  const filteredSlips = useMemo(() => {
    return workSlips.filter((w) => {
      if (filter === 'mine' && w.assigned_to_email !== myEmail) return false;
      if (filter === 'high' && w.priority !== 'high') return false;
      if (filter === 'due-today' && w.scheduled_date !== todayIso) return false;
      if (filter === 'unclaimed' && (w.assigned_to_type !== 'unassigned' || w.assigned_to_email)) return false;
      return true;
    });
  }, [workSlips, filter, myEmail, todayIso]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (filter === 'mine' && t.assigned_to_email !== myEmail) return false;
      if (filter === 'high' && t.priority !== 'high') return false;
      if (filter === 'due-today' && t.due_date !== todayIso) return false;
      if (filter === 'unclaimed' && t.assigned_to_email) return false;
      return true;
    });
  }, [tasks, filter, myEmail, todayIso]);

  const slipsByProperty = useMemo(() => {
    const groups = new Map<string, WorkSlipRow[]>();
    for (const ws of filteredSlips) {
      const existing = groups.get(ws.property_id);
      if (existing) existing.push(ws);
      else groups.set(ws.property_id, [ws]);
    }
    for (const [, list] of groups) {
      list.sort((a, b) => {
        if (a.priority === 'high' && b.priority !== 'high') return -1;
        if (a.priority !== 'high' && b.priority === 'high') return 1;
        return b.created_at.localeCompare(a.created_at);
      });
    }
    return [...groups.entries()].sort((a, b) => {
      if (a[1].length !== b[1].length) return b[1].length - a[1].length;
      const an = propertyMap.get(a[0])?.name ?? a[0];
      const bn = propertyMap.get(b[0])?.name ?? b[0];
      return an.localeCompare(bn);
    });
  }, [filteredSlips, propertyMap]);

  const counts = {
    all: workSlips.length + tasks.length,
    slips: workSlips.length,
    tasks: tasks.length,
    mine:
      workSlips.filter((w) => w.assigned_to_email === myEmail).length +
      tasks.filter((t) => t.assigned_to_email === myEmail).length,
    high:
      workSlips.filter((w) => w.priority === 'high').length +
      tasks.filter((t) => t.priority === 'high').length,
    dueToday:
      workSlips.filter((w) => w.scheduled_date === todayIso).length +
      tasks.filter((t) => t.due_date === todayIso).length,
    unclaimed:
      workSlips.filter((w) => w.assigned_to_type === 'unassigned' && !w.assigned_to_email).length +
      tasks.filter((t) => !t.assigned_to_email).length,
  };

  const showSlipsSection = tab !== 'tasks';
  const showTasksSection = tab !== 'slips';

  return (
    <>
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 24, width: '100%' }}>
        <div className="flex items-baseline justify-between flex-wrap gap-4">
          <div>
            <div className="eyebrow" style={{ marginBottom: 14 }}>Helm &middot; Work Queue</div>
            <h1
              className="font-serif"
              style={{ fontSize: 44, lineHeight: 1.05, fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--ink)' }}
            >
              The board.
            </h1>
            <p style={{ marginTop: 10, fontSize: 14, color: 'var(--ink-3)' }}>
              {counts.slips} work slip{counts.slips === 1 ? '' : 's'} &middot; {counts.tasks} task
              {counts.tasks === 1 ? '' : 's'} active
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setShowTaskModal(true)} style={ghostBtn()}>
              + Task
            </button>
            <button type="button" onClick={() => setShowSlipModal(true)} style={primaryBtn()}>
              + Work Slip
            </button>
          </div>
        </div>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 16, width: '100%' }}>
        <div className="flex items-center gap-2 flex-wrap">
          <TabButton active={tab === 'all'} onClick={() => setTab('all')} label="All" count={counts.all} />
          <TabButton active={tab === 'slips'} onClick={() => setTab('slips')} label="Slips" count={counts.slips} />
          <TabButton active={tab === 'tasks'} onClick={() => setTab('tasks')} label="Tasks" count={counts.tasks} />
        </div>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 28, width: '100%' }}>
        <div className="flex items-center gap-2 flex-wrap">
          <Pill active={filter === 'all'} onClick={() => setFilter('all')} label="All" count={counts.all} />
          <Pill active={filter === 'mine'} onClick={() => setFilter('mine')} label="My Items" count={counts.mine} />
          <Pill active={filter === 'high'} onClick={() => setFilter('high')} label="High Priority" count={counts.high} accent="var(--negative)" />
          <Pill active={filter === 'due-today'} onClick={() => setFilter('due-today')} label="Due Today" count={counts.dueToday} accent="var(--signal)" />
          <Pill active={filter === 'unclaimed'} onClick={() => setFilter('unclaimed')} label="Unclaimed" count={counts.unclaimed} />
        </div>
      </section>

      {showSlipsSection && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 48, width: '100%' }}>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
            <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
              Property Work
            </h2>
            <span className="eyebrow">{filteredSlips.length} active</span>
          </div>

          {slipsByProperty.length === 0 ? (
            <EmptyBlock message="No work slips match this filter." />
          ) : (
            <div style={{ borderTop: '1px solid var(--ink)' }}>
              {slipsByProperty.map(([propId, list]) => (
                <PropertyGroup
                  key={propId}
                  property={propertyMap.get(propId) ?? null}
                  slips={list}
                  myEmail={myEmail}
                  onAddSlip={() => {
                    setSlipPrefillProperty(propId);
                    setShowSlipModal(true);
                  }}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {showTasksSection && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%', flex: 1 }}>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
            <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
              Team Tasks
            </h2>
            <span className="eyebrow">{filteredTasks.length} outstanding</span>
          </div>

          {filteredTasks.length === 0 ? (
            <EmptyBlock message="No tasks match this filter." />
          ) : (
            <div style={{ borderTop: '1px solid var(--ink)' }}>
              {filteredTasks.map((t) => (
                <TaskRowItem key={t.id} task={t} />
              ))}
            </div>
          )}
        </section>
      )}

      {showSlipModal && (
        <WorkSlipModal
          properties={properties.filter((p) => p.is_active)}
          prefillPropertyId={slipPrefillProperty}
          onClose={() => {
            setShowSlipModal(false);
            setSlipPrefillProperty(null);
          }}
        />
      )}
      {showTaskModal && (
        <TaskModal
          properties={properties.filter((p) => p.is_active)}
          onClose={() => setShowTaskModal(false)}
        />
      )}
    </>
  );
}

function TabButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? 'var(--ink)' : 'transparent',
        color: active ? 'var(--paper)' : 'var(--ink)',
        border: '1px solid var(--ink)',
        padding: '8px 16px',
        fontSize: 11,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      {label} <span style={{ opacity: 0.7, marginLeft: 6 }}>{count}</span>
    </button>
  );
}

function Pill({
  active,
  onClick,
  label,
  count,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  accent?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? (accent ?? 'var(--ink)') : 'transparent',
        color: active ? 'var(--paper)' : (accent ?? 'var(--ink-3)'),
        border: `1px solid ${accent ?? 'var(--rule)'}`,
        padding: '6px 14px',
        fontSize: 11,
        letterSpacing: '.14em',
        textTransform: 'uppercase',
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      {label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{count}</span>
    </button>
  );
}

function PropertyGroup({
  property,
  slips,
  onAddSlip,
}: {
  property: PropertyForPicker | null;
  slips: WorkSlipRow[];
  myEmail: string;
  onAddSlip: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const highCount = slips.filter((s) => s.priority === 'high').length;
  const ownerActionCount = slips.filter((s) => s.owner_action_required).length;
  const propName = property?.name ?? 'Unknown property';
  const propertyId = property?.id ?? null;

  async function draftOwnerEmail() {
    if (!propertyId || drafting) return;
    setDrafting(true);
    setDraftErr(null);
    try {
      const res = await fetch('/api/work/draft-owner-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: propertyId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDraftErr(data?.error || `Failed (${res.status})`);
        return;
      }
      if (data?.draft_url) {
        window.open(data.draft_url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      setDraftErr(err instanceof Error ? err.message : String(err));
    } finally {
      setDrafting(false);
    }
  }

  return (
    <div style={{ borderBottom: '1px solid var(--rule)' }}>
      <div
        style={{
          display: 'flex',
          gap: 16,
          alignItems: 'baseline',
          padding: '20px 0',
          flexWrap: 'wrap',
        }}
      >
        <span
          className="font-mono"
          style={{ fontSize: 11, color: 'var(--signal)', letterSpacing: '.08em', width: 24 }}
        >
          {String(slips.length).padStart(2, '0')}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            textAlign: 'left',
            cursor: 'pointer',
            color: 'var(--ink)',
            flex: 1,
            minWidth: 160,
          }}
        >
          <span className="font-serif" style={{ fontSize: 18, fontWeight: 500 }}>
            {propName}
          </span>
        </button>
        {highCount > 0 && (
          <span
            style={{
              fontSize: 10,
              letterSpacing: '.16em',
              textTransform: 'uppercase',
              color: 'var(--negative)',
              fontWeight: 700,
            }}
          >
            {highCount} HIGH
          </span>
        )}
        {ownerActionCount > 0 && (
          <span
            title="Open items flagged for owner input"
            style={{
              fontSize: 10,
              letterSpacing: '.16em',
              textTransform: 'uppercase',
              color: 'var(--signal)',
              fontWeight: 700,
            }}
          >
            {ownerActionCount} OWNER
          </span>
        )}
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{slips.length}</span>
        {ownerActionCount > 0 && propertyId && (
          <button
            type="button"
            onClick={draftOwnerEmail}
            disabled={drafting}
            style={{
              background: 'var(--ink)',
              color: 'var(--paper)',
              border: '1px solid var(--ink)',
              padding: '4px 10px',
              fontSize: 10,
              letterSpacing: '.16em',
              textTransform: 'uppercase',
              cursor: drafting ? 'wait' : 'pointer',
              opacity: drafting ? 0.6 : 1,
            }}
          >
            {drafting ? 'Drafting…' : 'Draft Owner Email'}
          </button>
        )}
        <button
          type="button"
          onClick={onAddSlip}
          style={{
            background: 'none',
            border: '1px solid var(--rule)',
            padding: '4px 10px',
            fontSize: 10,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            cursor: 'pointer',
          }}
        >
          + Slip
        </button>
      </div>

      {draftErr && (
        <div
          style={{
            margin: '0 0 12px 56px',
            padding: '8px 12px',
            border: '1px solid var(--negative)',
            color: 'var(--negative)',
            fontSize: 12,
            background: 'rgba(200, 90, 58, 0.06)',
          }}
        >
          {draftErr}
        </div>
      )}

      {expanded && (
        <div style={{ paddingBottom: 12 }}>
          {slips.map((s) => (
            <WorkSlipRowItem key={s.id} slip={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkSlipRowItem({ slip }: { slip: WorkSlipRow }) {
  const [, startTransition] = useTransition();
  const router = useRouter();
  const isOverdue = !!slip.scheduled_date && slip.scheduled_date < new Date().toISOString().slice(0, 10);

  function markDone() {
    startTransition(async () => {
      await updateWorkSlipStatus({ id: slip.id, status: 'done' });
      router.refresh();
    });
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 0 12px 56px',
        borderTop: '1px dotted var(--rule-soft)',
      }}
    >
      <Link
        href={`/work/${slip.id}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flex: 1,
          textDecoration: 'none',
          color: 'inherit',
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background:
              slip.priority === 'high' ? 'var(--negative)' :
              slip.priority === 'normal' ? 'var(--ink-3)' :
              'var(--ink-4)',
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, color: 'var(--ink)' }}>{slip.title}</div>
          <div style={{ marginTop: 3, fontSize: 11, color: isOverdue ? 'var(--negative)' : 'var(--ink-4)', letterSpacing: '.06em' }}>
            {isOverdue && <span style={{ fontWeight: 700 }}>OVERDUE · </span>}
            {slip.assigned_to_label || (slip.assigned_to_email ? slip.assigned_to_email.split('@')[0] : 'Unclaimed')}
            {slip.location ? ` · ${slip.location}` : ''}
          </div>
        </div>
        <span style={pillTinyStyle(slip.priority === 'high' ? 'var(--negative)' : 'var(--ink-4)')}>
          {slip.priority}
        </span>
        <span style={pillTinyStyle('var(--ink-3)')}>
          {slip.status.replace('_', ' ')}
        </span>
      </Link>
      <button
        type="button"
        onClick={markDone}
        style={{
          background: 'none',
          border: '1px solid var(--rule)',
          padding: '4px 10px',
          fontSize: 10,
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          color: 'var(--positive)',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        ✓ Done
      </button>
    </div>
  );
}

function TaskRowItem({ task }: { task: TaskRow }) {
  const [, startTransition] = useTransition();
  const router = useRouter();
  const isOverdue = !!task.due_date && task.due_date < new Date().toISOString().slice(0, 10);

  function markDone() {
    startTransition(async () => {
      await updateTaskStatus({ id: task.id, status: 'done' });
      router.refresh();
    });
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 0',
        borderBottom: '1px solid var(--rule)',
      }}
    >
      <Link
        href={`/work/tasks/${task.id}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flex: 1,
          textDecoration: 'none',
          color: 'inherit',
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background:
              task.priority === 'high' ? 'var(--negative)' :
              task.priority === 'medium' ? 'var(--ink-3)' :
              'var(--ink-4)',
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, color: 'var(--ink)' }}>{task.title}</div>
          {task.description && (
            <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>{task.description}</div>
          )}
          <div style={{ marginTop: 4, fontSize: 11, color: isOverdue ? 'var(--negative)' : 'var(--ink-4)', letterSpacing: '.06em' }}>
            {isOverdue && <span style={{ fontWeight: 700 }}>OVERDUE · </span>}
            {task.assigned_to_email ? task.assigned_to_email.split('@')[0] : 'Unassigned'}
            {task.due_date ? ` · due ${task.due_date}` : ''}
          </div>
        </div>
        <span style={pillTinyStyle(task.priority === 'high' ? 'var(--negative)' : 'var(--ink-4)')}>
          {task.priority}
        </span>
        <span style={pillTinyStyle('var(--ink-3)')}>{task.status.replace('_', ' ')}</span>
      </Link>
      <button
        type="button"
        onClick={markDone}
        style={{
          background: 'none',
          border: '1px solid var(--rule)',
          padding: '4px 10px',
          fontSize: 10,
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          color: 'var(--positive)',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        ✓ Done
      </button>
    </div>
  );
}

function EmptyBlock({ message }: { message: string }) {
  return (
    <div style={{ borderTop: '1px solid var(--ink)', padding: '40px 0', textAlign: 'center' }}>
      <p style={{ color: 'var(--ink-3)' }}>{message}</p>
    </div>
  );
}

function WorkSlipModal({
  properties,
  prefillPropertyId,
  onClose,
}: {
  properties: PropertyForPicker[];
  prefillPropertyId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [propertyId, setPropertyId] = useState(prefillPropertyId ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState<WorkSlipCategory>('maintenance');
  const [priority, setPriority] = useState<WorkSlipPriority>('normal');
  const [scheduledDate, setScheduledDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await createWorkSlip({
      property_id: propertyId,
      title,
      description: description || undefined,
      location: location || undefined,
      category,
      priority,
      scheduled_date: scheduledDate || null,
    });
    if (!res.ok) {
      setError(res.error);
      setSubmitting(false);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <ModalShell title="New Work Slip" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Property *">
          <select
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            required
            style={selectStyle()}
          >
            <option value="" disabled>Pick a property…</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.title ? ` · ${p.title}` : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Title *">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Brief description of what needs to happen"
            required
            maxLength={200}
            style={inputStyle()}
          />
        </Field>

        <div className="flex gap-3">
          <div style={{ flex: 1 }}>
            <Field label="Category">
              <select value={category} onChange={(e) => setCategory(e.target.value as WorkSlipCategory)} style={selectStyle()}>
                {(Object.entries(WORK_SLIP_CATEGORY_LABELS) as [WorkSlipCategory, string][]).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Priority">
              <select value={priority} onChange={(e) => setPriority(e.target.value as WorkSlipPriority)} style={selectStyle()}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </Field>
          </div>
        </div>

        <Field label="Location (optional)">
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Kitchen, Master Bath"
            maxLength={200}
            style={inputStyle()}
          />
        </Field>

        <Field label="Scheduled date (optional)">
          <input
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            style={inputStyle()}
          />
        </Field>

        <Field label="Description (optional)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="Any extra detail…"
            style={{ ...inputStyle(), fontFamily: 'inherit', resize: 'vertical' }}
          />
        </Field>

        {error && <ErrorBlock message={error} />}

        <ModalActions onCancel={onClose} submitLabel="Create Work Slip" submitting={submitting} />
      </form>
    </ModalShell>
  );
}

function TaskModal({ properties, onClose }: { properties: PropertyForPicker[]; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<TaskScope>('corporate');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [tagsInput, setTagsInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const res = await createTask({
      title,
      description: description || undefined,
      scope,
      property_ids: scope === 'property' ? propertyIds : undefined,
      priority,
      due_date: dueDate || null,
      tags,
    });
    if (!res.ok) {
      setError(res.error);
      setSubmitting(false);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <ModalShell title="New Task" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Title *">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to happen?"
            required
            maxLength={200}
            style={inputStyle()}
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
        </div>

        {scope === 'property' && (
          <Field label="Properties">
            <select
              multiple
              value={propertyIds}
              onChange={(e) => setPropertyIds(Array.from(e.target.selectedOptions).map((o) => o.value))}
              style={{ ...selectStyle(), minHeight: 120 }}
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

        <Field label="Due date (optional)">
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            style={inputStyle()}
          />
        </Field>

        <Field label="Description (optional)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="Acceptance criteria, links, context…"
            style={{ ...inputStyle(), fontFamily: 'inherit', resize: 'vertical' }}
          />
        </Field>

        <Field label="Tags (comma-separated)">
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="e.g. marketing, hires"
            style={inputStyle()}
          />
        </Field>

        {error && <ErrorBlock message={error} />}

        <ModalActions onCancel={onClose} submitLabel="Create Task" submitting={submitting} />
      </form>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(30, 46, 52, 0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '40px 16px',
        overflowY: 'auto',
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--paper)',
          maxWidth: 520,
          width: '100%',
          padding: 28,
          border: '1px solid var(--ink)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <div className="flex items-baseline justify-between" style={{ marginBottom: 20 }}>
          <h2 className="font-serif" style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 18,
              color: 'var(--ink-3)',
              padding: '0 4px',
            }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
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

function ModalActions({ onCancel, submitLabel, submitting }: { onCancel: () => void; submitLabel: string; submitting: boolean }) {
  return (
    <div className="flex items-center justify-end gap-3" style={{ marginTop: 8, paddingTop: 16, borderTop: '1px solid var(--rule)' }}>
      <button type="button" onClick={onCancel} style={ghostBtn()} disabled={submitting}>
        Cancel
      </button>
      <button type="submit" style={primaryBtn()} disabled={submitting}>
        {submitting ? 'Saving…' : submitLabel}
      </button>
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: '10px 14px',
        borderLeft: '3px solid var(--negative)',
        background: 'var(--paper-2)',
        fontSize: 12,
        color: 'var(--negative)',
      }}
    >
      {message}
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    width: '100%',
    background: 'transparent',
    border: '1px solid var(--rule)',
    padding: '10px 12px',
    fontSize: 14,
    color: 'var(--ink)',
    outline: 'none',
  };
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

function pillTinyStyle(color: string): React.CSSProperties {
  return {
    fontSize: 9,
    letterSpacing: '.16em',
    textTransform: 'uppercase',
    fontWeight: 600,
    color,
    border: `1px solid ${color}`,
    padding: '2px 8px',
    whiteSpace: 'nowrap',
  };
}
