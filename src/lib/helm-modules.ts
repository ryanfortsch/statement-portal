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
/**
 * The five named sections the overflow nav groups modules into, plus a 'soon'
 * tail for not-yet-built items. Drives the section headers in
 * HelmModuleNavMore and HelmMobileMenu. Order here is render order.
 */
export type HelmGroup = 'money' | 'operations' | 'growth' | 'relationships' | 'reference' | 'soon';

export const HELM_GROUPS: { id: HelmGroup; label: string }[] = [
  { id: 'money',         label: 'Money' },
  { id: 'operations',    label: 'Operations' },
  { id: 'growth',        label: 'Growth' },
  { id: 'relationships', label: 'Relationships' },
  { id: 'reference',     label: 'Reference' },
  { id: 'soon',          label: 'Soon' },
];

export type HelmModule = {
  id: string;
  href: string;
  external?: boolean;
  number: string;
  title: string;
  description: string;
  status: 'active' | 'parked' | 'soon' | 'external';
  primary: boolean;
  /**
   * Hidden from the standalone nav lists (overflow dropdown + mobile
   * menu) because the module is reached as a tab inside a parent section
   * instead. Statements / Revenue / Forecast are tabs of Financials, so
   * they're hidden here and surfaced via the FinancialsTabs strip. Routes
   * and search still resolve; only the redundant nav entries are removed.
   */
  hidden?: boolean;
  /**
   * Which named section the module belongs to in the overflow nav. The
   * dropdown and mobile menu render a section header whenever this changes
   * between consecutive items. Hidden modules can omit it.
   */
  group?: HelmGroup;
};

export const HELM_MODULES: HelmModule[] = [
  // ── Active modules, in canonical number order ──────────────────────
  // Inspections (was 03) is intentionally not a module: it has no
  // standalone landing in the menu. An inspection is started from a
  // button on the Turnovers page, and the run flow lives at
  // /inspections/[id]. The /inspections route still exists as the
  // start form + recent list, just not as a nav item.
  {
    id: 'financials',
    // Default landing for the Financials section is Revenue (the
    // portfolio at-a-glance), not Statements -- per Dotti, 2026-05-23.
    // The FinancialsTabs strip still lets you jump to Statements /
    // Forecast / Cost Analysis from there.
    href: '/revenue',
    number: '01',
    title: 'Financials',
    description: 'Statements, Revenue, Forecast, and Cost Analysis in one place. Owner statements, portfolio revenue, the year model, and housekeeping cost trends.',
    status: 'active',
    primary: false,
    group: 'money',
  },
  // Statements / Revenue / Forecast are tabs inside Financials (see
  // FinancialsTabs). Kept in the registry so their routes + search resolve,
  // but hidden from the nav lists so they don't duplicate the Financials
  // entry. current="financials" highlights the parent on all four pages.
  {
    id: 'statements',
    href: '/statements',
    number: '01',
    title: 'Statements',
    description: 'Monthly owner statements. Ingest data, reconcile bank deposits, send the deliverable.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'money',
  },
  {
    id: 'operations',
    href: '/operations',
    number: '02',
    title: 'Turnovers',
    description: 'Turnover pipeline. Upcoming check-ins, prep status, and same-day turnaround flags. Live from Guesty. Start an inspection from here.',
    status: 'active',
    primary: true,
    group: 'operations',
  },
  {
    id: 'field',
    href: '/operations/packets',
    number: '03',
    title: 'Field',
    description: 'External contractor portal. Pool nearby inspections into priced packets, publish them to 1099 inspectors, and review completed work.',
    status: 'active',
    primary: false,
    group: 'operations',
  },
  {
    id: 'work',
    href: '/work',
    number: '04',
    title: 'Work',
    description: 'Work slips per property + team tasks. Filter by mine, high priority, due today, unclaimed. Mark done inline.',
    status: 'active',
    primary: true,
    group: 'operations',
  },
  {
    id: 'properties',
    href: '/properties',
    number: '05',
    title: 'Properties',
    description: 'Helm-native property registry. Owner, billing, mgmt fee, address, and a deep-link into recent statements.',
    status: 'active',
    primary: false,
    group: 'relationships',
  },
  {
    id: 'projections',
    href: '/projections',
    number: '06',
    title: 'Prospects',
    description: 'The prospect funnel. One record per prospect generates a projection deck, a partnership guide, and a management contract, all from the same shared inputs.',
    status: 'active',
    primary: false,
    group: 'growth',
  },
  {
    id: 'messaging',
    href: '/messaging',
    number: '08',
    title: 'Messaging',
    description: 'Guest message drafts awaiting approval. Approve, reject, or coach the AI right from Helm. Backed by the Stay Concierge service.',
    status: 'active',
    primary: true,
    group: 'relationships',
  },
  // Owner Messaging is now a TAB inside Messaging (see MessagingTabs), same
  // pattern as Statements / Revenue / Forecast / Cost Analysis / Books sitting
  // under Financials. Hidden from the nav lists so it doesn't duplicate the
  // Messaging entry; route + search still resolve. The Messaging
  // pending-count badge sums guest + owner pending drafts.
  {
    id: 'owner-messaging',
    href: '/owner-messaging',
    number: '08b',
    title: 'Owner Messaging',
    description: 'Owner reply drafts from SMS + email. The Owners tab of the Messaging section. Approve, reject, or coach the AI right from Helm.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'relationships',
  },
  {
    id: 'revenue',
    href: '/revenue',
    number: '10',
    title: 'Revenue',
    description: 'Portfolio revenue snapshot. Stays, ADR, occupancy, owner payout. Pro-rated by nights from Guesty bookings.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'money',
  },
  {
    id: 'marketing',
    href: '/marketing',
    number: '11',
    title: 'Marketing',
    description: 'Site traffic, conversions, top sources, and Core Web Vitals for both Rising Tide sites. Refreshed nightly.',
    status: 'active',
    primary: false,
    group: 'growth',
  },
  {
    id: 'forecast',
    href: '/forecast',
    number: '12',
    title: 'Forecast',
    description: 'The 2026 business plan as an interactive model. Slide the lever to see how new contracts move the year.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'money',
  },
  // LLC Accounting ("Books") is a tab inside Financials (see FinancialsTabs),
  // like Statements/Revenue/Forecast/Cost Analysis. Hidden from the nav
  // lists so it doesn't duplicate the Financials entry; route + search
  // still resolve.
  {
    id: 'books',
    href: '/books',
    number: '01',
    title: 'LLC Accounting',
    description: 'In-house bookkeeping for the three LLCs. Categorize bank + card transactions, produce quarterly P&Ls and 1099 prep.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'money',
  },
  // Cost Analysis is the housekeeping-cost trend view -- a tab inside
  // Financials (see FinancialsTabs), not a top-level destination. Registered
  // hidden so search and the Cmd+K palette can resolve it; the only way to
  // reach it via nav is the Financials tab strip.
  {
    id: 'cost-analysis',
    href: '/cost-analysis',
    number: '01',
    title: 'Cost Analysis',
    description: 'Housekeeping cost trends per property. Per-turnover and per-night, plotted month over month.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'money',
  },
  {
    id: 'guests',
    href: '/guests',
    number: '13',
    title: 'Guests',
    description: 'Guest-facing subscriber list, segments, and campaigns. The Weekly, ad-hoc broadcasts, welcome journeys. Replaces Squarespace contacts.',
    status: 'active',
    primary: false,
    group: 'growth',
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
    group: 'growth',
  },
  {
    id: 'playbook',
    href: '/playbook',
    number: '17',
    title: 'Playbook',
    description: 'How we run the business. Standard operating procedures, the eccentricities, and the institutional knowledge of Rising Tide, written down once and searchable everywhere. Ask Helm reads from here.',
    status: 'active',
    primary: false,
    group: 'reference',
  },
  // ── Parked: built but de-prioritized. Greyed + sorted to the bottom,
  //    non-clickable in the nav. The routes still resolve by direct URL.
  //    Flip `status` back to 'active' to un-park. ──────────────────────────
  {
    // /today is the full-expansion view of the home ForMeFeed: same data,
    // deeper. Un-parked because the morning SMS already links here, so the
    // parked status was a mismatch. /me was folded into the home feed in
    // the same pass and now redirects to /.
    id: 'today',
    href: '/today',
    number: '00',
    title: 'Today',
    description: 'Daily brief. Replies waiting, turnovers, work slips, drafts. The full-expansion view of the home feed; texted every morning.',
    status: 'active',
    primary: false,
    group: 'operations',
  },
  {
    id: 'crm',
    href: '/crm',
    number: '07',
    title: 'CRM',
    description: 'Owners, vendors, leads. Every touch logged in one place.',
    status: 'parked',
    primary: false,
    group: 'relationships',
  },
  {
    id: 'channels',
    href: '/channels',
    number: '16',
    title: 'Channels',
    description: 'The Helm-native replacement for Guesty. Multi-channel listings, iCal calendar sync, unified bookings.',
    status: 'parked',
    primary: false,
    group: 'operations',
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
    group: 'soon',
  },
  {
    id: 'admin',
    href: '#',
    number: '09',
    title: 'Admin',
    description: 'Settings, inspection templates, automation rules, team, roles.',
    status: 'soon',
    primary: false,
    group: 'soon',
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

// The mobile menu (HelmMobileMenu) no longer keeps its own ranked list.
// It renders the same PRIMARY_MODULES trio plus the same overflow set the
// desktop "More" dropdown shows (HELM_MODULES minus primary minus hidden),
// so the two surfaces stay congruent from a single source of truth.

/**
 * The overflow set the More dropdown and the mobile menu both render, organised
 * into the five named sections so each surface can paint a header when the
 * group changes. Within a section, active items come first and parked items
 * sort to the bottom (parked is "built but de-prioritized" -- still a real
 * route, just visually demoted). Soon items are their own tail section.
 *
 * Hidden modules (Statements / Revenue / Forecast / LLC Accounting / Cost
 * Analysis -- tabs of Financials) are excluded from the nav lists but their
 * routes still resolve and Cmd+K search still finds them.
 */
export function getGroupedOverflowModules(): { group: HelmGroup; label: string; modules: HelmModule[] }[] {
  const primaryIds = new Set(PRIMARY_MODULES.map((m) => m.id));
  const overflow = HELM_MODULES.filter((m) => !primaryIds.has(m.id) && !m.hidden);

  const statusRank: Record<HelmModule['status'], number> = {
    active: 0,
    external: 0,
    parked: 1,
    soon: 2,
  };

  return HELM_GROUPS.map((g) => ({
    group: g.id,
    label: g.label,
    modules: overflow
      .filter((m) => (m.group ?? 'reference') === g.id)
      .sort((a, b) => statusRank[a.status] - statusRank[b.status]),
  })).filter((s) => s.modules.length > 0);
}
