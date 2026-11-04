import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { operatingDate } from '@/lib/operating-date';
import { isStatementMonth, statementsReceiptsHref } from '@/lib/statements-month';
import { buttonClass } from '@/lib/button-class';
import { loadActiveProperties } from '../upload/actions';
import { StatementReceipts } from './StatementReceipts';

export default async function ReceiptsPage({ searchParams }: {
  searchParams: Promise<{ month?: string; property?: string }>;
}) {
  await requireOwnerEmail();
  const query = await searchParams;
  const month = isStatementMonth(query.month) ? query.month : operatingDate().slice(0, 7);
  const properties = await loadActiveProperties();
  return (
    <div className="min-h-screen" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <main className="max-w-[900px] mx-auto px-6 py-12">
        <div className="eyebrow">Statements</div>
        <h1 className="font-serif text-4xl mt-3 mb-4">Property receipts</h1>
        <p style={{ color: 'var(--ink-3)', marginBottom: 28 }}>
          Add a company purchase to the owner’s statement, even before the first statement is ready.
          Receipts saved ahead of time are included when that month’s statement is imported.
        </p>
        {properties === null ? (
          <div role="alert">
            <p>The property list did not load.</p>
            <Link href={statementsReceiptsHref(month, query.property)} className={buttonClass('secondary')}>
              Try again
            </Link>
          </div>
        ) : (
          <StatementReceipts
            properties={properties.map(({ id, name, location }) => ({ id, name, location }))}
            initialMonth={month}
            initialPropertyId={query.property || ''}
          />
        )}
      </main>
    </div>
  );
}
