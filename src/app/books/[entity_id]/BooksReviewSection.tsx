'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The interactive review section on /books/[entity_id]: action buttons
 * to run the AI categorizer + batch-accept high-confidence proposals,
 * plus the per-row dropdown editor for confirming or correcting the AI.
 *
 * Server passes:
 *   - transactions: the latest N rows (server-fetched)
 *   - accounts: account_id -> { last4, label } map for the bank column
 *   - coaOptions: chart-of-accounts list for THIS entity (key/name/type)
 *
 * UX choices:
 *   - Categorize: max 200 per click (server-side cap). The button shows
 *     a count of uncategorized + a status during the run.
 *   - Accept high-confidence: shows the candidate count up-front. One
 *     click flips all to reviewed=true with their AI category.
 *   - Per-row dropdown: optimistic local update on Confirm; full
 *     router.refresh() on batch actions to pull in any AI proposals.
 */

type Txn = {
  id: string;
  txn_date: string;
  description: string;
  amount: number;
  account_id: string | null;
  category_key: string | null;
  ai_category_key: string | null;
  ai_confidence: string | null;
  ai_reasoning: string | null;
  reviewed: boolean;
  source: string | null;
};

type AcctInfo = { last4: string | null; label: string | null };

type CoaOption = {
  key: string;
  name: string;
  type: string;
  parent_key: string | null;
  pass_through: boolean;
};

type CategorizeResult = {
  success?: true;
  candidates?: number;
  categorized?: number;
  batch_errors?: { batchIndex: number; error: string }[];
  error?: string;
};

type AcceptResult = {
  success?: true;
  candidates?: number;
  accepted?: number;
  error?: string;
};

function fmtAmount(n: number): string {
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `−$${s}` : `$${s}`;
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

export function BooksReviewSection({
  entityId,
  initialTransactions,
  accounts,
  coaOptions,
  pendingUncategorized,
  pendingHighConfidence,
}: {
  entityId: string;
  initialTransactions: Txn[];
  accounts: Record<string, AcctInfo>;
  coaOptions: CoaOption[];
  pendingUncategorized: number;
  pendingHighConfidence: number;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Txn[]>(initialTransactions);
  const [categorizing, setCategorizing] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<'positive' | 'tide' | 'negative' | null>(null);
  const [, startTransition] = useTransition();

  // Group COA options by parent for a cleaner dropdown. Children render
  // indented under parents; orphan accounts (no parent) render at the top.
  const optionGroups = (() => {
    const byParent = new Map<string | null, CoaOption[]>();
    for (const o of coaOptions) {
      const k = o.parent_key;
      const list = byParent.get(k) || [];
      list.push(o);
      byParent.set(k, list);
    }
    return byParent;
  })();
  const topLevel = (optionGroups.get(null) || []).sort((a, b) => a.name.localeCompare(b.name));

  function flashStatus(tone: 'positive' | 'tide' | 'negative', msg: string) {
    setStatusTone(tone);
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(null), 8000);
  }

  async function runCategorize() {
    setCategorizing(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/books/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_id: entityId, limit: 200 }),
      });
      const data: CategorizeResult = await res.json();
      if (!res.ok || data.error) {
        flashStatus('negative', data.error || 'Categorize failed');
      } else {
        const errs = data.batch_errors?.length ? ` (${data.batch_errors.length} batch error${data.batch_errors.length === 1 ? '' : 's'})` : '';
        flashStatus('positive', `Categorized ${data.categorized ?? 0} of ${data.candidates ?? 0} transactions${errs}.`);
      }
    } catch (err) {
      flashStatus('negative', err instanceof Error ? err.message : 'Categorize failed');
    } finally {
      setCategorizing(false);
      startTransition(() => router.refresh());
    }
  }

  async function runAcceptHighConfidence() {
    setAccepting(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/books/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept_high_confidence', entity_id: entityId }),
      });
      const data: AcceptResult = await res.json();
      if (!res.ok || data.error) {
        flashStatus('negative', data.error || 'Batch accept failed');
      } else {
        flashStatus('positive', `Accepted ${data.accepted ?? 0} high-confidence categorizations.`);
      }
    } catch (err) {
      flashStatus('negative', err instanceof Error ? err.message : 'Batch accept failed');
    } finally {
      setAccepting(false);
      startTransition(() => router.refresh());
    }
  }

  async function confirmRow(id: string, key: string) {
    // Optimistic update: flip row to reviewed locally so the table feels
    // responsive. The fetch refreshes the server tree in the background.
    const prevRow = rows.find((r) => r.id === id);
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, category_key: key, reviewed: true } : r)));
    try {
      const res = await fetch('/api/books/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', transaction_id: id, category_key: key }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        // Revert.
        setRows((cur) => cur.map((r) => (r.id === id ? prevRow || r : r)));
        flashStatus('negative', data.error || 'Confirm failed');
      }
    } catch (err) {
      setRows((cur) => cur.map((r) => (r.id === id ? prevRow || r : r)));
      flashStatus('negative', err instanceof Error ? err.message : 'Confirm failed');
    }
  }

  async function unconfirmRow(id: string) {
    const prevRow = rows.find((r) => r.id === id);
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, category_key: null, reviewed: false } : r)));
    try {
      const res = await fetch('/api/books/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unconfirm', transaction_id: id }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setRows((cur) => cur.map((r) => (r.id === id ? prevRow || r : r)));
        flashStatus('negative', data.error || 'Unconfirm failed');
      }
    } catch (err) {
      setRows((cur) => cur.map((r) => (r.id === id ? prevRow || r : r)));
      flashStatus('negative', err instanceof Error ? err.message : 'Unconfirm failed');
    }
  }

  return (
    <div>
      {/* ── ACTION BAR ── */}
      <div className="flex items-center gap-3 flex-wrap" style={{
        padding: '14px 0',
        borderTop: '1px solid var(--rule)',
        borderBottom: '1px solid var(--rule)',
        marginBottom: 14,
      }}>
        <button
          onClick={runCategorize}
          disabled={categorizing || pendingUncategorized === 0}
          style={{
            background: categorizing ? 'var(--paper-2)' : 'var(--ink)',
            color: categorizing ? 'var(--ink-3)' : 'var(--paper)',
            border: '1px solid var(--ink)',
            fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase',
            padding: '8px 14px',
            cursor: categorizing ? 'wait' : pendingUncategorized === 0 ? 'not-allowed' : 'pointer',
            opacity: pendingUncategorized === 0 ? 0.5 : 1,
          }}
        >
          {categorizing
            ? 'Categorizing…'
            : pendingUncategorized === 0
              ? 'Nothing to categorize'
              : `Categorize ${Math.min(200, pendingUncategorized)}${pendingUncategorized > 200 ? ` of ${pendingUncategorized}` : ''}`}
        </button>

        <button
          onClick={runAcceptHighConfidence}
          disabled={accepting || pendingHighConfidence === 0}
          style={{
            background: 'transparent',
            color: 'var(--ink)',
            border: '1px solid var(--ink)',
            fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase',
            padding: '8px 14px',
            cursor: accepting ? 'wait' : pendingHighConfidence === 0 ? 'not-allowed' : 'pointer',
            opacity: pendingHighConfidence === 0 ? 0.5 : 1,
          }}
        >
          {accepting ? 'Accepting…' : pendingHighConfidence === 0 ? 'No high-confidence proposals' : `Accept ${pendingHighConfidence} high-confidence`}
        </button>

        <span style={{ fontSize: 11, color: 'var(--ink-4)', marginLeft: 'auto', lineHeight: 1.4 }}>
          Categorize runs the AI over up to 200 uncategorized rows per click. Re-click for more.
        </span>
      </div>

      {statusMsg && statusTone && (
        <div style={{
          padding: '10px 12px',
          borderLeft: `2px solid var(${statusTone === 'positive' ? '--positive' : statusTone === 'tide' ? '--tide-deep' : '--negative'})`,
          background: 'var(--paper-2)',
          fontSize: 12, color: 'var(--ink-2)',
          marginBottom: 14,
        }}>
          {statusMsg}
        </div>
      )}

      {/* ── TABLE ── */}
      {rows.length === 0 ? (
        <div style={{
          padding: 16, background: 'var(--paper-2)',
          fontSize: 12, color: 'var(--ink-4)',
          textAlign: 'center',
          border: '1px dashed var(--rule)',
        }}>
          No transactions yet. Upload a Chase CSV above to get started.
        </div>
      ) : (
        <table className="w-full tabular-nums" style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
              <th style={{ textAlign: 'left', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Date</th>
              <th style={{ textAlign: 'left', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Description</th>
              <th style={{ textAlign: 'left', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Acct</th>
              <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Amount</th>
              <th style={{ textAlign: 'left', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Category</th>
              <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>—</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const acct = t.account_id ? accounts[t.account_id] : null;
              const acctLabel = acct?.last4 ? `⋯${acct.last4}` : '—';
              const currentKey = t.category_key || t.ai_category_key || '';
              return (
                <tr key={t.id} style={{
                  borderBottom: '1px solid var(--rule-soft)',
                  background: t.reviewed ? 'transparent' : 'rgba(200, 90, 58, 0.03)',
                }}>
                  <td style={{ padding: '6px 6px', whiteSpace: 'nowrap', color: 'var(--ink-3)' }}>{fmtDate(t.txn_date)}</td>
                  <td style={{ padding: '6px 6px', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 420 }} title={t.description}>
                    {t.description}
                    {t.ai_reasoning && !t.reviewed && (
                      <div style={{ fontSize: 10, color: 'var(--ink-4)', fontStyle: 'italic', marginTop: 2 }}>
                        AI: {t.ai_reasoning}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '6px 6px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)' }}>{acctLabel}</td>
                  <td style={{ padding: '6px 6px', textAlign: 'right', color: t.amount < 0 ? 'var(--negative)' : 'var(--positive)' }}>
                    {fmtAmount(t.amount)}
                  </td>
                  <td style={{ padding: '6px 6px' }}>
                    <select
                      value={currentKey}
                      onChange={(e) => {
                        const newKey = e.target.value;
                        // Local set first (optimistic) so the dropdown sticks while the fetch flies.
                        setRows((cur) => cur.map((r) => r.id === t.id ? { ...r, category_key: newKey, reviewed: true } : r));
                        confirmRow(t.id, newKey);
                      }}
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--rule)',
                        fontSize: 11,
                        padding: '3px 6px',
                        color: t.reviewed ? 'var(--ink)' : 'var(--ink-3)',
                        fontWeight: t.reviewed ? 500 : 400,
                        maxWidth: 260,
                      }}
                    >
                      {!currentKey && <option value="">— choose —</option>}
                      {topLevel.map((p) => {
                        const children = (optionGroups.get(p.key) || []).sort((a, b) => a.name.localeCompare(b.name));
                        return (
                          <optgroup key={p.key} label={`${p.name} (${p.type})`}>
                            <option value={p.key}>{p.name}</option>
                            {children.map((c) => (
                              <option key={c.key} value={c.key}>{`    └ ${c.name}`}</option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                    {t.ai_confidence && !t.reviewed && (
                      <span style={{
                        marginLeft: 6, fontSize: 9, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase',
                        color: t.ai_confidence === 'high' ? 'var(--positive)'
                          : t.ai_confidence === 'medium' ? 'var(--signal)'
                          : 'var(--ink-4)',
                      }}>
                        AI · {t.ai_confidence}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '6px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {t.reviewed ? (
                      <button
                        onClick={() => unconfirmRow(t.id)}
                        title="Mark unreviewed"
                        style={{
                          background: 'transparent', border: 'none',
                          color: 'var(--ink-4)', cursor: 'pointer',
                          fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase',
                          fontWeight: 500,
                        }}
                      >
                        ✓ reviewed
                      </button>
                    ) : (
                      <span style={{ fontSize: 10, color: 'var(--signal)', letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600 }}>
                        needs review
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
