'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  type WorkSlipRow,
  type TaskRow,
  type WorkSlipCategory,
  type WorkSlipPriority,
  type TaskScope,
  type TaskPriority,
  WORK_SLIP_CATEGORY_LABELS,
} from '@/lib/work-types';
import {
  createWorkSlip,
  createTask,
  updateWorkSlipStatus,
  updateTaskStatus,
  bulkUpdateWorkSlips,
  bulkUpdateTasks,
} from './actions';
import { TeamPicker } from '@/components/TeamPicker';
import { displayNameForEmail } from '@/lib/team';

type PropertyForPicker = {
  id: string;
  name: string;
  title: string | null;
  city: string;
  is_active: boolean;
};

type Props = {
  workSlips: WorkSlipRow[];
  snoozedSlips: WorkSlipRow[];
  tasks: TaskRow[];
  properties: PropertyForPicker[];
  myEmail: string;
  slipCommentCounts: Record<string, number>;
  taskCommentCounts: Record<string, number>;
};

type FilterId = 'all' | 'mine' | 'high' | 'due-today' | 'unclaimed' | 'owner-action' | 'snoozed';
type TabId = 'all' | 'slips' | 'tasks';

const FILTER_IDS: FilterId[] = ['all', 'mine', 'high', 'due-today', 'unclaimed', 'owner-action', 'snoozed'];
const TAB_IDS: TabId[] = ['all', 'slips', 'tasks'];

function parseFilter(value: string | null): FilterId {
  if (!value) return 'all';
  return (FILTER_IDS as string[]).includes(value) ? (value as FilterId) : 'all';
}
function parseTab(value: string | null): TabId {
  if (!value) return 'all';
  return (TAB_IDS as string[]).includes(value) ? (value as TabId) : 'all';
}

export function QueueClient({ workSlips, snoozedSlips, tasks, properties, myEmail, slipCommentCounts, taskCommentCounts }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initialFilter = parseFilter(searchParams.get('filter'));
  const initialTab = parseTab(searchParams.get('tab'));
  const [tab, setTabState] = useState<TabId>(initialTab);
  const [filter, setFilterState] = useState<FilterId>(initialFilter);

  // Keep state in sync if the URL changes (e.g. browser back/forward, or
  // landing on the page from a deep link with a different filter/tab).
  useEffect(() => {
    const nextFilter = parseFilter(searchParams.get('filter'));
    setFilterState((curr) => (curr === nextFilter ? curr : nextFilter));
    const nextTab = parseTab(searchParams.get('tab'));
    setTabState((curr) => (curr === nextTab ? curr : nextTab));
  }, [searchParams]);

  // URL writer used by both setters. router.replace keeps the queue from
  // piling up history entries on every pill toggle.
  function writeUrl(nextFilter: FilterId, nextTab: TabId) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextFilter === 'all') params.delete('filter');
    else params.set('filter', nextFilter);
    if (nextTab === 'all') params.delete('tab');
    else params.set('tab', nextTab);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }
  function setFilter(next: FilterId) {
    setFilterState(next);
    writeUrl(next, tab);
  }
  function setTab(next: TabId) {
    setTabState(next);
    writeUrl(filter, next);
  }
  const [showSlipModal, setShowSlipModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [slipPrefillProperty, setSlipPrefillProperty] = useState<string | null>(null);

  // Selection state for bulk actions. Stored as Sets so toggle is O(1).
  // Selected ids that no longer appear in the current filter aren't pruned
  // automatically — the bulk bar still operates on them so the user doesn't
  // lose work when they tweak filters mid-triage.
  const [selectedSlipIds, setSelectedSlipIds] = useState<Set<string>>(() => new Set());
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set());
  const [bulkPending, startBulkTransition] = useTransition();
  const [bulkErr, setBulkErr] = useState<string | null>(null);

  function toggleSlip(id: string) {
    setSelectedSlipIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleTask(id: string) {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelectedSlipIds(new Set());
    setSelectedTaskIds(new Set());
    setBulkErr(null);
  }

  function runBulk(patch: {
    status?: 'done';
    priority?: WorkSlipPriority;
    assigned_to_email?: string | null;
  }) {
    setBulkErr(null);
    const slipIds = Array.from(selectedSlipIds);
    const taskIds = Array.from(selectedTaskIds);
    if (slipIds.length === 0 && taskIds.length === 0) return;

    startBulkTransition(async () => {
      const ops: Promise<{ ok: boolean; error?: string }>[] = [];
      if (slipIds.length > 0) {
        ops.push(
          bulkUpdateWorkSlips({
            ids: slipIds,
            patch: {
              status: patch.status,
              priority: patch.priority,
              assigned_to_email: patch.assigned_to_email,
            },
          }) as Promise<{ ok: boolean; error?: string }>,
        );
      }
      if (taskIds.length > 0) {
        // Tasks share priority shape with slips (low/normal/high vs low/medium/high) —
        // map normal → medium when bulk-setting from the slip-style picker.
        const taskPriority: TaskPriority | undefined =
          patch.priority === 'normal' ? 'medium' : (patch.priority as TaskPriority | undefined);
        ops.push(
          bulkUpdateTasks({
            ids: taskIds,
            patch: {
              status: patch.status,
              priority: taskPriority,
              assigned_to_email: patch.assigned_to_email,
            },
          }) as Promise<{ ok: boolean; error?: string }>,
        );
      }

      const results = await Promise.all(ops);
      const firstErr = results.find((r) => !r.ok);
      if (firstErr && firstErr.error) {
        setBulkErr(firstErr.error);
        return;
      }
      clearSelection();
      router.refresh();
    });
  }

  const propertyMap = useMemo(() => new Map(properties.map((p) => [p.id, p])), [properties]);
  const todayIso = new Date().toISOString().slice(0, 10);

  const filteredSlips = useMemo(() => {
    // Snoozed pill switches the source bucket entirely — operator wants
    // to see what they pushed off, not what's active.
    const source = filter === 'snoozed' ? snoozedSlips : workSlips;
    return source.filter((w) => {
      if (filter === 'mine' && w.assigned_to_email !== myEmail) return false;
      if (filter === 'high' && w.priority !== 'high') return false;
      if (filter === 'due-today' && w.scheduled_date !== todayIso) return false;
      if (filter === 'unclaimed' && (w.assigned_to_type !== 'unassigned' || w.assigned_to_email)) return false;
      if (filter === 'owner-action' && !w.owner_action_required) return false;
      return true;
    });
  }, [workSlips, snoozedSlips, filter, myEmail, todayIso]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (filter === 'mine' && t.assigned_to_email !== myEmail) return false;
      if (filter === 'high' && t.priority !== 'high') return false;
      if (filter === 'due-today' && t.due_date !== todayIso) return false;
      if (filter === 'unclaimed' && t.assigned_to_email) return false;
      // Slip-only filters: collapse tasks section when these are active.
      if (filter === 'owner-action') return false;
      if (filter === 'snoozed') return false;
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
    ownerAction: workSlips.filter((w) => w.owner_action_required).length,
    snoozed: snoozedSlips.length,
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
          <Pill active={filter === 'owner-action'} onClick={() => setFilter('owner-action')} label="Owner Action" count={counts.ownerAction} accent="var(--signal)" />
          <Pill active={filter === 'snoozed'} onClick={() => setFilter('snoozed')} label="Snoozed" count={counts.snoozed} accent="var(--tide-deep)" />
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
                  selectedIds={selectedSlipIds}
                  onToggleSelect={toggleSlip}
                  commentCounts={slipCommentCounts}
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
                <TaskRowItem
                  key={t.id}
                  task={t}
                  selected={selectedTaskIds.has(t.id)}
                  onToggleSelect={toggleTask}
                  commentCount={taskCommentCounts[t.id] ?? 0}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {showSlipModal && (
        <WorkSlipModal
          properties={properties.filter((p) => p.is_active)}
          prefillPropertyId={slipPrefillProperty}
          myEmail={myEmail}
          onClose={() => {
            setShowSlipModal(false);
            setSlipPrefillProperty(null);
          }}
        />
      )}
      {showTaskModal && (
        <TaskModal
          properties={properties.filter((p) => p.is_active)}
          myEmail={myEmail}
          onClose={() => setShowTaskModal(false)}
        />
      )}

      {(selectedSlipIds.size > 0 || selectedTaskIds.size > 0) && (
        <BulkActionBar
          slipCount={selectedSlipIds.size}
          taskCount={selectedTaskIds.size}
          pending={bulkPending}
          err={bulkErr}
          myEmail={myEmail}
          onClear={clearSelection}
          onMarkDone={() => runBulk({ status: 'done' })}
          onAssignToMe={() => runBulk({ assigned_to_email: myEmail })}
          onUnassign={() => runBulk({ assigned_to_email: null })}
          onSetPriority={(p) => runBulk({ priority: p })}
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
  selectedIds,
  onToggleSelect,
  commentCounts,
  onAddSlip,
}: {
  property: PropertyForPicker | null;
  slips: WorkSlipRow[];
  myEmail: string;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  commentCounts: Record<string, number>;
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
            <WorkSlipRowItem
              key={s.id}
              slip={s}
              selected={selectedIds.has(s.id)}
              onToggleSelect={onToggleSelect}
              commentCount={commentCounts[s.id] ?? 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkSlipRowItem({
  slip,
  selected,
  onToggleSelect,
  commentCount,
}: {
  slip: WorkSlipRow;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  commentCount: number;
}) {
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
        padding: '12px 0 12px 24px',
        borderTop: '1px dotted var(--rule-soft)',
        background: selected ? 'var(--paper-2)' : 'transparent',
      }}
    >
      <SelectCheckbox
        checked={selected}
        onChange={() => onToggleSelect(slip.id)}
        ariaLabel={`Select work slip ${slip.title}`}
      />
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
            {slip.assigned_to_label || (slip.assigned_to_email ? displayNameForEmail(slip.assigned_to_email) : 'Unclaimed')}
            {slip.location ? ` · ${slip.location}` : ''}
          </div>
        </div>
        {commentCount > 0 && (
          <CommentBadge count={commentCount} />
        )}
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

function TaskRowItem({
  task,
  selected,
  onToggleSelect,
  commentCount,
}: {
  task: TaskRow;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  commentCount: number;
}) {
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
        padding: '14px 0 14px 24px',
        borderBottom: '1px solid var(--rule)',
        background: selected ? 'var(--paper-2)' : 'transparent',
      }}
    >
      <SelectCheckbox
        checked={selected}
        onChange={() => onToggleSelect(task.id)}
        ariaLabel={`Select task ${task.title}`}
      />
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
            {displayNameForEmail(task.assigned_to_email)}
            {task.due_date ? ` · due ${task.due_date}` : ''}
          </div>
        </div>
        {commentCount > 0 && (
          <CommentBadge count={commentCount} />
        )}
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
  myEmail,
  onClose,
}: {
  properties: PropertyForPicker[];
  prefillPropertyId: string | null;
  myEmail: string;
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
  const [assignedToEmail, setAssignedToEmail] = useState<string | null>(null);
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
      assigned_to_email: assignedToEmail,
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

        <Field label="Assignee">
          <TeamPicker
            value={assignedToEmail}
            onChange={setAssignedToEmail}
            myEmail={myEmail}
            placeholder="Unassigned"
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

function TaskModal({
  properties,
  myEmail,
  onClose,
}: {
  properties: PropertyForPicker[];
  myEmail: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<TaskScope>('corporate');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [tagsInput, setTagsInput] = useState('');
  const [assignedToEmail, setAssignedToEmail] = useState<string | null>(null);
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
      assigned_to_email: assignedToEmail,
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

        <Field label="Assignee">
          <TeamPicker
            value={assignedToEmail}
            onChange={setAssignedToEmail}
            myEmail={myEmail}
            placeholder="Unassigned"
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

/**
 * Compact "Nc" badge surfaced on queue rows when an item has comments.
 * Editorial-style label (rule-bordered pill, "c" suffix for comment) so
 * it sits cleanly alongside the priority + status pills.
 */
function CommentBadge({ count }: { count: number }) {
  return (
    <span
      title={`${count} comment${count === 1 ? '' : 's'} on this thread`}
      style={{
        fontSize: 9,
        letterSpacing: '.04em',
        fontWeight: 600,
        color: 'var(--tide-deep)',
        border: '1px solid var(--tide-deep)',
        padding: '2px 6px',
        whiteSpace: 'nowrap',
      }}
    >
      {count}c
    </span>
  );
}

/**
 * Square checkbox styled to match Helm's editorial palette. Stops Link
 * propagation so clicking the checkbox doesn't navigate into the row.
 */
function SelectCheckbox({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      style={{
        width: 18,
        height: 18,
        flexShrink: 0,
        background: checked ? 'var(--ink)' : 'var(--paper)',
        border: `1.5px solid ${checked ? 'var(--ink)' : 'var(--rule)'}`,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        color: 'var(--paper)',
        fontSize: 12,
        lineHeight: 1,
      }}
    >
      {checked ? '✓' : ''}
    </button>
  );
}

function BulkActionBar({
  slipCount,
  taskCount,
  pending,
  err,
  myEmail,
  onClear,
  onMarkDone,
  onAssignToMe,
  onUnassign,
  onSetPriority,
}: {
  slipCount: number;
  taskCount: number;
  pending: boolean;
  err: string | null;
  myEmail: string;
  onClear: () => void;
  onMarkDone: () => void;
  onAssignToMe: () => void;
  onUnassign: () => void;
  onSetPriority: (priority: WorkSlipPriority) => void;
}) {
  const total = slipCount + taskCount;
  const summary = `${total} selected${
    slipCount && taskCount ? ` (${slipCount} slip${slipCount === 1 ? '' : 's'}, ${taskCount} task${taskCount === 1 ? '' : 's'})` : ''
  }`;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 24,
        transform: 'translateX(-50%)',
        zIndex: 70,
        background: 'var(--ink)',
        color: 'var(--paper)',
        padding: '12px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        boxShadow: '0 12px 36px rgba(30, 46, 52, 0.28)',
        maxWidth: 'calc(100vw - 32px)',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          className="font-mono"
          style={{ fontSize: 11, color: 'var(--signal)', letterSpacing: '.08em' }}
        >
          ●
        </span>
        <span style={{ fontSize: 12, letterSpacing: '.06em' }}>{summary}</span>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <BulkBtn label="Mark done" onClick={onMarkDone} disabled={pending} />
        <BulkBtn
          label="Assign to me"
          onClick={onAssignToMe}
          disabled={pending || !myEmail}
        />
        <BulkBtn label="Unassign" onClick={onUnassign} disabled={pending} />
        <BulkBtn label="High" onClick={() => onSetPriority('high')} disabled={pending} accent="var(--negative)" />
        <BulkBtn label="Normal" onClick={() => onSetPriority('normal')} disabled={pending} />
        <BulkBtn label="Low" onClick={() => onSetPriority('low')} disabled={pending} muted />
      </div>

      <button
        type="button"
        onClick={onClear}
        disabled={pending}
        style={{
          background: 'transparent',
          border: '1px solid var(--paper)',
          color: 'var(--paper)',
          padding: '6px 12px',
          fontSize: 10,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          cursor: pending ? 'wait' : 'pointer',
          opacity: pending ? 0.6 : 1,
        }}
      >
        Clear
      </button>

      {err && (
        <div
          style={{
            width: '100%',
            background: 'var(--negative)',
            color: 'var(--paper)',
            padding: '6px 10px',
            fontSize: 11,
          }}
        >
          {err}
        </div>
      )}
    </div>
  );
}

function BulkBtn({
  label,
  onClick,
  disabled,
  accent,
  muted,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: string;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: accent ? accent : 'var(--paper)',
        color: accent ? 'var(--paper)' : 'var(--ink)',
        border: `1px solid ${accent ?? 'var(--paper)'}`,
        padding: '6px 10px',
        fontSize: 10,
        letterSpacing: '.16em',
        textTransform: 'uppercase',
        fontWeight: 500,
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.6 : muted ? 0.75 : 1,
      }}
    >
      {label}
    </button>
  );
}
