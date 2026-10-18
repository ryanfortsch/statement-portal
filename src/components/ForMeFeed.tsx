import Link from 'next/link';
import { auth } from '@/auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { ACTIVE_WORK_SLIP_STATUSES, ACTIVE_TASK_STATUSES } from '@/lib/work-types';
import { loadDailyBrief, type BriefEmail, type BriefInboundTouch, type BriefCleaningFlag, type BriefInspection, type BriefStay } from '@/lib/daily-brief';
import { fieldDb, isFieldConfigured } from '@/lib/field-db';
import { loadShootBoard, shootPaySummary } from '@/lib/creative-shoots';
import { dollars } from '@/lib/field-types';
import { FeedClearButton } from '@/components/FeedClearButton';
import { listRecentPaymentLinks, type PaymentLinkRow } from '@/lib/payment-links';
import { ageLabel, LINK_LOOKBACK_DAYS, money, paymentLinkStatus, stripeKeyFixUrl } from '@/lib/payment-links-text';
import { PaymentLinkActions } from '@/app/messaging/send/PaymentLinkActions';
import { loadMeetingCards } from '@/lib/meetings';
import { meetingWhen, todayET, type MeetingCard } from '@/lib/meetings-core';
import { operatingDate } from '@/lib/operating-date';
import { checkoutBoardHref } from '@/lib/turnover-board';
import { roleForEmail, roleMayOpen } from '@/lib/helm-access';
import { canOpenMailbox, gmailUrl } from '@/lib/gmail-links';
import { dueWording, handoffMonths, inNagWindow, monthName } from '@/lib/close-handoff';
import { loadHandoffItems } from '@/lib/close-handoff-db';
import { loadOwnerHoldQuestions, type OwnerHoldQuestionCard } from '@/lib/owner-hold-questions';
import { HoldRow } from '@/app/cleaner-messaging/OwnerHoldQuestionsCard';
import { homeFeedOrder, windowPayments, type FeedSection } from '@/lib/home-feed-order';

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

// One line per operator queue with work stacked up (creative pay, field
// packets, unsent statements). No clear button: a queue card clears itself
// the moment its count reads zero, so dismissing it would just mask pressure.
type QueueCard = {
  id: string;
  href: string;
  text: string;
};

type PlannedWalk = {
  id: string;
  propertyId: string;
  propertyName: string;
  /** The stay the walk preps for: with the property id it names the
   *  pipeline row's anchor (#turnover-<pid>-<rid>). */
  reservationId: string | null;
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
 * The "For Me" home feed: the signed-in person's day, in the order it is
 * worked (lib/home-feed-order.ts). My work, walks and meetings; then what is
 * waiting on my reply; then the clock-bound team items (an owner block's
 * "clean after?", a cleaning to check) and the team's unassigned work; then
 * the office queues; then guest payments. Owners keep the "clean after?"
 * card first. The mail is the daily-brief triage read from cache, with no
 * live classification on page load.
 *
 * One × with one meaning: it hides a row from your own feed and changes
 * nothing else (recorded per user in home_feed_dismissals), and the next
 * from the pool backfills. A card that clears by being answered (an owner
 * block, a cleaning flag, an office queue, a Stripe key to fix) has no ×.
 */
export async function ForMeFeed() {
  let needsReply: BriefEmail[] = [];
  let fyi: BriefEmail[] = [];
  let inboundWaiting: BriefInboundTouch[] = [];
  let cleaningFlags: BriefCleaningFlag[] = [];
  let houses: TodayAtTheHouses = { out: [], in: [], walked: [] };
  let gmailConfigured = true;
  let gmailMailbox: string | null = null;

  try {
    const brief = await loadDailyBrief();
    needsReply = brief.unreadEmails.filter((e) => e.triage === 'needs_reply');
    fyi = brief.unreadEmails.filter((e) => e.triage === 'fyi');
    inboundWaiting = brief.inboundWaiting;
    cleaningFlags = brief.cleaningFlags;
    houses = todayAtTheHouses(brief.checkoutsToday, brief.checkinsToday, brief.inspectionsCompletedToday);
    gmailConfigured = brief.gmailConfigured;
    gmailMailbox = brief.gmailMailbox;
  } catch {
    // Surface a graceful empty state rather than crash the home page.
    gmailConfigured = false;
  }

  const session = await auth();
  const email = session?.user?.email ?? '';
  const role = roleForEmail(email);
  const owner = role === 'owner';
  // Links into the mailbox the brief read render only for the person who
  // owns it; everyone else gets the sender, the summary and the subject.
  const mail = { mailbox: gmailMailbox, canOpen: canOpenMailbox(email, gmailMailbox) };
  // The triaged mail is one owner's inbox. It waits on the owners, or on
  // whoever's mailbox it is; a staff login's replies are the team's texts.
  if (!owner && !mail.canOpen) {
    needsReply = [];
    fyi = [];
  }
  const [{ work: allWork, mode: workMode }, dismissed, plannedWalks, queueCards, paymentCards, meetingCards, ownerHolds] = await Promise.all([
    loadMyWork(email),
    loadDismissals(email),
    loadPlannedWalks(email),
    loadQueueCards(email),
    loadPaymentLinkCards(),
    // Owners see every meeting on the calendar; staff see the ones they logged.
    owner ? loadMeetingCards() : email ? loadMeetingCards(new Date(), { createdBy: email }) : Promise.resolve([]),
    // Owner blocks nobody has answered "clean after?" for. No clear
    // button: answering is the clear, on the buttons right here.
    loadOwnerHoldQuestions(supabase).catch(() => null),
  ]);
  const ownerHoldAsks: OwnerHoldQuestionCard[] = ownerHolds?.pending ?? [];
  const ownerHoldToday = ownerHolds?.today ?? todayET();

  // Guest payment links: paid this week (the "did they pay?" answer) and
  // still open past a day (the "they haven't" answer). Both hide with ×.
  // A property whose Stripe key will not let Helm read payments is one row
  // with no ×: it clears itself once the key is fixed and the next sweep
  // reads it. The feed shows a few, unpaid first; the rest fold into "N more".
  const overdueLinks = paymentCards.overdue.filter((c) => !dismissed.has(`plink-unpaid:${c.row.request_key}`));
  const paidLinks = paymentCards.paid.filter((c) => !dismissed.has(`plink-paid:${c.row.request_key}`));
  const keyProblems = paymentCards.keyProblems;
  const payments = windowPayments(overdueLinks, keyProblems, paidLinks);

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

  // Each section, or null when it has nothing to show. The page renders them
  // in the order of the signed-in person's day (lib/home-feed-order.ts).
  const sections: Record<FeedSection, React.ReactNode> = {
    // ON YOUR PLATE: work assigned to you. The header links to the board
    // filtered to "mine"; the feed shows a few and backfills as you clear.
    work:
      workMode === 'assigned' && myWork.length > 0 ? (
        <>
          <SectionHeaderLink href="/work?filter=mine" title="On your plate" eyebrow={`${workFiltered.length} assigned`} />
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {myWork.map((w) => (
              <MyWorkRow key={`${w.kind}-${w.id}`} item={w} />
            ))}
          </div>
        </>
      ) : null,

    // PLANNED WALKS: inspection plans assigned to you, today and the next
    // few days. A walk has a fixed clock; the row lands on the walk's own
    // pipeline row.
    walks:
      plannedWalks.length > 0 ? (
        <>
          <SectionHeaderLink href="/turnovers" title="Planned walks" eyebrow={`${plannedWalks.length} upcoming`} />
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {plannedWalks.map((w) => (
              <PlannedWalkRow key={w.id} walk={w} />
            ))}
          </div>
        </>
      ) : null,

    // MEETINGS: sit-downs logged on a CRM contact page, today and tomorrow
    // in Gloucester. The card leaves on its own once the day passes.
    meetings:
      meetingCards.length > 0 ? (
        <>
          <SectionHeaderLink
            href="/crm"
            title="Meetings"
            eyebrow={meetingCards.length === 1 ? '1 coming up' : `${meetingCards.length} coming up`}
          />
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {meetingCards.map((m) => (
              <MeetingFeedRow key={m.id} meeting={m} />
            ))}
          </div>
        </>
      ) : null,

    // NEEDS YOUR REPLY: triaged mail flagged for a reply and texts or
    // emails from a contact still waiting on us; then, with no heading, the
    // mail worth a glance.
    replies:
      replyTotal > 0 || glance.length > 0 ? (
        <>
          {replyTotal > 0 && (
            <>
              {/* No header link: each row opens its own place (the
                  contact, or the mail for whoever owns the mailbox). */}
              <SectionHeader title="Needs your reply" eyebrow={`${replyTotal} waiting`} />
              <div style={{ borderTop: '1px solid var(--ink)' }}>
                {replyEmails.map((e) => (
                  <EmailItem key={e.id} email={e} mail={mail} />
                ))}
                {replyInbound.map((t) => (
                  <InboundItem key={inboundId(t)} touch={t} />
                ))}
              </div>
            </>
          )}
          {glance.length > 0 && (
            <div style={{ marginTop: replyTotal > 0 ? 28 : 0, borderTop: '1px solid var(--rule)' }}>
              {glance.map((e) => (
                <EmailItem key={e.id} email={e} mail={mail} dim />
              ))}
            </div>
          )}
        </>
      ) : null,

    // OWNER BLOCKS TO ANSWER: Guesty holds for the owner with no "clean
    // after?" answer yet. The stay is on the cleaner schedule meanwhile;
    // the buttons are the same ones as on the cleaner messaging card, and
    // answering is the clear.
    holds:
      ownerHoldAsks.length > 0 ? (
        <>
          <SectionHeaderLink
            href="/messaging/team#owner-holds"
            title="Owner blocks · clean after?"
            eyebrow={`${ownerHoldAsks.length} to answer`}
            subline="On the cleaner schedule until you say otherwise."
          />
          <div style={{ borderTop: '2px solid var(--signal)' }}>
            {ownerHoldAsks.map((c) => (
              <HoldRow key={`${c.propertyId}|${c.checkIn}`} card={c} today={ownerHoldToday} back="home" />
            ))}
          </div>
        </>
      ) : null,

    // CLEANINGS TO CHECK: a guest leaving and no cleaner booked, or a
    // cleaner booked before the guest is out or after the next one is in.
    // Today through the day after tomorrow, as far as the vendor announces.
    // A flag clears itself once the vendor's schedule catches up.
    cleanings:
      cleaningFlags.length > 0 ? (
        <>
          <SectionHeaderLink href="/turnovers/cleanings" title="Cleanings to check" eyebrow={`${cleaningFlags.length} to check`} />
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {cleaningFlags.map((f) => (
              <CleaningFlagRow key={`${f.date}|${f.propertyId}`} flag={f} />
            ))}
          </div>
        </>
      ) : null,

    // UNASSIGNED WORK: when nothing is assigned to you, the team's
    // unclaimed backlog, spread across homes, after the clock-bound items.
    unassigned:
      workMode === 'unassigned' && myWork.length > 0 ? (
        <>
          <SectionHeaderLink href="/work?filter=unclaimed" title="Unassigned work" eyebrow={`${workFiltered.length} unassigned`} />
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {myWork.map((w) => (
              <MyWorkRow key={`${w.kind}-${w.id}`} item={w} />
            ))}
          </div>
        </>
      ) : null,

    // IN THE QUEUES: one row per office queue with work stacked up. A row
    // renders only while its count is nonzero, so the block disappears on
    // its own when the queues are clear.
    queues:
      queueCards.length > 0 ? (
        <>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 12 }}>
            <h2 style={sectionHeadingStyle}>In the queues</h2>
            <span className="eyebrow">{queueCards.length} waiting</span>
          </div>
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {queueCards.map((c) => (
              <QueueRow key={c.id} card={c} />
            ))}
          </div>
        </>
      ) : null,

    // PAYMENTS: guest payment links (late checkouts, pets, extra nights,
    // deposits) still open after a day, and ones just paid. Helm is the
    // alert for a link, per the team-notification policy.
    payments:
      overdueLinks.length + keyProblems.length + paidLinks.length > 0 ? (
        <>
          <SectionHeaderLink
            href={PAYMENTS_HREF}
            title="Payments"
            eyebrow={paymentsEyebrow(paidLinks.length, overdueLinks.length, keyProblems.length)}
          />
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {payments.overdue.map((c) => (
              <PaymentLinkFeedRow key={c.row.request_key} card={c} />
            ))}
            {payments.problems.map((k) => (
              <PaymentKeyProblemRow key={k.propertyId} problem={k} owner={owner} />
            ))}
            {payments.paid.map((c) => (
              <PaymentLinkFeedRow key={c.row.request_key} card={c} />
            ))}
            {payments.more > 0 && <MoreRow href={PAYMENTS_HREF} text={`${payments.more} more`} />}
          </div>
        </>
      ) : null,
  };

  const shown = homeFeedOrder(role).filter((key) => sections[key] != null);

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 24, paddingBottom: 80, width: '100%' }}>
      {shown.length === 0 ? (
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
        </div>
      ) : (
        shown.map((key) => (
          <div key={key} data-feed-section={key} style={{ marginBottom: 36 }}>
            {sections[key]}
          </div>
        ))
      )}

      {/* TODAY AT THE HOUSES: who leaves and who arrives today, and the
          homes walked today. The one block of the retired /today page the
          home did not already have; under the feed, because it is the
          day's backdrop rather than something waiting on you. */}
      <TodayAtTheHousesSection houses={houses} />
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
  const today = operatingDate();

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
 * optional subline sits beneath the title. The link uses inherited color
 * so it reads as a heading, not a blue underlined link.
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

/** The same header with nothing to click: for a section whose rows each
 *  open their own place. */
function SectionHeader({ title, eyebrow }: { title: string; eyebrow: string }) {
  return (
    <div className="flex items-baseline justify-between" style={{ marginBottom: 12 }}>
      <h2 style={sectionHeadingStyle}>{title}</h2>
      <span className="eyebrow">{eyebrow}</span>
    </div>
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
  const todayIso = operatingDate();
  const today = new Date(`${todayIso}T00:00:00`);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days <= 7) return `in ${days}d`;
  return due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Which mailbox the feed's emails live in, and whether this session may
 *  open it. A session that may not sees the same row with nothing to click. */
type MailAccess = { mailbox: string | null; canOpen: boolean };

function EmailItem({ email: e, mail, dim = false }: { email: BriefEmail; mail: MailAccess; dim?: boolean }) {
  const fromLabel = e.fromName || e.fromEmail || 'Unknown sender';
  const fromStyle = {
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--ink)',
    textDecoration: 'none',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as const;
  return (
    <div style={feedRowStyle}>
      <span aria-hidden style={{ ...dotStyle, background: dim ? 'var(--rule)' : 'var(--signal)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-baseline justify-between" style={{ gap: 16 }}>
          {mail.canOpen ? (
            <a href={gmailUrl(mail.mailbox, `inbox/${e.threadId}`)} target="_blank" rel="noreferrer" style={fromStyle}>
              {fromLabel}
            </a>
          ) : (
            <span style={fromStyle}>{fromLabel}</span>
          )}
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
            {e.draftId && mail.canOpen && (
              <a
                href={gmailUrl(mail.mailbox, `drafts/${e.draftId}`)}
                target="_blank"
                rel="noreferrer"
                style={{ flexShrink: 0, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--signal)', textDecoration: 'none' }}
              >
                Reply drafted →
              </a>
            )}
            {e.draftId && !mail.canOpen && (
              <span style={{ flexShrink: 0, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                Reply drafted
              </span>
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
 * page; the full schedule lives on /turnovers. The previous /me page surfaced
 * these too -- this is where they live now.
 */
async function loadPlannedWalks(email: string): Promise<PlannedWalk[]> {
  if (!email) return [];
  try {
    const today = operatingDate();
    const { data } = await supabase
      .from('inspection_plans')
      .select('id, property_id, guesty_reservation_id, planned_for_date, checkin_date, notes, properties!inner(id, name)')
      .eq('assigned_to_email', email)
      .gte('planned_for_date', today)
      .order('planned_for_date', { ascending: true })
      .limit(6);
    return ((data ?? []) as Array<{
      id: string;
      property_id: string;
      guesty_reservation_id: string | null;
      planned_for_date: string | null;
      checkin_date: string;
      notes: string | null;
      properties: { id: string; name: string } | { id: string; name: string }[] | null;
    }>).map((p) => {
      const prop = Array.isArray(p.properties) ? p.properties[0] : p.properties;
      return {
        id: p.id,
        propertyId: p.property_id,
        propertyName: prop?.name ?? p.property_id,
        reservationId: p.guesty_reservation_id,
        plannedFor: p.planned_for_date,
        checkinDate: p.checkin_date,
        notes: p.notes,
      };
    });
  } catch {
    return [];
  }
}

function MeetingFeedRow({ meeting: m }: { meeting: MeetingCard }) {
  const today = todayET();
  const isToday = m.date === today;
  const dotColor = isToday ? 'var(--signal)' : 'var(--tide-deep)';
  const detail = [m.propertyName, m.location].filter(Boolean).join(' · ');
  return (
    <Link
      href={`/crm/${m.contactId}`}
      style={{ ...feedRowStyle, alignItems: 'center', textDecoration: 'none', color: 'inherit' }}
    >
      <span style={{ ...dotStyle, marginTop: 0, background: dotColor }} aria-hidden="true" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: 'var(--ink)' }}>
          {m.contactName}
          {m.title && m.title.toLowerCase() !== `meeting with ${m.contactName}`.toLowerCase() ? (
            <span style={{ color: 'var(--ink-3)' }}> · {m.title}</span>
          ) : null}
        </div>
        <div style={{ marginTop: 3, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.06em' }}>
          {meetingWhen(m, today)}
          {detail ? ` · ${detail}` : ''}
          {m.notes ? ` · ${m.notes}` : ''}
        </div>
      </div>
    </Link>
  );
}

function PlannedWalkRow({ walk }: { walk: PlannedWalk }) {
  const today = operatingDate();
  const isToday = walk.plannedFor === today;
  const isPast = !!walk.plannedFor && walk.plannedFor < today;
  const dotColor = isPast ? 'var(--negative)' : isToday ? 'var(--signal)' : 'var(--tide-deep)';
  const label = isPast ? 'overdue' : isToday ? 'today' : walk.plannedFor ? plainDate(walk.plannedFor) : 'upcoming';
  // Land on the walk's own row, not the top of the board: the pipeline is
  // filtered to the home and widened to a range that holds the check-in,
  // and the row anchor scrolls to it. A plan with no stay behind it falls
  // back to the filtered board.
  const daysOut = Math.ceil((Date.parse(`${walk.checkinDate.slice(0, 10)}T12:00:00`) - Date.parse(`${today}T12:00:00`)) / 86_400_000);
  const range = daysOut <= 0 ? 'today' : daysOut <= 3 ? '3d' : daysOut <= 7 ? '7d' : daysOut <= 14 ? '14d' : '30d';
  const anchor = walk.reservationId ? `#turnover-${walk.propertyId}-${walk.reservationId}` : '';
  const href = `/turnovers?range=${range}&property=${encodeURIComponent(walk.propertyId)}${anchor}`;
  return (
    <Link
      href={href}
      style={{ ...feedRowStyle, alignItems: 'center', textDecoration: 'none', color: 'inherit' }}
    >
      <span style={{ ...dotStyle, marginTop: 0, background: dotColor }} aria-hidden="true" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: 'var(--ink)' }}>{walk.propertyName}</div>
        <div style={{ marginTop: 3, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.06em' }}>
          Walk {label} · check-in {plainDate(walk.checkinDate)}
          {walk.notes ? ` · ${walk.notes}` : ''}
        </div>
      </div>
    </Link>
  );
}

/**
 * Queue-pressure cards. Each loader degrades to null on any failure (missing
 * table, unconfigured Field env, network) so the rest of the feed is never
 * touched, matching how the other loaders here fail.
 *
 * Role-aware: creative pay and the statement close are owner work, and
 * their cards link to owner pages. For a staff login those loaders are not
 * run at all, so no dollar figure or unsent count is read for someone who
 * could not open the page behind it; and whatever a loader returns, a card
 * whose href the proxy would bounce never reaches the feed.
 */
async function loadQueueCards(email: string): Promise<QueueCard[]> {
  const role = roleForEmail(email);
  const owner = role === 'owner';
  const [creative, packets, statements, handoff] = await Promise.all([
    owner ? loadCreativeQueue() : null,
    loadPacketQueue(),
    owner ? loadStatementQueue() : null,
    loadCloseHandoffQueue(email),
  ]);
  return [creative, ...packets, statements, handoff]
    .filter((c): c is QueueCard => !!c)
    .filter((c) => roleMayOpen(role, c.href));
}

/**
 * The month-close handoff, read from each end. Staff see their deadline:
 * items still open for a month inside the nag window (a week before the
 * due date through the close). Owners see what waits on them: items the
 * field has sent, plus anything left open once the month is over.
 */
async function loadCloseHandoffQueue(email: string): Promise<QueueCard | null> {
  try {
    const today = todayET();
    const months = handoffMonths(today);
    const items = await loadHandoffItems({ months, statuses: ['open', 'sent'] });
    if (items.length === 0) return null;
    const cur = today.slice(0, 7);
    if (roleForEmail(email) === 'owner') {
      const toFile = items.filter((i) => i.status === 'sent' || i.month < cur);
      if (toFile.length === 0) return null;
      const m = toFile.map((i) => i.month).sort()[0];
      const n = toFile.filter((i) => i.month === m).length;
      return { id: 'queue-close-handoff', href: `/fieldwork/close?month=${m}`, text: `Close handoff: ${n} field item${n === 1 ? '' : 's'} to file for ${monthName(m)}` };
    }
    const open = items.filter((i) => i.status === 'open' && inNagWindow(i.month, today));
    if (open.length === 0) return null;
    const m = open.map((i) => i.month).sort()[0];
    const n = open.filter((i) => i.month === m).length;
    return { id: 'queue-close-handoff', href: `/fieldwork/close?month=${m}`, text: `Close handoff: ${n} item${n === 1 ? '' : 's'} not sent for ${monthName(m)}, ${dueWording(m, today)}` };
  } catch {
    return null;
  }
}

/**
 * Creative pay pressure: shoots the office has to act on (views overdue to
 * read, or a locked payout awaiting send) plus the total owed now. Reads the
 * same board + rollup the /fieldwork/shoots page renders, so the numbers
 * can never drift from what the board shows.
 */
async function loadCreativeQueue(): Promise<QueueCard | null> {
  if (!isFieldConfigured) return null;
  try {
    const board = await loadShootBoard();
    let toApprove = 0;
    let owedCents = 0;
    for (const s of board) {
      const sum = shootPaySummary(s.assets, s.pay, s.shoot, s.card);
      owedCents += sum.owedCents;
      if (s.pay.needsAttention || sum.owedCents > 0) toApprove++;
    }
    if (toApprove === 0 && owedCents === 0) return null;
    const bits = [
      toApprove > 0 ? `${toApprove} shoot${toApprove === 1 ? '' : 's'} to act on` : null,
      owedCents > 0 ? `${dollars(owedCents)} owed` : null,
    ].filter(Boolean);
    return { id: 'queue-creative', href: '/fieldwork/shoots', text: `Creative: ${bits.join(' · ')}` };
  } catch {
    return null;
  }
}

/**
 * Field packets sitting in 'submitted' - the one packet status that waits on
 * the operator (approve, or request changes). Same vocabulary as the
 * "Awaiting approval" strip on /fieldwork/packets. One row PER packet linking
 * straight to its detail page (the second-most-visited page in the app per
 * the Aug 2026 click-history audit, ~340 visits/month), oldest submission
 * first so the longest-waiting contractor surfaces on top; past the cap the
 * rest fold into one board link.
 */
const PACKET_QUEUE_CAP = 3;

async function loadPacketQueue(): Promise<QueueCard[]> {
  if (!isFieldConfigured) return [];
  try {
    const { data, count } = await fieldDb()
      .from('inspection_packets')
      .select('id, title, stop_count, submitted_at', { count: 'exact' })
      .eq('status', 'submitted')
      .order('submitted_at', { ascending: true })
      .limit(PACKET_QUEUE_CAP);
    if (!data || data.length === 0) return [];
    const cards: QueueCard[] = data.map((p) => ({
      id: `queue-packet-${p.id}`,
      href: `/fieldwork/packets/${p.id}`,
      // A planned packet's title already counts its stops ("Gloucester ·
      // 2 stops"); say it once.
      text: `Field: approve ${p.title}${p.stop_count && !/\bstops?\b/i.test(p.title) ? ` · ${p.stop_count} stop${p.stop_count === 1 ? '' : 's'}` : ''}`,
    }));
    const more = (count ?? data.length) - data.length;
    if (more > 0) {
      cards.push({
        id: 'queue-packets-more',
        href: '/fieldwork/packets',
        text: `Field: ${more} more packet${more === 1 ? '' : 's'} awaiting approval`,
      });
    }
    return cards;
  } catch {
    return [];
  }
}

/**
 * Close-week statement pressure: statements not yet sent for the most recent
 * CLOSED period (latest statement_periods month before the current one).
 * Sent-ness is the close_tasks.email_sent_at stamp - the same field the
 * statements dashboard's "N sent" counter reads. Rule: the card shows
 * whenever unsent > 0 for that period, no date window - the stamp persists,
 * so the card clears itself the moment the last statement is marked sent.
 */
async function loadStatementQueue(): Promise<QueueCard | null> {
  try {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const { data: period } = await supabase
      .from('statement_periods')
      .select('id, month')
      .lt('month', currentMonth)
      .order('month', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!period) return null;
    const [{ count: total }, { count: sent }] = await Promise.all([
      supabase
        .from('property_statements')
        .select('id', { count: 'exact', head: true })
        .eq('period_id', period.id),
      supabase
        .from('close_tasks')
        .select('property_id', { count: 'exact', head: true })
        .eq('period_id', period.id)
        .not('email_sent_at', 'is', null),
    ]);
    const unsent = (total ?? 0) - (sent ?? 0);
    if (unsent <= 0) return null;
    const monthName = new Date(`${period.month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long' });
    return { id: 'queue-statements', href: '/statements', text: `Statements: ${unsent} unsent for ${monthName}` };
  } catch {
    return null;
  }
}

function CleaningFlagRow({ flag }: { flag: BriefCleaningFlag }) {
  // A flag about a checkout lands on that house's board row, where the
  // verdict prints; a visit with nobody checking out has no row, so it lands
  // on the From Cape Ann Elite list.
  const href =
    flag.status === 'no_checkout'
      ? `/turnovers/cleanings#day-${flag.date}`
      : checkoutBoardHref(flag.propertyId, flag.date, operatingDate());
  return (
    <Link
      href={href}
      style={{ ...feedRowStyle, alignItems: 'baseline', textDecoration: 'none', color: 'inherit' }}
    >
      <span aria-hidden style={{ ...dotStyle, background: 'var(--signal)' }} />
      <span
        className="font-mono"
        style={{ flexShrink: 0, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)', minWidth: 78 }}
      >
        {flag.dayLabel}
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--ink)' }}>
        <span style={{ fontWeight: 600 }}>{flag.propertyName}</span>
        <span style={{ color: 'var(--ink-3)' }}> · {flag.detail}</span>
      </span>
      <span className="eyebrow">→</span>
    </Link>
  );
}

function QueueRow({ card }: { card: QueueCard }) {
  return (
    <Link
      href={card.href}
      style={{ ...feedRowStyle, alignItems: 'center', textDecoration: 'none', color: 'inherit' }}
    >
      <span aria-hidden style={{ ...dotStyle, marginTop: 0, background: 'var(--signal)' }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
        {card.text}
      </span>
      <span className="eyebrow">→</span>
    </Link>
  );
}

/** "Sat, Oct 18" for a YYYY-MM-DD, read at noon so no zone moves the day. */
function plainDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
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


// ── Today at the houses ───────────────────────────────────────────

type HouseRow = { kind: 'out' | 'in'; stay: BriefStay; walked: boolean };
type TodayAtTheHouses = { out: HouseRow[]; in: HouseRow[]; walked: BriefInspection[] };

/** Today's checkouts, then check-ins, each ticked when the home was walked
 *  today; a home walked with no stay today gets its own row. */
function todayAtTheHouses(checkouts: BriefStay[], checkins: BriefStay[], walks: BriefInspection[]): TodayAtTheHouses {
  const walkedHomes = new Set(walks.map((w) => w.propertyId));
  const stayHomes = new Set([...checkouts, ...checkins].map((s) => s.propertyId));
  const byName = (a: HouseRow, b: HouseRow) => a.stay.propertyName.localeCompare(b.stay.propertyName);
  return {
    out: checkouts.map((stay): HouseRow => ({ kind: 'out', stay, walked: walkedHomes.has(stay.propertyId) })).sort(byName),
    in: checkins.map((stay): HouseRow => ({ kind: 'in', stay, walked: walkedHomes.has(stay.propertyId) })).sort(byName),
    walked: walks.filter((w) => !stayHomes.has(w.propertyId)),
  };
}

function TodayAtTheHousesSection({ houses }: { houses: TodayAtTheHouses }) {
  const total = houses.out.length + houses.in.length + houses.walked.length;
  if (total === 0) return null;
  const eyebrow = [
    houses.out.length > 0 ? `${houses.out.length} out` : null,
    houses.in.length > 0 ? `${houses.in.length} in` : null,
    houses.walked.length > 0 ? `${houses.walked.length} walked` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div data-feed-section="houses" style={{ marginTop: 12 }}>
      <SectionHeaderLink href="/turnovers?range=today" title="Today at the houses" eyebrow={eyebrow} />
      <div style={{ borderTop: '1px solid var(--ink)' }}>
        {[...houses.out, ...houses.in].map((r, i) => (
          <HouseStayRow key={`${r.kind}-${r.stay.propertyId}-${i}`} row={r} />
        ))}
        {houses.walked.map((w) => (
          <Link
            key={w.id}
            href={`/inspections/${w.id}/summary`}
            style={{ ...feedRowStyle, alignItems: 'baseline', textDecoration: 'none', color: 'inherit' }}
          >
            <span className="font-mono" style={houseTagStyle('var(--ink-3)')}>
              Walked
            </span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
              {w.propertyName}
              <WalkedTick />
            </span>
            <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--ink-4)' }}>
              {w.completedAt
                ? new Date(w.completedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
                : ''}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function HouseStayRow({ row }: { row: HouseRow }) {
  const { stay } = row;
  return (
    <Link
      href={`/properties/${stay.propertyId}`}
      style={{ ...feedRowStyle, alignItems: 'baseline', textDecoration: 'none', color: 'inherit' }}
    >
      <span className="font-mono" style={houseTagStyle(row.kind === 'out' ? 'var(--signal)' : 'var(--ink-3)')}>
        {row.kind === 'out' ? 'Out' : 'In'}
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--ink)' }}>
        <span style={{ fontWeight: 500 }}>{stay.propertyName}</span>
        {row.walked && <WalkedTick />}
        {stay.guestName && <span style={{ color: 'var(--ink-3)' }}> · {stay.guestName}</span>}
      </span>
      <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--ink-4)' }}>{stay.channel ?? ''}</span>
    </Link>
  );
}

function WalkedTick() {
  return (
    <span
      aria-label="walked today"
      title="Walked today"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        marginLeft: 8,
        background: 'var(--signal)',
        color: 'var(--paper)',
        borderRadius: 999,
        fontSize: 10,
        lineHeight: 1,
        verticalAlign: 'middle',
      }}
    >
      ✓
    </span>
  );
}

function houseTagStyle(color: string): React.CSSProperties {
  return { flexShrink: 0, minWidth: 44, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color };
}

// ── Payments ──────────────────────────────────────────────────────

/** Where every payment row and the section header land: the Charge tab's ledger. */
const PAYMENTS_HREF = '/messaging/send?tab=charge#payment-links';

type PaymentCard = { row: PaymentLinkRow; propertyName: string; status: 'paid' | 'overdue' };

/** A property whose restricted Stripe key refuses the checkout-sessions
 *  read, so none of its open links can be called paid or unpaid. */
type PaymentKeyProblem = { propertyId: string; propertyName: string; openLinks: number; fixUrl: string };

/** A paid link stays on the feed this long; an unpaid one is called out
 *  from a day after it was sent until it is this old, then it is a dead
 *  deal that only the ledger still lists. */
const PAID_SHOW_DAYS = 7;
const OVERDUE_SHOW_DAYS = 14;

type PaymentCards = { paid: PaymentCard[]; overdue: PaymentCard[]; keyProblems: PaymentKeyProblem[] };

async function loadPaymentLinkCards(): Promise<PaymentCards> {
  const empty: PaymentCards = { paid: [], overdue: [], keyProblems: [] };
  try {
    const rows = await listRecentPaymentLinks({ days: LINK_LOOKBACK_DAYS, limit: 60 });
    if (rows.length === 0) return empty;
    const names = await loadPropertyNames();
    const now = Date.now();
    const paidCutoff = now - PAID_SHOW_DAYS * 86_400_000;
    const overdueCutoff = now - OVERDUE_SHOW_DAYS * 86_400_000;
    const paid: PaymentCard[] = [];
    const overdue: PaymentCard[] = [];
    const problems = new Map<string, PaymentKeyProblem>();
    for (const row of rows) {
      const status = paymentLinkStatus(row, now);
      const propertyName = names.get(row.property_id) ?? row.property_id;
      if (status === 'paid' && row.paid_at && new Date(row.paid_at).getTime() >= paidCutoff) {
        paid.push({ row, propertyName, status: 'paid' });
      } else if (status === 'overdue' && new Date(row.sent_at || row.created_at).getTime() >= overdueCutoff) {
        overdue.push({ row, propertyName, status: 'overdue' });
      } else if (status === 'unverified') {
        const existing = problems.get(row.property_id);
        if (existing) existing.openLinks++;
        else {
          problems.set(row.property_id, {
            propertyId: row.property_id,
            propertyName,
            openLinks: 1,
            fixUrl: stripeKeyFixUrl(row.paid_check_error),
          });
        }
      }
    }
    return { paid, overdue, keyProblems: [...problems.values()] };
  } catch {
    return empty;
  }
}

function paymentsEyebrow(paid: number, overdue: number, cantCheck: number): string {
  return [
    paid > 0 ? `${paid} paid` : null,
    overdue > 0 ? `${overdue} unpaid` : null,
    cantCheck > 0 ? `${cantCheck} can't check` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function PaymentKeyProblemRow({ problem, owner }: { problem: PaymentKeyProblem; owner: boolean }) {
  const links = `${problem.openLinks} open link${problem.openLinks === 1 ? '' : 's'}`;
  return (
    <div style={feedRowStyle}>
      <span aria-hidden style={{ ...dotStyle, background: 'var(--signal)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-baseline justify-between" style={{ gap: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
            Can&apos;t see payments at {problem.propertyName}
          </span>
          <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--signal)' }}>{links}</span>
        </div>
        <div style={{ marginTop: 3, fontSize: 11, fontWeight: 500, color: 'var(--ink-3)', lineHeight: 1.4 }}>
          {owner ? "The home's Stripe key can't read payments." : "Ask Ryan to fix the home's Stripe key."}
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
          {owner && problem.fixUrl ? (
            <a
              href={problem.fixUrl}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--signal)', textDecoration: 'none' }}
            >
              Fix the key in Stripe →
            </a>
          ) : null}
          <Link
            href={PAYMENTS_HREF}
            style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--ink-3)', textDecoration: 'none' }}
          >
            See the links →
          </Link>
        </div>
      </div>
    </div>
  );
}

/** The last row of a capped section: how many more, linking to the rest. */
function MoreRow({ href, text }: { href: string; text: string }) {
  return (
    <Link href={href} style={{ ...feedRowStyle, alignItems: 'center', textDecoration: 'none', color: 'inherit' }}>
      <span className="eyebrow" style={{ color: 'var(--tide-deep)' }}>{text} →</span>
    </Link>
  );
}

function PaymentLinkFeedRow({ card }: { card: PaymentCard }) {
  const { row } = card;
  const paid = card.status === 'paid';
  const who = row.guest_name || 'Guest';
  const headline = paid
    ? `${who} paid ${money(row.amount_cents)}`
    : `${who} hasn't paid ${money(row.amount_cents)} yet`;
  const when = paid ? ageLabel(row.paid_at) : `${row.sent_at ? 'sent' : 'made'} ${ageLabel(row.sent_at || row.created_at)}`;
  const sublineBits = [row.label, card.propertyName].filter(Boolean);
  if (!paid && row.nudge_count > 0) sublineBits.push(`nudged ${row.nudge_count}x`);
  return (
    <div style={feedRowStyle}>
      <span aria-hidden style={{ ...dotStyle, background: paid ? 'var(--tide-deep)' : 'var(--signal)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-baseline justify-between" style={{ gap: 16 }}>
          <Link href={PAYMENTS_HREF} style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', textDecoration: 'none' }}>
            {headline}
          </Link>
          <span style={{ flexShrink: 0, fontSize: 11, color: paid ? 'var(--ink-4)' : 'var(--signal)' }}>{when}</span>
        </div>
        <div style={{ marginTop: 3, fontSize: 11, fontWeight: 500, color: 'var(--ink-3)', lineHeight: 1.4 }}>
          {sublineBits.join(' · ')}
        </div>
        {!paid && (
          <div style={{ marginTop: 8 }}>
            <PaymentLinkActions requestKey={row.request_key} url={row.url} closed={false} compact />
          </div>
        )}
      </div>
      <FeedClearButton itemType={paid ? 'plink-paid' : 'plink-unpaid'} itemId={row.request_key} />
    </div>
  );
}
