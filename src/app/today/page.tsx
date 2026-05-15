import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { isConfigured as isHelmConfigured } from '@/lib/supabase';
import {
  loadDailyBrief,
  briefHeadline,
  type BriefStay,
  type BriefEmail,
  type BriefInspection,
  type BriefProspect,
} from '@/lib/daily-brief';
import type { Approval } from '@/lib/stay-concierge';
import { MarkHandledButton } from './MarkHandledButton';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function prettyDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.round(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)} hr ago`;
  return `${Math.round(diffSec / 86400)} d ago`;
}

function SectionHead({
  number,
  title,
  count,
  href,
}: {
  number: string;
  title: string;
  count?: number;
  href?: string;
}) {
  return (
    <div className="flex items-baseline justify-between mb-4">
      <div className="flex items-baseline gap-4">
        <span
          className="font-mono text-[11px]"
          style={{ color: 'var(--ink-4)', letterSpacing: '0.04em' }}
        >
          {number}
        </span>
        <h2
          className="font-serif"
          style={{
            color: 'var(--ink)',
            fontSize: 22,
            fontWeight: 500,
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h2>
        {typeof count === 'number' ? (
          <span className="text-[11px]" style={{ color: 'var(--ink-4)' }}>
            {count}
          </span>
        ) : null}
      </div>
      {href ? (
        href.startsWith('http') ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] uppercase tracking-[0.14em] hover:underline"
            style={{ color: 'var(--signal)' }}
          >
            Open →
          </a>
        ) : (
          <Link
            href={href}
            className="text-[11px] uppercase tracking-[0.14em] hover:underline"
            style={{ color: 'var(--signal)' }}
          >
            Open →
          </Link>
        )
      ) : null}
    </div>
  );
}

function Check() {
  return (
    <span
      aria-label="inspection completed"
      title="Inspection completed today"
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
      }}
    >
      ✓
    </span>
  );
}

function StayRow({
  s,
  label,
  inspected,
}: {
  s: BriefStay;
  label: 'IN' | 'OUT';
  inspected: boolean;
}) {
  return (
    <li
      className="flex justify-between items-baseline gap-4 py-2 border-b last:border-b-0"
      style={{ borderColor: 'var(--rule-soft)' }}
    >
      <div className="text-sm flex items-baseline">
        <span
          className="font-mono text-[10px] mr-3"
          style={{
            color: label === 'OUT' ? 'var(--signal)' : 'var(--ink-3)',
            letterSpacing: '0.08em',
          }}
        >
          {label}
        </span>
        <Link
          href={`/properties/${s.propertyId}`}
          className="font-medium hover:underline underline-offset-2"
          style={{ color: 'var(--ink)' }}
        >
          {s.propertyName}
        </Link>
        {inspected ? <Check /> : null}
        {s.guestName ? (
          <span className="ml-2" style={{ color: 'var(--ink-3)' }}>
            · {s.guestName}
          </span>
        ) : null}
      </div>
      <span className="text-xs" style={{ color: 'var(--ink-4)' }}>
        {s.channel ?? ''}
      </span>
    </li>
  );
}

function formatAge(ageHours: number): string {
  if (ageHours < 1) return 'just now';
  if (ageHours < 24) return `${ageHours}h ago`;
  return `${Math.round(ageHours / 24)}d ago`;
}

function EmailRow({ e }: { e: BriefEmail }) {
  const fromLabel = e.fromName || e.fromEmail || 'Unknown sender';
  const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${e.threadId}`;
  const needsReply = e.triage === 'needs_reply';
  return (
    <li
      className="py-3 border-b last:border-b-0 flex gap-3"
      style={{ borderColor: 'var(--rule-soft)' }}
    >
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 6,
          height: 6,
          marginTop: 8,
          borderRadius: 999,
          background: needsReply ? 'var(--signal)' : 'var(--rule)',
        }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline gap-4">
          <div className="flex items-baseline gap-2 min-w-0">
            <a
              href={gmailUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium hover:underline underline-offset-2 truncate"
              style={{ color: 'var(--ink)' }}
            >
              {fromLabel}
            </a>
            {needsReply ? (
              <span
                className="text-[9px] uppercase tracking-[0.14em] px-1.5 py-0.5 rounded"
                style={{ background: 'var(--signal)', color: 'var(--paper)', flexShrink: 0 }}
              >
                Reply
              </span>
            ) : null}
          </div>
          <div className="flex items-baseline gap-3" style={{ flexShrink: 0 }}>
            <span className="text-[11px]" style={{ color: 'var(--ink-4)' }}>
              {formatAge(e.ageHours)}
            </span>
            <MarkHandledButton messageId={e.id} />
          </div>
        </div>
        <div
          className="mt-1"
          style={{
            color: needsReply ? 'var(--ink)' : 'var(--ink-3)',
            fontSize: needsReply ? 14 : 13,
          }}
        >
          {e.triageSummary || e.subject}
        </div>
        {needsReply ? (
          <div className="text-[11px] mt-1 italic" style={{ color: 'var(--ink-4)' }}>
            {e.subject}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function ApprovalRow({ a }: { a: Approval }) {
  return (
    <li
      className="py-2.5 border-b last:border-b-0"
      style={{ borderColor: 'var(--rule-soft)' }}
    >
      <div className="flex justify-between items-baseline gap-4">
        <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
          {a.guest_first} · {a.listing_name}
        </span>
        <span className="text-[11px]" style={{ color: 'var(--ink-4)' }}>
          {a.age_minutes != null ? `${a.age_minutes}m` : ''}
        </span>
      </div>
      <div className="text-xs mt-0.5 italic" style={{ color: 'var(--ink-3)' }}>
        “{a.guest_text.length > 130 ? `${a.guest_text.slice(0, 130)}…` : a.guest_text}”
      </div>
    </li>
  );
}

function ProspectRow({ p }: { p: BriefProspect }) {
  const meta: string[] = [];
  if (p.status === 'draft') meta.push('draft');
  else if (p.daysSinceSent !== null) meta.push(p.daysSinceSent === 0 ? 'sent today' : `sent ${p.daysSinceSent}d ago`);
  if (p.closeLikelihoodPct != null) meta.push(`${p.closeLikelihoodPct}%`);
  return (
    <li
      className="py-2.5 border-b last:border-b-0"
      style={{ borderColor: 'var(--rule-soft)' }}
    >
      <div className="flex justify-between items-baseline gap-4">
        <Link
          href={`/projections/${p.id}`}
          className="text-sm font-medium hover:underline underline-offset-2"
          style={{ color: 'var(--ink)' }}
        >
          {p.prospectName}
        </Link>
        <span
          className="text-[11px]"
          style={{ color: p.status === 'draft' ? 'var(--signal)' : 'var(--ink-4)' }}
        >
          {meta.join(' · ')}
        </span>
      </div>
      <div className="text-xs mt-0.5" style={{ color: 'var(--ink-3)' }}>
        {p.propertyAddress}
        {p.propertyCity ? `, ${p.propertyCity}` : ''}
      </div>
    </li>
  );
}

export default async function TodayPage() {
  if (!isHelmConfigured) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead current="today" />
        <main className="max-w-[720px] mx-auto px-10 py-12 flex-1">
          <p>Supabase is not configured.</p>
        </main>
        <HelmFooter module="Today" right="Source: Helm" />
      </div>
    );
  }

  const brief = await loadDailyBrief();
  const headline = briefHeadline(brief);

  // Property IDs whose inspection completed today; used to mark a ✓ on
  // any stay row for that property.
  const inspectedToday = new Set(brief.inspectionsCompletedToday.map(i => i.propertyId));

  // Property IDs that already appear in stays today. An inspection on a
  // property with no stay today still belongs on the page, so we surface
  // those as standalone rows.
  const stayPropertyIds = new Set([
    ...brief.checkoutsToday.map(s => s.propertyId),
    ...brief.checkinsToday.map(s => s.propertyId),
  ]);
  const inspectionsWithoutStay: BriefInspection[] = brief.inspectionsCompletedToday.filter(
    i => !stayPropertyIds.has(i.propertyId),
  );

  const sections: React.ReactNode[] = [];
  let n = 1;
  const num = () => String(n++).padStart(2, '0');

  if (
    brief.checkinsToday.length ||
    brief.checkoutsToday.length ||
    inspectionsWithoutStay.length
  ) {
    sections.push(
      <section key="checkins" className="mb-12">
        <SectionHead number={num()} title="Check-ins today" href="/operations" />
        <ul>
          {brief.checkinsToday.map((s, i) => (
            <StayRow
              key={`in-${s.propertyId}-${i}`}
              s={s}
              label="IN"
              inspected={inspectedToday.has(s.propertyId)}
            />
          ))}
          {brief.checkoutsToday.map((s, i) => (
            <StayRow
              key={`out-${s.propertyId}-${i}`}
              s={s}
              label="OUT"
              inspected={inspectedToday.has(s.propertyId)}
            />
          ))}
          {inspectionsWithoutStay.map(i => (
            <li
              key={i.id}
              className="flex justify-between items-baseline gap-4 py-2 border-b last:border-b-0"
              style={{ borderColor: 'var(--rule-soft)' }}
            >
              <div className="text-sm flex items-baseline">
                <span
                  className="font-mono text-[10px] mr-3"
                  style={{ color: 'var(--ink-3)', letterSpacing: '0.08em' }}
                >
                  INS
                </span>
                <Link
                  href={`/inspections/${i.id}`}
                  className="font-medium hover:underline underline-offset-2"
                  style={{ color: 'var(--ink)' }}
                >
                  {i.propertyName}
                </Link>
                <Check />
              </div>
              <span className="text-xs" style={{ color: 'var(--ink-4)' }}>
                {i.completedAt
                  ? new Date(i.completedAt).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })
                  : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>,
    );
  }

  // Needs-reply emails first, then FYI. Notifications are filtered
  // out earlier in the loader so they never surface here.
  const visibleEmails = [...brief.unreadEmails].sort((a, b) => {
    if (a.triage !== b.triage) return a.triage === 'needs_reply' ? -1 : 1;
    return a.receivedAt < b.receivedAt ? 1 : -1;
  });

  if (visibleEmails.length) {
    const transparencyBits: string[] = [];
    if (brief.totals.needsReply) {
      transparencyBits.push(
        `${brief.totals.needsReply} flagged for your reply`,
      );
    }
    if (brief.totals.notifications) {
      transparencyBits.push(`${brief.totals.notifications} automated noise hidden`);
    }
    sections.push(
      <section key="emails" className="mb-12">
        <SectionHead
          number={num()}
          title="Emails"
          count={visibleEmails.length}
          href="https://mail.google.com/mail/u/0/#inbox"
        />
        {transparencyBits.length ? (
          <p className="text-[11px] mb-3" style={{ color: 'var(--ink-4)' }}>
            All unread. AI sorted: {transparencyBits.join(' · ')}.
          </p>
        ) : (
          <p className="text-[11px] mb-3" style={{ color: 'var(--ink-4)' }}>
            All unread.
          </p>
        )}
        <ul>
          {visibleEmails.slice(0, 16).map(e => (
            <EmailRow key={e.id} e={e} />
          ))}
        </ul>
      </section>,
    );
  }

  if (brief.pendingApprovals.length) {
    sections.push(
      <section key="approvals" className="mb-12">
        <SectionHead
          number={num()}
          title="Guest message drafts"
          count={brief.pendingApprovals.length}
          href="/messaging"
        />
        <ul>
          {brief.pendingApprovals.slice(0, 8).map(a => (
            <ApprovalRow key={a.id} a={a} />
          ))}
        </ul>
      </section>,
    );
  }

  if (brief.activeProspects.length) {
    const draftCount = brief.activeProspects.filter(p => p.status === 'draft').length;
    const sentCount = brief.activeProspects.length - draftCount;
    const counterLabel: string[] = [];
    if (draftCount) counterLabel.push(`${draftCount} draft${draftCount === 1 ? '' : 's'}`);
    if (sentCount) counterLabel.push(`${sentCount} awaiting`);
    sections.push(
      <section key="prospects" className="mb-12">
        <div className="flex items-baseline justify-between mb-4">
          <div className="flex items-baseline gap-4">
            <span
              className="font-mono text-[11px]"
              style={{ color: 'var(--ink-4)', letterSpacing: '0.04em' }}
            >
              {num()}
            </span>
            <h2
              className="font-serif"
              style={{
                color: 'var(--ink)',
                fontSize: 22,
                fontWeight: 500,
                letterSpacing: '-0.01em',
              }}
            >
              Prospects
            </h2>
            <span className="text-[11px]" style={{ color: 'var(--ink-4)' }}>
              {counterLabel.join(' · ')}
            </span>
          </div>
          <Link
            href="/projections"
            className="text-[11px] uppercase tracking-[0.14em] hover:underline"
            style={{ color: 'var(--signal)' }}
          >
            Open →
          </Link>
        </div>
        <ul>
          {brief.activeProspects.slice(0, 12).map(p => (
            <ProspectRow key={p.id} p={p} />
          ))}
        </ul>
      </section>,
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="today" />

      <main className="max-w-[720px] mx-auto px-10 py-12 flex-1 w-full">
        <header className="mb-14">
          <div className="text-[11px] uppercase tracking-[0.18em] mb-3" style={{ color: 'var(--signal)' }}>
            Daily Brief
          </div>
          <h1
            className="font-serif"
            style={{
              color: 'var(--ink)',
              letterSpacing: '-0.015em',
              fontSize: 52,
              lineHeight: 1.02,
              fontWeight: 400,
            }}
          >
            {prettyDate(brief.date)}
          </h1>
          <p className="font-serif mt-4" style={{ color: 'var(--ink-3)', fontSize: 19, lineHeight: 1.4 }}>
            {headline}
          </p>
        </header>

        {sections.length ? (
          <div>{sections}</div>
        ) : (
          <p className="font-serif" style={{ color: 'var(--ink-3)', fontSize: 20 }}>
            Nothing on the deck. Enjoy the quiet.
          </p>
        )}

        <div
          className="mt-12 pt-4 text-[11px] flex justify-between items-baseline"
          style={{ borderTop: '1px solid var(--rule-soft)', color: 'var(--ink-4)' }}
        >
          <span>
            {brief.gmailConfigured
              ? `Gmail · live ${relativeTime(brief.lastGmailSyncAt)}`
              : 'Gmail not connected'}
          </span>
          <span>{brief.totals.activeProspects} prospects in funnel</span>
        </div>
      </main>

      <HelmFooter module="Today" right="Source: Helm" />
    </div>
  );
}
