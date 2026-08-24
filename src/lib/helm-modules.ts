/**
 * Single source of truth for Helm's module list.
 *
 * The home page is Ask Helm + signal tiles + the For Me feed; it does not
 * render this list as cards. Discovery runs through the masthead (the
 * seven `primary: true` small-caps tabs: Work, Turnovers, Field, Messaging,
 * Properties, Money, Growth), the "More" menu (now the Library, a small
 * shelf of reference modules), and Cmd+K search, all of which read from
 * here. The masthead's active tab derives from the pathname via
 * activeModuleIdForPathname, not from a per-page prop.
 *
 * `status: 'active'`   - module is built; clicks to `href`
 * `status: 'parked'`   - built but de-prioritized; clicks to `href`,
 *                        renders greyed and sorted to the bottom of
 *                        the menu (no "Soon" badge - it's not coming
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
  /**
   * Masthead / mobile display name when it differs from `title`. Titles stay
   * the search vocabulary ('Financials', 'Marketing'); navLabel is what the
   * tab actually says ('Money', 'Growth').
   */
  navLabel?: string;
  /**
   * Id of the primary module whose masthead tab lights up when the user is
   * inside this module. Defaults to the module's own id.
   */
  section?: string;
  /**
   * Extra pathname prefixes for modules whose href is not a usable prefix,
   * e.g. an href carrying a query string.
   */
  routePrefixes?: string[];
};

export const HELM_MODULES: HelmModule[] = [
  // ── Active modules, in canonical number order ──────────────────────
  {
    id: 'financials',
    // Default landing for the Financials section is Revenue (the
    // portfolio at-a-glance), not Statements -- per Dotti, 2026-05-23.
    // The FinancialsTabs strip still lets you jump to Statements /
    // Forecast / Cost Analysis from there.
    href: '/revenue',
    number: '01',
    title: 'Financials',
    navLabel: 'Money',
    description: 'Money: Statements, Revenue, Forecast, and Cost Analysis in one place. Owner statements, portfolio revenue, the year model, and housekeeping cost trends.',
    status: 'active',
    primary: true,
    group: 'money',
  },
  // Statements / Revenue / Forecast are tabs inside Financials (see
  // FinancialsTabs). Kept in the registry so their routes + search resolve,
  // but hidden from the nav lists so they don't duplicate the Financials
  // entry. section: 'financials' lights the Money tab on all four pages.
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
    section: 'financials',
  },
  {
    id: 'operations',
    href: '/turnovers',
    number: '02',
    title: 'Turnovers',
    description: 'Turnover pipeline. Upcoming check-ins, prep status, and same-day turnaround flags. Live from Guesty. Start an inspection from here.',
    status: 'active',
    primary: true,
    group: 'operations',
  },
  // Inspections has no menu entry: a run is started from a button on the
  // Turnovers page and the flow lives at /inspections/[id]. Registered here
  // for search, surfaced in-context (hidden from menus).
  {
    id: 'inspections',
    href: '/inspections',
    number: '02a',
    title: 'Inspections',
    description: 'Start a property inspection and browse recent runs. The run flow itself lives at /inspections/[id].',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'operations',
    section: 'operations',
  },
  // A Turnovers tab (TurnoverTabs), so no menu entry of its own. Registered
  // for search; the daily digest approval lives on /cleaner-messaging.
  {
    id: 'checkout-schedule',
    href: '/turnovers/schedule',
    number: '02b',
    title: 'Cleaner Schedule',
    description: 'Checkout schedule the cleaners can trust: Guesty bookings merged with late checkouts and extensions Helm knows about. Feeds the daily digest text to Rosa and her live mobile page.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'operations',
    section: 'operations',
  },
  // FieldTabs still handles the job-type/lens sub-navigation underneath.
  {
    id: 'field',
    href: '/fieldwork/packets',
    number: '03',
    title: 'Field',
    description: 'External contractor portal. Pool nearby inspections into priced packets, publish them to 1099 inspectors, and review completed work.',
    status: 'active',
    primary: true,
    group: 'operations',
    // Catch-all so lens routes without their own registry entry
    // (/fieldwork/rate-card, /fieldwork/hiring-package) still light the
    // Field tab; the longer per-lens prefixes above and below win where
    // they exist.
    routePrefixes: ['/fieldwork'],
  },
  // Roster is the Field section's Roster lens (see FieldTabs). Registered
  // here for search, surfaced in-context (hidden from menus).
  {
    id: 'roster',
    href: '/fieldwork/roster',
    number: '03a',
    title: 'Field Roster',
    description: 'The 1099 contractor roster. Profiles, trades, rates, and standing for everyone who works the fleet.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'operations',
    section: 'field',
  },
  {
    id: 'hiring',
    href: '/fieldwork/hiring',
    number: '03b',
    title: 'Hiring',
    description: 'Applicant pipeline. Review applications, invite or decline, track source channels.',
    status: 'active',
    primary: false,
    // A tab inside the Field section (see FieldTabs: Packets / Contractors /
    // Hiring), so it's hidden from the standalone nav lists -- route + search
    // still resolve, it just doesn't duplicate the Field entry.
    hidden: true,
    group: 'operations',
    section: 'field',
  },
  // Creative is reached from the Operations surface, not the menus.
  // Registered here for search, surfaced in-context (hidden from menus).
  {
    id: 'creative',
    href: '/fieldwork/shoots',
    number: '03c',
    title: 'Creative Shoots & Pay',
    description: 'The creative pay ledger. Log shoots and assets, review deliverables, approve and pay the crew.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'operations',
    section: 'field',
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
  // The gear grid is reached from the Work board and the specialists'
  // property-work board. Registered here for search, surfaced in-context
  // (hidden from menus).
  {
    id: 'gear',
    href: '/work/gear',
    number: '04a',
    title: 'Guest Gear Grid',
    description: 'Which properties hold which guest gear. Pack-n-plays, high chairs, and where each one lives.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'operations',
    section: 'work',
  },
  // PropertiesTabBar still handles the Prospects sub-tab underneath.
  {
    id: 'properties',
    href: '/properties',
    number: '05',
    title: 'Properties',
    description: 'Helm-native property registry. Owner, billing, mgmt fee, address, and a deep-link into recent statements.',
    status: 'active',
    primary: true,
    group: 'relationships',
  },
  // Listing Copy Studio is reached from the Properties surface.
  // Registered here for search, surfaced in-context (hidden from menus).
  {
    id: 'listing-copy-studio',
    href: '/properties/listing-copy-studio',
    number: '05a',
    title: 'Listing Copy Studio',
    description: 'Review and rewrite the editorial copy on every Stay Cape Ann listing. Taglines, About, highlights.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'growth',
    section: 'properties',
  },
  // Bedroom Photos is reached from the Properties surface.
  // Registered here for search, surfaced in-context (hidden from menus).
  {
    id: 'bedroom-photos',
    href: '/properties/bedroom-photos',
    number: '05b',
    title: 'Bedroom Photos',
    description: 'Per-bedroom photo coverage across the fleet. Which rooms are shot, which still need the camera.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'growth',
    section: 'properties',
  },
  // Contracts register is a tab on the Properties surface.
  // Registered here for search, surfaced in-context (hidden from menus).
  {
    id: 'property-contracts',
    href: '/properties/contracts',
    number: '05c',
    title: 'Management Contracts',
    description: 'Every owner agreement: fee, term, renewal mechanics, notice deadlines, negotiated clauses, signed PDFs.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'relationships',
    section: 'properties',
  },
  // Prospects is now a TAB inside Properties (the Prospects tab at
  // /properties/prospects), same pattern as Statements / Revenue under
  // Financials. Hidden from the nav lists so it doesn't duplicate the
  // Properties entry; the prospect detail/create routes (/prospects/[id],
  // /prospects/new) still resolve and Cmd+K search still finds it. The
  // standalone /projections index redirects to the Properties tab.
  {
    id: 'projections',
    href: '/properties/prospects',
    number: '06',
    title: 'Prospects',
    description: 'The prospect funnel. One record per prospect generates a projection deck, a partnership guide, and a management contract, all from the same shared inputs.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'growth',
    section: 'properties',
    // The workroom lives at /prospects/...; /projections/... still hosts
    // the public deliverable surfaces (render, guide, contract,
    // onboarding-render) plus the legacy redirect stub, so both prefixes
    // light the Properties tab.
    routePrefixes: ['/prospects', '/projections'],
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
  // The Send lens of the Guests tab: pick a stay and write to them. Hidden
  // from the nav lists (Messaging already carries the section) but registered
  // so the command palette can jump straight here, which is the whole point
  // of a surface used mid-turnover.
  {
    id: 'messaging-send',
    href: '/messaging/send',
    number: '08e',
    title: 'Send a Guest Message',
    description: 'Pick a stay and send a message: check-in notes, day-of updates, anything you start rather than reply to. The Send lens of the Messaging Guests tab.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'relationships',
    section: 'messaging',
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
    section: 'messaging',
  },
  // Cleaner Messaging is a TAB inside Messaging (see MessagingTabs), same as
  // Owner Messaging above. Hidden from the nav lists so it doesn't duplicate
  // the Messaging entry; route + search still resolve.
  {
    id: 'cleaner-messaging',
    href: '/cleaner-messaging',
    number: '08c',
    title: 'Cleaner Messaging',
    description: 'Bilingual reply drafts for Rosa and Nina. Portuguese draft + English translation side-by-side, plus translation of their inbound message. Approve, reject, or coach the AI from Helm.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'relationships',
    section: 'messaging',
  },
  // Contractor Messaging is a TAB inside Messaging (see MessagingTabs), same
  // as Owner and Cleaner Messaging above. Registered here for search,
  // surfaced in-context (hidden from menus).
  {
    id: 'contractor-messaging',
    href: '/contractor-messaging',
    number: '08d',
    title: 'Contractor Messaging',
    description: 'Reply drafts for field contractors. The Contractors tab of the Messaging section. Approve, reject, or coach the AI from Helm.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'relationships',
    section: 'messaging',
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
    section: 'financials',
  },
  {
    id: 'marketing',
    href: '/marketing',
    number: '11',
    title: 'Marketing',
    navLabel: 'Growth',
    description: 'Growth: site traffic, conversions, top sources, and Core Web Vitals for both Rising Tide sites. Refreshed nightly.',
    status: 'active',
    primary: true,
    group: 'growth',
  },
  // AirDNA is reached from the Marketing surface. Registered here for
  // search, surfaced in-context (hidden from menus).
  {
    id: 'airdna',
    href: '/marketing/airdna',
    number: '11a',
    title: 'AirDNA Market Data',
    description: 'AirDNA market comps for the fleet. Upload the CSVs, read occupancy, ADR, and revenue benchmarks.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'growth',
    section: 'marketing',
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
    section: 'financials',
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
    section: 'financials',
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
    section: 'financials',
  },
  // Guests is now a TAB inside Marketing (see MarketingTabs). Hidden from the
  // nav lists so it doesn't duplicate the Marketing entry; GuestsTabBar still
  // handles the Reviews/Contacts/Agreements sub-tabs underneath.
  {
    id: 'guests',
    href: '/guests',
    number: '13',
    title: 'Guests',
    description: 'Guest-facing subscriber list, segments, and campaigns. The Weekly, ad-hoc broadcasts, welcome journeys. Replaces Squarespace contacts.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'growth',
    section: 'marketing',
  },
  // Contacts and Agreements are the other two Guests lenses, now real
  // routes under /guests. Registered here for search, surfaced in-context
  // (hidden from menus).
  {
    id: 'guest-contacts',
    href: '/guests/contacts',
    number: '13a',
    title: 'Guest Contacts',
    description: 'The guest contact list. Subscribers, segments, and per-guest history behind the campaigns.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'growth',
    section: 'marketing',
  },
  {
    id: 'agreements',
    href: '/guests/agreements',
    number: '13b',
    title: 'Guest Agreements',
    description: 'Stay Cape Ann rental agreements. Send, track signatures, countersign, archive the PDF.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'growth',
    section: 'marketing',
  },
  // Reviews is not a module of its own - it's the "Reviews" tab inside
  // the Guests section (/guests?tab=reviews). /reviews redirects there.
  // Competitors is surfaced as a tab of the Growth strip, so it's hidden
  // from the nav lists; route + search still resolve.
  {
    id: 'competitors',
    href: '/competitors',
    number: '15',
    title: 'Competitors',
    description: 'Other vacation rental managers in the Cape Ann market. Inventory size, town mix, unit count. Phase 1 starts with Atlantic Vacation Homes.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'growth',
    section: 'marketing',
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
  // Search finally gets a standing nav entry: the full-results page for
  // Cmd+K queries, shelved in the Library.
  {
    id: 'search',
    href: '/search',
    number: '18',
    title: 'Search',
    description: 'Full-results search across every Helm module. The long-form view behind the Cmd+K palette.',
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
    // Now a TAB inside Work (see WorkTabs); hidden from the nav lists for
    // the same reason as Turnovers/Field/Properties above.
    id: 'today',
    href: '/today',
    number: '00',
    title: 'Today',
    description: 'Daily brief. Replies waiting, turnovers, work slips, drafts. The full-expansion view of the home feed; texted every morning.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'operations',
    section: 'work',
  },
  {
    // Un-parked: CRM is in daily circulation via property pages and the
    // home feed, so it reads at full strength in the Library.
    id: 'crm',
    href: '/crm',
    number: '07',
    title: 'CRM',
    description: 'Owners, vendors, leads. Every touch logged in one place.',
    status: 'active',
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
  // No 'soon' placeholders at the moment. The status + group machinery
  // stays: a future not-built entry renders dimmed and inert in the menus.
];

/**
 * Display order for the primary masthead nav. Independent of HELM_MODULES
 * array order so the master list can stay in module-number order while the
 * nav shows the seven sections in the order Dotti reads them left-to-right:
 * Work, Turnovers, Field, Messaging (which carries the pending-count badge),
 * Properties, Money (Financials), Growth (Marketing).
 */
const PRIMARY_ORDER: string[] = ['work', 'operations', 'field', 'messaging', 'properties', 'financials', 'marketing'];

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
// It renders the same PRIMARY_MODULES pair plus the same overflow set the
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

// The "More" menu is now the Library: a small shelf of reference modules.
// Pinned in this exact reading order, regardless of group.
const OVERFLOW_PRIORITY = ['playbook', 'crm', 'channels', 'search'];

/**
 * The flat "More" menu list both the desktop dropdown and the mobile sheet
 * render: the grouped overflow flattened, then the priority modules pulled to
 * the front in OVERFLOW_PRIORITY order. Single source of truth so the two
 * surfaces stay congruent.
 */
export function getOverflowModulesFlat(): HelmModule[] {
  const flat = getGroupedOverflowModules().flatMap((s) => s.modules);
  const pinned = OVERFLOW_PRIORITY
    .map((id) => flat.find((m) => m.id === id))
    .filter((m): m is HelmModule => !!m);
  const pinnedIds = new Set(pinned.map((m) => m.id));
  return [...pinned, ...flat.filter((m) => !pinnedIds.has(m.id))];
}

/**
 * Resolve which masthead tab lights up for a pathname. Every module
 * contributes candidate prefixes (its href with any query/hash stripped,
 * plus routePrefixes); the longest matching prefix wins and its module's
 * `section ?? id` is returned. This drives the masthead active state; a
 * page cannot lie about where it is. Client-safe: pure data + string ops.
 */
export function activeModuleIdForPathname(pathname: string): string | undefined {
  let bestModule: HelmModule | undefined;
  let bestPrefix = '';
  for (const m of HELM_MODULES) {
    const stripped = m.href.split(/[?#]/)[0];
    const candidates = m.routePrefixes ? [stripped, ...m.routePrefixes] : [stripped];
    for (const prefix of candidates) {
      if (!prefix || prefix === '#') continue;
      const matches = pathname === prefix || pathname.startsWith(prefix + '/');
      if (matches && prefix.length > bestPrefix.length) {
        bestModule = m;
        bestPrefix = prefix;
      }
    }
  }
  return bestModule ? (bestModule.section ?? bestModule.id) : undefined;
}
