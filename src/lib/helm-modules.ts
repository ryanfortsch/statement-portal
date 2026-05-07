/**
 * Single source of truth for Helm's module list.
 *
 * The home page renders all of these as cards. The masthead nav inside each
 * module renders the ones with `primary: true` as small-caps tabs so the most-
 * used modules are reachable without going home.
 *
 * `status: 'active'`   - module is built; clicks to `href`
 * `status: 'soon'`     - placeholder; clicks do nothing (or anchor)
 * `status: 'external'` - lives outside Helm (e.g. Lovable); opens in new tab
 */
export type HelmModule = {
  id: string;
  href: string;
  external?: boolean;
  number: string;
  title: string;
  description: string;
  status: 'active' | 'soon' | 'external';
  primary: boolean;
};

export const HELM_MODULES: HelmModule[] = [
  {
    id: 'statements',
    href: '/statements',
    number: '01',
    title: 'Statements',
    description: 'Monthly owner statements. Ingest data, reconcile bank deposits, send the deliverable.',
    status: 'active',
    primary: true,
  },
  {
    id: 'operations',
    href: '/operations',
    number: '02',
    title: 'Operations',
    description: 'Turnover pipeline. Upcoming check-ins, prep status, and same-day turnaround flags. Live from Guesty.',
    status: 'active',
    primary: true,
  },
  {
    id: 'inspections',
    href: '/inspections',
    number: '03',
    title: 'Inspections',
    description: 'Walk a property, run the standard 50-item checklist, mark Pass / Issue / N/A, and produce a summary. Helm-native.',
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
    description: 'The prospect funnel. One record per prospect generates a projection deck, a partnership guide, and a management contract — all from the same shared inputs.',
    status: 'active',
    primary: true,
  },
  {
    id: 'crm',
    href: '/crm',
    number: '07',
    title: 'CRM',
    description: 'Owners, vendors, leads. Every touch logged in one place.',
    status: 'active',
    primary: true,
  },
  {
    id: 'guest-intel',
    href: '#',
    number: '08',
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
  {
    id: 'revenue',
    href: '/revenue',
    number: '10',
    title: 'Revenue',
    description: 'Portfolio revenue snapshot. Stays, ADR, occupancy, owner payout. Pro-rated by nights from Guesty bookings.',
    status: 'active',
    primary: true,
  },
  {
    id: 'marketing',
    href: '/marketing',
    number: '11',
    title: 'Marketing',
    description: 'GA4 traffic, conversions, top sources, and Core Web Vitals for both Rising Tide sites. Refreshed nightly.',
    status: 'active',
    primary: false,
  },
  {
    id: 'forecast',
    href: '/forecast',
    number: '12',
    title: 'Forecast',
    description: 'The 2026 business plan as an interactive model. Slide the lever to see how new contracts move the year — revenue, expenses, spring crunch, cash-positive months.',
    status: 'active',
    primary: false,
  },
  {
    id: 'audience',
    href: '/audience',
    number: '13',
    title: 'Audience',
    description: 'Guest-facing subscriber list, segments, and campaigns. The Weekly, ad-hoc broadcasts, welcome journeys. Replaces Squarespace contacts.',
    status: 'active',
    primary: true,
  },
];

export const PRIMARY_MODULES = HELM_MODULES.filter((m) => m.primary);
