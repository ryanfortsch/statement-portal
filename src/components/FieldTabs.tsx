import Link from 'next/link';
import { NAV_TRADES, TRADE_META, type ContractorTrade } from '@/lib/field-types';

/**
 * Sub-navigation for the Field section, in two rows.
 *
 * Row 1 (job type) is the primary axis: Inspectors, Handymen, Creative. Each is
 * its own hiring track, roster, and paid-work stream. Picking one scopes the
 * whole section to that trade via ?trade=.
 *
 * Row 2 (lens) is the function within a job: Packets (the priced work board),
 * Roster (the people), Hiring (the applicant pipeline). Packets only shows for
 * trades that use the packet machinery — creative work is paid per delivered
 * asset, so it has no packet board.
 *
 * Plain server-rendered links, no client state (mirrors FinancialsTabs). The
 * masthead separately highlights "Field" (each page passes current="field").
 */

const LENS_HREF: Record<'packets' | 'contractors' | 'hiring', string> = {
  packets: '/operations/packets',
  contractors: '/operations/contractors',
  hiring: '/operations/contractors/applicants',
};

export function FieldTabs({
  current,
  trade = 'inspection',
}: {
  current: 'packets' | 'contractors' | 'hiring';
  trade?: ContractorTrade;
}) {
  // A job-type tab keeps you on the same lens where that lens exists for the
  // target trade; if you're on Packets and switch to a packet-less trade
  // (creative), land on its Roster instead of a dead board.
  const jobHref = (t: ContractorTrade) => {
    const lens = current === 'packets' && !TRADE_META[t].hasPackets ? 'contractors' : current;
    return `${LENS_HREF[lens]}?trade=${t}`;
  };

  const lenses = (
    [
      TRADE_META[trade].hasPackets ? { id: 'packets', label: 'Packets' } : null,
      { id: 'contractors', label: 'Roster' },
      { id: 'hiring', label: 'Hiring' },
    ].filter(Boolean) as { id: 'packets' | 'contractors' | 'hiring'; label: string }[]
  ).map((l) => ({ ...l, href: `${LENS_HREF[l.id]}?trade=${trade}` }));

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 20 }}>
      {/* Row 1 — job type */}
      <div className="flex items-baseline" style={{ gap: 26, borderBottom: '1px solid var(--ink)', overflowX: 'auto' }}>
        {NAV_TRADES.map((t) => {
          const isActive = t === trade;
          return (
            <Link
              key={t}
              href={jobHref(t)}
              style={{
                fontSize: 14,
                letterSpacing: '.03em',
                textTransform: 'uppercase',
                fontWeight: 600,
                color: isActive ? 'var(--ink)' : 'var(--ink-4)',
                textDecoration: 'none',
                paddingBottom: 12,
                borderBottom: isActive ? '2px solid var(--signal)' : '2px solid transparent',
                marginBottom: -1,
                whiteSpace: 'nowrap',
              }}
            >
              {TRADE_META[t].label}
            </Link>
          );
        })}
      </div>

      {/* Row 2 — lens within the active job */}
      <div className="flex items-center" style={{ gap: 16, paddingTop: 10, paddingBottom: 2, overflowX: 'auto' }}>
        {lenses.map((l, i) => {
          const isActive = l.id === current;
          return (
            <span key={l.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 16, whiteSpace: 'nowrap' }}>
              {i > 0 && <span style={{ color: 'var(--rule)', fontSize: 12 }}>·</span>}
              <Link
                href={l.href}
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
    </section>
  );
}
