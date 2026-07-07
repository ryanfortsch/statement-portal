'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Receipt capture -- photograph (or drag in) a paper receipt, review the
 * AI-prefilled fields, confirm, and the expense folds into that month's
 * Repairs & Maintenance deduction.
 *
 * Three-phase state machine copied from QuickCapture (input -> review ->
 * done): NOTHING WRITES UNTIL CONFIRM. The extract call is assist-only and
 * best-effort -- on any failure the operator lands on the same review form
 * with blank fields and a quiet note.
 *
 * The server may bounce the first Confirm with needs_confirm warnings
 * (possible double deduction against a bank charge already on the month,
 * or a statement the owner already has). The warnings render inline and
 * "Add anyway" re-submits with acknowledge_warnings.
 */

type Phase = 'input' | 'review' | 'done';

type Extracted = {
  vendor: string | null;
  amount: number | null;
  expense_date: string | null;
  category: 'repairs' | 'supplies' | 'other' | null;
  note: string | null;
  confidence: 'high' | 'medium' | 'low';
};

type Warning = {
  kind: string;
  message: string;
  owner_payout_before?: number;
  owner_payout_after?: number;
};

/**
 * Inline View / Void controls for a receipt-sourced repair_events row on the
 * dashboard's Repairs & Maintenance section (CleaningEventCredit's closed /
 * open button style). View fetches a fresh 10-minute signed URL on demand --
 * the bucket is private, so there is no stored public link. Void soft-deletes
 * (status='void'), removes the mirror row, and recomputes the statement.
 */
export function ReceiptRowActions({ receiptId, onVoided }: { receiptId: string; onVoided: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const tinyButton: React.CSSProperties = {
    fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
    border: '1px solid var(--rule)', background: 'transparent',
    padding: '3px 8px', cursor: busy ? 'wait' : 'pointer',
  };

  async function view() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/receipts/${receiptId}/url`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) { setErr(data?.error || 'No file'); return; }
      window.open(data.url, '_blank');
    } catch {
      setErr('View failed');
    } finally {
      setBusy(false);
    }
  }

  async function voidReceipt() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/receipts/${receiptId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setErr(data?.error || 'Void failed'); return; }
      setConfirming(false);
      onVoided();
    } catch {
      setErr('Void failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {!confirming ? (
        <>
          <button type="button" onClick={view} disabled={busy} style={{ ...tinyButton, color: 'var(--ink-3)' }}>
            View
          </button>
          <button type="button" onClick={() => { setConfirming(true); setErr(null); }} disabled={busy}
            style={{ ...tinyButton, color: 'var(--ink-3)' }}>
            Void
          </button>
        </>
      ) : (
        <>
          <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>Void this receipt?</span>
          <button type="button" onClick={voidReceipt} disabled={busy}
            style={{ ...tinyButton, color: 'var(--paper)', background: 'var(--ink)', border: '1px solid var(--ink)' }}>
            {busy ? '…' : 'Void'}
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={busy}
            style={{ ...tinyButton, border: 'none', color: 'var(--ink-3)' }}>
            Cancel
          </button>
        </>
      )}
      {err && <span style={{ fontSize: 10, color: 'var(--negative, #b13b2a)' }}>{err}</span>}
    </span>
  );
}

const FIELD_STYLE: React.CSSProperties = {
  border: '1px solid var(--rule)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  padding: '6px 8px',
  fontSize: 13,
  width: '100%',
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-4)',
  display: 'block',
  marginBottom: 4,
};

export function ReceiptCapture({
  propertyId,
  propertyName,
  defaultMonth,
  onDone,
  onCancel,
}: {
  propertyId: string;
  propertyName: string;
  /** 'YYYY-MM' the capture bills to by default (the card's selected month). */
  defaultMonth: string;
  /** Fired after a successful save so the caller can refresh totals. */
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('input');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractNote, setExtractNote] = useState<string | null>(null);

  // Review fields (all editable; strings so partial typing never fights React).
  const [amount, setAmount] = useState('');
  const [vendor, setVendor] = useState('');
  const [expenseDate, setExpenseDate] = useState('');
  const [statementMonth, setStatementMonth] = useState(defaultMonth);
  const [category, setCategory] = useState<'repairs' | 'supplies' | 'other'>('repairs');
  const [note, setNote] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [doneInfo, setDoneInfo] = useState<{ amount: string; month: string; uploadWarning: string | null } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Revoke the local object URL when it changes / unmounts.
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  function reset() {
    setPhase('input');
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setExtracting(false);
    setExtractNote(null);
    setAmount(''); setVendor(''); setExpenseDate(''); setNote('');
    setStatementMonth(defaultMonth);
    setCategory('repairs');
    setError(null);
    setWarnings([]);
    setDoneInfo(null);
  }

  function acceptFile(f: File | null | undefined) {
    if (!f) return;
    const ok = /^image\//.test(f.type) || f.type === 'application/pdf' || /\.(jpe?g|png|webp|heic|pdf)$/i.test(f.name);
    if (!ok) {
      setError(`"${f.name}" doesn't look like a receipt photo or PDF.`);
      return;
    }
    setError(null);
    setFile(f);
    if (/^image\//.test(f.type)) {
      setPreviewUrl(URL.createObjectURL(f));
    }
    setPhase('review');
    void runExtract(f);
  }

  async function runExtract(f: File) {
    setExtracting(true);
    setExtractNote(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await fetch('/api/receipts/extract', { method: 'POST', body: fd });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok && data.extracted) {
        const ex = data.extracted as Extracted;
        if (ex.amount != null && Number.isFinite(ex.amount)) setAmount(String(ex.amount));
        if (ex.vendor) setVendor(ex.vendor);
        if (ex.expense_date && /^\d{4}-\d{2}-\d{2}$/.test(ex.expense_date)) setExpenseDate(ex.expense_date);
        if (ex.category) setCategory(ex.category);
        if (ex.note) setNote(ex.note);
        if (ex.confidence === 'low') setExtractNote('Low-confidence read. Double-check every field.');
      } else {
        setExtractNote('Could not read the receipt. Enter the details manually.');
      }
    } catch {
      setExtractNote('Could not read the receipt. Enter the details manually.');
    } finally {
      setExtracting(false);
    }
  }

  async function submit(acknowledge: boolean) {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setError('Enter a positive amount.'); return; }
    if (!/^\d{4}-\d{2}$/.test(statementMonth)) { setError('Pick a statement month.'); return; }
    setSaving(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('property_id', propertyId);
      fd.append('month', statementMonth);
      fd.append('amount', String(amt));
      if (vendor.trim()) fd.append('vendor_name', vendor.trim());
      if (note.trim()) fd.append('description', note.trim());
      if (expenseDate) fd.append('expense_date', expenseDate);
      fd.append('category', category);
      if (acknowledge) fd.append('acknowledge_warnings', 'true');
      if (file) fd.append('file', file);
      const res = await fetch('/api/receipts', { method: 'POST', body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || 'Save failed'); return; }
      if (data?.needs_confirm) {
        setWarnings((data.warnings || []) as Warning[]);
        return;
      }
      if (!data?.ok) { setError(data?.error || 'Save failed'); return; }
      setDoneInfo({ amount: amt.toFixed(2), month: statementMonth, uploadWarning: data.upload_warning || null });
      setPhase('done');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const monthMismatch =
    expenseDate && /^\d{4}-\d{2}-\d{2}$/.test(expenseDate) && expenseDate.slice(0, 7) !== statementMonth
      ? expenseDate.slice(0, 7)
      : null;

  const frame: React.CSSProperties = {
    border: '1px solid var(--rule)',
    background: 'var(--paper-2)',
    padding: 14,
    fontFamily: 'var(--sans)',
  };

  // ── DONE ──
  if (phase === 'done' && doneInfo) {
    return (
      <div style={frame}>
        <div style={{ fontSize: 12, color: 'var(--ink)' }}>
          <span style={{ color: 'var(--positive)', fontWeight: 600 }}>Saved.</span>{' '}
          ${doneInfo.amount} billed to {doneInfo.month} under Repairs &amp; Maintenance.
        </div>
        {doneInfo.uploadWarning && (
          <div style={{ fontSize: 11, color: 'var(--signal)', marginTop: 6 }}>{doneInfo.uploadWarning}</div>
        )}
        <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
          <button type="button" onClick={reset} style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
            color: 'var(--ink)', border: '1px solid var(--ink)', background: 'transparent',
            padding: '5px 10px', cursor: 'pointer',
          }}>
            Add another
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
              color: 'var(--ink-3)', border: 'none', background: 'transparent',
              padding: '5px 6px', cursor: 'pointer',
            }}>
              Close
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── INPUT ──
  if (phase === 'input') {
    return (
      <div style={frame}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          Add receipt &middot; {propertyName}
        </div>
        <div
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
          onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(false); }}
          onDrop={(e) => {
            e.preventDefault(); e.stopPropagation(); setDragging(false);
            acceptFile(e.dataTransfer.files?.[0]);
          }}
          style={{
            marginTop: 10, padding: 16,
            border: `${dragging ? '2px' : '1px'} dashed ${dragging ? 'var(--ink)' : 'var(--ink-4)'}`,
            background: dragging ? 'var(--paper)' : 'transparent',
            transition: 'background .12s, border-color .12s',
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', flexWrap: 'wrap' }}>
            <input
              ref={fileInputRef}
              type="file"
              // Nudge Safari toward JPEG conversion; capture opens the phone
              // camera directly (receipts happen at Home Depot, not a desk).
              accept="image/jpeg,image/png,image/webp,application/pdf"
              capture="environment"
              onChange={(e) => { acceptFile(e.target.files?.[0]); e.target.value = ''; }}
              style={{ display: 'none' }}
            />
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              border: '1px solid var(--ink)', padding: '7px 12px',
              fontSize: 10, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase',
              color: 'var(--ink)',
            }}>
              Photograph receipt
            </span>
            <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>
              {dragging ? 'Release to add' : 'or drag a photo / PDF here'}
            </span>
          </label>
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => { setError(null); setPhase('review'); }}
            style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase',
              color: 'var(--ink-3)', border: 'none', background: 'transparent',
              padding: 0, cursor: 'pointer', textDecoration: 'underline',
            }}
          >
            Enter manually
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase',
              color: 'var(--ink-4)', border: 'none', background: 'transparent',
              padding: 0, cursor: 'pointer',
            }}>
              Cancel
            </button>
          )}
        </div>
        {error && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--signal)' }}>{error}</div>}
      </div>
    );
  }

  // ── REVIEW ──
  return (
    <div style={frame}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
        Review receipt &middot; {propertyName}
      </div>
      {extracting && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-3)' }}>Reading the receipt…</div>
      )}
      {!extracting && extractNote && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-3)' }}>{extractNote}</div>
      )}

      <div style={{ display: 'flex', gap: 14, marginTop: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="Receipt preview"
            style={{ width: 96, maxHeight: 160, objectFit: 'cover', border: '1px solid var(--rule)', flexShrink: 0 }}
          />
        )}
        {!previewUrl && file && (
          <div style={{
            width: 96, height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid var(--rule)', fontSize: 10, color: 'var(--ink-4)', flexShrink: 0,
            textTransform: 'uppercase', letterSpacing: '.1em',
          }}>
            PDF
          </div>
        )}
        <div style={{ flex: 1, minWidth: 240, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={LABEL_STYLE}>Amount ($)</label>
            <input type="number" step="0.01" min="0" value={amount} disabled={saving}
              onChange={(e) => { setAmount(e.target.value); setWarnings([]); }} style={FIELD_STYLE} />
          </div>
          <div>
            <label style={LABEL_STYLE}>Vendor</label>
            <input type="text" value={vendor} disabled={saving} placeholder="Home Depot"
              onChange={(e) => setVendor(e.target.value)} style={FIELD_STYLE} />
          </div>
          <div>
            <label style={LABEL_STYLE}>Expense date</label>
            <input type="date" value={expenseDate} disabled={saving}
              onChange={(e) => setExpenseDate(e.target.value)} style={FIELD_STYLE} />
          </div>
          <div>
            <label style={LABEL_STYLE}>Statement month</label>
            <input type="month" value={statementMonth} disabled={saving}
              onChange={(e) => { setStatementMonth(e.target.value); setWarnings([]); }} style={FIELD_STYLE} />
            {monthMismatch && (
              <button
                type="button"
                onClick={() => setStatementMonth(monthMismatch)}
                style={{
                  marginTop: 4, fontSize: 10, color: 'var(--signal)', border: 'none',
                  background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'left', textDecoration: 'underline',
                }}
              >
                Receipt dated {expenseDate} -- bill to {monthMismatch}?
              </button>
            )}
          </div>
          <div>
            <label style={LABEL_STYLE}>Category</label>
            <select value={category} disabled={saving}
              onChange={(e) => setCategory(e.target.value as 'repairs' | 'supplies' | 'other')} style={FIELD_STYLE}>
              <option value="repairs">Repairs</option>
              <option value="supplies">Supplies</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label style={LABEL_STYLE}>Note (owner-facing)</label>
            <input type="text" value={note} disabled={saving} placeholder="Replacement smoke detectors"
              onChange={(e) => setNote(e.target.value)} style={FIELD_STYLE} />
          </div>
        </div>
      </div>

      {warnings.length > 0 && (
        <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(200,90,58,.08)', border: '1px solid var(--signal)' }}>
          {warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--signal)', marginTop: i > 0 ? 6 : 0 }}>{w.message}</div>
          ))}
        </div>
      )}
      {error && <div style={{ marginTop: 10, fontSize: 11, color: 'var(--signal)' }}>{error}</div>}

      <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
        {warnings.length === 0 ? (
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={saving || extracting}
            style={{
              background: 'var(--ink)', color: 'var(--paper)', border: '1px solid var(--ink)',
              padding: '7px 14px', fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
              cursor: saving ? 'wait' : 'pointer', opacity: saving || extracting ? 0.5 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Confirm'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={saving}
            style={{
              background: 'var(--signal)', color: 'var(--paper)', border: '1px solid var(--signal)',
              padding: '7px 14px', fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
              cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.5 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Add anyway'}
          </button>
        )}
        <button
          type="button"
          onClick={() => (onCancel ? onCancel() : reset())}
          disabled={saving}
          style={{
            background: 'transparent', border: '1px solid var(--rule)', color: 'var(--ink-3)',
            padding: '7px 12px', fontSize: 10, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
