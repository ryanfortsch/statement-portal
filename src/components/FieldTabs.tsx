'use client';

import Link from 'next/link';
import { NavTabCount } from './NavTabCount';
import { SectionTabs } from './SectionTabs';
import { useHelmRole } from './useHelmRole';
import { NAV_TRADES, TRADE_META, type ContractorTrade } from '@/lib/field-types';

/**
 * Sub-navigation for the Field section, in two rows.
 *
 * Row 1 (job type) is the primary axis: Inspectors, Handymen, Creative. Each is
 * its own hiring track, roster, and paid-work stream. Picking one scopes the
 * whole section to that trade via ?trade=. It renders through SectionTabs, the
 * shared strip primitive, with `current` passed explicitly because the trade
 * lives in the query string and the pathname cannot derive it.
 *
 * Row 2 (lens) is the function within a job: Packets (the priced work board),
 * Shoots & Pay (creative's planner grid + money surface), Roster (the people), Hiring (the
 * applicant pipeline), Trades (the outside vendors we dispatch). Packets only
 * shows for trades that use the packet machinery - creative work is paid per
 * delivered asset, so its board is Shoots & Pay instead. It rides in the
 * primitive's secondRow slot.
 *
 * Trades and Close handoff are fleet-wide chores, not a job type's: a
 * plumber is a plumber whichever row-1 tab you came from, and the month's
 * repair costs are the month's. They sit off the trade grid: their links
 * carry no ?trade=, no row-1 tab lights on them, and a row-1 tab clicked
 * from one of them opens that trade's own board (UI/UX audit, 2026-10-17:
 * "Handymen > Trades" read as the handymen's vendors, and nothing on the
 * page changed with the trade).
 *
 * Role-aware: Shoots & Pay is the creative pay ledger, owners only
 * (`/fieldwork/shoots` is in OWNER_PATH_PREFIXES). For a staff login the
 * lens is not offered and the Creative tab lands on Roster instead, so no
 * tab here leads to /not-available. Row 1 goes through SectionTabs, which
 * applies the same rule to any href it is handed; the lens row is this
 * strip's own markup, so it asks the role itself.
 */

type FieldLens = 'packets' | 'shoots' | 'contractors' | 'hiring' | 'trades' | 'close';

/** The lenses that belong to no job type: no ?trade=, no lit row-1 tab. */
const TRADELESS: ReadonlySet<FieldLens> = new Set<FieldLens>(['trades', 'close']);

const LENS_HREF: Record<FieldLens, string> = {
  packets: '/fieldwork/packets',
  shoots: '/fieldwork/shoots',
  contractors: '/fieldwork/roster',
  hiring: '/fieldwork/hiring',
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
  // A job-type tab keeps you on the same lens where that lens exists for the
  // target trade; otherwise it lands on that trade's own work board: Packets
  // for the trades that dispatch packets, Shoots & Pay for creative (the
  // planner grid and the pay ledger, which is where creative work is run
  // from). Landing creative on its Roster, as this used to, put the people
  // list in front of the work every time (Dotti, 2026-09-21). Staff cannot
  // open the pay ledger, so for them creative's home is the Roster after all.
  const hasShoots = (t: ContractorTrade) => TRADE_META[t].hasShoots && owner;
  const lensExists = (lens: FieldLens, t: ContractorTrade) =>
    lens === 'packets' ? TRADE_META[t].hasPackets : lens === 'shoots' ? hasShoots(t) : true;
  const homeLens = (t: ContractorTrade): FieldLens =>
    TRADE_META[t].hasPackets ? 'packets' : hasShoots(t) ? 'shoots' : 'contractors';
  const tradeless = TRADELESS.has(current);
  // From a trade-less lens a job-type tab opens that trade's own board.
  const jobHref = (t: ContractorTrade) =>
    `${LENS_HREF[!tradeless && lensExists(current, t) ? current : homeLens(t)]}?trade=${t}`;

  const lenses = (
    [
      TRADE_META[trade].hasPackets ? { id: 'packets', label: 'Packets' } : null,
      hasShoots(trade) ? { id: 'shoots', label: 'Shoots & Pay' } : null,
      { id: 'contractors', label: 'Roster' },
      { id: 'hiring', label: 'Hiring' },
      { id: 'trades', label: 'Trades' },
      // The month-close handoff: field data for the statement close. Off
      // the trade grid, like Trades.
      { id: 'close', label: 'Close handoff' },
    ].filter(Boolean) as { id: FieldLens; label: string }[]
  ).map((l) => ({ ...l, href: TRADELESS.has(l.id) ? LENS_HREF[l.id] : `${LENS_HREF[l.id]}?trade=${trade}` }));

  return (
    <SectionTabs
      // An empty id lights nothing: a trade-less lens has no job type.
      current={tradeless ? '' : trade}
      tabs={NAV_TRADES.map((t) => ({ id: t, label: TRADE_META[t].label, href: jobHref(t), badgeOutside: true, badge: <NavTabCount kind="fieldPackets" trade={t} href={`/fieldwork/packets?trade=${t}&focus=review#needs-review`} /> }))}
      secondRow={
        <div className="flex items-center" style={{ gap: 16, paddingTop: 10, paddingBottom: 2, overflowX: 'auto' }}>
          {lenses.map((l, i) => {
            const isActive = l.id === current;
            return (
              <span key={l.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 16, whiteSpace: 'nowrap' }}>
                {i > 0 && <span style={{ color: 'var(--rule)', fontSize: 12 }}>·</span>}
                <Link
                  href={l.href}
                  aria-current={isActive ? 'page' : undefined}
                  style={{
                    fontSize: 12,
                    letterSpacing: '.06em',
                    textTransform: 'uppercase',
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? 'var(--ink)' : 'var(--ink-4)',
                    textDecoration: 'none',
                  }}
                >
                  {l.label}
                </Link>
              </span>
            );
          })}
        </div>
      }
    />
  );
}
