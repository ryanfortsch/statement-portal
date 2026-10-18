/**
 * Single source of truth for Helm's module list.
 *
 * The home page is Ask Helm + signal tiles + the For Me feed; it does not
 * render this list as cards. Discovery runs through the masthead (the
 * seven `primary: true` small-caps tabs: Work, Turnovers, Field, Messaging,
 * Properties, Money, Growth; staff get five, see `access` and `masthead`),
 * the "More" menu (now the Library, a small shelf of reference modules),
 * and Cmd+K search, all of which read from
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
  /**
   * `'owner'` keeps the module out of a staff login's nav and search. The
   * route itself is turned away by the proxy (OWNER_PATH_PREFIXES in
   * helm-access.ts); this flag is what stops the chrome linking there.
   * The two lists must agree: the test in helm-access.test.ts checks it.
   */
  access?: 'owner';
  /**
   * `'owner'` makes a primary module a masthead tab for owners only; a staff
   * login finds it in the More menu instead. Unlike `access`, nothing is
   * gated: the route, its search entry and its pages stay open to staff.
   * Growth carries it (2026-10-18): nothing under it is a daily operations
   * duty, so it is a shelf for staff and a section for owners.
   */
  masthead?: 'owner';
};

import type { HelmRole } from '@/lib/helm-access';

/** Whether a role gets to see a module in the nav and in search. */
export function moduleVisibleTo(m: HelmModule, role: HelmRole): boolean {
  return m.access !== 'owner' || role === 'owner';
}

/** Whether a module is a masthead tab for this role (not just reachable). */
function onMastheadFor(m: HelmModule, role: HelmRole): boolean {
  return m.primary && moduleVisibleTo(m, role) && (m.masthead !== 'owner' || role === 'owner');
}

export const HELM_MODULES: HelmModule[] = [
  // ── Active modules, in canonical number order ──────────────────────
  {
    id: 'financials',
    // Default landing for the Financials section is Revenue (the
    // portfolio at-a-glance), not Statements -- per Dotti, 2026-05-23.
    // The FinancialsTabs strip still lets you jump to Statements /
    // Forecast / LLC Accounting from there.
    href: '/revenue',
    number: '01',
    title: 'Financials',
    navLabel: 'Money',
    description: 'Money: Statements, Revenue, Forecast and LLC Accounting in one place. Owner statements, portfolio revenue, the year model with its actuals, and the LLC ledgers.',
    status: 'active',
    primary: true,
    group: 'money',
    access: 'owner',
  },
  // Statements / Revenue / Forecast are tabs inside Financials (see
  // FinancialsTabs). Kept in the registry so their routes + search resolve,
  // but hidden from the nav lists so they don't duplicate the Financials
  // entry. section: 'financials' lights the Money tab on all four pages.
  {
    id: 'payments',
    href: '/payments',
    number: '01',
    title: 'Stripe lookup',
    description:
      "Did this guest pay? Guest payments read live from the property's own Stripe account (Guesty reports $0 on every direct booking). Read-only. Balance charges live under it.",
    status: 'active',
    primary: false,
    hidden: true,
    section: 'financials',
    group: 'money',
    access: 'owner',
  },
  {
    id: 'balance-charges',
    href: '/payments/balance-charges',
    number: '01',
    title: 'Balance charges',
    description:
      "Far-future booking balances, charged to the card the guest saved at deposit once their charge date arrives. One confirm per charge, in the property's own Stripe account.",
    status: 'active',
    primary: false,
    hidden: true,
    section: 'financials',
    group: 'money',
    access: 'owner',
  },
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
    access: 'owner',
  },
  {
    id: 'operations',
    href: '/turnovers',
    number: '02',
    title: 'Turnovers',
    description: 'Turnover pipeline. Upcoming check-ins, prep status, and same-day turnaround flags. Live from Guesty. Start a walk from here.',
    status: 'active',
    primary: true,
    group: 'operations',
  },
  // Walks has no menu entry: it is the Walks tab of Turnovers and the walk
  // flow lives at /inspections/[id] (the route keeps its old name; a person
  // reads "walk"). Registered here for search, surfaced in-context (hidden
  // from menus). The id stays 'inspections' so a search for the old word
  // still lands here: search matches title, description and id.
  {
    id: 'inspections',
    href: '/inspections',
    number: '02a',
    title: 'Walks',
    description: 'Walk a home and browse recent walks. The walk itself lives at /inspections/[id].',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'operations',
    section: 'operations',
  },
  // A Turnovers tab (TurnoverTabs), so no menu entry of its own. Registered
  // for search; the daily digest approval lives on the Team inbox.
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
  // Not a tab: the schedule page links here from its foot, and the property
  // page sends staff here to add a cleaner. Who gets the daily text and
  // each home's default checkout and cleaner finish times.
  {
    id: 'cleaner-settings',
    href: '/turnovers/settings',
    number: '02d',
    title: 'Cleaner settings',
    description: 'Who gets the daily cleaner text (recipients, scope, language, their live page link) and each home\'s default checkout and cleaner finish times.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'operations',
    section: 'operations',
  },
  // Not a tab: the pipeline links here under its list. Every home by day
  // for the next 7, 14 or 30 days; the one place the occupancy calendar
  // renders (the home page and the pipeline both let it go).
  {
    id: 'occupancy-calendar',
    href: '/turnovers/calendar',
    number: '02e',
    title: 'Occupancy calendar',
    description: 'Every home by day for the next 7, 14 or 30 days: who is in, who leaves, which nights are open.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'operations',
    section: 'operations',
  },
  // Not a tab any more: each checkout's cleaner verdict prints on its board
  // row. What is left is the crew's visits no row can show, reached from
  // the board and the home feed's "Cleanings to check".
  {
    id: 'cleanings',
    href: '/turnovers/cleanings',
    number: '02c',
    title: 'From Cape Ann Elite',
    description: "Cape Ann Elite's visits the turnover board cannot show: a cleaning booked where nobody checks out, and days they have not announced yet. Read from the Jobber reminders they text the Quo line.",
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
    href: '/fieldwork/roster#applicants',
    number: '03b',
    title: 'Hiring',
    description: 'Applicants, at the top of each roster. Review applications, invite or decline, track source channels.',
    status: 'active',
    primary: false,
    // The Applicants section of the Roster (Hiring folded into it,
    // 2026-10-18), so it's hidden from the standalone nav lists -- search
    // still resolves it, it just doesn't duplicate the Field entry.
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
    description: 'Send a contributor to an empty home from the planner grid, and the creative pay ledger: shoots and assets, deliverables, approve and pay the crew.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'operations',
    section: 'field',
    access: 'owner',
  },
  // Trades is the Field section's vendor directory (see FieldTabs). The
  // description carries the trade vocabulary on purpose: Cmd+K for "plumber"
  // or "exterminator" has to land here, and searchPages matches description
  // text as well as title.
  {
    id: 'trades',
    href: '/fieldwork/trades',
    number: '03d',
    title: 'Trades & Vendors',
    description: 'Who we call when something breaks. The outside vendor directory: plumber, electrician, HVAC, appliance repair, handyman, locksmith, exterminator and pest control, landscaper, roofer, painter, chimney, septic, snow removal. Numbers, after-hours lines, rates, insurance.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'operations',
    section: 'field',
  },
  // The month-close handoff: the field data (repair costs, card charges by
  // home, cleaning issues) the operations manager sends three days before
  // the statement close, filed into statements by an owner from the
  // statement card. Open to staff on purpose: nothing on it moves money.
  {
    id: 'close-handoff',
    href: '/fieldwork/close',
    number: '03e',
    title: 'Close handoff',
    description: 'Field data for the monthly statement close: repair costs, card charges by home and cleaning issues, added through the month and sent three days before the close. Owners file each item into the statement.',
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
    description: 'Work slips per property, plus office to-dos that belong to no house. Filter by mine, high priority, due today, unassigned. Mark done inline.',
    status: 'active',
    primary: true,
    group: 'operations',
  },
  {
    id: 'maintenance-runs',
    href: '/work/maintenance',
    number: '04b',
    title: 'Maintenance',
    description: 'Handyman jobs bundled onto days a home is empty. Publish a run for a contractor to claim, or email the work order to a vendor.',
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
  // Every home's Stay Cape Ann launcher on one read-only list, reached from
  // the Properties surface. It replaced the Listing Copy Studio and the
  // fleet Bedroom Photos page (2026-10-18), which both redirect here.
  // Registered here for search, surfaced in-context (hidden from menus).
  {
    id: 'stay-cape-ann-listings',
    href: '/properties/stay-cape-ann',
    number: '05a',
    title: 'Stay Cape Ann listings',
    description: 'Every home on staycapeann.com and its launcher. Copy to review, bedroom photos, live pages.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'growth',
    section: 'properties',
  },
  // Bedroom Photos (05b) was retired into each home's Stay Cape Ann
  // launcher on 2026-10-18; /properties/bedroom-photos redirects there.
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
    access: 'owner',
  },
  // The guest gear grid, a fact about the homes: a tab on the Properties
  // strip and the specialists' property-work board (it was a Work tab until
  // 2026-10-18; /work/gear redirects). Registered for search, hidden from
  // menus.
  {
    id: 'gear',
    href: '/properties/guest-gear',
    number: '05f',
    title: 'Guest gear',
    description: 'Which homes hold which guest gear. Pack-n-plays, high chairs, and where each one lives.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'operations',
    section: 'properties',
  },
  // The fleet-wide trash-day notice print page. Reached from a property's
  // Guest Deliverables tile; registered here for search, hidden from menus.
  {
    id: 'trash-notices',
    href: '/properties/trash-notices',
    number: '05e',
    title: 'Trash day notices',
    description: 'The 4 x 6 fridge card for every Gloucester home, one per printed page: collection day, carts out the night before and back in once emptied, where the carts live.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'operations',
    section: 'properties',
  },
  {
    id: 'property-onboarding',
    // A section of the Properties roster since 2026-10-18; the old board
    // route redirects to the anchor.
    href: '/properties#coming-online',
    number: '05d',
    title: 'Coming online',
    description: 'Every home on a Launch list: progress, what is next and who owns it, and the live homes still carrying open required steps (Guesty cleaning automation, PriceLabs, the roster).',
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
    access: 'owner',
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
  // Diagnostics stay searchable without adding another primary nav item.
  {
    id: 'messaging-status',
    href: '/messaging/status',
    number: '08f',
    title: 'Message Delivery & Sync',
    description: 'Message import checks, source coverage, and pending work sync.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'relationships',
    section: 'messaging',
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
  // The Quality lens of the Guests tab: how the AI is doing and what it is
  // being taught. Off the Inbox since 2026-10-17 so the working page ends at
  // Conversations; hidden from the nav lists, reachable from the lens row,
  // the one-line "N property facts to file" on each queue page, and search.
  {
    id: 'messaging-quality',
    href: '/messaging/quality',
    number: '08g',
    title: 'Messaging Quality',
    description: 'How the guest AI is doing and what it is being taught: performance, learned facts, rules coached repeatedly, and property facts waiting to be filed. The Quality lens of the Messaging Guests tab.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'relationships',
    section: 'messaging',
  },
  // The Saved replies lens of the Guests tab. Registered so Cmd+K and the
  // breadcrumb registry know it exists; it had no atlas entry until
  // 2026-10-17.
  {
    id: 'messaging-blurbs',
    href: '/messaging/blurbs',
    number: '08h',
    title: 'Saved Replies',
    description: 'Answers in your own words that the guest AI quotes verbatim when a question matches. Approve, edit, retire. The Saved replies lens of the Messaging Guests tab.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'relationships',
    section: 'messaging',
  },
  // Owner Messaging is now a TAB inside Messaging (see MessagingTabs), same
  // pattern as Statements / Revenue / Forecast / Books sitting
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
    access: 'owner',
  },
  // The Team inbox is a TAB inside Messaging (see MessagingTabs): the cleaner
  // and contractor queues as one list since 2026-10-18 (/cleaner-messaging
  // and /contractor-messaging redirect here). Hidden from the nav lists so
  // it doesn't duplicate the Messaging entry; route + search still resolve.
  {
    id: 'messaging-team',
    href: '/messaging/team',
    number: '08c',
    title: 'Team Messages',
    description: 'Cleaner and contractor texts in one inbox. Portuguese drafts with the English beside them for Rosa and the crew, the daily schedule text and "clean after?" questions, and contractor replies with the work slip each text implies. The Team tab of the Messaging section.',
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
    access: 'owner',
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
    // A masthead tab for owners; staff reach it from More.
    masthead: 'owner',
    group: 'growth',
  },
  // AirDNA is reached from the Marketing surface (owners only: the upload is
  // an owner chore and its reminder texts the owner). Registered here for
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
    access: 'owner',
  },
  {
    id: 'forecast',
    href: '/forecast',
    number: '12',
    title: 'Forecast',
    description: 'The business plan as an interactive model: slide the lever to see how new contracts move the year. Actuals at the foot: upload the company card and operating exports and see where the money goes.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'money',
    section: 'financials',
    access: 'owner',
  },
  // LLC Accounting ("Books") is a tab inside Financials (see FinancialsTabs),
  // like Statements/Revenue/Forecast. Hidden from the nav
  // lists so it doesn't duplicate the Financials entry; route + search
  // still resolve.
  {
    id: 'books',
    href: '/books',
    number: '01',
    title: 'LLC Accounting',
    description: 'In-house bookkeeping for the three LLCs. Bank and card transactions, categorized against the chart of accounts, and the year\'s 1099 candidates on the Rising Tide ledger.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'money',
    section: 'financials',
    access: 'owner',
  },
  // The tabs of the one Growth strip (GrowthTabs, rendered by the Growth
  // layouts): Marketing, Reviews, Contacts, Agreements, Quotes, Competitors.
  // Hidden from the nav lists so they don't duplicate the Growth entry;
  // registered for search. Reviews lives at the bare /guests (the id stays
  // 'guests' so old references resolve), and the word Guests no longer
  // names it.
  {
    id: 'guests',
    href: '/guests',
    number: '13',
    title: 'Reviews',
    description: 'Every guest review Guesty synced: stars, the public text and the private feedback, by home and channel, over 7, 30, 90 days or a year.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'growth',
    section: 'marketing',
  },
  {
    id: 'guest-contacts',
    href: '/guests/contacts',
    number: '13a',
    title: 'Guest Contacts',
    description: 'The guest contact list: subscribers, campaigns, and each guest\'s record. Where The Weekly is sent from.',
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
  {
    id: 'quotes',
    href: '/guests/quotes',
    number: '13c',
    title: 'Custom Quotes',
    description: 'Stay Cape Ann custom quotes and booking requests. Compose the price in Helm; the guest accepts and pays on staycapeann.com.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'growth',
    section: 'marketing',
    access: 'owner',
  },
  {
    id: 'competitors',
    href: '/competitors',
    number: '15',
    title: 'Competitors',
    description: 'Other vacation rental managers in the Cape Ann market. Inventory size, town mix, unit count.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'growth',
    section: 'marketing',
    // Owner-of-record research on competitor-managed homes is prospecting.
    access: 'owner',
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
    // Un-parked: CRM is in daily circulation via property pages and the
    // home feed, so it reads at full strength in the Library.
    id: 'crm',
    href: '/crm',
    number: '07',
    title: 'CRM',
    description: 'Owners, vendors, leads. Every call, text, email and visit logged in one place, as each contact\'s activity.',
    status: 'active',
    primary: false,
    group: 'relationships',
  },
  // Channels is the Helm-native PMS, and until a Cape Ann home is Helm-run
  // (calendar_authority is guesty for every one; 65 Calderwood is a
  // read-only pilot) a write there reaches no OTA. So it is off the More
  // menu (hidden, 2026-10-18): a home's Channels link on its property page
  // and Cmd+K reach it, and the route stays. Un-hide it when a Cape Ann home
  // is flipped. Its pages light the Properties tab (section), since they are
  // reached from a home. The three lenses below are registered only so
  // Cmd+K resolves "multi-calendar", "channel wiring" and "bookings"
  // straight to the page; searchPages matches title / description / id and
  // ignores `hidden`.
  {
    id: 'channels',
    href: '/channels',
    number: '16',
    title: 'Channels',
    description: 'Listings, rates, calendars, bookings, and the per-property cutover from Guesty.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'operations',
    section: 'properties',
  },
  {
    id: 'channels-calendar',
    href: '/channels/calendar',
    number: '16a',
    title: 'Multi-calendar',
    description: 'One row per property, day columns, nightly price on vacant days, booking bars by channel. Edit price, min-stay and closed nights; drag to block. The multi-calendar of the Channels section.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'operations',
    section: 'properties',
  },
  {
    id: 'channels-listings',
    // Per home since 2026-10-18: the Edit wiring fold on each home's hub.
    href: '/channels',
    number: '16b',
    title: 'Channel wiring',
    description: 'Per-channel listing ids, URLs, iCal import feeds and the Helm export link for Airbnb, VRBO, Booking.com and Guesty, and which OTA imports Helm: Edit wiring on each home\'s channel hub. The switch that cuts a home over from Guesty to Helm is Prepare cutover on the same hub.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'operations',
    section: 'properties',
  },
  {
    id: 'channels-bookings',
    href: '/channels/bookings',
    number: '16c',
    title: 'Bookings',
    description: 'Every stay and block on the Helm calendar across channels: confirmed, pending, cancelled, owner holds. Open a booking, move its dates, cancel it, or create a manual one.',
    status: 'active',
    primary: false,
    hidden: true,
    group: 'operations',
    section: 'properties',
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

/**
 * The masthead tabs a role gets. Staff lose the Money tab (owner-gated) and
 * the Growth tab (`masthead: 'owner'`, which moves it to their More menu).
 */
export function primaryModulesFor(role: HelmRole): HelmModule[] {
  return PRIMARY_MODULES.filter((m) => onMastheadFor(m, role));
}

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
export function getGroupedOverflowModules(role: HelmRole = 'owner'): { group: HelmGroup; label: string; modules: HelmModule[] }[] {
  // A primary module that is not on this role's masthead (Growth for staff)
  // lands here instead, so it is demoted, never lost.
  const mastheadIds = new Set(primaryModulesFor(role).map((m) => m.id));
  const overflow = HELM_MODULES.filter((m) => !mastheadIds.has(m.id) && !m.hidden && moduleVisibleTo(m, role));

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
// Pinned in this exact reading order, regardless of group. 'marketing' only
// reaches the list for staff, whose masthead has no Growth tab; 'channels'
// only once it is un-hidden (a Cape Ann home Helm-run).
const OVERFLOW_PRIORITY = ['playbook', 'crm', 'channels', 'marketing', 'search'];

/**
 * The flat "More" menu list both the desktop dropdown and the mobile sheet
 * render: the grouped overflow flattened, then the priority modules pulled to
 * the front in OVERFLOW_PRIORITY order. Single source of truth so the two
 * surfaces stay congruent.
 */
export function getOverflowModulesFlat(role: HelmRole = 'owner'): HelmModule[] {
  const flat = getGroupedOverflowModules(role).flatMap((s) => s.modules);
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
