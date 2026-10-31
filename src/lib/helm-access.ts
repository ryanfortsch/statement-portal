/**
 * Helm's two roles, and which doors each one opens.
 *
 * Until 2026-10 Helm had one kind of login: any @risingtidestr.com Google
 * account opened every page, the owner statements and the books included.
 * The first employee (an Operations Manager who runs turnovers, inspections,
 * repairs and messaging, and is deliberately kept out of owner money) made a
 * second kind necessary.
 *
 *   owner  - Ryan, Allie, Dotti: everything.
 *   staff  - anyone else on the Workspace domain: operations, not money.
 *
 * Owners are the explicit list in `src/lib/team.ts` (`access: 'owner'`).
 * Every other sign-in is staff, so a new Workspace seat is staff by default
 * and the gate fails closed.
 *
 * Three things read this module and must agree:
 *   - `src/proxy.ts` turns a staff request for an owner path away at the door
 *     (a 403 for /api, a redirect to /not-available for a page).
 *   - the nav (`helm-modules.ts`, HelmModuleNav / NavMore / MobileMenu) and
 *     search hide the owner modules from staff, so nothing links to a page
 *     that would bounce.
 *   - server actions that move money (packet pay, contractor pay details,
 *     W-9 reveal) call `requireOwnerEmail()` from `helm-access-server.ts`,
 *     because a server action posts to whatever page it was rendered on and
 *     the path gate alone cannot cover an action shared across pages.
 *
 * Pure: no server imports, so the proxy, client components and tests can
 * all use it.
 */

// Relative with the extension on purpose: Node's test runner resolves
// neither the `@/` alias nor an extensionless sibling, and this module is
// under test (the repo convention, see sca-quotes-types.ts imports).
import { getTeamMember, hasDuty } from './team.ts';

export type HelmRole = 'owner' | 'staff';

/**
 * Ask Helm tools a staff login never gets. Ask Helm renders on the home
 * page, which no role can be kept off, so the gate has to sit on the tool
 * set: without it, "what did 21 Horton pay out in March" answers for anyone
 * signed in. Consumed by `src/lib/ask/tools.ts`.
 */
export const OWNER_ONLY_ASK_TOOLS: ReadonlySet<string> = new Set(['get_statements', 'list_prospects']);

/** The role for a signed-in email. Unknown or missing emails are staff. */
export function roleForEmail(email: string | null | undefined): HelmRole {
  return getTeamMember(email)?.access === 'owner' ? 'owner' : 'staff';
}

export function isOwnerEmail(email: string | null | undefined): boolean {
  return roleForEmail(email) === 'owner';
}

/**
 * "View as staff": an owner walks Helm as a staff login sees it, because no
 * owner can sign in as the staff hire and a preview cannot be read without
 * an SSO session. The switch is one httpOnly cookie, written only by the
 * owner-checked server action in `src/app/view-as-actions.ts` and read on
 * the server (the proxy, `helm-access-server.ts`, the root layout). Nothing
 * reads or sets it from a URL, and the browser never reads it at all: the
 * client chrome gets the resolved view from the root layout.
 */
export const VIEW_AS_COOKIE = 'helm_view_as';
export const VIEW_AS_STAFF = 'staff';

/**
 * The role Helm acts on: the one resolver every gate and every piece of
 * chrome reads. It can only take an owner DOWN. A login `roleForEmail`
 * calls staff stays staff whatever the cookie says, and a missing or
 * garbled cookie leaves the real role, so the cookie never opens a door.
 */
export function effectiveRole(email: string | null | undefined, viewAs: string | null | undefined): HelmRole {
  const real = roleForEmail(email);
  if (real !== 'owner') return real;
  return viewAs === VIEW_AS_STAFF ? 'staff' : 'owner';
}

/** What the client chrome needs: the role, and which way the switch points. */
export type HelmView = {
  role: HelmRole;
  /** An owner login currently seeing Helm as staff (the banner shows). */
  viewingAsStaff: boolean;
  /** An owner login in owner view (the menu offers View as staff). */
  mayViewAsStaff: boolean;
  /** Holds the dispatch duty, in their own view (`canDispatch`). */
  dispatcher: boolean;
};

/** No session, or before the layout hands one in: staff, no switch. */
export const STAFF_VIEW: HelmView = { role: 'staff', viewingAsStaff: false, mayViewAsStaff: false, dispatcher: false };

export function helmView(email: string | null | undefined, viewAs: string | null | undefined): HelmView {
  const ownerLogin = roleForEmail(email) === 'owner';
  const role = effectiveRole(email, viewAs);
  return { role, viewingAsStaff: ownerLogin && role === 'staff', mayViewAsStaff: ownerLogin && role === 'owner', dispatcher: canDispatch(email, viewAs) };
}

/**
 * The dispatch duty as the session acts on it: held on the roster
 * (`team.ts`), and not while an owner is in View as staff, since the switch
 * drops every privilege the login has, duties included. It gates naming
 * someone else on a walk and creating or sending a Field packet.
 */
export function canDispatch(email: string | null | undefined, viewAs: string | null | undefined): boolean {
  return hasDuty(email, 'dispatch') && effectiveRole(email, viewAs) === roleForEmail(email);
}

/**
 * Page prefixes only an owner may open. Matched as a whole path segment
 * (`/statements` covers `/statements/close`, never `/statements-foo`).
 *
 * The public deliverables under some of these (`/statements/render`, the
 * projection render pages) are let through by the proxy BEFORE the role
 * check, so headless PDF rendering is unaffected.
 */
export const OWNER_PATH_PREFIXES: readonly string[] = [
  // Money.
  '/statements',
  '/books',
  '/forecast',
  '/revenue',
  // The Stripe lookup itself (/payments) is open to staff, read-only, since
  // 2026-10-19 (Dotti): "did this guest pay?" is a guest-messaging question.
  // Charging a saved card is not.
  '/payments/balance-charges',
  // Owner relationships and the pipeline.
  '/properties/contracts',
  '/properties/prospects',
  // Winter lease applicants: their income, dates and screening.
  '/properties/leases',
  '/prospects',
  '/projections',
  '/owner-messaging',
  // Guest pricing is set by the owners.
  '/guests/quotes',
  // Owner chores in Growth: the AirDNA comps upload (its reminder texts the
  // owner) and the competitor roster, whose owner-of-record research is
  // prospecting.
  '/marketing/airdna',
  '/competitors',
  // The creative pay ledger and the contractor rate card.
  '/fieldwork/shoots',
  '/fieldwork/rate-card',
  // The field test harness writes to live tables.
  '/fieldwork/packets/test',
  // Offer letters and other staff agreements: employment terms.
  '/staff-documents',
];

/**
 * /api prefixes only an owner may call: the statement pipeline, bank and
 * receipt writes, Stripe, the books, contracts and the prospect mail sync.
 * Everything that writes `owner_payout` is in here.
 *
 * Deliberately NOT here: /api/ingest-overhead (the company card upload,
 * reached from the Actuals section of /forecast, an owner page) and the
 * cron routes (re-running a stuck feed is an operations duty).
 * /api/stripe-account-check moved in on 2026-10-18: it names the Stripe
 * account a property's key reaches and counts its charges, and the launch
 * page now shows it to owners only.
 */
export const OWNER_API_PREFIXES: readonly string[] = [
  '/api/ingest',
  '/api/ingest-guesty-csv',
  '/api/upload-platform-csv',
  '/api/platform-csv-status',
  '/api/upload-booking-deposits',
  '/api/refresh-statement',
  '/api/fill-gap',
  '/api/resolve-gap',
  '/api/reservations',
  '/api/bank-deposits',
  '/api/receipts',
  '/api/cleaning-events',
  '/api/reconcile-emails',
  '/api/property-statements',
  '/api/statement-pdf',
  '/api/archive-statement',
  '/api/draft-email',
  '/api/period-notes',
  '/api/installments',
  '/api/sync-stripe',
  '/api/stripe-account-check',
  '/api/sync-invoices',
  // /api/payments/lookup is read-only Stripe GETs and open to staff with the
  // page (2026-10-19).
  '/api/books',
  '/api/backfill-internal-transfers',
  '/api/contracts',
  '/api/archive-contract',
  '/api/archive-projection',
  '/api/draft-onboarding-email',
  '/api/sync-prospect-mail',
  '/api/vendor-w9',
  // The AirDNA upload and the competitor sync behind the two owner pages.
  // The public market pages read /api/markets/airdna, which stays open, and
  // the weekly competitor cron imports the sync in process.
  '/api/airdna',
  '/api/sync-competitors',
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

/** True when a page path is owners-only. */
export function pathRequiresOwner(pathname: string): boolean {
  return OWNER_PATH_PREFIXES.some((p) => matchesPrefix(pathname, p));
}

/** True when an /api path is owners-only. */
export function apiRequiresOwner(pathname: string): boolean {
  return OWNER_API_PREFIXES.some((p) => matchesPrefix(pathname, p));
}

/**
 * May this role open this href? Owners always; staff only when the proxy
 * would let the page through. Query and hash are ignored, so
 * `/fieldwork/shoots?trade=creative` is judged as `/fieldwork/shoots`, and
 * an external link (`https://`, `mailto:`) is never gated here.
 *
 * The one question every tab, feed card and inline link that could land on
 * /not-available asks before it renders. Deciding from OWNER_PATH_PREFIXES
 * rather than a flag on each link is what keeps the chrome from drifting
 * from what the proxy enforces: gate a new page and its links hide with it.
 */
export function roleMayOpen(role: HelmRole, href: string): boolean {
  if (role === 'owner') return true;
  return !pathRequiresOwner(href.split(/[?#]/)[0]);
}

/** Where the proxy sends a staff login that opened an owner page. */
export const NOT_AVAILABLE_PATH = '/not-available';

/**
 * Where Back to owner view lands when it is clicked on /not-available: the
 * page the proxy turned away (its `from`), so the owner is back where they
 * were. Same-origin paths only; anything else, or no `from`, goes home.
 * Elsewhere it returns null: the same page simply loads again.
 */
export function ownerViewReturnPath(pathname: string, search: string, origin: string): string | null {
  if (pathname !== NOT_AVAILABLE_PATH) return null;
  const from = new URLSearchParams(search).get('from');
  if (!from) return '/';
  try {
    const url = new URL(from, origin);
    return url.origin === origin ? url.pathname + url.search : '/';
  } catch {
    return '/';
  }
}
