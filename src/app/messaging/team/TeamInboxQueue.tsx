'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { useQueueRefresh } from '@/components/QueueRefreshControl';
import { useApprovalQueue } from '@/lib/use-approval-queue';
import type { CleanerApproval, ContractorApproval } from '@/lib/stay-concierge';
import type { ApprovalContext } from '@/lib/contractor-approval-context';
import { ApprovalQueue } from '@/components/messaging/card/ApprovalQueue';
import { Pill } from '@/components/messaging/card/buttons';
import { CleanerCard } from '@/app/cleaner-messaging/CleanerCard';
import { ContractorCard } from '@/app/contractor-messaging/ContractorCard';
import { undoCleanerDecision } from '@/app/cleaner-messaging/actions';
import { undoContractorDecision } from '@/app/contractor-messaging/actions';
import { TEAM_AUDIENCES, teamHref, type TeamAudience } from '@/lib/team-inbox';

type PropertyOption = { id: string; name: string };

// The rest of the page re-renders on this cadence; the cards poll their own
// feeds every 15s.
const PAGE_REFRESH_MS = 60_000;

const AUDIENCE_TONE = { cleaner: '#1f5e6b', contractor: '#7a5c3a' } as const;

type Row =
  | { id: string; status: string; send_at: string; created_at: string; kind: 'cleaner'; approval: CleanerApproval }
  | { id: string; status: string; send_at: string; created_at: string; kind: 'contractor'; approval: ContractorApproval };

/**
 * The Team inbox (2026-10-18): the cleaner and contractor queues as one list,
 * each card wearing whose it is, with a filter row. The two pages differed by
 * one option group and one warning; a new hire learned one and was wrong on
 * the other. Each audience keeps its own feed, its own card blocks and its
 * own server actions (Next server actions are per-route).
 */
export function TeamInboxQueue({
  initialCleaners,
  initialContractors,
  contractorContext,
  properties,
  audience,
  aiPaused,
}: {
  initialCleaners: CleanerApproval[];
  initialContractors: ContractorApproval[];
  contractorContext?: Record<string, ApprovalContext>;
  properties: PropertyOption[];
  audience: TeamAudience;
  /** The drafting AI is down: a card with no draft says so. */
  aiPaused?: { reason?: string } | null;
}) {
  const cleaners = useApprovalQueue(initialCleaners, 'cleaners');
  const contractors = useApprovalQueue<ContractorApproval, Record<string, ApprovalContext>>(
    initialContractors,
    'contractors',
    contractorContext,
  );
  const { softRefresh } = useQueueRefresh(PAGE_REFRESH_MS);
  const refreshCleaners = cleaners.refresh;
  const refreshContractors = contractors.refresh;
  const onRefresh = useCallback(() => {
    refreshCleaners();
    refreshContractors();
    softRefresh();
  }, [refreshCleaners, refreshContractors, softRefresh]);

  const all: Row[] = [
    ...cleaners.approvals.map((a) => ({ id: a.id, status: a.status, send_at: a.send_at, created_at: a.created_at, kind: 'cleaner' as const, approval: a })),
    ...contractors.approvals.map((a) => ({ id: a.id, status: a.status, send_at: a.send_at, created_at: a.created_at, kind: 'contractor' as const, approval: a })),
  ].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const waiting = (kind: Row['kind']) => all.filter((r) => r.kind === kind && r.status !== 'scheduled').length;
  const counts = { all: waiting('cleaner') + waiting('contractor'), cleaners: waiting('cleaner'), contractors: waiting('contractor') };
  const shown = audience === 'all' ? all : all.filter((r) => (audience === 'cleaners' ? r.kind === 'cleaner' : r.kind === 'contractor'));

  return (
    <ApprovalQueue
      approvals={shown}
      onRefresh={onRefresh}
      undo={(id, kind) => (kind === 'contractor' ? undoContractorDecision(id) : undoCleanerDecision(id))}
      emptyMessage={
        audience === 'cleaners'
          ? 'No cleaner texts waiting.'
          : audience === 'contractors'
            ? 'No contractor texts waiting.'
            : 'No cleaner or contractor texts waiting.'
      }
      toolbar={<TeamFilter audience={audience} counts={counts} />}
      renderCard={(row, helpers) => {
        const tagged = { ...helpers, onDecided: (d: { id: string; name: string; property?: string }) => helpers.onDecided({ ...d, audience: row.kind }) };
        const chip = <Pill label={row.kind === 'cleaner' ? 'Cleaner' : 'Contractor'} tone={AUDIENCE_TONE[row.kind]} />;
        return row.kind === 'cleaner' ? (
          <CleanerCard
            key={row.id}
            approval={row.approval}
            properties={properties}
            helpers={tagged}
            onRegenerating={cleaners.watchRegen}
            regenStalled={cleaners.stalledId === row.id}
            audienceChip={chip}
            aiPaused={aiPaused}
          />
        ) : (
          <ContractorCard
            key={row.id}
            approval={row.approval}
            properties={properties}
            ctx={contractors.context?.[row.id]}
            helpers={tagged}
            onRegenerating={contractors.watchRegen}
            regenStalled={contractors.stalledId === row.id}
            audienceChip={chip}
            aiPaused={aiPaused}
          />
        );
      }}
    />
  );
}

/** All · Cleaners · Contractors, each with what is waiting. A link, so the
 *  sections that belong to one audience (the schedule text, "clean after?")
 *  follow the filter on the server. */
function TeamFilter({ audience, counts }: { audience: TeamAudience; counts: Record<TeamAudience, number> }) {
  const label: Record<TeamAudience, string> = { all: 'All', cleaners: 'Cleaners', contractors: 'Contractors' };
  return (
    <nav aria-label="Whose messages" className="rt-team-filter" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
      {TEAM_AUDIENCES.map((a) => {
        const active = a === audience;
        return (
          <Link
            key={a}
            href={teamHref(a)}
            scroll={false}
            aria-current={active ? 'page' : undefined}
            style={{
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              fontWeight: active ? 700 : 500,
              color: active ? 'var(--paper)' : 'var(--ink-2)',
              background: active ? 'var(--ink)' : 'var(--paper)',
              border: `1px solid ${active ? 'var(--ink)' : 'var(--rule)'}`,
              padding: '7px 12px',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {label[a]}
            {counts[a] > 0 ? ` · ${counts[a]}` : ''}
          </Link>
        );
      })}
    </nav>
  );
}
