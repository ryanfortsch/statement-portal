import { SectionTabs } from './SectionTabs';
import { NavTabCount } from '@/components/NavTabCount';

/**
 * Sub-navigation tab strip for the Financials section. Statements,
 * Revenue, Forecast, Cost Analysis, and LLC Accounting are five lenses
 * on the same money. Each remains its own route (URLs unchanged), but
 * the strip renders at the top of all five so they read as tabs of one
 * section; the masthead tab above reads "Money" and lights by pathname.
 * Statements carries the review-queue pill.
 *
 * Thin wrapper over SectionTabs, the shared strip primitive. `current`
 * stays required here: the five routes share no common prefix, so the
 * caller names its own tab.
 */
export function FinancialsTabs({
  current,
}: {
  current: 'statements' | 'revenue' | 'forecast' | 'cost-analysis' | 'books';
}) {
  return (
    <SectionTabs
      current={current}
      tabs={[
        { id: 'statements', label: 'Statements', href: '/statements', badge: <NavTabCount kind="statementsReview" /> },
        { id: 'revenue', label: 'Revenue', href: '/revenue' },
        { id: 'forecast', label: 'Forecast', href: '/forecast' },
        { id: 'cost-analysis', label: 'Cost Analysis', href: '/cost-analysis' },
        { id: 'books', label: 'LLC Accounting', href: '/books' },
      ]}
    />
  );
}
