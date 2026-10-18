import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { FinancialsTabs } from '@/components/FinancialsTabs';
import {
  LLC_ENTITIES,
  CHART_OF_ACCOUNTS,
  BOOKS_PROPERTY_LABELS,
  accountsListForEntity,
} from '@/lib/books';
import { applyBooksFilter, parseBooksFilter, quarterOptions, type BooksFilter } from '@/lib/books-review-filter';
import { UploadCsv } from './UploadCsv';
import { BooksReviewSection } from './BooksReviewSection';
import { BooksFilterBar } from './BooksFilterBar';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder');

/**
 * One LLC's ledger: upload a Chase CSV into one of its accounts, run the AI
 * categorizer, and review its proposals. /books lands on the Rising Tide
 * ledger; the switcher under the title moves between the three entities and
 * the chart of accounts sits behind its own link.
 *
 * The review table is filtered by the link (books-review-filter.ts):
 * unreviewed only by default, a quarter, a description search. Categorize
 * and Accept act on the same filtered rows.
 */

type AccountRow = {
  id: string;
  entity_id: string;
  kind: 'bank' | 'credit_card';
  institution: string | null;
  last4: string | null;
  label: string | null;
  property_id: string | null;
  inactive: boolean;
};

type TxnRow = {
  id: string;
  account_id: string | null;
  txn_date: string;
  description: string;
  amount: number;
  category_key: string | null;
  ai_category_key: string | null;
  ai_confidence: string | null;
  ai_reasoning: string | null;
  reviewed: boolean;
  source: string | null;
};

async function loadAccountsForEntity(entityId: string): Promise<{ accounts: AccountRow[]; tableReady: boolean }> {
  try {
    const { data, error } = await supabase
      .from('llc_accounts')
      .select('id, entity_id, kind, institution, last4, label, property_id, inactive')
      .eq('entity_id', entityId)
      .eq('inactive', false)
      .order('kind')
      .order('last4');
    if (error) {
      const missing = error.code === 'PGRST205' || /does not exist|relation|Could not find the table/i.test(error.message || '');
      return { accounts: [], tableReady: !missing };
    }
    return { accounts: (data || []) as AccountRow[], tableReady: true };
  } catch {
    return { accounts: [], tableReady: false };
  }
}

/** Rows matching the review filter, unreviewed first then newest, plus how many match in all. */
async function loadFilteredTransactions(entityId: string, filter: BooksFilter, limit = 100): Promise<{ rows: TxnRow[]; matching: number }> {
  try {
    const [rowsRes, countRes] = await Promise.all([
      applyBooksFilter(
        supabase
          .from('ledger_transactions')
          .select('id, account_id, txn_date, description, amount, category_key, ai_category_key, ai_confidence, ai_reasoning, reviewed, source')
          .eq('entity_id', entityId),
        filter,
      )
        .order('reviewed', { ascending: true })       // unreviewed first
        .order('txn_date', { ascending: false })
        .limit(limit),
      applyBooksFilter(
        supabase.from('ledger_transactions').select('id', { count: 'exact', head: true }).eq('entity_id', entityId),
        filter,
      ),
    ]);
    return { rows: (rowsRes.data || []) as TxnRow[], matching: countRes.count ?? (rowsRes.data || []).length };
  } catch {
    return { rows: [], matching: 0 };
  }
}

/**
 * Entity-wide counts and the batch-action counts for the filtered set.
 * Count queries, never a row dump: PostgREST caps a bare select at 1000
 * rows with no error (CLAUDE.md watch-out 1), and a year of one LLC's bank
 * and card rows runs to thousands.
 */
async function loadEntitySummary(entityId: string, filter: BooksFilter): Promise<{
  total: number;
  unreviewed: number;
  uncategorized: number;
  filtered_uncategorized: number;
  filtered_high_confidence: number;
  date_range: { min: string; max: string } | null;
}> {
  const count = () => supabase.from('ledger_transactions').select('id', { count: 'exact', head: true }).eq('entity_id', entityId);
  const edge = (ascending: boolean) =>
    supabase.from('ledger_transactions').select('txn_date').eq('entity_id', entityId).order('txn_date', { ascending }).limit(1);
  const [total, unreviewed, uncategorized, fUncategorized, fHigh, oldest, newest] = await Promise.all([
    count(),
    count().eq('reviewed', false),
    count().is('ai_category_key', null).is('category_key', null),
    applyBooksFilter(count().is('ai_category_key', null).is('category_key', null), filter),
    applyBooksFilter(
      count().eq('reviewed', false).is('category_key', null).eq('ai_confidence', 'high').not('ai_category_key', 'is', null),
      filter,
    ),
    edge(true),
    edge(false),
  ]);
  const min = (oldest.data?.[0] as { txn_date: string } | undefined)?.txn_date;
  const max = (newest.data?.[0] as { txn_date: string } | undefined)?.txn_date;
  return {
    total: total.count ?? 0,
    unreviewed: unreviewed.count ?? 0,
    uncategorized: uncategorized.count ?? 0,
    filtered_uncategorized: fUncategorized.count ?? 0,
    filtered_high_confidence: fHigh.count ?? 0,
    date_range: min && max ? { min, max } : null,
  };
}

/** Unreviewed rows per entity, for the switcher. */
async function loadUnreviewedByEntity(): Promise<Record<string, number | null>> {
  const ids = Object.keys(LLC_ENTITIES);
  const counts = await Promise.all(ids.map((id) =>
    supabase.from('ledger_transactions').select('id', { count: 'exact', head: true }).eq('entity_id', id).eq('reviewed', false),
  ));
  return Object.fromEntries(ids.map((id, i) => [id, counts[i].error ? null : counts[i].count ?? 0]));
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

export default async function BookEntityPage({
  params,
  searchParams,
}: {
  params: Promise<{ entity_id: string }>;
  searchParams: Promise<{ all?: string | string[]; quarter?: string | string[]; q?: string | string[] }>;
}) {
  const { entity_id } = await params;
  const entity = LLC_ENTITIES[entity_id];
  if (!entity) notFound();
  const filter = parseBooksFilter(await searchParams);

  const { accounts, tableReady } = await loadAccountsForEntity(entity_id);
  // If the DB doesn't have accounts seeded yet, fall back to the lib's
  // static list so the page is at least informative pre-migration.
  const accountOptions = tableReady && accounts.length > 0
    ? accounts.map((a) => ({
        id: a.id,
        kind: a.kind,
        institution: a.institution,
        last4: a.last4,
        label: a.label,
        property_id: a.property_id,
      }))
    : accountsListForEntity(entity_id).map((a) => ({
        id: `seed:${a.entity_id}:${a.kind}:${a.last4}`, // sentinel until migration runs
        kind: a.kind,
        institution: a.institution,
        last4: a.last4,
        label: a.label,
        property_id: a.property_id || null,
      }));

  const [{ rows: txns, matching }, summary, unreviewedByEntity] = tableReady
    ? await Promise.all([loadFilteredTransactions(entity_id, filter), loadEntitySummary(entity_id, filter), loadUnreviewedByEntity()])
    : [
        { rows: [] as TxnRow[], matching: 0 },
        { total: 0, unreviewed: 0, uncategorized: 0, filtered_uncategorized: 0, filtered_high_confidence: 0, date_range: null },
        {} as Record<string, number | null>,
      ];
  const entities = Object.values(LLC_ENTITIES).sort((a, b) => a.sort - b.sort);

  // Account lookup map for the review table's bank-column rendering.
  const accountInfoMap: Record<string, { last4: string | null; label: string | null }> = {};
  for (const a of accounts) {
    accountInfoMap[a.id] = { last4: a.last4, label: a.label };
  }

  // Chart-of-accounts options for this entity (server-built so the
  // client component doesn't need to import the full COA list).
  const coaOptions = CHART_OF_ACCOUNTS
    .filter((a) => a.scope === 'shared' || a.scope === entity_id)
    .map((a) => ({
      key: a.key,
      name: a.name,
      type: a.type,
      parent_key: a.parent_key ?? null,
      pass_through: !!a.pass_through,
    }));

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <FinancialsTabs current="books" />

      <HelmHero
        eyebrow="Helm · LLC Accounting"
        title={entity.short}
        emphasis="ledger."
        description={entity.blurb}
        paddingTop={36}
        paddingBottom={16}
      />

      {/* Entity switcher + the chart of accounts behind a link. */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 4 }}>
        <nav aria-label="Entities" className="flex items-baseline flex-wrap" style={{ gap: '10px 22px', paddingBottom: 6 }}>
          {entities.map((e) => {
            const active = e.id === entity_id;
            const n = unreviewedByEntity[e.id];
            return (
              <Link
                key={e.id}
                href={`/books/${e.id}`}
                aria-current={active ? 'page' : undefined}
                style={{
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  color: active ? 'var(--ink)' : 'var(--ink-3)',
                  textDecoration: active ? 'underline' : 'none',
                  textDecorationColor: 'var(--signal)',
                  textDecorationThickness: 2,
                  textUnderlineOffset: 7,
                  whiteSpace: 'nowrap',
                }}
              >
                {e.short}
                {n != null && n > 0 && (
                  <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--signal)', fontWeight: 500 }}>{n} to review</span>
                )}
              </Link>
            );
          })}
          <Link href="/books/accounts" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
            Chart of accounts →
          </Link>
        </nav>
      </section>

      {!tableReady && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 16 }}>
          <div style={{
            padding: '12px 14px',
            borderLeft: '2px solid var(--signal)',
            background: 'var(--paper-2)',
            fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5,
          }}>
            <strong style={{ color: 'var(--signal)' }}>Setup pending.</strong> The ledger tables are not set up yet, so uploads will not work. The account list below is the standing seed.
          </div>
        </section>
      )}

      {/* Property links (holding entities) */}
      {entity.property_ids.length > 0 && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Owned properties</div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 13, color: 'var(--ink-2)' }}>
            {entity.property_ids.map((pid) => (
              <li key={pid} style={{ padding: '2px 0' }}>{BOOKS_PROPERTY_LABELS[pid] || pid}</li>
            ))}
          </ul>
        </section>
      )}

      {/* ── UPLOAD WIDGET ── */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%' }}>
        <UploadCsv accounts={accountOptions} />
      </section>

      {/* ── SUMMARY STRIP ── */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%' }}>
        <div className="flex items-baseline gap-6 flex-wrap" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          <span>
            <strong style={{ color: 'var(--ink)', fontFamily: 'var(--font-fraunces)', fontSize: 18 }}>{summary.total}</strong> transactions
          </span>
          <span>
            <strong style={{ color: summary.uncategorized > 0 ? 'var(--signal)' : 'var(--positive)', fontFamily: 'var(--font-fraunces)', fontSize: 18 }}>{summary.uncategorized}</strong> uncategorized
          </span>
          <span>
            <strong style={{ color: summary.unreviewed > 0 ? 'var(--signal)' : 'var(--positive)', fontFamily: 'var(--font-fraunces)', fontSize: 18 }}>{summary.unreviewed}</strong> unreviewed
          </span>
          {summary.date_range && (
            <span style={{ color: 'var(--ink-4)' }}>
              {fmtDate(summary.date_range.min)} → {fmtDate(summary.date_range.max)}
            </span>
          )}
        </div>
      </section>

      {/* ── REVIEW TABLE + ACTION BAR ── */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 20, paddingBottom: 40, flex: 1 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Categorize &amp; review</div>
        <BooksFilterBar key={filter.q} filter={filter} quarters={quarterOptions(summary.date_range)} matching={matching} />
        <BooksReviewSection
          key={JSON.stringify(filter)}
          entityId={entity_id}
          filter={filter}
          initialTransactions={txns}
          accounts={accountInfoMap}
          coaOptions={coaOptions}
          pendingUncategorized={summary.filtered_uncategorized}
          pendingHighConfidence={summary.filtered_high_confidence}
        />
        {matching > txns.length && (
          <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 10 }}>
            Showing {txns.length} of {matching}, unreviewed first, newest first.
          </div>
        )}
      </section>

      <HelmFooter module="LLC Accounting" />
    </div>
  );
}
