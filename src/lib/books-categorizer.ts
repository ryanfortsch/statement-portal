/**
 * AI categorizer for the Books module.
 *
 * Given a batch of ledger transactions for an entity, classifies each
 * against that entity's chart of accounts. Uses the Vercel AI Gateway
 * with Claude Sonnet 4.5 via the AI SDK (plain provider/model string,
 * no @ai-sdk/anthropic dependency -- per the Vercel platform default).
 *
 * Prompt structure:
 *   - System: who you are + entity context + the chart of accounts
 *     (compact form) + the vendor hints distilled from the 2025 GL
 *     + sign convention reminder (positive = money in, negative = out)
 *   - User: a batch of transactions with account context (which bank /
 *     card the transaction hit), and a request for structured output
 *
 * Output: per-transaction { category_key, confidence, reasoning }.
 * Confidence is the categorizer's own self-rating; we trust 'high'
 * enough for batch-accept, eyeball 'medium', and force review on 'low'.
 *
 * Batching: 25 transactions per LLM call (sweet spot for context use vs
 * round-trip count). The endpoint that consumes this batches further,
 * running batches in parallel with a concurrency cap so a year of 6k
 * transactions categorizes in ~1-2 minutes rather than 20.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { CHART_OF_ACCOUNTS, type CoaAccount } from '@/lib/books';
import { vendorHintsForPrompt } from '@/lib/books-vendor-hints';

export type CategorizableTransaction = {
  id: string;
  txn_date: string;
  description: string;
  amount: number;
  /** Which bank/card the transaction came from -- crucial context. */
  account_label: string;
  account_kind: 'bank' | 'credit_card';
  /** When the account is tied to a managed property (Rising Tide's per-property accounts). */
  property_id: string | null;
  /** Chase's own pre-classification on CC rows (Shopping / Travel / etc.). */
  raw_category: string | null;
  raw_type: string | null;
};

export type Categorization = {
  transaction_id: string;
  category_key: string;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
};

const CategorizationSchema = z.object({
  transaction_id: z.string(),
  category_key: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  reasoning: z.string(),
});
const BatchSchema = z.object({
  categorizations: z.array(CategorizationSchema),
});

/** Compact chart-of-accounts rendering: key + name + scope + parent. */
function chartForPrompt(entityId: string): string {
  const applicable = CHART_OF_ACCOUNTS
    .filter((a) => a.scope === 'shared' || a.scope === entityId)
    .sort((a, b) => a.sort - b.sort);
  return applicable
    .map((a) => {
      const parent = a.parent_key ? ` (parent: ${a.parent_key})` : '';
      const passThrough = a.pass_through ? ' [PASS-THROUGH]' : '';
      const hint = a.tax_hint ? ` // ${a.tax_hint}` : '';
      return `  - ${a.key}: ${a.name} [${a.type}]${parent}${passThrough}${hint}`;
    })
    .join('\n');
}

function entityLabel(entityId: string): string {
  return entityId === 'rising_tide' ? 'Rising Tide STR LLC (management company)'
    : entityId === 'goose_astoria' ? 'Goose of Astoria LLC (holding: 3246 NE 27th Terrace + 3 Locust Lane)'
    : entityId === 'goose_calderwood' ? 'Goose of Calderwood LLC (holding: 65 Calderwood Lane)'
    : entityId;
}

const BATCH_SIZE = 25;
const MODEL = 'anthropic/claude-sonnet-4.5';

async function categorizeOneBatch(
  entityId: string,
  txns: CategorizableTransaction[],
): Promise<Categorization[]> {
  if (txns.length === 0) return [];

  const txnLines = txns.map((t) => {
    const acct = `${t.account_label}${t.account_kind === 'credit_card' ? ' [CC]' : ''}${t.property_id ? ` [property: ${t.property_id}]` : ''}`;
    const raw = [t.raw_category, t.raw_type].filter(Boolean).join('/');
    const sign = t.amount < 0 ? 'OUT' : 'IN ';
    return `  - id=${t.id} | ${t.txn_date} | ${sign} $${Math.abs(t.amount).toFixed(2)} | acct: ${acct}${raw ? ` | chase: ${raw}` : ''} | "${t.description}"`;
  }).join('\n');

  const { object } = await generateObject({
    model: MODEL,
    schema: BatchSchema,
    system: `You are the AI categorizer for Rising Tide's in-house bookkeeping. You classify bank + credit-card transactions into one of the chart-of-accounts categories below for the given LLC entity.

ENTITY: ${entityLabel(entityId)}

CHART OF ACCOUNTS (use the \`key\` exactly as shown):
${chartForPrompt(entityId)}

SIGN CONVENTION:
  - Positive amount = money INTO the account (deposits, refunds, transfers in)
  - Negative amount = money OUT of the account (purchases, payments, debits)

ACCOUNT CONTEXT MATTERS:
  - For Rising Tide STR LLC, transactions on PER-PROPERTY accounts (e.g. KITTREDGE ⋯1323, MOYNAHAN ⋯3227) represent money flowing through that owner's trust account, so most expenses there are pass-through (property_*). Transactions on the main operating account (⋯5130) or the A. OBrien CC (⋯3878) are Rising Tide's own operating expenses.
  - For Goose holding entities, every transaction is the entity's own income or expense (no pass-through).

VENDOR HINTS (distilled from the 2025 GL — apply unless context contradicts):
${vendorHintsForPrompt()}

CRITICAL RULES:
  1. Output the chart-of-accounts \`key\` EXACTLY as it appears above (snake_case). Never invent a key.
  2. If you genuinely can't decide, output \`uncategorized\` with confidence "low". Never pick "suspense" — that's reserved for human review only.
  3. \`intercompany_due\` / \`transfer\` is for internal money movement between Rising Tide's own accounts or between entities. These are NOT expenses; mark as transfers.
  4. Negative entries on expense categories are valid (refunds, contra-entries). Don't flip the sign or "fix" them.
  5. confidence "high" = unambiguous vendor pattern with clear category; "medium" = reasonable inference; "low" = guess based on weak signal.
  6. Pass-through categories (marked [PASS-THROUGH]) are valid for Rising Tide only.`,
    prompt: `Categorize each of the following ${txns.length} transactions. Return one categorization per transaction, keyed by id.

TRANSACTIONS:
${txnLines}

Output JSON with a "categorizations" array containing one object per transaction.`,
  });

  return object.categorizations as Categorization[];
}

/**
 * Categorize an arbitrary number of transactions, batched + parallelized.
 *
 * Concurrency cap of 5 keeps Anthropic-via-Gateway happy at 25 txns/call
 * — ~125 txns in flight at a time. A year of 6k transactions runs in
 * roughly 90-120s.
 */
export async function categorizeTransactions(
  entityId: string,
  txns: CategorizableTransaction[],
): Promise<{ results: Categorization[]; errors: { batchIndex: number; error: string }[] }> {
  const batches: CategorizableTransaction[][] = [];
  for (let i = 0; i < txns.length; i += BATCH_SIZE) {
    batches.push(txns.slice(i, i + BATCH_SIZE));
  }

  const results: Categorization[] = [];
  const errors: { batchIndex: number; error: string }[] = [];

  const CONCURRENCY = 5;
  let cursor = 0;

  async function worker() {
    while (cursor < batches.length) {
      const myIndex = cursor++;
      try {
        const batchResults = await categorizeOneBatch(entityId, batches[myIndex]);
        // Merge into shared results in order they complete (which is
        // fine -- results are keyed by transaction_id, order doesn't
        // matter to the consumer).
        results.push(...batchResults);
      } catch (err) {
        errors.push({
          batchIndex: myIndex,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => worker()));

  return { results, errors };
}

/** Convenience: validate a category_key exists in the chart of accounts. */
export function isValidCategoryKey(entityId: string, key: string): boolean {
  return CHART_OF_ACCOUNTS.some(
    (a: CoaAccount) => a.key === key && (a.scope === 'shared' || a.scope === entityId),
  );
}
