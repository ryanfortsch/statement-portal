import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { Section } from '@/components/Section';
import { isConfigured as isHelmConfigured } from '@/lib/supabase';
import {
  loadDailyBrief,
  briefHeadline,
  type BriefStay,
  type BriefInboundTouch,
  type BriefDataGap,
} from '@/lib/daily-brief';
import type { TaskRow, WorkSlipRow } from '@/lib/work-types';
import type { Approval } from '@/lib/stay-concierge';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function prettyDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function StaysList({ stays, kind }: { stays: BriefStay[]; kind: 'checkout' | 'checkin' }) {
  if (!stays.length) return null;
  const label = kind === 'checkout' ? 'Checkouts' : 'Check-ins';
  return (
    <div className="mb-6">
      <h3 className="font-serif text-lg mb-2" style={{ color: 'var(--ink)' }}>
        {label} today
      </h3>
      <ul className="space-y-1">
        {stays.map((s, i) => (
          <li key={`${s.propertyId}-${i}`} className="text-sm flex justify-between gap-4">
            <span style={{ color: 'var(--ink)' }}>
              <Link
                href={`/properties/${s.propertyId}`}
                className="underline-offset-2 hover:underline"
                style={{ color: 'var(--ink)' }}
              >
                {s.propertyName}
              </Link>
              {s.guestName ? <span style={{ color: 'var(--ink-3)' }}> · {s.guestName}</span> : null}
            </span>
            <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
              {s.channel ?? ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InboundList({ items }: { items: BriefInboundTouch[] }) {
  if (!items.length) {
    return <p className="text-sm" style={{ color: 'var(--ink-3)' }}>Inbox is quiet.</p>;
  }
  return (
    <ul className="space-y-3">
      {items.slice(0, 12).map(t => (
        <li key={t.contactId} className="text-sm">
          <div className="flex justify-between gap-4">
            <Link
              href={`/crm/${t.contactId}`}
              className="font-medium underline-offset-2 hover:underline"
              style={{ color: 'var(--ink)' }}
            >
              {t.contactName ?? 'Unknown contact'}
            </Link>
            <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
              {t.daysWaiting === 0 ? 'today' : `${t.daysWaiting}d waiting`} · {t.channel}
            </span>
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--ink-3)' }}>
            {t.summary.length > 140 ? `${t.summary.slice(0, 140)}…` : t.summary}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ApprovalList({ items }: { items: Approval[] }) {
  if (!items.length) {
    return <p className="text-sm" style={{ color: 'var(--ink-3)' }}>No drafts waiting for review.</p>;
  }
  return (
    <ul className="space-y-3">
      {items.slice(0, 8).map(a => (
        <li key={a.id} className="text-sm">
          <div className="flex justify-between gap-4">
            <span className="font-medium" style={{ color: 'var(--ink)' }}>
              {a.guest_first} · {a.listing_name}
            </span>
            <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
              {a.age_minutes != null ? `${a.age_minutes}m` : ''}
            </span>
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--ink-3)' }}>
            “{a.guest_text.length > 120 ? `${a.guest_text.slice(0, 120)}…` : a.guest_text}”
          </div>
        </li>
      ))}
      <li className="text-xs pt-1">
        <Link href="/messaging" className="underline" style={{ color: 'var(--signal)' }}>
          Review all in Messaging →
        </Link>
      </li>
    </ul>
  );
}

function SlipList({ slips, label }: { slips: WorkSlipRow[]; label: string }) {
  if (!slips.length) return null;
  return (
    <div className="mb-5">
      <h3 className="font-serif text-base mb-1" style={{ color: 'var(--ink)' }}>{label}</h3>
      <ul className="space-y-1.5">
        {slips.slice(0, 10).map(s => (
          <li key={s.id} className="text-sm flex justify-between gap-4">
            <Link
              href={`/work/${s.id}`}
              className="underline-offset-2 hover:underline"
              style={{ color: 'var(--ink)' }}
            >
              {s.title}
            </Link>
            <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
              {s.property_id}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TaskList({ tasks }: { tasks: TaskRow[] }) {
  if (!tasks.length) {
    return <p className="text-sm" style={{ color: 'var(--ink-3)' }}>No tasks due.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {tasks.slice(0, 12).map(t => (
        <li key={t.id} className="text-sm flex justify-between gap-4">
          <Link
            href={`/work/${t.id}`}
            className="underline-offset-2 hover:underline"
            style={{ color: 'var(--ink)' }}
          >
            {t.title}
          </Link>
          <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
            {t.due_date ?? (t.priority === 'high' ? 'high' : '')}
          </span>
        </li>
      ))}
    </ul>
  );
}

function GapList({ gaps }: { gaps: BriefDataGap[] }) {
  if (!gaps.length) return null;
  return (
    <ul className="space-y-1.5">
      {gaps.slice(0, 10).map(g => (
        <li key={g.id} className="text-sm flex justify-between gap-4">
          <span style={{ color: 'var(--ink)' }}>
            {g.propertyName ?? g.propertyId ?? 'Unknown'}
            {g.month ? <span style={{ color: 'var(--ink-3)' }}> · {g.month}</span> : null}
            <span style={{ color: 'var(--ink-3)' }}> · {g.gapType}</span>
          </span>
          {g.severity ? (
            <span
              className="text-xs uppercase tracking-wider"
              style={{ color: g.severity === 'high' ? 'var(--signal)' : 'var(--ink-3)' }}
            >
              {g.severity}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default async function TodayPage() {
  if (!isHelmConfigured) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead current="today" />
        <main className="max-w-[1100px] mx-auto px-10 py-12 flex-1">
          <p>Supabase is not configured.</p>
        </main>
        <HelmFooter module="Today" right="Source: Helm" />
      </div>
    );
  }

  const brief = await loadDailyBrief();
  const headline = briefHeadline(brief);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="today" />

      <main className="max-w-[1100px] mx-auto px-10 py-10 flex-1 w-full">
        <header className="mb-10">
          <div
            className="text-xs uppercase tracking-[0.18em] mb-2"
            style={{ color: 'var(--signal)' }}
          >
            Daily Brief
          </div>
          <h1 className="font-serif text-4xl md:text-5xl" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            {prettyDate(brief.date)}
          </h1>
          <p className="font-serif text-lg mt-3" style={{ color: 'var(--ink-3)' }}>
            {headline}
          </p>
        </header>

        <div className="grid md:grid-cols-2 gap-10">
          <Section title="On the boards today">
            <StaysList stays={brief.checkoutsToday} kind="checkout" />
            <StaysList stays={brief.checkinsToday} kind="checkin" />
            {!brief.checkoutsToday.length && !brief.checkinsToday.length ? (
              <p className="text-sm" style={{ color: 'var(--ink-3)' }}>No turnovers today.</p>
            ) : null}
          </Section>

          <Section title={`Replies needed (${brief.inboundWaiting.length})`}>
            <InboundList items={brief.inboundWaiting} />
            {brief.inboundWaiting.length > 0 ? (
              <p className="text-xs pt-3">
                <Link href="/crm" className="underline" style={{ color: 'var(--signal)' }}>
                  Open CRM →
                </Link>
              </p>
            ) : null}
          </Section>

          {brief.stayConciergeConfigured ? (
            <Section title={`Guest drafts pending (${brief.pendingApprovals.length})`}>
              <ApprovalList items={brief.pendingApprovals} />
            </Section>
          ) : null}

          <Section title={`Work queue (${brief.totals.activeSlips} active)`}>
            <SlipList slips={brief.highPrioritySlips} label="High priority" />
            <SlipList slips={brief.ownerActionSlips} label="Owner action needed" />
            {!brief.highPrioritySlips.length && !brief.ownerActionSlips.length ? (
              <p className="text-sm" style={{ color: 'var(--ink-3)' }}>Nothing pressing.</p>
            ) : null}
            <p className="text-xs pt-3">
              <Link href="/work" className="underline" style={{ color: 'var(--signal)' }}>
                Open Work →
              </Link>
            </p>
          </Section>

          <Section title={`Tasks due (${brief.dueTasks.length})`}>
            <TaskList tasks={brief.dueTasks} />
          </Section>

          {brief.unresolvedDataGaps.length ? (
            <Section title={`Statement gaps (${brief.unresolvedDataGaps.length})`}>
              <GapList gaps={brief.unresolvedDataGaps} />
              <p className="text-xs pt-3">
                <Link href="/statements" className="underline" style={{ color: 'var(--signal)' }}>
                  Open Statements →
                </Link>
              </p>
            </Section>
          ) : null}
        </div>
      </main>

      <HelmFooter module="Today" right="Source: Helm" />
    </div>
  );
}
