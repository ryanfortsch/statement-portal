'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ReceiptCapture, ReceiptRowActions } from '@/components/ReceiptCapture';
import { buttonClass } from '@/lib/button-class';
import { isStatementMonth, statementsHref } from '@/lib/statements-month';

type PropertyOption = { id: string; name: string; location: string };
type Receipt = {
  id: string; amount: number; vendor_name: string | null; expense_date: string | null;
  description: string | null; receipt_path: string | null;
};

export function StatementReceipts({ properties, initialMonth, initialPropertyId }: {
  properties: PropertyOption[]; initialMonth: string; initialPropertyId: string;
}) {
  const [propertyId, setPropertyId] = useState(() => properties.some(p => p.id === initialPropertyId) ? initialPropertyId : '');
  const [month, setMonth] = useState(initialMonth);
  const [capture, setCapture] = useState(false);
  const [revision, setRevision] = useState(0);
  const property = properties.find(p => p.id === propertyId);
  const field = { display: 'block', width: '100%', marginTop: 6, padding: 10, border: '1px solid var(--rule)', background: 'var(--paper)' };

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginBottom: 24 }}>
        <label style={{ flex: '1 1 260px' }}>Property
          <select value={propertyId} disabled={capture} onChange={e => setPropertyId(e.target.value)} style={field}>
            <option value="">Choose a property</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.name}{p.location ? ` · ${p.location}` : ''}</option>)}
          </select>
        </label>
        <label>Statement month
          <input type="month" value={month} disabled={capture} onChange={e => setMonth(e.target.value)} style={field} />
        </label>
      </div>
      {properties.length === 0 && <EmptyState>No active properties are available.</EmptyState>}
      {!capture && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 28 }}>
          <Button variant="primary" disabled={!property || !isStatementMonth(month)} onClick={() => setCapture(true)}>Add receipt</Button>
          <Link href={statementsHref(month)} className={buttonClass('quiet')}>Back to statements</Link>
        </div>
      )}
      {capture && property && (
        <ReceiptCapture
          propertyId={property.id} propertyName={property.name} defaultMonth={month}
          onDone={({ month: savedMonth }) => { setMonth(savedMonth); setRevision(n => n + 1); }}
          onCancel={() => { setCapture(false); setRevision(n => n + 1); }}
        />
      )}
      {property && isStatementMonth(month) && (
        <SavedReceipts key={`${propertyId}:${month}:${revision}`} propertyId={propertyId} propertyName={property.name} month={month} onChanged={() => setRevision(n => n + 1)} />
      )}
    </>
  );
}

function SavedReceipts({ propertyId, propertyName, month, onChanged }: {
  propertyId: string; propertyName: string; month: string; onChanged: () => void;
}) {
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ property_id: propertyId, month });
    void (async () => {
      try {
        const res = await fetch(`/api/receipts?${params}`, { signal: controller.signal, cache: 'no-store' });
        const data = await res.json();
        if (!res.ok || !Array.isArray(data.receipts)) throw new Error('Saved receipts did not load.');
        if (!controller.signal.aborted) setReceipts(data.receipts);
      } catch {
        if (!controller.signal.aborted) setError('Saved receipts did not load. Check them before adding the same purchase again.');
      }
    })();
    return () => controller.abort();
  }, [propertyId, month]);

  return (
    <section style={{ marginTop: 32 }} aria-label="Saved receipts">
      <h2 className="font-serif text-2xl">Saved for {propertyName} · {month}</h2>
      {error ? <div role="alert"><p>{error}</p><Button size="sm" onClick={onChanged}>Retry</Button></div>
        : receipts === null ? <p role="status">Loading receipts…</p>
          : receipts.length === 0 ? <EmptyState>No receipts saved for this property and month.</EmptyState>
            : <ul style={{ listStyle: 'none', padding: 0 }}>
              {receipts.map(r => <li key={r.id} style={{ borderTop: '1px solid var(--rule)', padding: '16px 0' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 }}>
                  <strong>{r.vendor_name || 'Receipt'} · ${Number(r.amount).toFixed(2)}</strong>
                  <ReceiptRowActions receiptId={r.id} onVoided={onChanged} />
                </div>
                <p style={{ color: 'var(--ink-3)', marginTop: 6 }}>{[r.expense_date, r.description, r.receipt_path ? 'Receipt attached' : 'No attachment'].filter(Boolean).join(' · ')}</p>
              </li>)}
            </ul>}
    </section>
  );
}
