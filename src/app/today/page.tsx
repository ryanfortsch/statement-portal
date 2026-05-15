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
  type BriefInspection,
  type BriefProspect,
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

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.round(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)} hr ago`;
  return `${Math.round(diffSec / 86400)} d ago`;
}

function StayRow({ s, label }: { s: BriefStay; label: string }) {
  return (
    <li className="flex justify-between items-baseline gap-4 py-1.5 border-b last:border-b-0" style={{ borderColor: 'var(--rule-soft)' }}>
      <div className="text-sm">
        <span className="text-[10px] uppercase tracking-[0.14em] mr-2" style={{ color: 'var(--ink-4)' }}>
          {label}
        </span>
        <Link
          href={`/properties/${s.propertyId}`}
          className="font-medium hover:underline underline-offset-2"
          style={{ color: 'var(--ink)' }}
        >
          {s.propertyName}
        </Link>
        {s.guestName ? <span style={{ color: 'var(--ink-3)' }}> · {s.guestName}</span> : null}
      </div>
      <span className="text-xs" style={{ color: 'var(--ink-4)' }}>
        {s.channel ?? ''}
      </span>
    </li>
  );
}

function InboundList({ items }: { items: BriefInboundTouch[] }) {
  return (
    <ul>
      {items.slice(0, 12).map(t => (
        <li key={t.contactId} className="py-2 border-b last:border-b-0" style={{ borderColor: 'var(--rule-soft)' }}>
          <div className="flex justify-between items-baseline gap-4">
            <Link
              href={`/crm/${t.contactId}`}
              className="text-sm font-medium hover:underline underline-offset-2"
              style={{ color: 'var(--ink)' }}
            >
              {t.contactName ?? 'Unknown contact'}
            </Link>
            <span className="text-[11px]" style={{ color: 'var(--ink-4)' }}>
              {t.daysWaiting === 0 ? 'today' : `${t.daysWaiting}d`} · {t.channel}
            </span>
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--ink-3)' }}>
            {t.summary.length > 130 ? `${t.summary.slice(0, 130)}…` : t.summary}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ApprovalList({ items }: { items: Approval[] }) {
  return (
    <ul>
      {items.slice(0, 8).map(a => (
        <li key={a.id} className="py-2 border-b last:border-b-0" style={{ borderColor: 'var(--rule-soft)' }}>
          <div className="flex justify-between items-baseline gap-4">
            <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
              {a.guest_first} · {a.listing_name}
            </span>
            <span className="text-[11px]" style={{ color: 'var(--ink-4)' }}>
              {a.age_minutes != null ? `${a.age_minutes}m` : ''}
            </span>
          </div>
          <div className="text-xs mt-0.5 italic" style={{ color: 'var(--ink-3)' }}>
            “{a.guest_text.length > 120 ? `${a.guest_text.slice(0, 120)}…` : a.guest_text}”
          </div>
        </li>
      ))}
    </ul>
  );
}

function SlipBlock({ slips, label }: { slips: WorkSlipRow[]; label: string }) {
  if (!slips.length) return null;
  return (
    <div className="mb-3 last:mb-0">
      <div className="text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ink-4)' }}>
        {label}
      </div>
      <ul>
        {slips.slice(0, 10).map(s => (
          <li key={s.id} className="text-sm flex justify-between items-baseline gap-4 py-1 border-b last:border-b-0" style={{ borderColor: 'var(--rule-soft)' }}>
            <Link
              href={`/work/${s.id}`}
              className="hover:underline underline-offset-2"
              style={{ color: 'var(--ink)' }}
            >
              {s.title}
            </Link>
            <span className="text-[11px]" style={{ color: 'var(--ink-4)' }}>
              {s.property_id}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TaskList({ tasks }: { tasks: TaskRow[] }) {
  return (
    <ul>
      {tasks.slice(0, 12).map(t => (
        <li key={t.id} className="text-sm flex justify-between items-baseline gap-4 py-1.5 border-b last:border-b-0" style={{ borderColor: 'var(--rule-soft)' }}>
          <Link
            href={`/work/${t.id}`}
            className="hover:underline underline-offset-2"
            style={{ color: 'var(--ink)' }}
          >
            {t.title}
          </Link>
          <span className="text-[11px]" style={{ color: 'var(--ink-4)' }}>
            {t.due_date ?? (t.priority === 'high' ? 'high' : '')}
          </span>
        </li>
      ))}
    </ul>
  );
}

function GapList({ gaps }: { gaps: BriefDataGap[] }) {
  return (
    <ul>
      {gaps.slice(0, 10).map(g => (
        <li key={g.id} className="text-sm flex justify-between items-baseline gap-4 py-1.5 border-b last:border-b-0" style={{ borderColor: 'var(--rule-soft)' }}>
          <span style={{ color: 'var(--ink)' }}>
            {g.propertyName ?? g.propertyId ?? 'Unknown'}
            {g.month ? <span style={{ color: 'var(--ink-3)' }}> · {g.month}</span> : null}
            <span style={{ color: 'var(--ink-3)' }}> · {g.gapType}</span>
          </span>
          {g.severity ? (
            <span
              className="text-[10px] uppercase tracking-[0.14em]"
              style={{ color: g.severity === 'high' ? 'var(--signal)' : 'var(--ink-4)' }}
            >
              {g.severity}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function InspectionList({ items }: { items: BriefInspection[] }) {
  return (
    <ul>
      {items.map(i => (
        <li key={i.id} className="text-sm flex justify-between items-baseline gap-4 py-1.5 border-b last:border-b-0" style={{ borderColor: 'var(--rule-soft)' }}>
          <Link
            href={`/inspections/${i.id}`}
            className="hover:underline underline-offset-2"
            style={{ color: 'var(--ink)' }}
          >
            {i.propertyName}
          </Link>
          <span className="text-[11px]" style={{ color: 'var(--ink-4)' }}>
            {i.completedAt
              ? new Date(i.completedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
              : 'in progress'}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ProspectList({ items }: { items: BriefProspect[] }) {
  return (
    <ul>
      {items.slice(0, 12).map(p => {
        const meta: string[] = [];
        if (p.status === 'draft') meta.push('draft');
        else if (p.daysSinceSent !== null) meta.push(p.daysSinceSent === 0 ? 'sent today' : `sent ${p.daysSinceSent}d ago`);
        if (p.closeLikelihoodPct != null) meta.push(`${p.closeLikelihoodPct}%`);
        return (
          <li key={p.id} className="py-2 border-b last:border-b-0" style={{ borderColor: 'var(--rule-soft)' }}>
            <div className="flex justify-between items-baseline gap-4">
              <Link
                href={`/projections/${p.id}`}
                className="text-sm font-medium hover:underline underline-offset-2"
                style={{ color: 'var(--ink)' }}
              >
                {p.prospectName}
              </Link>
              <span className="text-[11px]" style={{ color: p.status === 'draft' ? 'var(--signal)' : 'var(--ink-4)' }}>
                {meta.join(' · ')}
              </span>
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--ink-3)' }}>
              {p.propertyAddress}
              {p.propertyCity ? `, ${p.propertyCity}` : ''}
            </div>
          </li>
        );
      })}
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

  const sections: { key: string; title: string; node: React.ReactNode; right?: React.ReactNode }[] = [];

  const stays = [
    ...brief.checkoutsToday.map(s => ({ s, label: 'OUT' })),
    ...brief.checkinsToday.map(s => ({ s, label: 'IN' })),
  ];
  if (stays.length || brief.inspectionsCompletedToday.length) {
    sections.push({
      key: 'stays',
      title: 'On the boards today',
      node: (
        <div>
          {stays.length ? (
            <ul className="mb-3 last:mb-0">
              {stays.map((row, i) => (
                <StayRow key={`${row.label}-${row.s.propertyId}-${i}`} s={row.s} label={row.label} />
              ))}
            </ul>
          ) : null}
          {brief.inspectionsCompletedToday.length ? (
            <div>
              <div className="text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ink-4)' }}>
                Inspections completed
              </div>
              <InspectionList items={brief.inspectionsCompletedToday} />
            </div>
          ) : null}
        </div>
      ),
    });
  }

  if (brief.inboundWaiting.length) {
    sections.push({
      key: 'replies',
      title: `Replies needed (${brief.inboundWaiting.length})`,
      node: (
        <>
          <InboundList items={brief.inboundWaiting} />
          <p className="text-[11px] pt-2 mt-2 border-t" style={{ color: 'var(--ink-4)', borderColor: 'var(--rule-soft)' }}>
            <Link href="/crm" className="hover:underline" style={{ color: 'var(--signal)' }}>
              Open CRM →
            </Link>
          </p>
        </>
      ),
    });
  }

  if (brief.pendingApprovals.length) {
    sections.push({
      key: 'approvals',
      title: `Guest drafts (${brief.pendingApprovals.length})`,
      node: (
        <>
          <ApprovalList items={brief.pendingApprovals} />
          <p className="text-[11px] pt-2 mt-2 border-t" style={{ color: 'var(--ink-4)', borderColor: 'var(--rule-soft)' }}>
            <Link href="/messaging" className="hover:underline" style={{ color: 'var(--signal)' }}>
              Open Messaging →
            </Link>
          </p>
        </>
      ),
    });
  }

  if (brief.activeProspects.length) {
    const draftCount = brief.activeProspects.filter(p => p.status === 'draft').length;
    const labelBits: string[] = [];
    if (draftCount) labelBits.push(`${draftCount} draft${draftCount === 1 ? '' : 's'}`);
    const sentCount = brief.activeProspects.length - draftCount;
    if (sentCount) labelBits.push(`${sentCount} awaiting`);
    sections.push({
      key: 'prospects',
      title: `Prospects (${labelBits.join(', ')})`,
      node: (
        <>
          <ProspectList items={brief.activeProspects} />
          <p className="text-[11px] pt-2 mt-2 border-t" style={{ color: 'var(--ink-4)', borderColor: 'var(--rule-soft)' }}>
            <Link href="/projections" className="hover:underline" style={{ color: 'var(--signal)' }}>
              Open Prospects →
            </Link>
          </p>
        </>
      ),
    });
  }

  if (brief.highPrioritySlips.length || brief.ownerActionSlips.length) {
    sections.push({
      key: 'work',
      title: `Work queue (${brief.totals.activeSlips} active)`,
      node: (
        <>
          <SlipBlock slips={brief.highPrioritySlips} label="High priority" />
          <SlipBlock slips={brief.ownerActionSlips} label="Owner action needed" />
          <p className="text-[11px] pt-2 mt-2 border-t" style={{ color: 'var(--ink-4)', borderColor: 'var(--rule-soft)' }}>
            <Link href="/work" className="hover:underline" style={{ color: 'var(--signal)' }}>
              Open Work →
            </Link>
          </p>
        </>
      ),
    });
  }

  if (brief.dueTasks.length) {
    sections.push({
      key: 'tasks',
      title: `Tasks (${brief.dueTasks.length})`,
      node: <TaskList tasks={brief.dueTasks} />,
    });
  }

  if (brief.unresolvedDataGaps.length) {
    sections.push({
      key: 'gaps',
      title: `Statement gaps (${brief.unresolvedDataGaps.length})`,
      node: (
        <>
          <GapList gaps={brief.unresolvedDataGaps} />
          <p className="text-[11px] pt-2 mt-2 border-t" style={{ color: 'var(--ink-4)', borderColor: 'var(--rule-soft)' }}>
            <Link href="/statements" className="hover:underline" style={{ color: 'var(--signal)' }}>
              Open Statements →
            </Link>
          </p>
        </>
      ),
    });
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="today" />

      <main className="max-w-[1100px] mx-auto px-10 py-10 flex-1 w-full">
        <header className="mb-10">
          <div className="text-[11px] uppercase tracking-[0.18em] mb-2" style={{ color: 'var(--signal)' }}>
            Daily Brief
          </div>
          <h1 className="font-serif" style={{ color: 'var(--ink)', letterSpacing: '-0.01em', fontSize: 44, lineHeight: 1.05, fontWeight: 400 }}>
            {prettyDate(brief.date)}
          </h1>
          <p className="font-serif mt-3" style={{ color: 'var(--ink-3)', fontSize: 18 }}>
            {headline}
          </p>
        </header>

        {sections.length ? (
          <div className="grid md:grid-cols-2 gap-x-10 gap-y-8">
            {sections.map(s => (
              <Section key={s.key} title={s.title} paddingTop={0} paddingBottom={0}>
                {s.node}
              </Section>
            ))}
          </div>
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
            Gmail synced {relativeTime(brief.lastGmailSyncAt)}
          </span>
          <span>
            {brief.totals.activeSlips} slips · {brief.totals.activeTasks} tasks ·{' '}
            {brief.totals.activeProspects} prospects
          </span>
        </div>
      </main>

      <HelmFooter module="Today" right="Source: Helm" />
    </div>
  );
}
