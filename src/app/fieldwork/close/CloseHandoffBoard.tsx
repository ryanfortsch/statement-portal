'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  HANDOFF_KINDS,
  HANDOFF_STATUS_LABEL,
  dueWording,
  firstNameFromEmail,
  fmtMoney,
  groupByProperty,
  handoffDueDate,
  fmtDay,
  kindMeta,
  monthLabel,
  summarize,
  type HandoffItem,
  type HandoffKind,
} from '@/lib/close-handoff';

/**
 * The close handoff board: the month strip, the add form, and the items by
 * home. Staff add, delete and send their own items; an owner can also set an
 * item aside here. Filing into a statement happens on the statement card,
 * through the receipt path, so this board never posts to /api/receipts.
 */

const FIELD: React.CSSProperties = {
  border: '1px solid var(--rule)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  padding: '6px 8px',
  fontSize: 13,
  width: '100%',
};
const LABEL: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-4)',
  display: 'block',
  marginBottom: 4,
};
const TINY: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
  border: '1px solid var(--rule)', background: 'transparent', color: 'var(--ink-3)',
  padding: '3px 8px', cursor: 'pointer',
};
const PRIMARY: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
  color: 'var(--paper)', background: 'var(--ink)', border: '1px solid var(--ink)',
  padding: '8px 14px', cursor: 'pointer',
};

function statusColor(status: HandoffItem['status']): string {
  if (status === 'filed') return 'var(--positive)';
  if (status === 'dismissed') return 'var(--ink-4)';
  if (status === 'sent') return 'var(--tide-deep)';
  return 'var(--signal)';
}

export function CloseHandoffBoard({
  month,
  months,
  today,
  items,
  properties,
  statementHomes,
  owner,
  me,
}: {
  month: string;
  months: string[];
  today: string;
  items: HandoffItem[];
  properties: { id: string; name: string }[];
  statementHomes: string[];
  owner: boolean;
  me: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Set aside opens an inline note under the item (the house pattern), not
  // a browser prompt. The id of the item whose note is open, and the note.
  const [asideFor, setAsideFor] = useState<string | null>(null);
  const [asideNote, setAsideNote] = useState('');

  // The add form. The home starts blank: a default of the first home was a
  // mis-file waiting to happen on a phone.
  const [propertyId, setPropertyId] = useState('');
  const [kind, setKind] = useState<HandoffKind>('repair');
  const [description, setDescription] = useState('');
  const [vendor, setVendor] = useState('');
  const [amount, setAmount] = useState('');
  const [chargeDate, setChargeDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);

  const names = new Map(properties.map((p) => [p.id, p.name]));
  const stmtHomes = new Set(statementHomes);
  const summary = summarize(items);
  const groups = groupByProperty(items);
  const due = handoffDueDate(month);
  const meta = kindMeta(kind);

  async function call(url: string, init: RequestInit, key: string): Promise<Record<string, unknown> | null> {
    setBusy(key); setError(null); setNotice(null);
    try {
      const res = await fetch(url, init);
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) { setError((data?.error as string) || 'That did not save'); return null; }
      return data ?? {};
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save');
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.append('property_id', propertyId);
    fd.append('month', month);
    fd.append('kind', kind);
    fd.append('description', description.trim());
    if (vendor.trim()) fd.append('vendor', vendor.trim());
    if (amount.trim()) fd.append('amount', amount.trim());
    if (chargeDate) fd.append('charge_date', chargeDate);
    if (file) fd.append('file', file);
    const data = await call('/api/close-handoff', { method: 'POST', body: fd }, 'add');
    if (!data) return;
    setDescription(''); setVendor(''); setAmount(''); setChargeDate(''); setFile(null); setFileKey((k) => k + 1);
    setNotice(data.upload_warning ? String(data.upload_warning) : 'Added.');
    router.refresh();
  }

  async function sendMonth() {
    const data = await call('/api/close-handoff', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ month }),
    }, 'send');
    if (!data) return;
    setNotice(`${monthLabel(month)} sent: ${data.sent} item${data.sent === 1 ? '' : 's'} are with the office.`);
    router.refresh();
  }

  async function act(item: HandoffItem, action: 'sent' | 'reopen' | 'dismiss', note?: string) {
    const data = await call(`/api/close-handoff/${item.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, note }),
    }, item.id);
    if (data) router.refresh();
  }

  async function remove(item: HandoffItem) {
    if (!window.confirm(`Delete this item? It comes off the handoff for good${item.status === 'sent' ? " and off Ryan's queue" : ''}.`)) return;
    const data = await call(`/api/close-handoff/${item.id}`, { method: 'DELETE' }, item.id);
    if (data) router.refresh();
  }

  async function setAside(item: HandoffItem) {
    await act(item, 'dismiss', asideNote.trim() || undefined);
    setAsideFor(null); setAsideNote('');
  }

  async function view(item: HandoffItem) {
    const data = await call(`/api/close-handoff/${item.id}/url`, {}, `view-${item.id}`);
    if (data?.url) window.open(String(data.url), '_blank');
  }

  return (
    <div>
      {/* Month strip + the deadline. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
        {months.map((m) => (
          <Link
            key={m}
            href={`/fieldwork/close?month=${m}`}
            aria-current={m === month ? 'page' : undefined}
            className="font-serif"
            style={{ fontSize: 20, textDecoration: 'none', color: m === month ? 'var(--ink)' : 'var(--ink-4)', borderBottom: m === month ? '2px solid var(--ink)' : '2px solid transparent', paddingBottom: 2 }}
          >
            {monthLabel(m)}
          </Link>
        ))}
      </div>
      <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '14px 18px', marginBottom: 24, background: 'var(--paper-2, #fff)', display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: '1 1 260px' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
            {monthLabel(month)} · {dueWording(month, today)}
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.5 }}>
            {summary.pending === 0 && summary.filed + summary.dismissed === 0
              ? 'Nothing added yet.'
              : `${summary.open} not sent · ${summary.sent} with the office · ${summary.filed} filed · ${summary.dismissed} set aside${summary.pendingAmount > 0 ? ` · ${fmtMoney(summary.pendingAmount)} waiting` : ''}`}
            {' '}Send by {fmtDay(due)}; the close starts three days later.
          </div>
          {/* What happens after Sent, for the person who never sees a
              statement: the owner-only footer used to be the only place. */}
          {!owner && summary.sent > 0 && (
            <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 4 }}>
              Sent items are with Ryan. He files each into the owner statement, and it turns to Filed here.
            </div>
          )}
        </div>
        {summary.open > 0 && (
          <button type="button" onClick={sendMonth} disabled={busy !== null} style={PRIMARY}>
            {busy === 'send' ? 'Sending…' : `Mark ${monthLabel(month).split(' ')[0]} sent (${summary.open})`}
          </button>
        )}
      </div>

      {error && <div role="alert" style={{ fontSize: 12, color: 'var(--signal)', marginBottom: 12 }}>{error}</div>}
      {notice && <div style={{ fontSize: 12, color: 'var(--positive)', marginBottom: 12 }}>{notice}</div>}

      {/* Add an item. */}
      <form onSubmit={add} style={{ border: '1px solid var(--rule)', background: 'var(--paper-2)', padding: 14, marginBottom: 28 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 10 }}>
          Add to {monthLabel(month)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <label>
            <span style={LABEL}>Home</span>
            <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} style={FIELD} required>
              <option value="" disabled>Choose the home…</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>
            <span style={LABEL}>What kind</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as HandoffKind)} style={FIELD}>
              {HANDOFF_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </label>
          {meta.money && (
            <label>
              <span style={LABEL}>Amount</span>
              <input type="number" step="0.01" min="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={FIELD} required placeholder="0.00" />
            </label>
          )}
          <label>
            <span style={LABEL}>Date</span>
            <input type="date" value={chargeDate} onChange={(e) => setChargeDate(e.target.value)} style={FIELD} />
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginTop: 12 }}>
          <label>
            <span style={LABEL}>{meta.money ? 'Vendor or store' : 'Who was involved'}</span>
            <input value={vendor} onChange={(e) => setVendor(e.target.value)} style={FIELD} placeholder={meta.money ? 'Paone Mechanical, Home Depot…' : 'Cape Ann Elite…'} />
          </label>
          <label>
            <span style={LABEL}>Photo or PDF</span>
            <input key={fileKey} type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ ...FIELD, padding: '4px 6px' }} />
          </label>
        </div>
        <label style={{ display: 'block', marginTop: 12 }}>
          <span style={LABEL}>What it was</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} style={FIELD} required maxLength={300} placeholder={meta.hint} />
        </label>
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="submit" disabled={busy !== null || !propertyId} style={PRIMARY}>{busy === 'add' ? 'Adding…' : 'Add'}</button>
        </div>
      </form>

      {/* Items by home. */}
      {groups.size === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--ink-4)' }}>No items for {monthLabel(month)} yet.</div>
      ) : (
        [...groups.entries()].map(([pid, list]) => (
          <div key={pid} style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, borderBottom: '1px solid var(--rule)', paddingBottom: 6, marginBottom: 8 }}>
              <div className="font-serif" style={{ fontSize: 18 }}>{names.get(pid) ?? pid}</div>
              {!stmtHomes.has(pid) && (
                <span style={{ fontSize: 10, color: 'var(--ink-4)', letterSpacing: '.06em' }}>no owner statement for this home</span>
              )}
            </div>
            {list.map((item) => {
              const km = kindMeta(item.kind);
              const mine = item.created_by.toLowerCase() === me.toLowerCase();
              const live = item.status === 'open' || item.status === 'sent';
              return (
                <div key={item.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--rule-soft, var(--rule))' }}>
                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-4)', marginRight: 8 }}>{km.label}</span>
                      {item.description}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>
                      {[item.vendor, item.amount != null ? fmtMoney(item.amount) : null, item.charge_date, `by ${firstNameFromEmail(item.created_by)}`]
                        .filter(Boolean)
                        .join(' · ')}
                      {item.status === 'filed' && item.receipt_id ? ' · filed as a receipt' : ''}
                      {item.resolution_note ? ` · ${item.resolution_note}` : ''}
                    </div>
                  </div>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: statusColor(item.status), whiteSpace: 'nowrap', paddingTop: 2 }}>
                    {HANDOFF_STATUS_LABEL[item.status]}
                  </span>
                  <span style={{ display: 'inline-flex', gap: 6, whiteSpace: 'nowrap' }}>
                    {item.file_path && <button type="button" onClick={() => view(item)} disabled={busy !== null} style={TINY}>View</button>}
                    {live && (mine || owner) && item.status === 'open' && <button type="button" onClick={() => act(item, 'sent')} disabled={busy !== null} style={TINY}>Send</button>}
                    {live && (mine || owner) && item.status === 'sent' && <button type="button" onClick={() => act(item, 'reopen')} disabled={busy !== null} style={TINY}>Reopen</button>}
                    {live && (mine || owner) && <button type="button" onClick={() => remove(item)} disabled={busy !== null} style={TINY}>Delete</button>}
                    {live && owner && asideFor !== item.id && (
                      <button type="button" onClick={() => { setAsideFor(item.id); setAsideNote(''); }} disabled={busy !== null} style={TINY}>
                        Set aside
                      </button>
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
                      style={{ ...FIELD, width: 'auto', flex: '1 1 220px' }}
                    />
                    <button type="button" onClick={() => void setAside(item)} disabled={busy !== null} style={{ ...TINY, color: 'var(--ink)', borderColor: 'var(--ink)' }}>
                      {busy === item.id ? 'Setting aside…' : 'Set aside'}
                    </button>
                    <button type="button" onClick={() => { setAsideFor(null); setAsideNote(''); }} disabled={busy !== null} style={{ ...TINY, border: 'none' }}>Cancel</button>
                  </div>
                )}
                </div>
              );
            })}
          </div>
        ))
      )}

      {owner && summary.pending > 0 && (
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>
          Repair costs and card charges file into the statement from the home&apos;s card on{' '}
          <Link href="/statements" style={{ color: 'var(--tide-deep)' }}>Statements</Link>, through the same receipt step as any
          other receipt. Cleaning issues can be noted on the period there.
        </div>
      )}
    </div>
  );
}
