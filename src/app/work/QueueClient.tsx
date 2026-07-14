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
import { PhotoUploader } from '@/components/PhotoUploader';
import { displayNameForEmail } from '@/lib/team';
import { suppliesLabel } from '@/lib/inspection-supplies';
import { useSoftRefresh } from '@/lib/use-soft-refresh';

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
  /** contractor id -> name, for slips a field inspector flagged post-visit. */
  reporterNames: Record<string, string>;
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
function parseOpen(value: string | null): Set<string> {
  return new Set((value ?? '').split(',').map((s) => s.trim()).filter(Boolean));
}
function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// Property Work and Team Tasks both dump every item by default, which
// turned the board into a wall of property names + task cards once the
// roster grew past a few. Show the most urgent N up front and tuck the
// rest behind a single expander — sorting already puts HIGH-priority
// items first, so the limit doubles as a "what needs me now" view.
const INITIAL_PROPERTY_LIMIT = 5;
const INITIAL_TASK_LIMIT = 5;

export function QueueClient({ workSlips, snoozedSlips, tasks, properties, myEmail, slipCommentCounts, taskCommentCounts, reporterNames }: Props) {
  const router = useRouter();
  const softRefresh = useSoftRefresh();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initialFilter = parseFilter(searchParams.get('filter'));
  const initialTab = parseTab(searchParams.get('tab'));
  const [tab, setTabState] = useState<TabId>(initialTab);
  const [filter, setFilterState] = useState<FilterId>(initialFilter);
  // Which property groups are expanded, mirrored to ?open= so the state
  // survives the trip into a slip and back, a browser refresh, and any
  // board remount — mid-triage you land back on the property you had open.
  const [openProps, setOpenProps] = useState<Set<string>>(() => parseOpen(searchParams.get('open')));

  // Keep state in sync if the URL changes (e.g. browser back/forward, or
  // landing on the page from a deep link with a different filter/tab).
  useEffect(() => {
    const nextFilter = parseFilter(searchParams.get('filter'));
    setFilterState((curr) => (curr === nextFilter ? curr : nextFilter));
    const nextTab = parseTab(searchParams.get('tab'));
    setTabState((curr) => (curr === nextTab ? curr : nextTab));
    const nextOpen = parseOpen(searchParams.get('open'));
    setOpenProps((curr) => (sameSet(curr, nextOpen) ? curr : nextOpen));
  }, [searchParams]);

  // Landing from a slip's "← All Work" link (/work?open=X#prop-X): the
  // loading skeleton means the browser's native anchor scroll fires before
  // the real board exists, so scroll to the group once it has mounted.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith('#prop-')) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, []);

  // Remember the board's full URL (filter + tab + open groups) so the slip
  // detail page's "← All Work" link can bring you back to this exact view
  // instead of a fresh board. Session-scoped on purpose.
  useEffect(() => {
    sessionStorage.setItem('helm:work-board-url', window.location.pathname + window.location.search);
  }, [searchParams]);

  // URL writer used by both setters. router.replace keeps the queue from
  // piling up history entries on every pill toggle. Reads the LIVE URL
  // (not the useSearchParams snapshot) so a pill click right after a group
  // toggle can't rebuild the query from a stale snapshot and drop ?open=.
  function writeUrl(nextFilter: FilterId, nextTab: TabId) {
    const params = new URLSearchParams(window.location.search);
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
  // Mirrors the expanded set to ?open=, same idiom as writeUrl above.
  // Deliberately router.replace and NOT window.history.replaceState: a raw
  // replaceState leaves the router's canonical URL behind, and the next
  // server-action revalidation (e.g. ✓ Done) then treats its refresh as a
  // real navigation to the "changed" URL and scrolls to the top — the
  // exact yank this board just got rid of. Verified empirically on 16.2.4.
  function toggleOpenProp(propId: string) {
    const next = new Set(openProps);
    if (next.has(propId)) next.delete(propId);
    else next.add(propId);
    setOpenProps(next);
    const params = new URLSearchParams(window.location.search);
    if (next.size === 0) params.delete('open');
    else params.set('open', [...next].join(','));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
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
      softRefresh();
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
      // Surface urgency first so the page reads as "what needs me today"
      // rather than "biggest backlog wins": HIGH slips beat owner-action
      // beats raw count, then alpha-by-name as the tiebreaker.
      const highA = a[1].filter((s) => s.priority === 'high').length;
      const highB = b[1].filter((s) => s.priority === 'high').length;
      if (highA !== highB) return highB - highA;
      const ownerA = a[1].filter((s) => s.owner_action_required).length;
      const ownerB = b[1].filter((s) => s.owner_action_required).length;
      if (ownerA !== ownerB) return ownerB - ownerA;
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

      {/* Filter pills: only render the ones with > 0 matches, plus the
          currently-selected filter (so a pill doesn't disappear out from
          under your finger when its count drops to zero), plus the All
          reset. On a typical day 5 of 7 filters are empty - rendering
          them as full pill buttons was visual weight that didn't earn
          its keep. */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 28, width: '100%' }}>
        <div className="flex items-center gap-2 flex-wrap">
          <Pill active={filter === 'all'} onClick={() => setFilter('all')} label="All" count={counts.all} />
          {(counts.mine > 0 || filter === 'mine') && (
            <Pill active={filter === 'mine'} onClick={() => setFilter('mine')} label="My Items" count={counts.mine} />
          )}
          {(counts.high > 0 || filter === 'high') && (
            <Pill active={filter === 'high'} onClick={() => setFilter('high')} label="High Priority" count={counts.high} accent="var(--negative)" />
          )}
          {(counts.dueToday > 0 || filter === 'due-today') && (
            <Pill active={filter === 'due-today'} onClick={() => setFilter('due-today')} label="Due Today" count={counts.dueToday} accent="var(--signal)" />
          )}
          {(counts.unclaimed > 0 || filter === 'unclaimed') && (
            <Pill active={filter === 'unclaimed'} onClick={() => setFilter('unclaimed')} label="Unclaimed" count={counts.unclaimed} />
          )}
          {(counts.ownerAction > 0 || filter === 'owner-action') && (
            <Pill active={filter === 'owner-action'} onClick={() => setFilter('owner-action')} label="Owner Action" count={counts.ownerAction} accent="var(--signal)" />
          )}
          {(counts.snoozed > 0 || filter === 'snoozed') && (
            <Pill active={filter === 'snoozed'} onClick={() => setFilter('snoozed')} label="Snoozed" count={counts.snoozed} accent="var(--tide-deep)" />
          )}
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
            <CollapsibleList
              items={slipsByProperty}
              initial={INITIAL_PROPERTY_LIMIT}
              moreLabel={(n) => `Show ${n} more propert${n === 1 ? 'y' : 'ies'}`}
              defaultExpanded={slipsByProperty.slice(INITIAL_PROPERTY_LIMIT).some(([pid]) => openProps.has(pid))}
              renderItem={([propId, list]) => (
                <PropertyGroup
                  key={propId}
                  propId={propId}
                  property={propertyMap.get(propId) ?? null}
                  slips={list}
                  myEmail={myEmail}
                  expanded={openProps.has(propId)}
                  onToggleExpanded={() => toggleOpenProp(propId)}
                  selectedIds={selectedSlipIds}
                  onToggleSelect={toggleSlip}
                  commentCounts={slipCommentCounts}
                  reporterNames={reporterNames}
                  onAddSlip={() => {
                    setSlipPrefillProperty(propId);
                    setShowSlipModal(true);
                  }}
                />
              )}
              keyFor={([propId]) => propId}
            />
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
            <CollapsibleList
              items={filteredTasks}
              initial={INITIAL_TASK_LIMIT}
              moreLabel={(n) => `Show ${n} more task${n === 1 ? '' : 's'}`}
              renderItem={(t) => (
                <TaskRowItem
                  key={t.id}
                  task={t}
                  selected={selectedTaskIds.has(t.id)}
                  onToggleSelect={toggleTask}
                  commentCount={taskCommentCounts[t.id] ?? 0}
                />
              )}
              keyFor={(t) => t.id}
            />
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

/**
 * Render the first `initial` items, then a single "Show N more" expander
 * (or "Show less" when expanded). Keeps the board scannable while still
 * giving access to the long tail. Used for both Property Work and Team
 * Tasks - the data shape is generic so callers pass renderItem / keyFor.
 */
function CollapsibleList<T>({
  items,
  initial,
  moreLabel,
  renderItem,
  keyFor,
  defaultExpanded = false,
}: {
  items: T[];
  initial: number;
  moreLabel: (n: number) => string;
  renderItem: (item: T) => React.ReactNode;
  keyFor: (item: T) => string;
  /** Start with the tail shown — e.g. when a ?open= property group would
   *  otherwise be hidden behind the "Show more" fold on a return visit. */
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const visible = expanded ? items : items.slice(0, initial);
  const hiddenCount = Math.max(0, items.length - initial);
  return (
    <div style={{ borderTop: '1px solid var(--ink)' }}>
      {visible.map((item) => (
        <div key={keyFor(item)}>{renderItem(item)}</div>
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          style={{
            width: '100%',
            background: 'none',
            border: 'none',
            borderBottom: '1px solid var(--rule)',
            padding: '14px 0',
            fontSize: 11,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            fontWeight: 500,
            color: 'var(--ink-3)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          {expanded ? '↑ Show less' : `↓ ${moreLabel(hiddenCount)}`}
        </button>
      )}
    </div>
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

/**
 * Inventory vs. work. Three ways a slip counts as inventory:
 *   1. category 'inventory' — picked on the New Work Slip form.
 *   2. from_supply_key — auto-created by the inspection Supplies Check.
 *   3. legacy 'rising_tide' titled "Restock: …" — pre-dates the
 *      inventory category, kept so old hand-entered restocks still land
 *      on the supplies side of the board instead of among the repairs.
 */
function isSupplySlip(s: WorkSlipRow): boolean {
  return (
    s.category === 'inventory' ||
    !!s.from_supply_key ||
    (s.category === 'rising_tide' && /^restock:\s/i.test(s.title))
  );
}

function supplyChipLabel(s: WorkSlipRow): string {
  if (s.from_supply_key) return suppliesLabel(s.from_supply_key);
  return s.title.replace(/^restock:\s*/i, '').trim() || s.title;
}

/** Names shown on the glance line before collapsing into "+N". */
const GLANCE_SUPPLY_LIMIT = 2;

function SupplyChip({ label, title }: { label: string; title?: string }) {
  return (
    <span
      title={title}
      style={{
        fontSize: 11,
        color: 'var(--tide-deep)',
        border: '1px solid var(--tide)',
        background: 'rgba(78, 124, 158, 0.10)',
        padding: '2px 8px',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function SlipGroupLabel({ text, color }: { text: string; color: string }) {
  return (
    <div
      style={{
        padding: '10px 0 4px 24px',
        fontSize: 10,
        letterSpacing: '.16em',
        textTransform: 'uppercase',
        fontWeight: 700,
        color,
      }}
    >
      {text}
    </div>
  );
}

function PropertyGroup({
  propId,
  property,
  slips,
  expanded,
  onToggleExpanded,
  selectedIds,
  onToggleSelect,
  commentCounts,
  reporterNames,
  onAddSlip,
}: {
  propId: string;
  property: PropertyForPicker | null;
  slips: WorkSlipRow[];
  myEmail: string;
  /** Expansion is owned by QueueClient (mirrored to ?open=) so it survives
   *  navigating into a slip and back. Default collapsed: with 8+ properties
   *  × ~8 slips each, the queue is a long scroll if every group renders
   *  expanded — triage starts from the header (count, HIGH badge). */
  expanded: boolean;
  onToggleExpanded: () => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  commentCounts: Record<string, number>;
  reporterNames: Record<string, string>;
  onAddSlip: () => void;
}) {
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const highCount = slips.filter((s) => s.priority === 'high').length;
  const ownerActionCount = slips.filter((s) => s.owner_action_required).length;
  const supplySlips = slips.filter(isSupplySlip);
  const workSlips = slips.filter((s) => !isSupplySlip(s));
  // The same supply can be flagged low at two inspections before anyone
  // shops — one chip on the glance line, not two.
  const supplyNames = [...new Set(supplySlips.map(supplyChipLabel))];
  const propName = property?.name ?? 'Unknown property';
  const propertyId = property?.id ?? null;

  function printPropertyWork() {
    if (!propertyId) return;
    // Hand off to the dedicated print route — a real server-rendered
    // checklist sheet that fits a tight single page. ?auto=1 fires the
    // print dialog on load. The old in-place approach (overlay this
    // group via @media print) squeezed the title to a sliver and left
    // the rest of the board generating blank pages.
    window.open(`/properties/${propertyId}/work-slips/print?auto=1`, '_blank', 'noopener,noreferrer');
  }

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
    // Anchor target for /work?open=X#prop-X (the slip page's back link);
    // scrollMarginTop keeps the header clear of the masthead on landing.
    <div id={`prop-${propId}`} style={{ borderBottom: '1px solid var(--rule)', scrollMarginTop: 96 }}>
      <div
        style={{
          display: 'flex',
          gap: 16,
          alignItems: 'baseline',
          padding: '20px 0',
          flexWrap: 'wrap',
        }}
      >
        {/* The leading mono "07" used to render here as the slip count
            padded to two digits. It looked like a stable property rank
            but was actually duplicating the count that already appears
            on the right side of the row (next to + SLIP). Dropped. */}
        <div style={{ flex: 1, minWidth: 160 }}>
          <button
            type="button"
            onClick={onToggleExpanded}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              textAlign: 'left',
              cursor: 'pointer',
              color: 'var(--ink)',
              display: 'block',
            }}
          >
            <span className="font-serif" style={{ fontSize: 18, fontWeight: 500 }}>
              {propName}
            </span>
          </button>
          {/* Inventory at a glance: which supplies this property needs,
              readable without expanding the group. Open restock slips
              drive it, so checking one off clears its chip. */}
          {supplyNames.length > 0 && (
            <div
              className="rt-no-print"
              style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}
            >
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                  color: 'var(--tide-deep)',
                }}
              >
                Supplies
              </span>
              {supplyNames.slice(0, GLANCE_SUPPLY_LIMIT).map((name) => (
                <SupplyChip key={name} label={name} />
              ))}
              {supplyNames.length > GLANCE_SUPPLY_LIMIT && (
                <SupplyChip
                  label={`+${supplyNames.length - GLANCE_SUPPLY_LIMIT}`}
                  title={supplyNames.slice(GLANCE_SUPPLY_LIMIT).join(', ')}
                />
              )}
            </div>
          )}
        </div>
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
            className="rt-no-print"
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
        {propertyId && (
          <button
            type="button"
            onClick={printPropertyWork}
            className="rt-no-print"
            title={`Print ${propName} work list`}
            aria-label={`Print ${propName} work list`}
            style={{
              background: 'none',
              border: '1px solid var(--rule)',
              padding: '4px 8px',
              fontSize: 12,
              color: 'var(--ink-3)',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            🖨
          </button>
        )}
        <button
          type="button"
          onClick={onAddSlip}
          className="rt-no-print"
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
          {/* Inventory first, then work, with group labels whenever the
              property has restocks — keeps a shopping run and a repair
              visit from reading as one undifferentiated list. The
              labels print too: the paper checklist gets the same
              restock-vs-work split as the screen. */}
          {supplySlips.length > 0 && (
            <SlipGroupLabel text={`Needs restock · ${supplySlips.length}`} color="var(--tide-deep)" />
          )}
          {supplySlips.map((s) => (
            <WorkSlipRowItem
              key={s.id}
              slip={s}
              isSupply
              selected={selectedIds.has(s.id)}
              onToggleSelect={onToggleSelect}
              commentCount={commentCounts[s.id] ?? 0}
              reporterName={s.reported_by_contractor_id ? reporterNames[s.reported_by_contractor_id] ?? 'a field inspector' : undefined}
            />
          ))}
          {supplySlips.length > 0 && workSlips.length > 0 && (
            <SlipGroupLabel text={`Work · ${workSlips.length}`} color="var(--ink-4)" />
          )}
          {workSlips.map((s) => (
            <WorkSlipRowItem
              key={s.id}
              slip={s}
              selected={selectedIds.has(s.id)}
              onToggleSelect={onToggleSelect}
              commentCount={commentCounts[s.id] ?? 0}
              reporterName={s.reported_by_contractor_id ? reporterNames[s.reported_by_contractor_id] ?? 'a field inspector' : undefined}
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
  reporterName,
  isSupply = false,
}: {
  slip: WorkSlipRow;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  commentCount: number;
  reporterName?: string;
  isSupply?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const softRefresh = useSoftRefresh();
  const isOverdue = !!slip.scheduled_date && slip.scheduled_date < new Date().toISOString().slice(0, 10);

  function markDone() {
    startTransition(async () => {
      await updateWorkSlipStatus({ id: slip.id, status: 'done' });
      softRefresh();
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
      <span className="rt-no-print">
        <SelectCheckbox
          checked={selected}
          onChange={() => onToggleSelect(slip.id)}
          ariaLabel={`Select work slip ${slip.title}`}
        />
      </span>
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
              isSupply ? 'var(--tide)' :
              slip.priority === 'normal' ? 'var(--ink-3)' :
              'var(--ink-4)',
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, color: 'var(--ink)' }}>{slip.title}</div>
          {/* The detail is what you triage on — surface it right on the row
              (one clamped line, full text on hover) so you don't have to
              open the slip just to see what it's about. Assignment info
              stays, demoted to the meta line below. Supply/restock rows
              skip it: their auto-generated description is boilerplate. */}
          {!isSupply && (slip.action_summary || slip.description) && (
            <div
              style={{
                marginTop: 3,
                fontSize: 12,
                color: 'var(--ink-3)',
                display: '-webkit-box',
                WebkitLineClamp: 1,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={slip.action_summary || slip.description || undefined}
            >
              {slip.action_summary || slip.description}
            </div>
          )}
          <div style={{ marginTop: 3, fontSize: 11, color: isOverdue ? 'var(--negative)' : 'var(--ink-4)', letterSpacing: '.06em' }}>
            {isOverdue && <span style={{ fontWeight: 700 }}>OVERDUE · </span>}
            {slip.assigned_to_label || (slip.assigned_to_email ? displayNameForEmail(slip.assigned_to_email) : 'Unclaimed')}
            {slip.location ? ` · ${slip.location}` : ''}
            {reporterName && <span style={{ color: 'var(--tide-deep)' }}> · flagged by {reporterName}</span>}
          </div>
        </div>
        {commentCount > 0 && (
          <span className="rt-no-print"><CommentBadge count={commentCount} /></span>
        )}
        {/* Supply rows trade the priority pill for a supply pill — every
            restock is priority normal, so the pill said nothing. A
            hand-bumped high restock keeps its high pill alongside. */}
        {isSupply ? (
          <>
            {slip.priority === 'high' && (
              <span className="rt-no-print" style={pillTinyStyle('var(--negative)')}>high</span>
            )}
            <span className="rt-no-print" style={pillTinyStyle('var(--tide-deep)')}>supply</span>
          </>
        ) : (
          <span className="rt-no-print" style={pillTinyStyle(slip.priority === 'high' ? 'var(--negative)' : 'var(--ink-4)')}>
            {slip.priority}
          </span>
        )}
        <span className="rt-no-print" style={pillTinyStyle('var(--ink-3)')}>
          {slip.status.replace('_', ' ')}
        </span>
      </Link>
      <button
        type="button"
        onClick={markDone}
        disabled={isPending}
        className="rt-no-print"
        style={{
          background: 'none',
          border: '1px solid var(--rule)',
          padding: '4px 10px',
          fontSize: 10,
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          color: 'var(--positive)',
          cursor: isPending ? 'wait' : 'pointer',
          opacity: isPending ? 0.6 : 1,
          flexShrink: 0,
        }}
      >
        {isPending ? 'Saving…' : '✓ Done'}
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
  const [isPending, startTransition] = useTransition();
  const softRefresh = useSoftRefresh();
  const isOverdue = !!task.due_date && task.due_date < new Date().toISOString().slice(0, 10);

  function markDone() {
    startTransition(async () => {
      await updateTaskStatus({ id: task.id, status: 'done' });
      softRefresh();
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
            <div
              style={{
                marginTop: 3,
                fontSize: 12,
                color: 'var(--ink-3)',
                display: '-webkit-box',
                WebkitLineClamp: 1,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={task.description}
            >
              {task.description}
            </div>
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
        disabled={isPending}
        style={{
          background: 'none',
          border: '1px solid var(--rule)',
          padding: '4px 10px',
          fontSize: 10,
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          color: 'var(--positive)',
          cursor: isPending ? 'wait' : 'pointer',
          opacity: isPending ? 0.6 : 1,
          flexShrink: 0,
        }}
      >
        {isPending ? 'Saving…' : '✓ Done'}
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
  const [category, setCategory] = useState<WorkSlipCategory>('rising_tide');
  const [priority, setPriority] = useState<WorkSlipPriority>('normal');
  const [scheduledDate, setScheduledDate] = useState('');
  // Assignee defaults to Unassigned — creator identity is captured
  // server-side (created_by_email) so we know who filed it, but the
  // slip lands in the team backlog by default rather than auto-claiming
  // for whoever happens to be creating it.
  const [assignedToEmail, setAssignedToEmail] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  // Everything except Property / Title / Description lives behind the
  // "+ Details" inline link, mirroring the inspection Work Slip modal:
  // the defaults are right for the vast majority of slips filed from
  // the board, so the form fits on a phone with the keyboard open. The
  // panel auto-expands if any of its fields drifted off the defaults
  // (e.g. reopening the panel after arming Priority=High).
  const [moreOpen, setMoreOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showMore =
    moreOpen ||
    !!location.trim() ||
    category !== 'rising_tide' ||
    priority !== 'normal' ||
    !!scheduledDate ||
    assignedToEmail !== null;

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
      photo_urls: photos,
    });
    if (!res.ok) {
      setError(res.error);
      setSubmitting(false);
      return;
    }
    onClose();
    router.push(`/work/${res.id}`);
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
                {p.name}
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

        <Field label="Description (optional)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Any extra detail…"
            style={{ ...inputStyle(), fontFamily: 'inherit', resize: 'vertical' }}
          />
        </Field>

        {/* Inline "+ Details" / "+ Photo" toggles — the whole point of
            this simplification is that neither has to be visible for the
            common case, but both are one tap away. */}
        {!showMore && !(photosOpen || photos.length > 0) && (
          <div style={{ display: 'flex', gap: 18 }}>
            <button type="button" onClick={() => setMoreOpen(true)} style={inlineLinkStyle}>
              + Details
            </button>
            <button type="button" onClick={() => setPhotosOpen(true)} style={inlineLinkStyle}>
              + Photo
            </button>
          </div>
        )}

        {showMore && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-3">
              <div style={{ flex: 1 }}>
                <Field label="Category">
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as WorkSlipCategory)}
                    style={selectStyle()}
                  >
                    {(Object.entries(WORK_SLIP_CATEGORY_LABELS) as [WorkSlipCategory, string][]).map(
                      ([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ),
                    )}
                  </select>
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Priority">
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as WorkSlipPriority)}
                    style={selectStyle()}
                  >
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

            {!photosOpen && photos.length === 0 && (
              <div>
                <button type="button" onClick={() => setPhotosOpen(true)} style={inlineLinkStyle}>
                  + Photo
                </button>
              </div>
            )}
          </div>
        )}

        {(photosOpen || photos.length > 0) && (
          <Field label="Photos">
            <PhotoUploader
              value={photos}
              onChange={setPhotos}
              folder="work_slips"
              disabled={submitting}
            />
            {!showMore && (
              <div style={{ marginTop: 10 }}>
                <button type="button" onClick={() => setMoreOpen(true)} style={inlineLinkStyle}>
                  + Details
                </button>
              </div>
            )}
          </Field>
        )}

        {error && <ErrorBlock message={error} />}

        <ModalActions onCancel={onClose} submitLabel="Create Work Slip" submitting={submitting} />
      </form>
    </ModalShell>
  );
}

const inlineLinkStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  color: 'var(--ink-3)',
  textDecoration: 'underline',
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: 'inherit',
};

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
    router.push(`/work/tasks/${res.id}`);
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
