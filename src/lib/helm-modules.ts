/**
 * Single source of truth for Helm's module list.
 *
 * The home page renders all of these as cards. The masthead nav inside each
 * module renders the ones with `primary: true` as small-caps tabs so the most-
 * used modules are reachable without going home.
 *
 * `status: 'active'`   - module is built; clicks to `href`
 * `status: 'parked'`   - built but de-prioritized; clicks to `href`,
 *                        renders greyed and sorted to the bottom of
 *                        the menu (no "Soon" badge — it's not coming
 *                        soon, it's just demoted)
 * `status: 'soon'`     - not built yet; placeholder, clicks do nothing
 * `status: 'external'` - lives outside Helm (e.g. Lovable); opens in new tab
 */
export type HelmModule = {
  id: string;
  href: string;
  external?: boolean;
  number: string;
  title: string;
  description: string;
  status: 'active' | 'parked' | 'soon' | 'external';
  primary: boolean;
};

export const HELM_MODULES: HelmModule[] = [
  // ── Active modules, in canonical number order ──────────────────────
  // Inspections (was 03) is intentionally not a module: it has no
  // standalone landing in the menu. An inspection is started from a
  // button on the Turnovers page, and the run flow lives at
  // /inspections/[id]. The /inspections route still exists as the
  // start form + recent list, just not as a nav item.
  {
    id: 'statements',
    href: '/statements',
    number: '01',
    title: 'Statements',
    description: 'Monthly owner statements. Ingest data, reconcile bank deposits, send the deliverable.',
    status: 'active',
    primary: false,
  },
  {
    id: 'operations',
    href: '/operations',
    number: '02',
    title: 'Turnovers',
    description: 'Turnover pipeline. Upcoming check-ins, prep status, and same-day turnaround flags. Live from Guesty. Start an inspection from here.',
    status: 'active',
    primary: true,
  },
  {
    id: 'work',
    href: '/work',
    number: '04',
    title: 'Work',
    description: 'Work slips per property + team tasks. Filter by mine, high priority, due today, unclaimed. Mark done inline.',
    status: 'active',
    primary: true,
  },
  {
    id: 'properties',
    href: '/properties',
    number: '05',
    title: 'Properties',
    description: 'Helm-native property registry. Owner, billing, mgmt fee, address, and a deep-link into recent statements.',
    status: 'active',
    primary: false,
  },
  {
    id: 'projections',
    href: '/projections',
    number: '06',
    title: 'Prospects',
    description: 'The prospect funnel. One record per prospect generates a projection deck, a partnership guide, and a management contract, all from the same shared inputs.',
    status: 'active',
    primary: false,
  },
  {
    id: 'messaging',
    href: '/messaging',
    number: '08',
    title: 'Messaging',
    description: 'Guest message drafts awaiting approval. Approve, reject, or coach the AI right from Helm. Backed by the Stay Concierge service.',
    status: 'active',
    primary: true,
  },
  {
    id: 'revenue',
    href: '/revenue',
    number: '10',
    title: 'Revenue',
    description: 'Portfolio revenue snapshot. Stays, ADR, occupancy, owner payout. Pro-rated by nights from Guesty bookings.',
    status: 'active',
    primary: false,
  },
  {
    id: 'marketing',
    href: '/marketing',
    number: '11',
    title: 'Marketing',
    description: 'Site traffic, conversions, top sources, and Core Web Vitals for both Rising Tide sites. Refreshed nightly.',
    status: 'active',
    primary: false,
  },
  {
    id: 'forecast',
    href: '/forecast',
    number: '12',
    title: 'Forecast',
    description: 'The 2026 business plan as an interactive model. Slide the lever to see how new contracts move the year.',
    status: 'active',
    primary: false,
  },
  {
    id: 'guests',
    href: '/guests',
    number: '13',
    title: 'Guests',
    description: 'Guest-facing subscriber list, segments, and campaigns. The Weekly, ad-hoc broadcasts, welcome journeys. Replaces Squarespace contacts.',
    status: 'active',
    primary: false,
  },
  // Reviews is not a module of its own — it's the "Reviews" tab inside
  // the Guests section (/guests?tab=reviews). /reviews redirects there.
  {
    id: 'competitors',
    href: '/competitors',
    number: '15',
    title: 'Competitors',
    description: 'Other vacation rental managers in the Cape Ann market. Inventory size, town mix, unit count. Phase 1 starts with Atlantic Vacation Homes.',
    status: 'active',
    primary: false,
  },
  // ── Parked: built but de-prioritized. Greyed + sorted to the bottom,
  //    non-clickable in the nav. The routes still resolve by direct URL
  //    (the Today daily brief is texted to Dotti with a direct link, so
  //    parking it from the menu doesn't break the morning send). Flip
  //    `status` back to 'active' to un-park. ──────────────────────────
  {
    id: 'today',
    href: '/today',
    number: '00',
    title: 'Today',
    description: 'Daily brief. Replies waiting, turnovers, work slips, drafts. Texted to Dotti every morning.',
    status: 'parked',
    primary: false,
  },
  {
    id: 'crm',
    href: '/crm',
    number: '07',
    title: 'CRM',
    description: 'Owners, vendors, leads. Every touch logged in one place.',
    status: 'parked',
    primary: false,
  },
  {
    id: 'channels',
    href: '/channels',
    number: '16',
    title: 'Channels',
    description: 'The Helm-native replacement for Guesty. Multi-channel listings, iCal calendar sync, unified bookings.',
    status: 'parked',
    primary: false,
  },
  // ── Not built yet ──────────────────────────────────────────────────
  {
    id: 'guest-intel',
    href: '#',
    number: '08a',
    title: 'Guest Intel',
    description: 'Upcoming-guest dossiers. Reservation context, reasons for travel, special requests.',
    status: 'soon',
    primary: false,
  },
  {
    id: 'admin',
    href: '#',
    number: '09',
    title: 'Admin',
    description: 'Settings, inspection templates, automation rules, team, roles.',
    status: 'soon',
    primary: false,
  },
];

/**
 * Display order for the primary masthead nav. Independent of HELM_MODULES
 * array order so the master list can stay in module-number order while
 * the nav shows the daily-flow tabs in the order Dotti reads them
 * left-to-right: Turnovers (the ops pipeline), Work (the persistent
 * backlog board), and Messaging (the guest-reply queue, which carries a
 * pending-count badge so she can see at a glance whether anything's
 * waiting).
 */
const PRIMARY_ORDER: string[] = ['operations', 'work', 'messaging'];

export const PRIMARY_MODULES = HELM_MODULES
  .filter((m) => m.primary)
  .sort((a, b) => {
    const ai = PRIMARY_ORDER.indexOf(a.id);
    const bi = PRIMARY_ORDER.indexOf(b.id);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

/**
 * Display order for the mobile menu specifically. Phones have a single
 * vertical scrolling list with every module on it, so what's actually
 * tapped on a phone (messaging, the turnover pipeline, the inspection
 * walks, work slips, properties, prospects) ranks above the ops-room
 * surfaces that get used at a desk (forecast, marketing, revenue, etc.).
 *
 * Independent of PRIMARY_ORDER because the desktop top-nav and the
 * mobile menu serve different jobs: top nav is "five tabs I always have
 * visible," mobile menu is "every module ranked by tap frequency."
 *
 * "soon" modules slide to the very bottom regardless of canonical
 * number so the visible-and-inert ones don't push down the
 * visible-and-usable ones.
 */
const MOBILE_ORDER: string[] = [
  'messaging',
  'operations',
  'work',
  'properties',
  'projections',
];

export const MOBILE_MODULES = [...HELM_MODULES].sort((a, b) => {
  const ai = MOBILE_ORDER.indexOf(a.id);
  const bi = MOBILE_ORDER.indexOf(b.id);

  // Both in the priority list: priority order wins.
  if (ai !== -1 && bi !== -1) return ai - bi;
  // Only one in the priority list: it goes first.
  if (ai !== -1) return -1;
  if (bi !== -1) return 1;

  // Neither ranked. Push parked + soon to the bottom (both are
  // greyed bottom-tier in the menu UI); otherwise keep canonical
  // module-number order from HELM_MODULES.
  const aBottom = a.status === 'soon' || a.status === 'parked';
  const bBottom = b.status === 'soon' || b.status === 'parked';
  if (aBottom !== bBottom) return aBottom ? 1 : -1;
  return HELM_MODULES.indexOf(a) - HELM_MODULES.indexOf(b);
});
