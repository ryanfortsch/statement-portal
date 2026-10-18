'use client';

import { Suspense, use, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  type WorkSlipRow,
  type TaskRow,
  type WorkSlipCategory,
  type WorkSlipPriority,
  type TaskPriority,
  DEFAULT_WORK_SLIP_CATEGORY,
  OFFICE_TODO_LABEL,
  OFFICE_TODOS_LABEL,
  TASK_STATUS_LABELS,
  WORK_PRIORITIES,
  WORK_PRIORITY_LABELS,
  WORK_SLIP_CATEGORY_HINTS,
  WORK_SLIP_CATEGORY_LABELS,
  WORK_SLIP_PICKER_CATEGORIES,
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
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { useOwnerEmailDraft } from '@/lib/use-owner-email-draft';
import { CopiedEmailNotice } from '@/components/CopiedEmailNotice';
import { operatingDate } from '@/lib/operating-date';
import { compareWork, workMyWeek, workOverdue, workSignals, workThisWeek, workUnassigned } from '@/lib/work-board-view';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { groupSlipsByLane, LANE_LABELS, slipDetailLine, slipDisplayTitle, type WorkLane } from '@/lib/work-slip-lanes';
import type { WorkBriefHeadline } from '@/lib/work-briefs';
import { dismissStaleSlips, loadStaleSlips, organizePendingCount, organizeWorkNow, type StaleHomeView } from './organize-actions';
import { GLOUCESTER_TZ } from '@/lib/stable-time';

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
  /** property id -> the nightly brief's one-line headline and its date (lib/work-briefs.ts). */
  briefHeadlines?: Record<string, WorkBriefHeadline>;
  /** The view with no ?filter= (lib/work-board-view.ts defaultWorkFilter):
   *  'my-week' for a staff login, 'all' for an owner. */
  defaultFilter?: FilterId;
  /** Owners get "Review stale slips" on the Organize menu. */
  isOwner?: boolean;
  /** The session's own Gmail for Draft Owner Email, or null when Helm holds
   *  none for them (the button copies the email instead). */
  myMailbox?: string | null;
};

type FilterId = 'all' | 'my-week' | 'week' | 'overdue' | 'blocked' | 'mine' | 'high' | 'due-today' | 'unclaimed' | 'owner-action' | 'snoozed';

// The board has two faces: property work, where you land, and the office
// to-dos one tab over. A slip belongs to a house; an office to-do does not.
// The old third "All" tab stacked both sections on one page, so the thing
// you came for sat above a second full list you had to scroll past. One at
// a time. The URL keeps ?tab=tasks (the table's name) so old links land.
type TabId = 'slips' | 'tasks';

const FILTER_IDS: FilterId[] = ['all', 'my-week', 'week', 'overdue', 'blocked', 'mine', 'high', 'due-today', 'unclaimed', 'owner-action', 'snoozed'];

/** Filters that only mean anything to a work slip. On the Tasks tab they
 *  neither render nor apply, but they stay in the URL so tabbing back to
 *  Property Work restores the view you left. */
const SLIP_ONLY_FILTERS: FilterId[] = ['owner-action', 'snoozed'];

/** Blocked is a task status only. The board loads open, in-progress and
 *  scheduled slips and nothing sets a slip to blocked, so on Property Work
 *  the pill never renders and the filter reads as All. */
const TASK_ONLY_FILTERS: FilterId[] = ['blocked'];

/** The filters behind the "More" select, in its order. */
const MORE_FILTERS: FilterId[] = ['mine', 'high', 'owner-action', 'snoozed'];

/** No ?filter= is the role's default view; an unknown one reads as All. */
function parseFilter(value: string | null, fallback: FilterId = 'all'): FilterId {
  if (!value) return fallback;
  return (FILTER_IDS as string[]).includes(value) ? (value as FilterId) : 'all';
}
function parseTab(value: string | null): TabId {
  return value === 'tasks' ? 'tasks' : 'slips';
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

export function QueueClient({ workSlips, snoozedSlips, tasks, properties, myEmail, slipCommentCounts, taskCommentCounts, reporterNames, briefHeadlines = {}, defaultFilter = 'all', isOwner = false, myMailbox }: Props) {
  const router = useRouter();
  const softRefresh = useSoftRefresh();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initialFilter = parseFilter(searchParams.get('filter'), defaultFilter);
  const initialTab = parseTab(searchParams.get('tab'));
  const [tab, setTabState] = useState<TabId>(initialTab);
  const [filter, setFilterState] = useState<FilterId>(initialFilter);
  // Which property groups are expanded, mirrored to ?open= so the state
  // survives the trip into a slip and back, a browser refresh, and any
  // board remount — mid-triage you land back on the property you had open.
  const [openProps, setOpenProps] = useState<Set<string>>(() => parseOpen(searchParams.get('open')));

  // Keep state in sync if the URL changes (e.g. browser back/forward, or
  // landing on the page from a deep link with a different filter/tab).
  // Read the LIVE URL, not the useSearchParams snapshot: during the
  // revalidation a ✓ Done action arms, the hook transiently reports an
  // empty query while the address bar still shows ?open=..., and syncing
  // from that phantom snapshot collapsed every open group mid-triage
  // (verified on prod 2026-08-05). The hook stays in the dep array as the
  // change signal; window.location is the ground truth we adopt.
  useEffect(() => {
    const live = new URLSearchParams(window.location.search);
    const nextFilter = parseFilter(live.get('filter'), defaultFilter);
    setFilterState((curr) => (curr === nextFilter ? curr : nextFilter));
    const nextTab = parseTab(live.get('tab'));
    setTabState((curr) => (curr === nextTab ? curr : nextTab));
    const nextOpen = parseOpen(live.get('open'));
    setOpenProps((curr) => (sameSet(curr, nextOpen) ? curr : nextOpen));
  }, [searchParams, defaultFilter]);

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
    // The role's default view is the bare URL; anything else is spelled out,
    // so All on a staff login is ?filter=all and survives a reload.
    if (nextFilter === defaultFilter) params.delete('filter');
    else params.set('filter', nextFilter);
    if (nextTab === 'slips') params.delete('tab');
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
  // "Review stale slips" (owners): the read starts on the tap and the panel
  // reads the promise, so nothing loads until an owner asks.
  const [staleLoad, setStaleLoad] = useState<Promise<StaleLoad> | null>(null);
  function openStaleReview() {
    setStaleLoad(
      loadStaleSlips().catch(() => ({ ok: false as const, error: 'Could not read the board. Close this and try again.' })),
    );
  }
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [slipPrefillProperty, setSlipPrefillProperty] = useState<string | null>(null);

  // Selection state for bulk actions. Stored as Sets so toggle is O(1).
  // Selected ids that no longer appear in the current filter aren't pruned
  // automatically — the bulk bar still operates on them so the user doesn't
  // lose work when they tweak filters mid-triage.
  const [selectedSlipIds, setSelectedSlipIds] = useState<Set<string>>(() => new Set());
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set());
  const [bulkPending, startBulkTransition] = useTransition();
  const bulkLock = useRef(false);
  useUnsavedWorkGuard(bulkPending);
  const [bulkErr, setBulkErr] = useState<string | null>(null);

  function toggleSlip(id: string) {
    if (bulkLock.current) return;
    setSelectedSlipIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleTask(id: string) {
    if (bulkLock.current) return;
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    if (bulkLock.current) return;
    setSelectedSlipIds(new Set());
    setSelectedTaskIds(new Set());
    setBulkErr(null);
  }

  function runBulk(patch: {
    status?: 'done';
    priority?: WorkSlipPriority;
    assigned_to_email?: string | null;
  }) {
    if (bulkLock.current) return;
    const slipIds = Array.from(selectedSlipIds);
    const taskIds = Array.from(selectedTaskIds);
    if (slipIds.length === 0 && taskIds.length === 0) return;
    // A mixed selection is refused, never mapped: the bar says so in one
    // line (BulkActionBar) and every action waits for one kind.
    if (slipIds.length > 0 && taskIds.length > 0) return;
    bulkLock.current = true;
    setBulkErr(null);

    const onSlipsNow = slipIds.length > 0;
    const ids = onSlipsNow ? slipIds : taskIds;
    const label = onSlipsNow ? 'Work slips' : OFFICE_TODOS_LABEL;
    const deselect = onSlipsNow ? setSelectedSlipIds : setSelectedTaskIds;
    startBulkTransition(async () => {
      try {
        const res = onSlipsNow
          ? await bulkUpdateWorkSlips({ ids, patch })
          : await bulkUpdateTasks({ ids, patch });
        if (res.ok) {
          deselect((current) => {
            const next = new Set(current);
            for (const id of ids) next.delete(id);
            return next;
          });
        } else {
          setBulkErr(`${label}: ${res.error} They remain selected.`);
        }
      } catch {
        setBulkErr(`${label}: could not confirm the update. Check their current status before retrying. They remain selected.`);
      } finally {
        bulkLock.current = false;
        softRefresh();
      }
    });
  }

  const propertyMap = useMemo(() => new Map(properties.map((p) => [p.id, p])), [properties]);
  const todayIso = operatingDate();

  // A slip-only filter left over from the Property Work tab reads as "all"
  // over on Tasks rather than blanking the list. The URL keeps the real
  // one, so tabbing back restores it.
  const activeFilter: FilterId =
    (tab === 'tasks' && SLIP_ONLY_FILTERS.includes(filter)) || (tab === 'slips' && TASK_ONLY_FILTERS.includes(filter)) ? 'all' : filter;

  const filteredSlips = useMemo(() => {
    // Snoozed pill switches the source bucket entirely — operator wants
    // to see what they pushed off, not what's active.
    const source = activeFilter === 'snoozed' ? snoozedSlips : workSlips;
    return source.filter((w) => {
      if (activeFilter === 'my-week' && !workMyWeek(w, myEmail, todayIso)) return false;
      if (activeFilter === 'week' && !workThisWeek(w, todayIso)) return false;
      if (activeFilter === 'overdue' && !workOverdue(w, todayIso)) return false;
      if (activeFilter === 'mine' && w.assigned_to_email !== myEmail) return false;
      if (activeFilter === 'high' && w.priority !== 'high') return false;
      if (activeFilter === 'due-today' && w.scheduled_date !== todayIso) return false;
      if (activeFilter === 'unclaimed' && !workUnassigned(w)) return false;
      if (activeFilter === 'owner-action' && !w.owner_action_required) return false;
      return true;
    });
  }, [workSlips, snoozedSlips, activeFilter, myEmail, todayIso]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (activeFilter === 'my-week' && !workMyWeek(t, myEmail, todayIso)) return false;
      if (activeFilter === 'week' && !workThisWeek(t, todayIso)) return false;
      if (activeFilter === 'overdue' && !workOverdue(t, todayIso)) return false;
      if (activeFilter === 'blocked' && t.status !== 'blocked') return false;
      if (activeFilter === 'mine' && t.assigned_to_email !== myEmail) return false;
      if (activeFilter === 'high' && t.priority !== 'high') return false;
      if (activeFilter === 'due-today' && t.due_date !== todayIso) return false;
      if (activeFilter === 'unclaimed' && t.assigned_to_email) return false;
      return true;
    }).sort((a, b) => compareWork(a, b, todayIso));
  }, [tasks, activeFilter, myEmail, todayIso]);

  /** The ideal ranking: overdue, blocked, due today, then priority. What order the
   *  board WOULD be in if it re-sorted right now. */
  const rankedProperties = useMemo(() => {
    const groups = new Map<string, WorkSlipRow[]>();
    for (const ws of filteredSlips) {
      const existing = groups.get(ws.property_id);
      if (existing) existing.push(ws);
      else groups.set(ws.property_id, [ws]);
    }
    for (const [, list] of groups) {
      list.sort((a, b) => compareWork(a, b, todayIso));
    }
    return [...groups.entries()].sort((a, b) => {
      const urgency = compareWork(a[1][0], b[1][0], todayIso);
      if (urgency) return urgency;
      const an = propertyMap.get(a[0])?.name ?? a[0];
      const bn = propertyMap.get(b[0])?.name ?? b[0];
      return an.localeCompare(bn);
    });
  }, [filteredSlips, propertyMap, todayIso]);

  // ── Rank order freezes while you work ────────────────────────────────
  // The ranking is the good part; re-applying it on every ✓ Done was the
  // problem. Closing a property's last HIGH slip demoted it below every
  // property that still had one, and with INITIAL_PROPERTY_LIMIT at 5 that
  // routinely pushed the group being worked straight past the "Show more"
  // fold, so it vanished mid-triage, still expanded, while the operator was
  // holding "what's left here" in their head (Dotti, 2026-08-24).
  //
  // So the order you land on is the order you keep. It re-ranks on a
  // deliberate view change (filter or tab), on an explicit Re-sort, and on
  // a fresh page load. Never underneath a close.
  const [frozenOrder, setFrozenOrder] = useState<{ filter: FilterId; tab: TabId; ids: string[] } | null>(null);
  // Adjust-state-during-render rather than an effect: eslint's
  // react-hooks/set-state-in-effect forbids the effect version, and this
  // re-renders before paint so the board never flashes the stale order.
  if (!frozenOrder || frozenOrder.filter !== filter || frozenOrder.tab !== tab) {
    setFrozenOrder({ filter, tab, ids: rankedProperties.map(([pid]) => pid) });
  }

  const slipsByProperty = useMemo(() => {
    if (!frozenOrder) return rankedProperties;
    const slotOf = new Map(frozenOrder.ids.map((pid, i) => [pid, i]));
    // A property with no frozen slot is one that had zero matching slips
    // when the order was taken. Rather than stranding it at the bottom,
    // give it a fractional slot just after whatever it outranks in the
    // live ranking, so a newly urgent home still lands where it belongs.
    let lastSlot = -1;
    let run = 0;
    const placed = rankedProperties.map((entry) => {
      const slot = slotOf.get(entry[0]);
      if (slot !== undefined) {
        lastSlot = slot;
        run = 0;
        return { entry, key: slot };
      }
      run += 1;
      return { entry, key: lastSlot + run / (rankedProperties.length + 1) };
    });
    return placed.sort((a, b) => a.key - b.key).map((p) => p.entry);
  }, [rankedProperties, frozenOrder]);

  /** True once closing things has left the frozen order out of step with
   *  the live ranking, which is when Re-sort is worth offering. */
  const orderIsStale = useMemo(
    () => slipsByProperty.some(([pid], i) => rankedProperties[i][0] !== pid),
    [slipsByProperty, rankedProperties],
  );

  // Pill counts belong to whichever tab you're on. A combined number was
  // a lie on a board that only ever shows one list: "High Priority 5"
  // while reading Property Work now means five slips, full stop.
  const counts = useMemo(() => {
    if (tab === 'tasks') {
      return {
        ...workSignals(tasks, todayIso),
        all: tasks.length,
        myWeek: tasks.filter((t) => workMyWeek(t, myEmail, todayIso)).length,
        week: tasks.filter((t) => workThisWeek(t, todayIso)).length,
        mine: tasks.filter((t) => t.assigned_to_email === myEmail).length,
        high: tasks.filter((t) => t.priority === 'high').length,
        ownerAction: 0,
        snoozed: 0,
      };
    }
    return {
      ...workSignals(workSlips, todayIso),
      all: workSlips.length,
      myWeek: workSlips.filter((w) => workMyWeek(w, myEmail, todayIso)).length,
      week: workSlips.filter((w) => workThisWeek(w, todayIso)).length,
      mine: workSlips.filter((w) => w.assigned_to_email === myEmail).length,
      high: workSlips.filter((w) => w.priority === 'high').length,
      ownerAction: workSlips.filter((w) => w.owner_action_required).length,
      snoozed: snoozedSlips.length,
    };
  }, [tab, workSlips, snoozedSlips, tasks, myEmail, todayIso]);

  const onSlips = tab === 'slips';

  return (
    <>
      {/* The whole head of the board is two rows. No masthead: the section
          strip above already says Work / Board, and the tabs below name the
          list, so the two board faces ARE the heading — picking a tab and
          naming the list are one gesture. The create buttons ride along on
          that row instead of holding a row of their own, and the filter
          pills take the second, scoped to whichever face is up: only the
          ones with > 0 matches render, plus the selected one (so a pill
          can't vanish out from under your finger when its count hits zero),
          plus the All reset. The guest-gear matrix is reached by the Gear
          tab in the strip above, not a second link down here. */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 32, paddingBottom: 24, width: '100%' }}>
        <div className="flex items-end justify-between flex-wrap gap-4" style={{ marginBottom: 18 }}>
          <div className="flex items-end" style={{ gap: 24 }}>
            <BoardTab active={onSlips} onClick={() => setTab('slips')} label="Property Work" count={workSlips.length} />
            <BoardTab active={!onSlips} onClick={() => setTab('tasks')} label={OFFICE_TODOS_LABEL} count={tasks.length} />
          </div>
          <div className="flex items-center" style={{ gap: 12 }}>
            {/* The tab carries the total; once a filter narrows the list
                (a staff login opens on My week) this says how much of it is
                on screen, so nothing is hidden without saying so. */}
            {activeFilter !== 'all' && (
              <span className="eyebrow">
                {onSlips ? filteredSlips.length : filteredTasks.length} of {onSlips ? workSlips.length : tasks.length} shown
              </span>
            )}
            {onSlips && orderIsStale && (
              <button
                type="button"
                className="eyebrow rt-no-print"
                onClick={() => setFrozenOrder({ filter, tab, ids: rankedProperties.map(([pid]) => pid) })}
                title="Closing work changed the ranking. The board held its order so nothing moved while you were in it."
                style={{
                  background: 'none',
                  border: '1px solid var(--rule)',
                  color: 'var(--ink-3)',
                  padding: '3px 9px',
                  cursor: 'pointer',
                }}
              >
                ↕ Re-sort
              </button>
            )}
            {!onSlips && <button type="button" onClick={() => setShowTaskModal(true)} style={primaryBtn()}>
              + To-do
            </button>}
            {onSlips && <OrganizeButton onReviewStale={isOwner ? openStaleReview : undefined} />}
            {onSlips && <button type="button" onClick={() => setShowSlipModal(true)} style={primaryBtn()}>
              + Work Slip
            </button>}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap rt-work-filters" aria-label="Filter work">
          <Pill active={activeFilter === 'all'} onClick={() => setFilter('all')} label="All" count={counts.all} />
          {(counts.myWeek > 0 || activeFilter === 'my-week' || defaultFilter === 'my-week') && <Pill active={activeFilter === 'my-week'} onClick={() => setFilter('my-week')} label="My week" count={counts.myWeek} />}
          {/* Everyone's week: the home page's "Open work · this week" tile
              opens here, on the same rule (src/lib/work-week.ts). */}
          {(counts.week > 0 || activeFilter === 'week') && <Pill active={activeFilter === 'week'} onClick={() => setFilter('week')} label="This week" count={counts.week} />}
          {(counts.overdue > 0 || activeFilter === 'overdue') && <Pill active={activeFilter === 'overdue'} onClick={() => setFilter('overdue')} label="Overdue" count={counts.overdue} accent="var(--negative)" />}
          {(counts.dueToday > 0 || activeFilter === 'due-today') && <Pill active={activeFilter === 'due-today'} onClick={() => setFilter('due-today')} label="Due today" count={counts.dueToday} />}
          {!onSlips && (counts.blocked > 0 || activeFilter === 'blocked') && <Pill active={activeFilter === 'blocked'} onClick={() => setFilter('blocked')} label="Blocked" count={counts.blocked} accent="var(--signal)" />}
          {(counts.unclaimed > 0 || activeFilter === 'unclaimed') && <Pill active={activeFilter === 'unclaimed'} onClick={() => setFilter('unclaimed')} label="Unassigned" count={counts.unclaimed} />}
          {/* The first option is the way out: once a More filter is on, the
              select's own list offers All, so clearing it is one gesture
              here and not a trip to the All pill. */}
          <select aria-label="More work filters" value={MORE_FILTERS.includes(activeFilter) ? activeFilter : ''}
            onChange={e => setFilter((e.target.value || 'all') as FilterId)} style={{ ...selectStyle(), width: MORE_FILTERS.includes(activeFilter) ? 'auto' : 96, padding: '8px', fontSize: 12, minHeight: 44 }}>
            <option value="">{MORE_FILTERS.includes(activeFilter) ? 'All' : 'More'}</option>
            <option value="mine">My items ({counts.mine})</option>
            <option value="high">High priority ({counts.high})</option>
            {onSlips && <option value="owner-action">Owner action ({counts.ownerAction})</option>}
            {onSlips && <option value="snoozed">Snoozed ({counts.snoozed})</option>}
          </select>
        </div>
      </section>

      {onSlips && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%', flex: 1 }}>
          {slipsByProperty.length === 0 ? (
            <EmptyBlock
              message={
                activeFilter === 'snoozed'
                  ? 'Nothing snoozed. Snooze a slip from its detail page.'
                  : activeFilter === 'my-week'
                    ? `Nothing assigned to you is due this week. All ${workSlips.length} open slips are under All, and your undated ones under More, My items.`
                    : 'No work slips match this filter.'
              }
            />
          ) : (
            <CollapsibleList
              items={slipsByProperty}
              initial={INITIAL_PROPERTY_LIMIT}
              moreLabel={(n) => `Show ${n} more propert${n === 1 ? 'y' : 'ies'}`}
              pinnedKeys={openProps}
              renderItem={([propId, list]) => (
                <PropertyGroup
                  key={propId}
                  propId={propId}
                  property={propertyMap.get(propId) ?? null}
                  slips={list}
                  myEmail={myEmail}
                  expanded={openProps.has(propId)}
                  onToggleExpanded={() => toggleOpenProp(propId)}
                  bulkPending={bulkPending}
                  selectedIds={selectedSlipIds}
                  onToggleSelect={toggleSlip}
                  commentCounts={slipCommentCounts}
                  reporterNames={reporterNames}
                  brief={briefHeadlines[propId]}
                  myMailbox={myMailbox}
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

      {!onSlips && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%', flex: 1 }}>
          {filteredTasks.length === 0 ? (
            <EmptyBlock message="No office to-dos match this filter." />
          ) : (
            <CollapsibleList
              items={filteredTasks}
              initial={INITIAL_TASK_LIMIT}
              moreLabel={(n) => `Show ${n} more to-do${n === 1 ? '' : 's'}`}
              renderItem={(t) => (
                <TaskRowItem
                  key={t.id}
                  task={t}
                  bulkPending={bulkPending}
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
          myEmail={myEmail}
          onClose={() => setShowTaskModal(false)}
        />
      )}
      {staleLoad && <StaleReviewPanel load={staleLoad} onClose={() => setStaleLoad(null)} />}

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
  pinnedKeys,
}: {
  items: T[];
  initial: number;
  moreLabel: (n: number) => string;
  renderItem: (item: T) => React.ReactNode;
  keyFor: (item: T) => string;
  /** Items that must render in place even when they fall past `initial`.
   *  An expanded property group is the case that matters: it is the one
   *  the operator is working, and folding it away mid-triage is exactly
   *  the disappearing act this list used to pull. Shows it where it sits
   *  rather than unfurling the whole tail to reach it. */
  pinnedKeys?: Set<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded
    ? items
    : items.filter((item, i) => i < initial || !!pinnedKeys?.has(keyFor(item)));
  const hiddenCount = Math.max(0, items.length - visible.length);
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

/**
 * The board's two faces. Serif and heading-sized on purpose: this strip
 * stands where the "Property Work" and "Team Tasks" headings used to, so
 * it has to read as the name of the list beneath it, not as a third row
 * of navigation under the masthead and the Board/Maintenance/Gear strip.
 */
function BoardTab({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="font-serif rt-work-tab"
      style={{
        background: 'none',
        border: 'none',
        borderBottom: `2px solid ${active ? 'var(--signal)' : 'transparent'}`,
        padding: '0 0 6px',
        margin: 0,
        fontSize: 22,
        whiteSpace: 'nowrap',
        fontWeight: 400,
        letterSpacing: '-0.01em',
        color: active ? 'var(--ink)' : 'var(--ink-4)',
        cursor: active ? 'default' : 'pointer',
      }}
    >
      {label}
      <span
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '.1em',
          marginLeft: 8,
          verticalAlign: 'middle',
          opacity: 0.7,
        }}
      >
        {count}
      </span>
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
      aria-pressed={active}
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
      {label}
      <span style={{ opacity: 0.7, marginLeft: 4 }}>{count}</span>
    </button>
  );
}

/** "Brief · Oct 16": the day the nightly brief was written, in Eastern. */
function briefDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }).format(d);
}

function laneColor(lane: WorkLane): string {
  switch (lane) {
    case 'supply':
      return 'var(--tide-deep)';
    case 'owner':
    case 'pro':
      return 'var(--signal)';
    case 'office':
      return 'var(--ink-4)';
    default:
      return 'var(--ink-3)';
  }
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
  bulkPending = false,
  commentCounts,
  reporterNames,
  brief,
  myMailbox,
  onAddSlip,
}: {
  propId: string;
  property: PropertyForPicker | null;
  slips: WorkSlipRow[];
  /** The nightly brief's one line for this home, with its date, under the signals. */
  brief?: WorkBriefHeadline;
  myMailbox?: string | null;
  myEmail: string;
  /** Expansion is owned by QueueClient (mirrored to ?open=) so it survives
   *  navigating into a slip and back. Default collapsed: with 8+ properties
   *  × ~8 slips each, the queue is a long scroll if every group renders
   *  expanded — triage starts from the header (count, HIGH badge). */
  expanded: boolean;
  onToggleExpanded: () => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  bulkPending?: boolean;
  commentCounts: Record<string, number>;
  reporterNames: Record<string, string>;
  onAddSlip: () => void;
}) {
  const signals = workSignals(slips, operatingDate());
  const highCount = slips.filter((s) => s.priority === 'high').length;
  // No "blocked" term: a slip is never blocked (that is a task status).
  const summary = [signals.overdue && `${signals.overdue} overdue`, signals.dueToday && `${signals.dueToday} due today`, !signals.overdue && !signals.dueToday && highCount && `${highCount} high priority`, signals.unclaimed && `${signals.unclaimed} unassigned`].filter(Boolean).join(' · ');
  const ownerActionCount = slips.filter((s) => s.owner_action_required).length;
  // Lanes: restock, this visit, handyman run, pro, owner, office. The rule
  // is shared with the print sheet (lib/work-slip-lanes.ts), so what the
  // screen groups is what the paper groups. Restocks are listed once, in
  // their lane; the header used to repeat them as chips.
  const laneGroups = groupSlipsByLane(slips);
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

  const { pending: drafting, error: draftErr, draftUrl, draft: draftOwnerEmail, savedIn: draftSavedIn, copied: draftCopied } = useOwnerEmailDraft('/api/work/draft-owner-email', 'property_id', propertyId);
  const copyOwnerEmail = myMailbox === null || !!draftCopied;

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
            aria-expanded={expanded}
            aria-controls={`work-items-${propId}`}
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
              {propName}<span aria-hidden="true" style={{ marginLeft: 8, fontSize: 12 }}>{expanded ? '−' : '+'}</span>
            </span>
          </button>
          {summary && <div style={{ fontSize: 12, marginTop: 5, color: signals.overdue ? 'var(--signal)' : 'var(--ink-3)' }}>{summary}</div>}
          {/* The brief's headline: what the work at this home IS, in one
              line, so a collapsed home reads as more than a count. It
              carries its name and the day it was written, so the line is
              not an anonymous sentence. */}
          {brief && (
            <div style={{ marginTop: 6, maxWidth: 720 }}>
              <div className="eyebrow" style={{ fontSize: 10 }}>
                Brief{brief.generatedAt && briefDateLabel(brief.generatedAt) ? ` · ${briefDateLabel(brief.generatedAt)}` : ''}
              </div>
              <div style={{ fontSize: 12, marginTop: 2, color: 'var(--ink-2)', fontStyle: 'italic', lineHeight: 1.4 }}>
                {brief.headline}
              </div>
            </div>
          )}
        </div>
        {expanded && highCount > 0 && (
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
        {expanded && ownerActionCount > 0 && (
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
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{slips.length} open</span>
        {expanded && ownerActionCount > 0 && propertyId && (
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
            {drafting ? (copyOwnerEmail ? 'Copying…' : 'Drafting…') : draftUrl ? 'Open Gmail draft' : draftSavedIn ? 'Drafted' : draftCopied ? 'Copy again' : copyOwnerEmail ? 'Copy owner email' : 'Draft Owner Email'}
          </button>
        )}
        {expanded && propertyId && (
          <Link
            href={`/properties/${propertyId}`}
            prefetch={false}
            className="rt-no-print"
            title={`Open ${propName}'s property page`}
            aria-label={`Open ${propName}'s property page`}
            style={{
              background: 'none',
              border: '1px solid var(--rule)',
              padding: '4px 10px',
              fontSize: 10,
              letterSpacing: '.16em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
              textDecoration: 'none',
              lineHeight: 1.4,
            }}
          >
            Property ↗
          </Link>
        )}
        {expanded && propertyId && (
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
        {expanded && <button
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
        </button>}
      </div>

      {draftUrl && <a className="rt-no-print" href={draftUrl} target="_blank" rel="noopener noreferrer">Open saved Gmail draft</a>}
      {draftSavedIn && <span className="rt-no-print" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{draftSavedIn}</span>}
      {draftCopied && <span className="rt-no-print"><CopiedEmailNotice copied={draftCopied} /></span>}
      {draftErr && (
        <div role="alert"
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
        <div id={`work-items-${propId}`} style={{ paddingBottom: 12 }}>
          {/* One group per lane, in walk order: restock, this visit,
              handyman run, pro, owner, office. A label appears whenever
              there is more than one lane, or the only lane is not the
              routine visit (a home holding nothing but owner purchases
              should say so). Clustered slips sit adjacent inside a lane. */}
          {laneGroups.map(({ lane, slips: laneSlips }) => (
            <div key={lane}>
              {(laneGroups.length > 1 || lane !== 'visit') && (
                <SlipGroupLabel text={`${LANE_LABELS[lane]} · ${laneSlips.length}`} color={laneColor(lane)} />
              )}
              {laneSlips.map((s) => (
                <WorkSlipRowItem
                  key={s.id}
                  slip={s}
                  propertyName={propName}
                  bulkPending={bulkPending}
                  isSupply={lane === 'supply'}
                  selected={selectedIds.has(s.id)}
                  onToggleSelect={onToggleSelect}
                  commentCount={commentCounts[s.id] ?? 0}
                  reporterName={s.reported_by_contractor_id ? reporterNames[s.reported_by_contractor_id] ?? 'a field inspector' : undefined}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkSlipRowItem({
  slip,
  propertyName,
  selected,
  onToggleSelect,
  bulkPending = false,
  commentCount,
  reporterName,
  isSupply = false,
}: {
  slip: WorkSlipRow;
  /** The group's home, so "73 Rocky Neck: Fix the door" reads as "Fix the door". */
  propertyName?: string;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  bulkPending?: boolean;
  commentCount: number;
  reporterName?: string;
  isSupply?: boolean;
}) {
  const detail = isSupply ? null : slipDetailLine(slip, propertyName, 200);
  const [isPending, startTransition] = useTransition();
  const softRefresh = useSoftRefresh();
  // Optimistic removal: the row disappears the moment ✓ Done is clicked,
  // so a triage run never waits on the post-action refresh (which can take
  // seconds while the board re-renders). If the action truly fails the row
  // comes back; either way a refresh reconciles against the server. A 503
  // here usually means Vercel shed the response AFTER the update committed,
  // so the refresh clears the row even on the "failure" path.
  const [hidden, setHidden] = useState(false);
  const doneLock = useRef(false);
  const [doneError, setDoneError] = useState<string | null>(null);
  useUnsavedWorkGuard(isPending);
  const isOverdue = workOverdue(slip, operatingDate());

  function markDone() {
    if (doneLock.current || hidden || bulkPending) return;
    doneLock.current = true;
    setDoneError(null);
    setHidden(true);
    startTransition(async () => {
      try {
        const res = await updateWorkSlipStatus({ id: slip.id, status: 'done' });
        if (!res.ok) {
          setHidden(false);
          setDoneError(`Could not mark done: ${res.error}`);
        }
      } catch {
        setHidden(false);
        setDoneError('Could not confirm completion. Check the current status before retrying.');
      } finally {
        doneLock.current = false;
        softRefresh();
      }
    });
  }

  if (hidden) return null;

  return (
    <div
      className="rt-work-row"
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
          disabled={bulkPending || isPending}
          onChange={() => onToggleSelect(slip.id)}
          ariaLabel={`Select work slip ${slip.title}`}
        />
      </span>
      <Link
        href={`/work/${slip.id}`}
        prefetch={false}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flex: 1,
          minWidth: 0,
          flexWrap: 'wrap',
          textDecoration: 'none',
          color: 'inherit',
        }}
      >
        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
          <div style={{ fontSize: 14, color: 'var(--ink)' }}>{slipDisplayTitle(slip.title, propertyName)}</div>
          {doneError && <div role="alert" style={{ marginTop: 4, fontSize: 12, color: 'var(--negative)' }}>{doneError}</div>}
          {/* The detail is what you triage on — surface it right on the row
              (one clamped line, full text on hover) so you don't have to
              open the slip just to see what it's about. The line is the
              synthesized action summary when there is one, else the
              description collapsed (lib/work-slip-lanes.ts slipDetailLine),
              so a pasted review never fills the row. Assignment info
              stays, demoted to the meta line below. Supply/restock rows
              skip it: their auto-generated description is boilerplate. */}
          {detail && (
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
              {detail}
            </div>
          )}
          <div style={{ marginTop: 3, fontSize: 11, color: isOverdue ? 'var(--negative)' : 'var(--ink-4)', letterSpacing: '.06em' }}>
            {isOverdue && <span style={{ fontWeight: 700 }}>OVERDUE · </span>}
            {slip.assigned_to_label || (slip.assigned_to_email ? displayNameForEmail(slip.assigned_to_email) : slip.assigned_to_type === 'owner' ? 'Owner' : 'Unassigned')}
            {slip.scheduled_date ? ` · ${slip.scheduled_date === operatingDate() ? 'Due today' : `Scheduled ${slip.scheduled_date}`}` : ''}
            {slip.location ? ` · ${slip.location}` : ''}
            {reporterName && <span style={{ color: 'var(--tide-deep)' }}> · flagged by {reporterName}</span>}
            {slip.last_verified_open_at && (
              <span style={{ color: 'var(--positive)' }}>
                {' '}· ✓ still needed {new Date(slip.last_verified_open_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: GLOUCESTER_TZ })}
              </span>
            )}
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
          slip.priority === 'high' && <span className="rt-no-print" style={pillTinyStyle('var(--negative)')}>High</span>
        )}
        {/* Waiting on the owner: the ask (purchase, approval...) rides the
            pill so the row says what the owner email will ask for. */}
        {slip.owner_action_required && (
          <span
            className="rt-no-print"
            title={slip.owner_action_notes || 'Flagged for owner input'}
            style={pillTinyStyle('var(--signal)')}
          >
            owner{slip.owner_action_type ? ` · ${slip.owner_action_type}` : ''}
          </span>
        )}
        {/* Clustered with other slips about the same thing (organize pass). */}
        {slip.organize_group_label && (
          <span
            className="rt-no-print"
            title={`Grouped with other slips about this: ${slip.organize_group_label}`}
            style={pillTinyStyle('var(--ink-4)')}
          >
            {slip.organize_group_label}
          </span>
        )}
        {/* Who the AI-triaged fix belongs to: a handyman run or a licensed
            vendor. Inspector-scope stays quiet — that's the default fate of
            most slips (picked up on a routine stop as a ride-along). */}
        {!slip.owner_action_required && slip.category === 'maintenance' && (slip.run_scope === 'handyman' || slip.run_scope === 'pro') && (
          <span
            className="rt-no-print"
            title={slip.run_scope_note || undefined}
            style={pillTinyStyle(slip.run_scope === 'pro' ? 'var(--signal)' : 'var(--tide-deep)')}
          >
            {slip.run_scope === 'pro' ? 'vendor' : 'handyman'}
          </span>
        )}
        {slip.status !== 'open' && <span className="rt-no-print" style={pillTinyStyle(slip.status === 'blocked' ? 'var(--signal)' : 'var(--ink-3)')}>{slip.status.replace('_', ' ')}</span>}
      </Link>
      <button
        type="button"
        onClick={markDone}
        disabled={isPending || bulkPending}
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
  bulkPending = false,
  commentCount,
}: {
  task: TaskRow;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  bulkPending?: boolean;
  commentCount: number;
}) {
  const [isPending, startTransition] = useTransition();
  const softRefresh = useSoftRefresh();
  const isOverdue = !!task.due_date && task.due_date < operatingDate();
  // Same optimistic removal as WorkSlipRowItem: hide now, reconcile on
  // the refresh, restore only if the action reports a real failure.
  const [hidden, setHidden] = useState(false);
  const doneLock = useRef(false);
  const [doneError, setDoneError] = useState<string | null>(null);
  useUnsavedWorkGuard(isPending);

  function markDone() {
    if (doneLock.current || hidden || bulkPending) return;
    doneLock.current = true;
    setDoneError(null);
    setHidden(true);
    startTransition(async () => {
      try {
        const res = await updateTaskStatus({ id: task.id, status: 'done' });
        if (!res.ok) {
          setHidden(false);
          setDoneError(`Could not mark done: ${res.error}`);
        }
      } catch {
        setHidden(false);
        setDoneError('Could not confirm completion. Check the current status before retrying.');
      } finally {
        doneLock.current = false;
        softRefresh();
      }
    });
  }

  if (hidden) return null;

  return (
    <div
      className="rt-work-row"
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
        disabled={bulkPending || isPending}
        onChange={() => onToggleSelect(task.id)}
        ariaLabel={`Select to-do ${task.title}`}
      />
      <Link
        href={`/work/tasks/${task.id}`}
        prefetch={false}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flex: 1,
          minWidth: 0,
          flexWrap: 'wrap',
          textDecoration: 'none',
          color: 'inherit',
        }}
      >
        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
          <div style={{ fontSize: 14, color: 'var(--ink)' }}>{task.title}</div>
          {doneError && <div role="alert" style={{ marginTop: 4, fontSize: 12, color: 'var(--negative)' }}>{doneError}</div>}
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
            {task.assigned_to_email ? displayNameForEmail(task.assigned_to_email) : 'Unassigned'}
            {task.due_date ? ` · ${task.due_date === operatingDate() ? 'Due today' : `Due ${task.due_date}`}` : ''}
          </div>
        </div>
        {commentCount > 0 && (
          <CommentBadge count={commentCount} />
        )}
        {task.priority === 'high' && <span style={pillTinyStyle('var(--negative)')}>High</span>}
        {task.status !== 'open' && <span style={pillTinyStyle(task.status === 'blocked' ? 'var(--signal)' : 'var(--ink-3)')}>{TASK_STATUS_LABELS[task.status] ?? task.status}</span>}
      </Link>
      <button
        type="button"
        onClick={markDone}
        disabled={isPending || bulkPending}
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
  // Maintenance: a plain repair is what gets filed from the board. The
  // server's own default agrees (actions.ts createWorkSlip), so a slip filed
  // without opening "+ Details" lands in the visit lane, not under Office.
  const [category, setCategory] = useState<WorkSlipCategory>(DEFAULT_WORK_SLIP_CATEGORY);
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
  const saving = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const uploadBusy = useRef(false);
  const [uploading, setUploading] = useState(false);
  const snapshot = JSON.stringify([propertyId, title, description, location, category, priority, scheduledDate, assignedToEmail, photos]);
  const original = useRef(snapshot);
  const dirty = snapshot !== original.current;
  useUnsavedWorkGuard(dirty || submitting || uploading || uncertain);

  function requestClose() {
    if (saving.current || uploadBusy.current) return;
    if ((dirty || uncertain) && !window.confirm('Discard this unfinished work slip?')) return;
    onClose();
  }

  const showMore =
    moreOpen ||
    !!location.trim() ||
    category !== DEFAULT_WORK_SLIP_CATEGORY ||
    priority !== 'normal' ||
    !!scheduledDate ||
    assignedToEmail !== null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving.current || uploadBusy.current) return;
    saving.current = true;
    setUncertain(false);
    setError(null);
    setSubmitting(true);
    try {
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
    } catch {
      setUncertain(true);
      setError('Could not confirm whether the work slip was created. Your draft is kept. Check the work list in another tab before retrying to avoid a duplicate.');
    } finally {
      saving.current = false;
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="New Work Slip" onClose={requestClose} busy={submitting || uploading}>
      <form onSubmit={handleSubmit}>
        <fieldset disabled={submitting} className="flex flex-col gap-4" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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
                    {/* The five hand-filed categories, printed as their lane
                        words (lib/work-types.ts). vendor and ad_hoc are set
                        by packet code and never offered. */}
                    {WORK_SLIP_PICKER_CATEGORIES.map((v) => (
                      <option key={v} value={v}>{WORK_SLIP_CATEGORY_LABELS[v]}</option>
                    ))}
                  </select>
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.4 }}>{WORK_SLIP_CATEGORY_HINTS[category]}</div>
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
              onUploadingChange={(value) => { uploadBusy.current = value; setUploading(value); }}
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

        {error && <div role="alert"><ErrorBlock message={error} />{uncertain && <a href="/work" target="_blank" rel="noopener noreferrer">View saved work</a>}</div>}

        <ModalActions onCancel={requestClose} submitLabel="Create Work Slip" submitting={submitting || uploading} />
      </fieldset>
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

/**
 * New office to-do. A to-do is desk work that belongs to no house, so the
 * form asks only what one needs: what, when, who, how urgent. Work at a
 * house is a work slip (+ Work Slip on the Property Work tab).
 */
function TaskModal({
  myEmail,
  onClose,
}: {
  myEmail: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [dueDate, setDueDate] = useState('');
  const [assignedToEmail, setAssignedToEmail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const snapshot = JSON.stringify([title, description, priority, dueDate, assignedToEmail]);
  const original = useRef(snapshot);
  const dirty = snapshot !== original.current;
  useUnsavedWorkGuard(dirty || submitting || uncertain);

  function requestClose() {
    if (saving.current) return;
    if ((dirty || uncertain) && !window.confirm('Discard this unfinished to-do?')) return;
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setUncertain(false);
    setError(null);
    setSubmitting(true);
    try {
    const res = await createTask({
      title,
      description: description || undefined,
      priority,
      due_date: dueDate || null,
      assigned_to_email: assignedToEmail,
    });
    if (!res.ok) {
      setError(res.error);
      setSubmitting(false);
      return;
    }
    onClose();
    router.push(`/work/tasks/${res.id}`);
    } catch {
      setUncertain(true);
      setError('Could not confirm whether the to-do was created. Your draft is kept. Check the work list in another tab before retrying to avoid a duplicate.');
    } finally {
      saving.current = false;
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title={`New ${OFFICE_TODO_LABEL.toLowerCase()}`} onClose={requestClose} busy={submitting}>
      <form onSubmit={handleSubmit}>
        <fieldset disabled={submitting} className="flex flex-col gap-4" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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
            <Field label="Priority">
              <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} style={selectStyle()}>
                {WORK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{WORK_PRIORITY_LABELS[p]}</option>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Due date (optional)">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                style={inputStyle()}
              />
            </Field>
          </div>
        </div>

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
            placeholder="Links, context, what done looks like…"
            style={{ ...inputStyle(), fontFamily: 'inherit', resize: 'vertical' }}
          />
        </Field>

        {error && <div role="alert"><ErrorBlock message={error} />{uncertain && <a href="/work?tab=tasks" target="_blank" rel="noopener noreferrer">View saved work</a>}</div>}

        <ModalActions onCancel={requestClose} submitLabel="Create to-do" submitting={submitting} />
      </fieldset>
      </form>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, busy, children }: { title: string; onClose: () => void; busy: boolean; children: React.ReactNode }) {
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
            disabled={busy}
            aria-label="Close"
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

/** How often the Organize button asks how many slips the background pass
 *  still has to file, and how long it keeps asking. The pass itself runs
 *  under a 230-second budget (lib/organize-work-slips.ts), then rewrites
 *  the briefs. */
const ORGANIZE_POLL_MS = 10_000;
const ORGANIZE_WATCH_MS = 5 * 60_000;

/** Run the organize pass now instead of waiting for the night. The action
 *  answers at once with how many slips the pass has not seen and the model
 *  calls run after the response; the button then watches the count fall
 *  and reports on the board what it filed ("Filed 12 slips into lanes."),
 *  never "check back". */
function OrganizeButton({ onReviewStale }: { onReviewStale?: () => void }) {
  const softRefresh = useSoftRefresh();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [watching, setWatching] = useState(false);
  const lock = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useUnsavedWorkGuard(pending);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const plural = (n: number) => `${n} slip${n === 1 ? '' : 's'}`;

  /** The pass runs after the action returns. Rather than "check back", the
   *  button watches the pending count fall and, when it reaches zero (or
   *  the pass's budget is spent), says what was filed and refreshes the
   *  board so the lanes show it. */
  function watch(started: number, startedAt: number) {
    timer.current = setTimeout(async () => {
      let left = started;
      try {
        const res = await organizePendingCount();
        if (res.ok) left = res.pending;
      } catch {
        // A failed poll is not a failed pass; ask again next tick.
      }
      const filed = Math.max(0, started - left);
      if (left === 0 || Date.now() - startedAt > ORGANIZE_WATCH_MS) {
        setWatching(false);
        setNote(left === 0 ? `Filed ${plural(filed)} into lanes.` : `Filed ${filed} of ${plural(started)} into lanes. The nightly pass takes the rest.`);
        softRefresh();
        return;
      }
      if (filed > 0) setNote(`Filing… ${filed} of ${started} in lanes.`);
      watch(started, startedAt);
    }, ORGANIZE_POLL_MS);
  }

  function run() {
    if (lock.current || watching) return;
    lock.current = true;
    setNote('');
    setError('');
    startTransition(async () => {
      try {
        const res = await organizeWorkNow();
        if (!res.ok) {
          setError(res.error);
          return;
        }
        if (res.pending === 0) {
          setNote('Every open slip is already in a lane.');
        } else {
          setNote(`Filing ${plural(res.pending)} into lanes…`);
          setWatching(true);
          watch(res.pending, Date.now());
        }
        softRefresh();
      } catch {
        setError('Could not confirm the organize pass. Refresh the board before retrying.');
      } finally {
        lock.current = false;
      }
    });
  }

  return (
    <span className="rt-no-print" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      {note && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{note}</span>}
      {error && <span role="alert" style={{ fontSize: 11, color: 'var(--negative)' }}>{error}</span>}
      <button
        type="button"
        onClick={run}
        disabled={pending || watching}
        title="File new slips into lanes (this visit, handyman, pro, owner, office) and synthesize pasted reviews. Runs nightly on its own."
        style={{
          background: 'none',
          border: '1px solid var(--rule)',
          color: 'var(--ink-3)',
          padding: '8px 14px',
          fontSize: 11,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          cursor: pending || watching ? 'wait' : 'pointer',
          opacity: pending || watching ? 0.6 : 1,
        }}
      >
        {pending || watching ? 'Organizing…' : 'Organize'}
      </button>
      {/* The Organize menu: owner decisions about the board itself. */}
      {onReviewStale && (
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="More ways to organize"
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              background: 'none',
              border: '1px solid var(--rule)',
              color: 'var(--ink-3)',
              padding: '8px 10px',
              fontSize: 11,
              cursor: 'pointer',
              marginLeft: -11,
            }}
          >
            ▾
          </button>
          {menuOpen && (
            <span
              role="menu"
              style={{
                position: 'absolute',
                right: 0,
                top: 'calc(100% + 4px)',
                background: 'var(--paper)',
                border: '1px solid var(--ink)',
                boxShadow: '0 8px 24px rgba(30, 46, 52, 0.16)',
                zIndex: 40,
                minWidth: 200,
              }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onReviewStale();
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  padding: '12px 14px',
                  fontSize: 13,
                  color: 'var(--ink)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Review stale slips
              </button>
            </span>
          )}
        </span>
      )}
    </span>
  );
}

type StaleLoad = Awaited<ReturnType<typeof loadStaleSlips>>;

/** "Review stale slips": every open slip nobody has touched in 90 days,
 *  grouped by home, with Dismiss per row and per home. Nothing closes
 *  unless an owner taps (src/lib/work-stale.ts). */
function StaleReviewPanel({ load, onClose }: { load: Promise<StaleLoad>; onClose: () => void }) {
  return (
    <ModalShell title="Stale slips" onClose={onClose} busy={false}>
      <Suspense fallback={<div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '12px 0' }}>Reading the board…</div>}>
        <StaleReviewList load={load} />
      </Suspense>
    </ModalShell>
  );
}

function StaleReviewList({ load }: { load: Promise<StaleLoad> }) {
  const res = use(load);
  const softRefresh = useSoftRefresh();
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [note, setNote] = useState('');
  const locks = useRef(new Set<string>());
  useUnsavedWorkGuard(busy.size > 0);

  if (!res.ok) return <div role="alert" style={{ fontSize: 13, color: 'var(--negative)' }}>{res.error}</div>;

  const homes: StaleHomeView[] = res.homes
    .map((h) => ({ ...h, slips: h.slips.filter((s) => !gone.has(s.id)) }))
    .filter((h) => h.slips.length > 0);
  const total = homes.reduce((n, h) => n + h.slips.length, 0);

  async function dismiss(key: string, ids: string[]) {
    if (locks.current.has(key)) return;
    locks.current.add(key);
    setBusy(new Set(locks.current));
    setNote('');
    try {
      const r = await dismissStaleSlips(ids);
      if (!r.ok) {
        setNote(r.error);
        return;
      }
      setGone((prev) => new Set([...prev, ...r.dismissedIds]));
      if (r.skipped > 0) {
        setNote(`${r.skipped} ${r.skipped === 1 ? 'slip was' : 'slips were'} touched since this list loaded and stayed open.`);
      }
      softRefresh();
    } catch {
      setNote('Could not confirm the dismissal. Refresh the board before retrying.');
    } finally {
      locks.current.delete(key);
      setBusy(new Set(locks.current));
    }
  }

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 14, lineHeight: 1.5 }}>
        {total === 0
          ? `Nothing open has gone ${res.days} days without someone touching it.`
          : `${total} open ${total === 1 ? 'slip' : 'slips'} nobody has touched in ${res.days} days. Dismiss closes one without work; Reopen on the slip brings it back.`}
      </div>
      {note && <div role="status" style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 12 }}>{note}</div>}
      {homes.map((h) => {
        const homeKey = `home:${h.propertyId}`;
        const homeBusy = busy.has(homeKey);
        return (
          <section key={h.propertyId} style={{ borderTop: '1px solid var(--ink)', padding: '12px 0 4px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
              <span className="font-serif" style={{ fontSize: 17, color: 'var(--ink)' }}>{h.propertyName}</span>
              <span className="font-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{h.slips.length}</span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                disabled={homeBusy}
                onClick={() => dismiss(homeKey, h.slips.map((s) => s.id))}
                style={{ ...ghostBtn(), fontSize: 11, padding: '6px 10px' }}
              >
                {homeBusy ? 'Dismissing…' : `Dismiss all ${h.slips.length}`}
              </button>
            </div>
            {h.slips.map((s) => {
              const rowBusy = busy.has(s.id) || homeBusy;
              return (
                <div key={s.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 0', borderTop: '1px solid var(--rule)' }}>
                  <Link href={`/work/${s.id}`} style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink)', textDecoration: 'none' }}>
                    {s.title}
                  </Link>
                  <span style={{ fontSize: 11, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>
                    last touched {fmtStaleDay(s.lastTouchDay)}
                  </span>
                  <button
                    type="button"
                    disabled={rowBusy}
                    onClick={() => dismiss(s.id, [s.id])}
                    style={{ ...ghostBtn(), fontSize: 11, padding: '4px 10px' }}
                  >
                    {busy.has(s.id) ? '…' : 'Dismiss'}
                  </button>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

/** "2026-06-03" -> "Jun 3" (a year only when it is not this one). */
function fmtStaleDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const sameYear = day.slice(0, 4) === String(new Date().getFullYear());
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' });
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
  disabled = false,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
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
  // Slips and office to-dos are acted on one kind at a time. A selection
  // that holds both (picks survive a tab switch) is refused in one line
  // instead of being sent to two tables with two meanings.
  const mixed = slipCount > 0 && taskCount > 0;
  const summary = mixed
    ? `${slipCount} slip${slipCount === 1 ? '' : 's'} and ${taskCount} to-do${taskCount === 1 ? '' : 's'} selected`
    : `${total} selected`;
  const off = pending || mixed;

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
        <BulkBtn label="Mark done" onClick={onMarkDone} disabled={off} />
        <BulkBtn
          label="Assign to me"
          onClick={onAssignToMe}
          disabled={off || !myEmail}
        />
        <BulkBtn label="Unassign" onClick={onUnassign} disabled={off} />
        <BulkBtn label="High" onClick={() => onSetPriority('high')} disabled={off} accent="var(--negative)" />
        <BulkBtn label="Normal" onClick={() => onSetPriority('normal')} disabled={off} />
        <BulkBtn label="Low" onClick={() => onSetPriority('low')} disabled={off} muted />
      </div>

      {mixed && (
        <div role="status" style={{ flexBasis: '100%', fontSize: 12, color: 'var(--paper)' }}>
          Pick slips or office to-dos, not both. Untick one kind, or Clear.
        </div>
      )}

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
          role="alert"
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
