import Link from 'next/link';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import { ACTIVE_WORK_SLIP_STATUSES, ACTIVE_TASK_STATUSES } from '@/lib/work-types';
import { loadDailyBrief, type BriefEmail, type BriefInboundTouch } from '@/lib/daily-brief';

type MyWork = {
  id: string;
  kind: 'slip' | 'task';
  title: string;
  priority: string | null;
  propertyId: string | null;
};

/**
 * The "For Me" home feed: the signal worth surfacing, with the noise
 * already filtered out. Reuses the daily-brief AI triage (the same engine
 * /today renders) read from cache — no live classification on page load.
 *
 * Order of attention:
 *   1. On your plate — work slips and tasks assigned to the signed-in user.
 *   2. Needs your reply — emails the triage flagged needs_reply, plus
 *      inbound contact messages (texts/emails) still awaiting a response.
 *   3. Worth a glance — emails worth a glance but not a reply.
 *
 * Notifications / promotions never reach here; the triage drops them
 * before they'd ever clutter this view.
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

  const myWork = await loadMyWork();

  const hasReplyItems = needsReply.length > 0 || inboundWaiting.length > 0;
  const nothing = !hasReplyItems && fyi.length === 0 && myWork.length === 0;

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
          {/* ON YOUR PLATE — work assigned to the signed-in user */}
          {myWork.length > 0 && (
            <div style={{ marginBottom: hasReplyItems || fyi.length > 0 ? 36 : 12 }}>
              <div className="flex items-baseline justify-between" style={{ marginBottom: 12 }}>
                <h2 style={sectionHeadingStyle}>On your plate</h2>
                <span className="eyebrow">{myWork.length} assigned</span>
              </div>
              <div style={{ borderTop: '1px solid var(--ink)' }}>
                {myWork.map((w) => (
                  <MyWorkRow key={`${w.kind}-${w.id}`} item={w} />
                ))}
              </div>
            </div>
          )}

          {/* NEEDS YOUR REPLY */}
          {hasReplyItems && (
            <div style={{ marginBottom: fyi.length > 0 ? 36 : 12 }}>
              <div className="flex items-baseline justify-between" style={{ marginBottom: 12 }}>
                <h2 style={sectionHeadingStyle}>Needs your reply</h2>
                <span className="eyebrow">
                  {needsReply.length + inboundWaiting.length} waiting
                </span>
              </div>
              <div style={{ borderTop: '1px solid var(--ink)' }}>
                {needsReply.map((e) => (
                  <EmailItem key={e.id} email={e} />
                ))}
                {inboundWaiting.map((t) => (
                  <InboundItem key={`${t.contactId}-${t.touchedAt}`} touch={t} />
                ))}
              </div>
            </div>
          )}

          {/* WORTH A GLANCE */}
          {fyi.length > 0 && (
            <div>
              <div className="flex items-baseline justify-between" style={{ marginBottom: 12 }}>
                <h2 style={sectionHeadingStyle}>Worth a glance</h2>
                <span className="eyebrow">{fyi.length}</span>
              </div>
              <div style={{ borderTop: '1px solid var(--rule)' }}>
                {fyi.map((e) => (
                  <EmailItem key={e.id} email={e} dim />
                ))}
              </div>
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

/**
 * Work slips and tasks assigned to the signed-in user. Active items only,
 * un-snoozed, highest priority first. Empty when there's no session or
 * nothing assigned, so the section hides itself.
 */
async function loadMyWork(): Promise<MyWork[]> {
  try {
    const session = await auth();
    const email = session?.user?.email ?? '';
    if (!email) return [];
    const today = new Date().toISOString().slice(0, 10);
    const [slipRes, taskRes] = await Promise.all([
      supabase
        .from('work_slips')
        .select('id, property_id, title, priority, status')
        .eq('assigned_to_email', email)
        .in('status', ACTIVE_WORK_SLIP_STATUSES)
        .or(`snoozed_until.is.null,snoozed_until.lte.${today}`)
        .order('priority', { ascending: false })
        .limit(8),
      supabase
        .from('tasks')
        .select('id, title, priority, status')
        .eq('assigned_to_email', email)
        .in('status', ACTIVE_TASK_STATUSES)
        .order('priority', { ascending: false })
        .limit(8),
    ]);
    const slips: MyWork[] = (
      (slipRes.data ?? []) as Array<{ id: string; property_id: string | null; title: string; priority: string | null }>
    ).map((s) => ({ id: s.id, kind: 'slip', title: s.title, priority: s.priority, propertyId: s.property_id }));
    const tasks: MyWork[] = (
      (taskRes.data ?? []) as Array<{ id: string; title: string; priority: string | null }>
    ).map((t) => ({ id: t.id, kind: 'task', title: t.title, priority: t.priority, propertyId: null }));
    return [...slips, ...tasks];
  } catch {
    return [];
  }
}

function MyWorkRow({ item }: { item: MyWork }) {
  const isHigh = (item.priority ?? '').toLowerCase() === 'high';
  return (
    <Link
      href="/work"
      style={{
        display: 'flex',
        gap: 12,
        padding: '14px 0',
        borderBottom: '1px solid var(--rule)',
        alignItems: 'flex-start',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 6,
          height: 6,
          marginTop: 7,
          borderRadius: 999,
          background: isHigh ? 'var(--signal)' : 'var(--tide-deep)',
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
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
        {isHigh && (
          <div style={{ marginTop: 3, fontSize: 11, color: 'var(--signal)', fontWeight: 500 }}>
            High priority
          </div>
        )}
      </div>
    </Link>
  );
}

function EmailItem({ email: e, dim = false }: { email: BriefEmail; dim?: boolean }) {
  const fromLabel = e.fromName || e.fromEmail || 'Unknown sender';
  const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${e.threadId}`;
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '14px 0',
        borderBottom: '1px solid var(--rule)',
        alignItems: 'flex-start',
      }}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 6,
          height: 6,
          marginTop: 7,
          borderRadius: 999,
          background: dim ? 'var(--rule)' : 'var(--signal)',
        }}
      />
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
          <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--ink-4)' }}>
            {formatAge(e.ageHours)}
          </span>
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
    </div>
  );
}

function InboundItem({ touch: t }: { touch: BriefInboundTouch }) {
  return (
    <Link
      href="/crm"
      style={{
        display: 'flex',
        gap: 12,
        padding: '14px 0',
        borderBottom: '1px solid var(--rule)',
        alignItems: 'flex-start',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <span
        aria-hidden
        style={{ flexShrink: 0, width: 6, height: 6, marginTop: 7, borderRadius: 999, background: 'var(--tide-deep)' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
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
      </div>
    </Link>
  );
}

function formatAge(ageHours: number): string {
  if (ageHours < 1) return 'just now';
  if (ageHours < 24) return `${ageHours}h ago`;
  return `${Math.round(ageHours / 24)}d ago`;
}

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
