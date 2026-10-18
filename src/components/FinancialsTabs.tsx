import { SectionTabs } from './SectionTabs';
import { NavTabCount } from '@/components/NavTabCount';
import { isStatementMonth, statementsHref } from '@/lib/statements-month';

/**
 * Sub-navigation tab strip for the Financials section: Statements,
 * Revenue, Forecast, LLC Accounting and Payments. Each remains its own
 * route, but the strip renders at the top of all of them so they read as
 * tabs of one
 * section; the masthead tab above reads "Money" and lights by pathname.
 * Statements carries the review-queue pill.
 *
 * Thin wrapper over SectionTabs, the shared strip primitive. `current`
 * stays required here: the six routes share no common prefix, so the
 * caller names its own tab.
 *
 * Role-aware through SectionTabs: every one of these routes that sits in
 * OWNER_PATH_PREFIXES drops out of the strip for a staff login, so the
 * strip never offers a page the proxy would bounce.
 *
 * `month` carries the month on screen across the strip: Revenue showing one
 * calendar month opens Statements on it (/statements?month=), and
 * Statements opens Revenue on its month (/revenue?range=). A range that is
 * not one month carries nothing.
 */
export function FinancialsTabs({
  current,
  month = null,
}: {
  current: 'statements' | 'revenue' | 'forecast' | 'books' | 'payments';
  /** YYYY-MM the page is showing, when it is showing exactly one month. */
  month?: string | null;
}) {
  const m = isStatementMonth(month) ? month : null;
  return (
    <SectionTabs
      current={current}
      tabs={[
        // The pill sits beside the tab, not inside it: it is its own link to
        // the month it counts (/statements?month=), which a bare tab click
        // need not be.
        { id: 'statements', label: 'Statements', href: statementsHref(m), badgeOutside: true, badge: <NavTabCount kind="statementsReview" /> },
        { id: 'revenue', label: 'Revenue', href: m ? `/revenue?range=${m}` : '/revenue' },
        { id: 'forecast', label: 'Forecast', href: '/forecast' },
        { id: 'books', label: 'LLC Accounting', href: '/books' },
        // The Stripe lookup and, under it, balance charges. Not "Payments":
        // that word is the payment links and the home feed's cards.
        { id: 'payments', label: 'Stripe lookup', href: '/payments' },
      ]}
    />
  );
}
