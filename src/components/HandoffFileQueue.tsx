'use client';

import { useEffect, useState } from 'react';
import {
  HANDOFF_STATUS_LABEL,
  firstNameFromEmail,
  fmtMoney,
  kindMeta,
  type HandoffItem,
} from '@/lib/close-handoff';

/**
 * The field handoff on a statement card: what the operations manager sent
 * for this home and month, and the owner's three moves on each item.
 *
 *   File as receipt   posts the item (and its photo, copied through a signed
 *                     URL) to /api/receipts, the ONE receipt writer, so every
 *                     guard it has (double deduction, sent statement, freeze)
 *                     runs exactly as it does for a receipt added by hand;
 *                     needs_confirm comes back here as warnings with an
 *                     "Add anyway", like ReceiptCapture. The item then
 *                     records the receipt id.
 *   Note on period    for a cleaning issue: the text becomes a period note
 *                     through /api/period-notes, and the item is filed.
 *   Set aside         dismissed, with an optional note typed inline (the
 *                     house pattern, not a browser prompt).
 *
 * This component never writes property_receipts, repair_events or a
 * statement itself. Renders nothing when the month has no live items.
 */

type Warning = { kind: string; message: string };

const TINY: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
  border: '1px solid var(--rule)', background: 'transparent', color: 'var(--ink-3)',
  padding: '3px 8px', cursor: 'pointer',
};
const FIELD: React.CSSProperties = {
  border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)',
  padding: '5px 7px', fontSize: 12, width: '100%',
};
const LABEL: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
  color: 'var(--ink-4)', display: 'block', marginBottom: 3,
};

async function copyPhoto(item: HandoffItem): Promise<File | null> {
  if (!item.file_path) return null;
  try {
    const res = await fetch(`/api/close-handoff/${item.id}/url`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.url) return null;
    const blobRes = await fetch(String(data.url));
    if (!blobRes.ok) return null;
    const blob = await blobRes.blob();
    const name = item.file_path.split('/').pop() || 'receipt';
    return new File([blob], name, { type: blob.type || 'image/jpeg' });
  } catch {
    return null;
  }
}

export function HandoffFileQueue({
  propertyId,
  propertyName,
  month,
  onFiled,
}: {
  propertyId: string;
  propertyName: string;
  month: string;
  /** Fired after a receipt lands so the card refreshes its totals. */
  onFiled: () => void;
}) {
  const [items, setItems] = useState<HandoffItem[]>([]);
  const [filing, setFiling] = useState<HandoffItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [amount, setAmount] = useState('');
  const [vendor, setVendor] = useState('');
  const [expenseDate, setExpenseDate] = useState('');
  const [category, setCategory] = useState<'repairs' | 'supplies' | 'other'>('repairs');
  const [note, setNote] = useState('');
  // Set aside opens an inline note under the item: which item, and the note.
  const [asideFor, setAsideFor] = useState<string | null>(null);
  const [asideNote, setAsideNote] = useState('');

  // The live items for this home and month. State is set only from the
  // fetch's callbacks, never in the effect body, and a stale response for a
  // month the card has since left is dropped.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/close-handoff?month=${encodeURIComponent(month)}&property_id=${encodeURIComponent(propertyId)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !Array.isArray(data?.items)) { setItems([]); return; }
        setItems((data.items as HandoffItem[]).filter((i) => i.status === 'open' || i.status === 'sent'));
      })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [month, propertyId]);

  function startFiling(item: HandoffItem) {
    const km = kindMeta(item.kind);
    setFiling(item);
    setAmount(item.amount != null ? String(item.amount) : '');
    setVendor(item.vendor ?? '');
    setExpenseDate(item.charge_date ?? '');
    setCategory(km.receiptCategory ?? 'other');
    setNote(item.description);
    setWarnings([]);
    setError(null);
  }

  async function patch(item: HandoffItem, body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/close-handoff/${item.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) { setError(data?.error || 'That did not save'); return false; }
    return true;
  }

  async function fileReceipt(acknowledge: boolean) {
    if (!filing) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setError('Enter a positive amount.'); return; }
    setBusy(filing.id); setError(null);
    try {
      const fd = new FormData();
      fd.append('property_id', propertyId);
      fd.append('month', month);
      fd.append('amount', String(amt));
      if (vendor.trim()) fd.append('vendor_name', vendor.trim());
      if (note.trim()) fd.append('description', note.trim());
      if (expenseDate) fd.append('expense_date', expenseDate);
      fd.append('category', category);
      if (acknowledge) fd.append('acknowledge_warnings', 'true');
      const photo = await copyPhoto(filing);
      if (photo) fd.append('file', photo);
      const res = await fetch('/api/receipts', { method: 'POST', body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || 'Save failed'); return; }
      if (data?.needs_confirm) { setWarnings((data.warnings || []) as Warning[]); return; }
      if (!data?.ok) { setError(data?.error || 'Save failed'); return; }
      const receiptId = typeof data?.receipt?.id === 'string' ? data.receipt.id : null;
      const noted = [
        receiptId ? null : 'receipt saved',
        filing.file_path && !photo ? 'the photo could not be copied' : null,
        data.upload_warning ? String(data.upload_warning) : null,
      ].filter(Boolean).join('; ');
      await patch(filing, { action: 'filed', receipt_id: receiptId, note: noted || undefined });
      setFiling(null);
      setItems((prev) => prev.filter((i) => i.id !== filing.id));
      onFiled();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  }

  async function noteOnPeriod(item: HandoffItem) {
    setBusy(item.id); setError(null);
    try {
      const body = `${propertyName}: ${item.description}${item.vendor ? ` (${item.vendor})` : ''}${item.charge_date ? `, ${item.charge_date}` : ''}. From the field handoff.`;
      const res = await fetch('/api/period-notes', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ month, body, property_id: propertyId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || 'The note did not save'); return; }
      if (await patch(item, { action: 'filed', note: 'noted on the period' })) {
        setItems((prev) => prev.filter((i) => i.id !== item.id));
      }
    } finally {
      setBusy(null);
    }
  }

  async function setAside(item: HandoffItem) {
    setBusy(item.id); setError(null);
    try {
      if (await patch(item, { action: 'dismiss', note: asideNote.trim() || undefined })) {
        setItems((prev) => prev.filter((i) => i.id !== item.id));
        setAsideFor(null); setAsideNote('');
      }
    } finally {
      setBusy(null);
    }
  }

  async function view(item: HandoffItem) {
    try {
      const res = await fetch(`/api/close-handoff/${item.id}/url`);
      const data = await res.json().catch(() => null);
      if (res.ok && data?.url) window.open(String(data.url), '_blank');
      else setError(data?.error || 'No file');
    } catch {
      setError('View failed');
    }
  }

  if (items.length === 0) return null;

  return (
    <div style={{ border: '1px solid var(--rule)', background: 'var(--paper-2)', padding: 14, marginTop: 12, fontFamily: 'var(--sans)' }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 8 }}>
        From the field &middot; {items.length} item{items.length === 1 ? '' : 's'} for {month}
      </div>
      {items.map((item) => {
        const km = kindMeta(item.kind);
        const isFiling = filing?.id === item.id;
        return (
          <div key={item.id} style={{ padding: '8px 0', borderTop: '1px solid var(--rule)' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--ink)' }}>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-4)', marginRight: 8 }}>{km.label}</span>
                  {item.description}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>
                  {[item.vendor, item.amount != null ? fmtMoney(item.amount) : null, item.charge_date, `${HANDOFF_STATUS_LABEL[item.status].toLowerCase()} by ${firstNameFromEmail(item.created_by)}`]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <span style={{ display: 'inline-flex', gap: 6, whiteSpace: 'nowrap' }}>
                {item.file_path && <button type="button" onClick={() => view(item)} disabled={busy !== null} style={TINY}>View</button>}
                {km.money && !isFiling && <button type="button" onClick={() => startFiling(item)} disabled={busy !== null} style={{ ...TINY, color: 'var(--ink)', borderColor: 'var(--ink)' }}>File as receipt</button>}
                {!km.money && <button type="button" onClick={() => noteOnPeriod(item)} disabled={busy !== null} style={{ ...TINY, color: 'var(--ink)', borderColor: 'var(--ink)' }}>Note on period</button>}
                {asideFor !== item.id && (
                  <button type="button" onClick={() => { setAsideFor(item.id); setAsideNote(''); setFiling(null); setWarnings([]); }} disabled={busy !== null} style={TINY}>Set aside</button>
                )}
              </span>
            </div>

            {asideFor === item.id && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                <input
                  value={asideNote}
                  onChange={(e) => setAsideNote(e.target.value)}
                  maxLength={300}
                  placeholder="Why it is set aside (optional)"
                  autoFocus
                  style={{ ...FIELD, width: 'auto', flex: '1 1 200px' }}
                />
                <button type="button" onClick={() => setAside(item)} disabled={busy !== null} style={{ ...TINY, color: 'var(--ink)', borderColor: 'var(--ink)' }}>
                  {busy === item.id ? 'Setting aside…' : 'Set aside'}
                </button>
                <button type="button" onClick={() => { setAsideFor(null); setAsideNote(''); }} disabled={busy !== null} style={{ ...TINY, border: 'none' }}>Cancel</button>
              </div>
            )}

            {isFiling && (
              <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--rule)', background: 'var(--paper)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                  <label><span style={LABEL}>Amount</span><input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={FIELD} /></label>
                  <label><span style={LABEL}>Vendor</span><input value={vendor} onChange={(e) => setVendor(e.target.value)} style={FIELD} /></label>
                  <label><span style={LABEL}>Date</span><input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} style={FIELD} /></label>
                  <label>
                    <span style={LABEL}>Category</span>
                    <select value={category} onChange={(e) => setCategory(e.target.value as 'repairs' | 'supplies' | 'other')} style={FIELD}>
                      <option value="repairs">Repairs</option>
                      <option value="supplies">Supplies</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                </div>
                <label style={{ display: 'block', marginTop: 10 }}><span style={LABEL}>Note</span><input value={note} onChange={(e) => setNote(e.target.value)} style={FIELD} maxLength={200} /></label>
                {warnings.length > 0 && (
                  <div style={{ marginTop: 10, borderLeft: '3px solid var(--signal)', padding: '6px 10px', fontSize: 12, color: 'var(--ink-2)' }}>
                    {warnings.map((w, i) => <div key={i}>{w.message}</div>)}
                  </div>
                )}
                <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                  {warnings.length === 0 ? (
                    <button type="button" onClick={() => fileReceipt(false)} disabled={busy !== null} style={{ ...TINY, color: 'var(--paper)', background: 'var(--ink)', borderColor: 'var(--ink)', padding: '6px 12px' }}>
                      {busy === item.id ? 'Filing…' : `Bill to ${month}`}
                    </button>
                  ) : (
                    <button type="button" onClick={() => fileReceipt(true)} disabled={busy !== null} style={{ ...TINY, color: 'var(--paper)', background: 'var(--ink)', borderColor: 'var(--ink)', padding: '6px 12px' }}>
                      {busy === item.id ? 'Filing…' : 'Add anyway'}
                    </button>
                  )}
                  <button type="button" onClick={() => { setFiling(null); setWarnings([]); }} disabled={busy !== null} style={{ ...TINY, border: 'none' }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {error && <div role="alert" style={{ fontSize: 11, color: 'var(--signal)', marginTop: 8 }}>{error}</div>}
    </div>
  );
}
