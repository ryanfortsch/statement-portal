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
    href: '#',
    number: '02',
    title: 'Operations',
    description: 'Today’s turnovers, calendar, and wallboard. Daily ops between checkouts and check-ins.',
    status: 'soon',
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
    href: '#',
    number: '04',
    title: 'Work',
    description: 'Work slips, tasks, queue, and execution log. Get the day done.',
    status: 'soon',
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
    title: 'Projections',
    description: 'Prospect revenue estimates. Punch in a property, get a print-ready 11-page deck to send to the prospective owner.',
    status: 'active',
    primary: true,
  },
  {
    id: 'crm',
    href: '#',
    number: '07',
    title: 'CRM',
    description: 'Contacts, households, owners. Comms log via Quo. Pinned notes and tags.',
    status: 'soon',
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
];

export const PRIMARY_MODULES = HELM_MODULES.filter((m) => m.primary);
