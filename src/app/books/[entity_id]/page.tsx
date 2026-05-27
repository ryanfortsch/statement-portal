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
  currentQuarter,
} from '@/lib/books';
import { UploadCsv } from './UploadCsv';
import { BooksReviewSection } from './BooksReviewSection';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder');

/**
 * Per-entity Books drill-in. The operator lands here from the Books
 * index, picks a Chase CSV to ingest into one of this entity's accounts,
 * and sees the latest categorized + uncategorized ledger rows.
 *
 * Phase 1b-i (this PR): ingestion + raw transaction list.
 * Phase 1b-ii (next): AI categorizer + inline review (dropdown editor).
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

async function loadRecentTransactions(entityId: string, limit = 100): Promise<TxnRow[]> {
  try {
    const { data } = await supabase
      .from('ledger_transactions')
      .select('id, account_id, txn_date, description, amount, category_key, ai_category_key, ai_confidence, ai_reasoning, reviewed, source')
      .eq('entity_id', entityId)
      .order('reviewed', { ascending: true })       // unreviewed first
      .order('txn_date', { ascending: false })
      .limit(limit);
    return (data || []) as TxnRow[];
  } catch {
    return [];
  }
}

async function loadEntitySummary(entityId: string): Promise<{
  total: number;
  unreviewed: number;
  uncategorized: number;
  pending_high_confidence: number;
  date_range: { min: string; max: string } | null;
}> {
  const { data } = await supabase
    .from('ledger_transactions')
    .select('reviewed, category_key, ai_category_key, ai_confidence, txn_date')
    .eq('entity_id', entityId);
  const rows = (data || []) as { reviewed: boolean; category_key: string | null; ai_category_key: string | null; ai_confidence: string | null; txn_date: string }[];
  const total = rows.length;
  const unreviewed = rows.filter((r) => !r.reviewed).length;
  const uncategorized = rows.filter((r) => !r.ai_category_key && !r.category_key).length;
  const pendingHighConfidence = rows.filter((r) => !r.reviewed && !r.category_key && r.ai_confidence === 'high' && !!r.ai_category_key).length;
  const dates = rows.map((r) => r.txn_date).sort();
  return {
    total,
    unreviewed,
    uncategorized,
    pending_high_confidence: pendingHighConfidence,
    date_range: dates.length > 0 ? { min: dates[0], max: dates[dates.length - 1] } : null,
  };
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

export default async function BookEntityPage({ params }: { params: Promise<{ entity_id: string }> }) {
  const { entity_id } = await params;
  const entity = LLC_ENTITIES[entity_id];
  if (!entity) notFound();

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

  const txns = tableReady ? await loadRecentTransactions(entity_id) : [];
  const summary = tableReady
    ? await loadEntitySummary(entity_id)
    : { total: 0, unreviewed: 0, uncategorized: 0, pending_high_confidence: 0, date_range: null };
  const quarter = currentQuarter();

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
      <HelmMasthead current="financials" />
      <FinancialsTabs current="books" />

      <HelmHero
        eyebrow={`Helm · Financials · LLC Accounting · ${quarter}`}
        title={entity.short}
        emphasis="ledger."
        description={entity.blurb}
        paddingTop={36}
        paddingBottom={16}
      />

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 8 }}>
        <Link href="/books" style={{ fontSize: 11, color: 'var(--ink-4)', textDecoration: 'none', letterSpacing: '.08em', textTransform: 'uppercase' }}>
          ← All entities
        </Link>
      </section>

      {!tableReady && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 16 }}>
          <div style={{
            padding: '12px 14px',
            borderLeft: '2px solid var(--signal)',
            background: 'var(--paper-2)',
            fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5,
          }}>
            <strong style={{ color: 'var(--signal)' }}>Setup pending.</strong> Run <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>supabase-schema-books.sql</code> in the Supabase SQL editor to create the ledger tables. The account list below is the static seed from <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>src/lib/books.ts</code>; upload won&apos;t work until the migration runs.
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
        <BooksReviewSection
          entityId={entity_id}
          initialTransactions={txns}
          accounts={accountInfoMap}
          coaOptions={coaOptions}
          pendingUncategorized={summary.uncategorized}
          pendingHighConfidence={summary.pending_high_confidence}
        />
        {txns.length >= 100 && (
          <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 10, fontStyle: 'italic' }}>
            Showing the 100 most recent (unreviewed first). Categorize cycles through everything; the table refreshes between batches.
          </div>
        )}
      </section>

      <HelmFooter module="LLC Accounting" />
    </div>
  );
}
