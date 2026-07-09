import Link from 'next/link';
import { auth } from '@/auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { ACTIVE_WORK_SLIP_STATUSES, ACTIVE_TASK_STATUSES } from '@/lib/work-types';
import { loadDailyBrief, type BriefEmail, type BriefInboundTouch } from '@/lib/daily-brief';
import { FeedClearButton } from '@/components/FeedClearButton';

type MyWork = {
  id: string;
  kind: 'slip' | 'task';
  title: string;
  priority: string | null;
  // Slip-side: the single property the slip is filed under.
  propertyId: string | null;
  propertyName: string | null;
  // Task-side context. Tasks can live across multiple properties (or none,
  // for "corporate" / team tasks like "Order supplies"), and the meat is
  // often in the description, not the title — so surface a one-line
  // summary + the property list + due date in the feed row.
  actionSummary?: string | null;
  dueDate?: string | null;
  propertyNames?: string[];
  scope?: string | null;
};

type PlannedWalk = {
  id: string;
  propertyName: string;
  plannedFor: string | null;
  checkinDate: string;
  notes: string | null;
};

// How many items each section shows at once. The query pulls a deeper pool,
// so clearing one item backfills the next from beyond the window.
const WORK_WINDOW = 4;
const REPLY_WINDOW = 6;
const GLANCE_WINDOW = 6;

/**
 * The "For Me" home feed: the signal worth surfacing, with the noise
 * already filtered out. Reuses the daily-brief AI triage (the same engine
 * /today renders) read from cache — no live classification on page load.
 *
 * Order of attention:
 *   1. On your plate — work slips and tasks assigned to the signed-in user.
 *   2. Needs your reply — emails the triage flagged needs_reply, plus
 *      inbound contact messages (texts/emails) still awaiting a response.
 *   3. A headingless run of glance-worthy emails (triage 'fyi') underneath.
 *
 * Each item has a × to clear it from the feed (view-only; recorded per user
 * in home_feed_dismissals). Cleared items drop out and the next from the
 * pool backfills. Notifications and promotions never reach here; the triage
 * drops them upstream.
 */
export async function ForMeFeed() {
  let needsReply: BriefEmail[] = [];
  let fyi: BriefEmail[] = [];
  let inboundWaiting: BriefInboundTouch[] = [];
  let gmailConfigured = true;

  try {
    const brief = await loadDailyBrief();
    needsReply = brief.unreadEmails.filter((e) => e.triage === 'needs_reply');
    fyi = brief.unreadEmails.filter((e) => e.triage === 'fyi');
    inboundWaiting = brief.inboundWaiting;
    gmailConfigured = brief.gmailConfigured;
  } catch {
    // Surface a graceful empty state rather than crash the home page.
    gmailConfigured = false;
  }

  const session = await auth();
  const email = session?.user?.email ?? '';
  const [{ work: allWork, mode: workMode }, dismissed, plannedWalks] = await Promise.all([
    loadMyWork(email),
    loadDismissals(email),
    loadPlannedWalks(email),
  ]);

  // Drop cleared items, then pick the window (tasks first, slips spread
  // across properties) so clearing one reveals the next.
  const workFiltered = allWork.filter((w) => !dismissed.has(`${w.kind}:${w.id}`));
  const myWork = pickForFeed(workFiltered, workMode, WORK_WINDOW);

  const emailsFiltered = needsReply.filter((e) => !dismissed.has(`email:${e.id}`));
  const inboundFiltered = inboundWaiting.filter((t) => !dismissed.has(`inbound:${inboundId(t)}`));
  const replyTotal = emailsFiltered.length + inboundFiltered.length;
  const replyEmails = emailsFiltered.slice(0, REPLY_WINDOW);
  const replyInbound = inboundFiltered.slice(0, Math.max(0, REPLY_WINDOW - replyEmails.length));

  const glance = fyi.filter((e) => !dismissed.has(`email:${e.id}`)).slice(0, GLANCE_WINDOW);

  const hasReplyItems = replyTotal > 0;
  const hasWalks = plannedWalks.length > 0;
  const nothing = !hasReplyItems && workFiltered.length === 0 && glance.length === 0 && !hasWalks;

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 24, paddingBottom: 80, width: '100%' }}>
      {nothing ? (
        <div
          style={{
            borderTop: '1px solid var(--ink)',
            padding: '32px 0',
            textAlign: 'center',
            color: 'var(--ink-3)',
            fontSize: 14,
          }}
        >
          {gmailConfigured
            ? 'All clear. Nothing on your plate and nothing needs your reply right now.'
            : 'Email triage is not configured yet.'}
          <div style={{ marginTop: 10 }}>
            <Link href="/today" style={openBriefLinkStyle}>
              Open full brief →
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* PLANNED WALKS — inspection plans assigned to you for today or
              the next few days. Sits above "On your plate" because a walk
              has a fixed clock (you have to be on the property at a specific
              time) and slips/tasks can shift. Replaces the equivalent
              section that used to live on the orphan /me page. */}
          {hasWalks && (
            <div style={{ marginBottom: 36 }}>
              <SectionHeaderLink
                href="/operations"
                title="Planned walks"
                eyebrow={`${plannedWalks.length} upcoming`}
              />
              <div style={{ borderTop: '1px solid var(--ink)' }}>
                {plannedWalks.map((w) => (
                  <PlannedWalkRow key={w.id} walk={w} />
                ))}
              </div>
            </div>
          )}

          {/* ON YOUR PLATE — work assigned to you, or unassigned work as a
              fallback when you have nothing assigned. The whole header row
              is a link to the broader view (/work filtered to "mine" or
              "unclaimed") so a click goes to the full backlog. The cleared
              feed shows 4 at a time; dismissing one revalidates the page
              and the next from the 20-item pool slides in. */}
          {myWork.length > 0 && (
            <div style={{ marginBottom: hasReplyItems ? 36 : 12 }}>
              <SectionHeaderLink
                href={workMode === 'assigned' ? '/work?filter=mine' : '/work?filter=unclaimed'}
                title={workMode === 'assigned' ? 'On your plate' : 'Unassigned work'}
                eyebrow={
                  workMode === 'assigned'
                    ? `${workFiltered.length} assigned`
                    : `${workFiltered.length} unassigned`
                }
                subline={
                  workMode === 'unassigned'
                    ? "Nothing assigned to you right now. Showing the team's unclaimed backlog."
                    : undefined
                }
              />
              <div style={{ borderTop: '1px solid var(--ink)' }}>
                {myWork.map((w) => (
                  <MyWorkRow key={`${w.kind}-${w.id}`} item={w} />
                ))}
              </div>
            </div>
          )}

          {/* NEEDS YOUR REPLY */}
          {hasReplyItems && (
            <div style={{ marginBottom: 12 }}>
              <SectionHeaderLink
                href="/today"
                title="Needs your reply"
                eyebrow={`${replyTotal} waiting`}
              />
              <div style={{ borderTop: '1px solid var(--ink)' }}>
                {replyEmails.map((e) => (
                  <EmailItem key={e.id} email={e} />
                ))}
                {replyInbound.map((t) => (
                  <InboundItem key={inboundId(t)} touch={t} />
                ))}
              </div>
            </div>
          )}

          {/* Glance-worthy mail — same items that used to live under
              "Worth a glance", now with no heading per request. */}
          {glance.length > 0 && (
            <div
              style={{
                marginTop: hasReplyItems || myWork.length > 0 ? 28 : 0,
                borderTop: '1px solid var(--rule)',
              }}
            >
              {glance.map((e) => (
                <EmailItem key={e.id} email={e} dim />
              ))}
            </div>
          )}

          <div style={{ marginTop: 24 }}>
            <Link href="/today" style={openBriefLinkStyle}>
              Open full brief →
            </Link>
          </div>
        </>
      )}
    </section>
  );
}

type WorkMode = 'assigned' | 'unassigned';

/**
 * Work for the "On your plate" section. Prefers slips and tasks assigned to
 * the signed-in user; if they have NOTHING assigned, falls back to showing
 * unassigned work (the ownerless backlog) so the section stays useful and
 * those items get seen. Active, un-snoozed, highest priority first; pulls a
 * deeper pool than the feed shows so cleared items can backfill.
 */
async function loadMyWork(email: string): Promise<{ work: MyWork[]; mode: WorkMode }> {
  try {
    const propertyNames = await loadPropertyNames();
    if (email) {
      const mine = await fetchWork({ kind: 'assigned', email }, propertyNames);
      if (mine.length > 0) return { work: mine, mode: 'assigned' };
    }
    // Nothing assigned to this user: surface unassigned work instead.
    const orphans = await fetchWork({ kind: 'unassigned' }, propertyNames);
    return { work: orphans, mode: 'unassigned' };
  } catch {
    return { work: [], mode: 'assigned' };
  }
}

/** property id -> display name, so a slip can show which property it's on. */
async function loadPropertyNames(): Promise<Map<string, string>> {
  try {
    const { data } = await supabase.from('properties').select('id, name');
    return new Map(((data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]));
  } catch {
    return new Map();
  }
}

type WorkFilter = { kind: 'assigned'; email: string } | { kind: 'unassigned' };

async function fetchWork(filter: WorkFilter, propertyNames: Map<string, string>): Promise<MyWork[]> {
  const today = new Date().toISOString().slice(0, 10);

  let slipQ = supabase
    .from('work_slips')
    .select('id, property_id, title, priority, status')
    .in('status', ACTIVE_WORK_SLIP_STATUSES)
    .or(`snoozed_until.is.null,snoozed_until.lte.${today}`)
    .order('priority', { ascending: false })
    .limit(20);
  let taskQ = supabase
    .from('tasks')
    .select('id, title, priority, status, scope, description, action_summary, due_date, property_ids')
    .in('status', ACTIVE_TASK_STATUSES)
    .order('priority', { ascending: false })
    .limit(20);

  if (filter.kind === 'assigned') {
    slipQ = slipQ.eq('assigned_to_email', filter.email);
    taskQ = taskQ.eq('assigned_to_email', filter.email);
  } else {
    slipQ = slipQ.is('assigned_to_email', null);
    taskQ = taskQ.is('assigned_to_email', null);
  }

  const [slipRes, taskRes] = await Promise.all([slipQ, taskQ]);
  const slips: MyWork[] = (
    (slipRes.data ?? []) as Array<{ id: string; property_id: string | null; title: string; priority: string | null }>
  ).map((s) => ({
    id: s.id,
    kind: 'slip',
    title: s.title,
    priority: s.priority,
    propertyId: s.property_id,
    propertyName: s.property_id ? propertyNames.get(s.property_id) ?? null : null,
  }));
  const tasks: MyWork[] = (
    (taskRes.data ?? []) as Array<{
      id: string;
      title: string;
      priority: string | null;
      scope: string | null;
      description: string | null;
      action_summary: string | null;
      due_date: string | null;
      property_ids: string[] | null;
    }>
  ).map((t) => ({
    id: t.id,
    kind: 'task',
    title: t.title,
    priority: t.priority,
    propertyId: null,
    propertyName: null,
    // action_summary is the curated one-liner when present; otherwise
    // fall back to the first non-empty line of the description so the
    // row stops reading as just a bare title ("Allie order supplies"
    // → "King pillows -17 beach extra for both main and guest house").
    actionSummary: t.action_summary?.trim() || firstNonEmptyLine(t.description),
    dueDate: t.due_date,
    scope: t.scope,
    propertyNames: (t.property_ids ?? [])
      .map((pid) => propertyNames.get(pid))
      .filter((n): n is string => !!n),
  }));
  // Tasks before slips.
  return [...tasks, ...slips];
}

function firstNonEmptyLine(s: string | null | undefined): string | null {
  if (!s) return null;
  const line = s.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  if (!line) return null;
  return line.length > 90 ? line.slice(0, 90).trimEnd() + '…' : line;
}

/**
 * Choose which work items to show. Tasks come first. In the unassigned
 * fallback, slips are spread across properties (one per property before a
 * second from any) so the list isn't several items from a single house.
 */
function pickForFeed(items: MyWork[], mode: WorkMode, limit: number): MyWork[] {
  const tasks = items.filter((i) => i.kind === 'task');
  const slips = items.filter((i) => i.kind === 'slip');

  const out: MyWork[] = tasks.slice(0, limit);
  if (out.length >= limit) return out.slice(0, limit);

  if (mode === 'assigned') {
    out.push(...slips.slice(0, limit - out.length));
    return out.slice(0, limit);
  }

  // Unassigned: round-robin slips by property so no one house dominates.
  const byProperty = new Map<string, MyWork[]>();
  for (const s of slips) {
    const key = s.propertyId ?? s.id;
    const bucket = byProperty.get(key) ?? [];
    bucket.push(s);
    byProperty.set(key, bucket);
  }
  while (out.length < limit) {
    let addedOne = false;
    for (const bucket of byProperty.values()) {
      if (out.length >= limit) break;
      const next = bucket.shift();
      if (next) {
        out.push(next);
        addedOne = true;
      }
    }
    if (!addedOne) break;
  }
  return out.slice(0, limit);
}

/** The per-user set of cleared items, keyed "type:id". */
async function loadDismissals(email: string): Promise<Set<string>> {
  if (!email) return new Set();
  try {
    const { data } = await supabase
      .from('home_feed_dismissals')
      .select('item_type, item_id')
      .eq('user_email', email);
    return new Set(
      ((data ?? []) as Array<{ item_type: string; item_id: string }>).map((d) => `${d.item_type}:${d.item_id}`),
    );
  } catch {
    // Table not applied yet, etc. Treat as nothing cleared.
    return new Set();
  }
}

function inboundId(t: BriefInboundTouch): string {
  return `${t.contactId}-${t.touchedAt}`;
}

function MyWorkRow({ item }: { item: MyWork }) {
  const isHigh = (item.priority ?? '').toLowerCase() === 'high';
  // Deep-link to the item's own page so clicking opens the slip/task itself
  // instead of dumping you on the generic board.
  const href = item.kind === 'slip' ? `/work/${item.id}` : `/work/tasks/${item.id}`;

  // Tasks live across multiple properties (or none) and the meat is often
  // in the description, so build a richer subline: action-summary, then
  // property list, then due date, then High priority. Slips stay as
  // before (single property + High priority).
  const sublineBits: React.ReactNode[] = [];
  if (item.kind === 'task') {
    if (item.actionSummary) {
      sublineBits.push(<span style={{ color: 'var(--ink-2)' }}>{item.actionSummary}</span>);
    }
    const propLabel = formatPropertyList(item.propertyNames);
    if (propLabel) sublineBits.push(<span style={{ color: 'var(--ink-3)' }}>{propLabel}</span>);
    else if (item.scope && item.scope !== 'property') {
      // Corporate / team task with no property: label it so the row
      // doesn't read as missing context.
      sublineBits.push(<span style={{ color: 'var(--ink-3)' }}>{prettyScope(item.scope)}</span>);
    }
    if (item.dueDate) sublineBits.push(<span style={{ color: 'var(--ink-3)' }}>Due {formatDueDate(item.dueDate)}</span>);
  } else if (item.propertyName) {
    sublineBits.push(<span style={{ color: 'var(--ink-3)' }}>{item.propertyName}</span>);
  }
  if (isHigh) sublineBits.push(<span style={{ color: 'var(--signal)' }}>High priority</span>);

  return (
    <div style={feedRowStyle}>
      <span aria-hidden style={{ ...dotStyle, background: isHigh ? 'var(--signal)' : 'var(--tide-deep)' }} />
      <Link href={href} style={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}>
        <div className="flex items-baseline justify-between" style={{ gap: 16 }}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--ink)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.title}
          </span>
          <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {item.kind === 'slip' ? 'Work slip' : 'Task'}
          </span>
        </div>
        {sublineBits.length > 0 && (
          <div style={{ marginTop: 3, fontSize: 11, fontWeight: 500, lineHeight: 1.4 }}>
            {sublineBits.map((bit, i) => (
              <span key={i}>
                {i > 0 && <span style={{ color: 'var(--ink-4)' }}> · </span>}
                {bit}
              </span>
            ))}
          </div>
        )}
      </Link>
      <FeedClearButton itemType={item.kind} itemId={item.id} />
    </div>
  );
}

/**
 * Clickable section header for the For Me feed. The whole header row
 * (title + count eyebrow with arrow) is one link to the broader view; an
 * optional subline sits beneath the title to explain unusual states (e.g.
 * "nothing assigned to you — showing unclaimed"). The link uses
 * inherited color so it reads as a heading, not a blue underlined link.
 */
function SectionHeaderLink({
  href,
  title,
  eyebrow,
  subline,
}: {
  href: string;
  title: string;
  eyebrow: string;
  subline?: string;
}) {
  return (
    <Link
      href={href}
      style={{ display: 'block', textDecoration: 'none', color: 'inherit', marginBottom: 12 }}
    >
      <div className="flex items-baseline justify-between">
        <h2 style={sectionHeadingStyle}>{title}</h2>
        <span className="eyebrow">{eyebrow} →</span>
      </div>
      {subline && (
        <p
          style={{
            margin: '4px 0 0',
            fontSize: 12,
            color: 'var(--ink-4)',
            fontStyle: 'italic',
          }}
        >
          {subline}
        </p>
      )}
    </Link>
  );
}

function formatPropertyList(names: string[] | undefined): string | null {
  if (!names || names.length === 0) return null;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} + 1 other`;
  return `${names[0]} + ${names.length - 1} others`;
}

function prettyScope(scope: string): string {
  if (scope === 'corporate') return 'Team';
  if (scope === 'team') return 'Team';
  return scope.charAt(0).toUpperCase() + scope.slice(1);
}

/**
 * Date-only formatter. Parses YYYY-MM-DD as local midnight (NOT UTC,
 * which would shift to the day-before in ET) and renders as "today",
 * "tomorrow", "in 3d", "2d overdue", or "Jun 4" for things further out.
 */
function formatDueDate(iso: string): string {
  const due = new Date(`${iso.slice(0, 10)}T00:00:00`);
  const todayIso = new Date().toISOString().slice(0, 10);
  const today = new Date(`${todayIso}T00:00:00`);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days <= 7) return `in ${days}d`;
  return due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function EmailItem({ email: e, dim = false }: { email: BriefEmail; dim?: boolean }) {
  const fromLabel = e.fromName || e.fromEmail || 'Unknown sender';
  const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${e.threadId}`;
  return (
    <div style={feedRowStyle}>
      <span aria-hidden style={{ ...dotStyle, background: dim ? 'var(--rule)' : 'var(--signal)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-baseline justify-between" style={{ gap: 16 }}>
          <a
            href={gmailUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--ink)',
              textDecoration: 'none',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {fromLabel}
          </a>
          <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--ink-4)' }}>{formatAge(e.ageHours)}</span>
        </div>
        <div style={{ marginTop: 3, fontSize: dim ? 13 : 14, color: dim ? 'var(--ink-3)' : 'var(--ink)', lineHeight: 1.4 }}>
          {e.triageSummary || e.subject}
        </div>
        {!dim && (
          <div className="flex items-baseline" style={{ gap: 12, marginTop: 4 }}>
            <span style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {e.subject}
            </span>
            {e.draftId && (
              <a
                href={`https://mail.google.com/mail/u/0/#drafts/${e.draftId}`}
                target="_blank"
                rel="noreferrer"
                style={{ flexShrink: 0, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--signal)', textDecoration: 'none' }}
              >
                Reply drafted →
              </a>
            )}
          </div>
        )}
      </div>
      <FeedClearButton itemType="email" itemId={e.id} />
    </div>
  );
}

function InboundItem({ touch: t }: { touch: BriefInboundTouch }) {
  const href = t.contactId ? `/crm/${t.contactId}` : '/crm';
  return (
    <div style={feedRowStyle}>
      <span aria-hidden style={{ ...dotStyle, background: 'var(--tide-deep)' }} />
      <Link href={href} style={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}>
        <div className="flex items-baseline justify-between" style={{ gap: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
            {t.contactName || 'Contact'}
            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--ink-4)', marginLeft: 8, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {t.channel}
            </span>
          </span>
          <span style={{ flexShrink: 0, fontSize: 11, color: t.daysWaiting >= 2 ? 'var(--negative)' : 'var(--ink-4)' }}>
            {t.daysWaiting === 0 ? 'today' : `${t.daysWaiting}d waiting`}
          </span>
        </div>
        <div style={{ marginTop: 3, fontSize: 14, color: 'var(--ink)', lineHeight: 1.4 }}>{t.summary}</div>
      </Link>
      <FeedClearButton itemType="inbound" itemId={inboundId(t)} />
    </div>
  );
}

/**
 * Inspection plans assigned to this user, from today forward. Pulls a small
 * window so the feed shows the upcoming few without burying the rest of the
 * page; the full schedule lives on /operations. The previous /me page surfaced
 * these too -- this is where they live now.
 */
async function loadPlannedWalks(email: string): Promise<PlannedWalk[]> {
  if (!email) return [];
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await supabase
      .from('inspection_plans')
      .select('id, property_id, planned_for_date, checkin_date, notes, properties!inner(id, name)')
      .eq('assigned_to_email', email)
      .gte('planned_for_date', today)
      .order('planned_for_date', { ascending: true })
      .limit(6);
    return ((data ?? []) as Array<{
      id: string;
      property_id: string;
      planned_for_date: string | null;
      checkin_date: string;
      notes: string | null;
      properties: { id: string; name: string } | { id: string; name: string }[] | null;
    }>).map((p) => {
      const prop = Array.isArray(p.properties) ? p.properties[0] : p.properties;
      return {
        id: p.id,
        propertyName: prop?.name ?? p.property_id,
        plannedFor: p.planned_for_date,
        checkinDate: p.checkin_date,
        notes: p.notes,
      };
    });
  } catch {
    return [];
  }
}

function PlannedWalkRow({ walk }: { walk: PlannedWalk }) {
  const today = new Date().toISOString().slice(0, 10);
  const isToday = walk.plannedFor === today;
  const isPast = !!walk.plannedFor && walk.plannedFor < today;
  const dotColor = isPast ? 'var(--negative)' : isToday ? 'var(--signal)' : 'var(--tide-deep)';
  const label = isPast ? 'overdue' : isToday ? 'today' : walk.plannedFor ?? 'upcoming';
  return (
    <Link
      href="/operations"
      style={{ ...feedRowStyle, alignItems: 'center', textDecoration: 'none', color: 'inherit' }}
    >
      <span style={{ ...dotStyle, marginTop: 0, background: dotColor }} aria-hidden="true" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: 'var(--ink)' }}>{walk.propertyName}</div>
        <div style={{ marginTop: 3, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.06em' }}>
          Walk {label} · check-in {walk.checkinDate}
          {walk.notes ? ` · ${walk.notes}` : ''}
        </div>
      </div>
    </Link>
  );
}

function formatAge(ageHours: number): string {
  if (ageHours < 1) return 'just now';
  if (ageHours < 24) return `${ageHours}h ago`;
  return `${Math.round(ageHours / 24)}d ago`;
}

const feedRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  padding: '14px 0',
  borderBottom: '1px solid var(--rule)',
  alignItems: 'flex-start',
};

const dotStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 6,
  height: 6,
  marginTop: 7,
  borderRadius: 999,
};

const sectionHeadingStyle: React.CSSProperties = {
  fontFamily: 'var(--font-fraunces)',
  fontSize: 22,
  fontWeight: 400,
  letterSpacing: '-0.01em',
  color: 'var(--ink)',
  margin: 0,
};

const openBriefLinkStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--tide-deep)',
  textDecoration: 'none',
  fontWeight: 600,
};
