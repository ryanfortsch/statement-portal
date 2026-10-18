import { SectionTabs } from './SectionTabs';
import { NavTabCount } from '@/components/NavTabCount';

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
 */
export function FinancialsTabs({
  current,
}: {
  current: 'statements' | 'revenue' | 'forecast' | 'books' | 'payments';
}) {
  return (
    <SectionTabs
      current={current}
      tabs={[
        // The pill sits beside the tab, not inside it: it is its own link to
        // the month it counts (/statements?month=), which a bare tab click
        // need not be.
        { id: 'statements', label: 'Statements', href: '/statements', badgeOutside: true, badge: <NavTabCount kind="statementsReview" /> },
        { id: 'revenue', label: 'Revenue', href: '/revenue' },
        { id: 'forecast', label: 'Forecast', href: '/forecast' },
        { id: 'books', label: 'LLC Accounting', href: '/books' },
        { id: 'payments', label: 'Payments', href: '/payments' },
      ]}
    />
  );
}
