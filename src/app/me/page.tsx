import Link from 'next/link';
import type { ReactNode } from 'react';
import { auth } from '@/auth';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { Section } from '@/components/Section';
import { Stat } from '@/components/Stat';
import { isOwnerSession } from '@/lib/helm-access-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { assignableTeam, getTeamMember, type TeamMember } from '@/lib/team';
import { loadInspectorRecord } from '@/lib/inspector-reviews';
import { getReviewWindowStats } from '@/lib/reviews';
import { loadOpenWorkFor } from '@/lib/open-work-for';
import { loadInspectorCleaningReviews } from '@/lib/cleaning-reviews';
import { noticeWord, summarizeCleaningReviews, type CleaningReviewRow } from '@/lib/cleaning-reviews-core';
import { addDays } from '@/lib/inspector-reviews-core';
import { houseDay } from '@/lib/house-date';
import { etDateOf } from '@/lib/vendor-visit-dates';
import { teamHref } from '@/lib/team-inbox';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * My page (2026-11-07): the signed-in person's own numbers. Four, then the
 * three ledgers behind them.
 *
 *   - Their guest rating: the guests' stars on the stays they walked before,
 *     one chain for staff walks and the Field packets they ran as a
 *     contractor (inspector-reviews.ts).
 *   - The fleet's rating, trailing 30 days: the Reviews tab's own number.
 *   - Open work: the board's "mine" (slips they perform or coordinate).
 *   - Cleans: the stars they gave the crew at the end of each walk, and
 *     where each note stands (cleaning-reviews.ts).
 *
 * Staff see only their own. An owner opens it as themselves and may read a
 * teammate's with ?as=<email>; a staff login's ?as= is ignored.
 */

type Person = Pick<TeamMember, 'email' | 'name' | 'short' | 'role' | 'starts' | 'fieldEmails'>;

const ROLE_WORD: Record<TeamMember['role'], string> = {
  principal: 'Principal',
  operations: 'Operations',
  inspector: 'Inspector',
  contractor: 'Contractor',
};

/** property id -> internal name, so a row can say which home. */
async function loadHomeNames(): Promise<Map<string, string>> {
  try {
    const { data } = await supabaseAdmin.from('properties').select('id, name');
    return new Map(((data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]));
  } catch {
    return new Map();
  }
}

function personFor(email: string): Person {
  const member = getTeamMember(email);
  if (member) return member;
  const local = email.split('@')[0];
  const short = local.replace(/^./, (c) => c.toUpperCase());
  return { email, name: short, short, role: 'operations', starts: undefined, fieldEmails: [] };
}

export default async function MePage({ searchParams }: { searchParams: Promise<{ as?: string | string[] }> }) {
  const [session, owner, sp] = await Promise.all([auth(), isOwnerSession(), searchParams]);
  const me = session?.user?.email?.toLowerCase() ?? '';
  const asked = (Array.isArray(sp.as) ? sp.as[0] : sp.as)?.toLowerCase() ?? '';
  const target = owner && asked && getTeamMember(asked) ? asked : me;
  const person = personFor(target);
  const emails = [person.email, ...(person.fieldEmails ?? [])];
  const today = etDateOf(new Date());
  const since30 = addDays(today, -30);

  const [record, fleet, work, cleans, homes] = await Promise.all([
    loadInspectorRecord(emails).catch(() => null),
    getReviewWindowStats(30),
    loadOpenWorkFor(person.email).catch(() => ({ items: [], overdue: 0 })),
    loadInspectorCleaningReviews(emails).catch(() => [] as CleaningReviewRow[]),
    loadHomeNames(),
  ]);
  const cleanSummary = summarizeCleaningReviews(cleans, since30);

  const line = [
    ROLE_WORD[person.role],
    person.starts ? `since ${houseDay(person.starts)}` : null,
    record && record.walksThisMonth > 0 ? `${record.walksThisMonth} walk${record.walksThisMonth === 1 ? '' : 's'} this month` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <HelmHero plain eyebrow="Helm · My page" title={person.short} line={line} />

      {owner && <TeammateSwitch me={me} current={person.email} />}

      <div className="max-w-[1100px] mx-auto px-10" style={{ width: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', borderTop: '1px solid var(--ink)' }}>
          <Stat
            label="My guest rating"
            value={<StarValue avg={record?.summary.avg ?? null} />}
            sub={record ? `${record.summary.count} stay${record.summary.count === 1 ? '' : 's'} reviewed` : 'Could not be read'}
          />
          <Stat
            label="Fleet · 30 days"
            value={<StarValue avg={fleet.avg} />}
            sub={fleet.total ? `${fleet.total} review${fleet.total === 1 ? '' : 's'} · ${fleet.fiveStar} five-star` : 'No reviews yet'}
          />
          <Stat label="Open work" value={work.items.length} sub={work.overdue ? `${work.overdue} past due` : work.items.length ? 'None past due' : 'Nothing open'} />
          <Stat
            label="Cleans · 30 days"
            value={<StarValue avg={cleanSummary.avg} />}
            sub={cleanSummary.rated ? `${cleanSummary.rated} rated · ${cleanSummary.flagged} flagged` : 'None rated yet'}
            last
          />
        </div>
      </div>

      <Section
        title="Guest reviews"
        right={<QuietLink href="/guests">All reviews →</QuietLink>}
        empty={!record || record.reviews.length === 0}
        emptyMessage={record ? 'No guest reviews on your stays yet.' : 'Reviews could not be read.'}
      >
        <Rows>
          {(record?.reviews ?? []).slice(0, 8).map((r) => (
            <Row
              key={r.reservationId}
              home={r.propertyName}
              text={r.text || 'No written review.'}
              small={[r.guestName ? firstName(r.guestName) : null, r.channel].filter(Boolean).join(' · ')}
              meta={
                <>
                  {r.at ? `${houseDay(r.at)} · ` : ''}
                  <Stars n={r.rating} />
                </>
              }
            />
          ))}
        </Rows>
      </Section>

      <Section
        title="Open work"
        right={<QuietLink href="/work?filter=mine">On Work →</QuietLink>}
        empty={work.items.length === 0}
        emptyMessage="Nothing open."
      >
        <Rows>
          {work.items.slice(0, 8).map((w) => (
            <Row
              key={w.id}
              home={w.propertyName ?? 'Office'}
              text={<Link href={w.href} style={{ color: 'inherit', textDecoration: 'none' }}>{w.title}</Link>}
              meta={w.dueDate ? <span style={{ color: w.overdue ? 'var(--negative)' : undefined }}>{w.overdue ? 'Due ' : ''}{houseDay(w.dueDate)}</span> : w.priority === 'high' ? 'High' : ''}
            />
          ))}
          {work.items.length > 8 && <More href="/work?filter=mine" text={`${work.items.length - 8} more on Work`} />}
        </Rows>
      </Section>

      <Section
        title="Cleans"
        right={<QuietLink href={teamHref('cleaners')}>Team inbox →</QuietLink>}
        empty={cleans.length === 0}
        emptyMessage="No cleans rated yet."
      >
        <Rows>
          {cleans.slice(0, 8).map((c) => (
            <Row
              key={c.id}
              home={homes.get(c.property_id) ?? c.property_id}
              text={c.reason || ''}
              small={[noticeWord(c.notice_status), houseDay(c.walk_date)].filter(Boolean).join(' · ')}
              smallTone={c.notice_status === 'pending' || c.notice_status === 'approving' ? 'var(--signal)' : undefined}
              meta={<Stars n={c.stars} />}
            />
          ))}
        </Rows>
      </Section>

      <div style={{ flex: 1 }} />
      <HelmFooter module="My page" right={houseDay(today)} />
    </>
  );
}

/** An owner reads a teammate's page; a quiet row of names under the head. */
function TeammateSwitch({ me, current }: { me: string; current: string }) {
  const others = assignableTeam().filter((m) => m.email.toLowerCase() !== me);
  if (others.length === 0) return null;
  const item = (label: string, href: string, on: boolean) => (
    <Link key={href} href={href} style={{ color: on ? 'var(--ink)' : 'inherit', textDecoration: 'none', fontWeight: on ? 600 : 500 }}>
      {label}
    </Link>
  );
  return (
    <div className="max-w-[1100px] mx-auto px-10 eyebrow" style={{ width: '100%', paddingBottom: 18, display: 'flex', gap: 14, flexWrap: 'wrap', color: 'var(--ink-3)' }}>
      {item('You', '/me', current === me)}
      {others.map((m) => item(m.short, `/me?as=${encodeURIComponent(m.email)}`, current === m.email.toLowerCase()))}
    </div>
  );
}

function StarValue({ avg }: { avg: number | null }) {
  if (avg == null) return <span style={{ color: 'var(--ink-4)' }}>—</span>;
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      <span aria-hidden style={{ color: 'var(--signal)', fontSize: '0.6em', verticalAlign: '14%', marginRight: 4 }}>★</span>
      {avg.toFixed(avg >= 5 ? 1 : 2)}
    </span>
  );
}

function Stars({ n }: { n: number }) {
  const on = Math.max(0, Math.min(5, Math.round(n)));
  return (
    <span aria-label={`${on} of 5 stars`} style={{ color: 'var(--signal)', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
      {'★'.repeat(on)}
      <span style={{ color: 'var(--rule)' }}>{'★'.repeat(5 - on)}</span>
    </span>
  );
}

function QuietLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} style={{ fontSize: 12, color: 'var(--tide-deep)', fontWeight: 600, textDecoration: 'none' }}>
      {children}
    </Link>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <div style={{ borderTop: '1px solid var(--ink)' }}>{children}</div>;
}

/** One ledger row: the home, what it is, and the date or stars at the end. */
function Row({ home, text, small, smallTone, meta }: { home: string; text: ReactNode; small?: string; smallTone?: string; meta: ReactNode }) {
  return (
    <div
      className="rt-me-row"
      style={{ display: 'grid', gridTemplateColumns: 'minmax(96px, 128px) minmax(0, 1fr) auto', gap: 16, alignItems: 'baseline', padding: '13px 0', borderBottom: '1px solid var(--rule)' }}
    >
      <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>{home}</span>
      <span style={{ fontSize: 14, color: 'var(--ink)', minWidth: 0, overflowWrap: 'anywhere' }}>
        {text}
        {small && <small style={{ display: 'block', marginTop: 3, fontSize: 12, color: smallTone ?? 'var(--ink-3)', lineHeight: 1.45 }}>{small}</small>}
      </span>
      <span style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{meta}</span>
    </div>
  );
}

function More({ href, text }: { href: string; text: string }) {
  return (
    <div style={{ padding: '12px 0' }}>
      <QuietLink href={href}>{text} →</QuietLink>
    </div>
  );
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}
