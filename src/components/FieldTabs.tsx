'use client';

import { NavTabCount } from './NavTabCount';
import { SectionTabs } from './SectionTabs';
import { useHelmRole } from './useHelmRole';
import { TRADE_META, type ContractorTrade } from '@/lib/field-types';

/**
 * Sub-navigation for the Field section: one row of functions, like every
 * other section's strip (UX audit, 2026-11-07, finding 1).
 *
 * Jobs (the priced work board), Shoots & Pay (creative's planner grid and
 * pay ledger), Roster (the people, with the applicants at the top), Trades
 * (the outside vendors we dispatch) and Close handoff (the field's part of
 * the statement close). The trade is not a tab any more: it is the first
 * filter chip inside Jobs and Roster, the two boards that filter by it.
 * Jobs and Roster carry the trade you are on, so moving between them keeps
 * it; Trades and Close handoff belong to no trade and carry none.
 *
 * The review badge rides Jobs and counts every trade's submitted jobs. It
 * opens the lit trade's Needs review, which names the other trades' counts
 * one line below its own list.
 *
 * Role-aware: Shoots & Pay is the creative pay ledger, owners only
 * (`/fieldwork/shoots` is in OWNER_PATH_PREFIXES). SectionTabs drops any
 * tab the proxy would bounce, and this strip asks the role itself too, so
 * no tab here leads to /not-available. Staff reach creative through the
 * Roster's Creative chip.
 */

type FieldLens = 'packets' | 'shoots' | 'contractors' | 'trades' | 'close';

const LENS_HREF: Record<FieldLens, string> = {
  packets: '/fieldwork/packets',
  shoots: '/fieldwork/shoots',
  contractors: '/fieldwork/roster',
  trades: '/fieldwork/trades',
  close: '/fieldwork/close',
};

export function FieldTabs({
  current,
  trade = 'inspection',
}: {
  current: FieldLens;
  trade?: ContractorTrade;
}) {
  const owner = useHelmRole() === 'owner';
  // Jobs keeps the trade when that trade dispatches jobs; from creative
  // (no jobs) it opens the inspectors' board.
  const jobsTrade: ContractorTrade = TRADE_META[trade].hasPackets ? trade : 'inspection';

  // Jobs and Roster carry the trade; Trades and Close handoff carry none.
  const hrefOf = (id: FieldLens) =>
    id === 'packets' ? `${LENS_HREF.packets}?trade=${jobsTrade}` : id === 'contractors' ? `${LENS_HREF.contractors}?trade=${trade}` : LENS_HREF[id];

  const tabs = (
    [
      { id: 'packets', label: 'Jobs' },
      owner ? { id: 'shoots', label: 'Shoots & Pay' } : null,
      { id: 'contractors', label: 'Roster' },
      { id: 'trades', label: 'Trades' },
      // The month-close handoff: field data for the statement close.
      { id: 'close', label: 'Close handoff' },
    ].filter(Boolean) as { id: FieldLens; label: string }[]
  ).map((l) => ({
    ...l,
    href: hrefOf(l.id),
    ...(l.id === 'packets'
      ? { badgeOutside: true, badge: <NavTabCount kind="fieldPackets" href={`/fieldwork/packets?trade=${jobsTrade}&focus=review#needs-review`} /> }
      : {}),
  }));

  return <SectionTabs current={current} tabs={tabs} />;
}
