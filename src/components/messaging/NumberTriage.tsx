'use client';

import { suggestedContact } from '@/lib/matching-suggestions';
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ContactType, UnknownNumberRow } from '@/lib/crm';
import { QUO_LINES } from '@/lib/quo-lines';
import type { ContactReconcileSuggestionRow } from '@/lib/quo-reconcile';
import type { KnownForRow } from '@/lib/number-triage';
import type { DoNotHostNote } from '@/lib/do-not-host';
import { DoNotHostLine } from '@/components/DoNotHostLine';
import {
  addUnknownAsContact,
  dismissUnknownNumber,
  attachUnknownToContact,
  acceptContactSuggestion,
  dismissContactSuggestion,
} from '@/app/crm/actions';
import { NewContactModal } from '@/app/crm/NewContactModal';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { useSoftRefresh } from '@/lib/use-soft-refresh';

/**
 * The number triage card on /messaging: numbers that reached a Quo line and
 * that Helm cannot name, and what the Quo address book knows that the
 * contact list does not. One card, one verb set on every row:
 *
 *   Attach       link the number (or the address book's email / company) to
 *                a contact already in Helm
 *   New contact  file it as a new contact
 *   Not ours     hide it for good (a wrong number, a robocall, nobody we keep)
 *
 * It lived in two boxes on /crm with two verb sets (Attach / Add as new /
 * Dismiss, Add to Helm / Skip) until 2026-10-18. Each row owns its pending
 * state; a lost response keeps the row and says to check before retrying.
 *
 * A number Helm can name (knownByPhone, src/lib/known-numbers.ts) leads
 * with the name, picks the household it belongs to, and opens New contact
 * with the name typed.
 */

type TriageContact = { id: string; name: string; phone: string | null; type: ContactType };

type Props = {
  unknownNumbers: UnknownNumberRow[];
  olderUnknownNumbers?: UnknownNumberRow[];
  suggestions: ContactReconcileSuggestionRow[];
  olderSuggestions?: ContactReconcileSuggestionRow[];
  guestByPhone: Record<string, string>;
  knownByPhone?: Record<string, KnownForRow>;
  /** phone -> the do-not-host note, when the number is a guest Helm will not host again. */
  doNotHostByPhone?: Record<string, DoNotHostNote>;
  contacts: TriageContact[];
  properties: Array<{ id: string; name: string }>;
};

/** Rows an opened Older fold renders; each carries a contact picker. */
const OLDER_SHOWN = 100;
/** The inbox opens on the newest few numbers; the rest wait behind Show all,
 *  so a backlog never pushes the guest drafts off the screen. */
const RECENT_SHOWN = 3;

/** What a new contact from this line most likely is. No guest type exists. */
function defaultTypeForLine(line: UnknownNumberRow['quo_line'], known?: KnownForRow): ContactType {
  if (known?.source === 'owner') return 'owner';
  if (known?.source === 'prospect') return 'lead';
  if (line === 'ops') return 'vendor';
  if (line === 'owners') return 'lead';
  return 'other';
}

export function NumberTriage({ unknownNumbers, olderUnknownNumbers = [], suggestions, olderSuggestions = [], guestByPhone, knownByPhone = {}, doNotHostByPhone = {}, contacts, properties }: Props) {
  const router = useRouter();
  const softRefresh = useSoftRefresh();
  const [promote, setPromote] = useState<UnknownNumberRow | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const phoneLocks = useRef(new Set<string>());
  const [busyPhones, setBusyPhones] = useState<Set<string>>(new Set());
  const [attachSel, setAttachSel] = useState<Record<string, string>>({});
  const [attachMsg, setAttachMsg] = useState<Record<string, string>>({});
  const [hiddenSuggestions, setHiddenSuggestions] = useState<Set<string>>(new Set());
  const suggestionLocks = useRef(new Set<string>());
  const [busySuggestions, setBusySuggestions] = useState<Set<string>>(new Set());
  const [acceptedSuggestions, setAcceptedSuggestions] = useState<Record<string, { name: string; contactId?: string }>>({});
  useUnsavedWorkGuard(busyPhones.size > 0 || busySuggestions.size > 0);
  const [suggestionTypeFor, setSuggestionTypeFor] = useState<Record<string, ContactType>>({});
  const [suggestionErr, setSuggestionErr] = useState<Record<string, string>>({});
  const [showOlder, setShowOlder] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState('');
  const contactSuggestions = useMemo(() => Object.fromEntries([...unknownNumbers, ...olderUnknownNumbers].map(u => [u.phone, guestByPhone[u.phone] || knownByPhone[u.phone]?.contactId ? null : suggestedContact(u.last_body ?? '', knownByPhone[u.phone]?.name, contacts)])), [unknownNumbers, olderUnknownNumbers, guestByPhone, knownByPhone, contacts]);

  // Contacts for the attach picker: phone-less ones first (the likely
  // targets, e.g. an owner missing their number), each sorted by name.
  const attachOptions = useMemo(() => [...contacts].sort((a, b) => {
    const ap = a.phone ? 1 : 0;
    const bp = b.phone ? 1 : 0;
    if (ap !== bp) return ap - bp;
    return a.name.localeCompare(b.name);
  }), [contacts]);

  const visibleUnknowns = unknownNumbers.filter((u) => !hidden.has(u.phone));
  const visibleOlderUnknowns = olderUnknownNumbers.filter((u) => !hidden.has(u.phone));
  const visibleSuggestions = suggestions.filter((s) => !hiddenSuggestions.has(s.id));
  const visibleOlderSuggestions = olderSuggestions.filter((s) => !hiddenSuggestions.has(s.id));
  const recentCount = visibleUnknowns.length + visibleSuggestions.length;
  const olderCount = visibleOlderUnknowns.length + visibleOlderSuggestions.length;

  async function onNotOurs(phone: string) {
    if (phoneLocks.current.has(phone)) return;
    phoneLocks.current.add(phone);
    setBusyPhones(new Set(phoneLocks.current));
    setAttachMsg((m) => ({ ...m, [phone]: '' }));
    try {
      const res = await dismissUnknownNumber({ phone });
      if (!res.ok) { setAttachMsg((m) => ({ ...m, [phone]: res.error })); return; }
      setHidden((h) => new Set(h).add(phone));
      softRefresh();
    } catch {
      setAttachMsg((m) => ({ ...m, [phone]: 'Could not confirm Not ours. The number is still shown so you can check and retry.' }));
    } finally {
      phoneLocks.current.delete(phone);
      setBusyPhones(new Set(phoneLocks.current));
    }
  }

  /** The contact a row will attach to: the operator's pick, else the household Helm named. */
  const attachTarget = (phone: string): string => attachSel[phone] ?? knownByPhone[phone]?.contactId ?? contactSuggestions[phone]?.contact.id ?? '';

  async function onAttach(phone: string) {
    const contactId = attachTarget(phone);
    if (!contactId || phoneLocks.current.has(phone)) return;
    phoneLocks.current.add(phone);
    setBusyPhones(new Set(phoneLocks.current));
    setAttachMsg((m) => ({ ...m, [phone]: '' }));
    try {
      const res = await attachUnknownToContact({ phone, contactId });
      if (!res.ok) { setAttachMsg((m) => ({ ...m, [phone]: res.error })); return; }
      if (res.filled) {
        setHidden((h) => new Set(h).add(phone));
        softRefresh();
      } else {
        setAttachMsg((m) => ({
          ...m,
          [phone]: `Linked to ${res.contactName}, but they already have a primary phone, so edit the contact to make this their main number.`,
        }));
      }
    } catch {
      setAttachMsg((m) => ({ ...m, [phone]: 'Could not confirm the link. Your selected contact is retained. Check their phone before retrying.' }));
    } finally {
      phoneLocks.current.delete(phone);
      setBusyPhones(new Set(phoneLocks.current));
    }
  }

  async function onAcceptSuggestion(s: ContactReconcileSuggestionRow) {
    if (suggestionLocks.current.has(s.id)) return;
    suggestionLocks.current.add(s.id);
    setBusySuggestions(new Set(suggestionLocks.current));
    setSuggestionErr((m) => ({ ...m, [s.id]: '' }));
    const contactType = suggestionTypeFor[s.id] ?? 'vendor';
    try {
      const res = await acceptContactSuggestion({ id: s.id, contactType });
      if (!res.ok) { setSuggestionErr((m) => ({ ...m, [s.id]: res.error })); return; }
      setHiddenSuggestions((h) => new Set(h).add(s.id));
      setAcceptedSuggestions((m) => ({ ...m, [s.id]: { name: s.suggested_name ?? formatPhone(s.phone ?? ''), contactId: res.contactId } }));
      softRefresh();
    } catch {
      setSuggestionErr((m) => ({ ...m, [s.id]: 'Could not confirm this change. Check your contacts before retrying to avoid a duplicate.' }));
    } finally {
      suggestionLocks.current.delete(s.id);
      setBusySuggestions(new Set(suggestionLocks.current));
    }
  }

  async function onNotOursSuggestion(id: string) {
    if (suggestionLocks.current.has(id)) return;
    suggestionLocks.current.add(id);
    setBusySuggestions(new Set(suggestionLocks.current));
    setSuggestionErr((m) => ({ ...m, [id]: '' }));
    try {
      const res = await dismissContactSuggestion({ id });
      if (!res.ok) { setSuggestionErr((m) => ({ ...m, [id]: res.error })); return; }
      setHiddenSuggestions((h) => new Set(h).add(id));
      softRefresh();
    } catch {
      setSuggestionErr((m) => ({ ...m, [id]: 'Could not confirm Not ours. The suggestion is still shown so you can check and retry.' }));
    } finally {
      suggestionLocks.current.delete(id);
      setBusySuggestions(new Set(suggestionLocks.current));
    }
  }

  const renderSuggestion = (s: ContactReconcileSuggestionRow) => {
    const busy = busySuggestions.has(s.id);
    const isNew = s.suggestion_type === 'add_contact';
    return (
      <div key={s.id} data-triage="suggestion" style={rowStyle}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{s.suggested_name ?? formatPhone(s.phone ?? '')}</span>
          {s.phone && s.suggested_name && <span className="font-mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{formatPhone(s.phone)}</span>}
          <span className="eyebrow" style={{ fontSize: 10, padding: '2px 7px', border: '1px solid var(--rule)', color: 'var(--ink-3)' }}>Quo address book</span>
          <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-3)', minWidth: 160 }}>{s.reason}</span>
          {isNew && (
            <select
              disabled={busy}
              aria-label={`Contact type for ${s.suggested_name ?? s.phone}`}
              value={suggestionTypeFor[s.id] ?? 'vendor'}
              onChange={(e) => setSuggestionTypeFor((m) => ({ ...m, [s.id]: e.target.value as ContactType }))}
              style={selectStyle}
            >
              <option value="vendor">Vendor</option>
              <option value="owner">Owner</option>
              <option value="lead">Lead</option>
              <option value="other">Other</option>
            </select>
          )}
          <button type="button" disabled={busy} onClick={() => onAcceptSuggestion(s)} style={smallBtn(true)}>
            {busy ? '…' : isNew ? 'New contact' : 'Attach'}
          </button>
          <button type="button" disabled={busy} onClick={() => onNotOursSuggestion(s.id)} style={smallBtn(false)}>
            Not ours
          </button>
        </div>
        {suggestionErr[s.id] && <div role="alert" style={{ fontSize: 11, color: 'var(--negative)', paddingLeft: 2 }}>{suggestionErr[s.id]}</div>}
      </div>
    );
  };

  const renderUnknown = (u: UnknownNumberRow) => {
    const busy = busyPhones.has(u.phone);
    const known = knownByPhone[u.phone];
    const target = attachTarget(u.phone);
    const suggestion = contactSuggestions[u.phone];
    const flagged = doNotHostByPhone[u.phone];
    return (
      <div key={u.phone} data-triage="phone" style={rowStyle}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          {known && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{known.name}</span>}
          <span className="font-mono" style={known ? { fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap' } : { fontSize: 13, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{formatPhone(u.phone)}</span>
          {known && (
            <span className="eyebrow" style={{ fontSize: 10, padding: '2px 7px', border: '1px solid var(--rule)', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{known.label}</span>
          )}
          {/* Which of our three numbers they reached: GUESTS is a guest,
              24/7 is crew or a vendor, OWNERS an owner or a prospect. */}
          {u.quo_line && (
            <span className="eyebrow" style={{ fontSize: 10, padding: '2px 7px', border: '1px solid var(--rule)', color: u.quo_line === 'guests' ? 'var(--signal)' : 'var(--ink-3)', whiteSpace: 'nowrap' }}>
              {QUO_LINES[u.quo_line].label}
            </span>
          )}
          {/* A guest on a real stay is not a contact (there is no guest
              type): say so before anyone files them. */}
          {guestByPhone[u.phone] && (
            <span style={{ fontSize: 12, color: 'var(--signal)', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
              <span className="eyebrow" style={{ fontSize: 10, padding: '2px 7px', border: '1px solid var(--signal)' }}>Guest</span>
              <span style={{ fontWeight: 600 }}>{guestByPhone[u.phone]}</span>
            </span>
          )}
          <span style={{ flex: 1, minWidth: 200, fontSize: 12, color: 'var(--ink-3)' }}>
            {u.last_body ? `“${truncate(u.last_body, 90)}”` : 'Reached out'}
            {u.last_message_at && <span style={{ color: 'var(--ink-4)' }}>{' · '}{formatRelative(u.last_message_at)}</span>}
          </span>
          <select
            disabled={busy}
            aria-label={`Attach ${formatPhone(u.phone)} to contact`}
            value={target}
            onChange={(e) => setAttachSel((s) => ({ ...s, [u.phone]: e.target.value }))}
            style={{ ...selectStyle, maxWidth: 200 }}
          >
            <option value="">Attach to…</option>
            {attachOptions.filter(c => c.id === target || !search || `${c.name} ${c.phone ?? ''}`.toLowerCase().includes(search.toLowerCase())).map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.phone ? '' : ' · no #'}</option>
            ))}
          </select>
          <button type="button" disabled={busy || !target} onClick={() => onAttach(u.phone)} style={smallBtn(!!target)}>
            {busy ? '…' : suggestion?.contact.id === target || known?.contactId === target ? 'Confirm match' : 'Attach'}
          </button>
          <button type="button" disabled={busy} onClick={() => { if (!phoneLocks.current.has(u.phone)) setPromote(u); }} style={smallBtn(false)}>
            New contact
          </button>
          <button type="button" disabled={busy} onClick={() => onNotOurs(u.phone)} style={smallBtn(false)}>
            {busy ? '…' : 'Not ours'}
          </button>
        </div>
        {/* A guest Helm will not host again, texting again: say so before
            anyone answers or files them (src/lib/do-not-host.ts). */}
        {flagged && <DoNotHostLine size="sm" reason={flagged.reason} set_by={flagged.set_by} set_at={flagged.set_at} />}
        {(suggestion || known?.contactId) && <p style={{ fontSize: 12, color: 'var(--tide-deep)', margin: '6px 0' }}>Suggested match: {suggestion?.contact.name ?? known?.name}. {suggestion?.evidence ?? `Number found in ${known?.label.toLowerCase()} records`}. Confirm or choose another contact.</p>}
        {attachMsg[u.phone] && <div role="status" style={{ fontSize: 11, color: 'var(--ink-3)', paddingLeft: 2 }}>{attachMsg[u.phone]}</div>}
      </div>
    );
  };

  if (recentCount + olderCount === 0 && Object.keys(acceptedSuggestions).length === 0) return null;

  return (
    <section id="new-numbers" className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 8, paddingBottom: 24, width: '100%' }}>
      <div style={{ border: '1px solid var(--signal)', padding: '16px 18px' }}>
        <div className="eyebrow" style={{ color: 'var(--signal)', marginBottom: 12 }}>New numbers · {recentCount}</div>
        <input type="search" aria-label="Search contacts for matching" placeholder="Find a contact by name or phone" value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%', maxWidth: 360, fontSize: 14, padding: 10, marginBottom: 12, border: '1px solid var(--rule)', background: 'var(--paper)' }} />
        {Object.entries(acceptedSuggestions).map(([id, result]) => (
          <div key={id} role="status" style={{ paddingBottom: 10, fontSize: 12 }}>
            Updated {result.name}.{' '}
            {result.contactId && <Link href={`/crm/${result.contactId}`} target="_blank" rel="noopener noreferrer">View contact →</Link>}
          </div>
        ))}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {recentCount === 0 && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Nothing new in the last 30 days.</div>}
          {(showAll ? visibleUnknowns : visibleUnknowns.slice(0, RECENT_SHOWN)).map(renderUnknown)}
          {(showAll ? visibleSuggestions : visibleSuggestions.slice(0, Math.max(0, RECENT_SHOWN - visibleUnknowns.length))).map(renderSuggestion)}
        </div>
        {!showAll && recentCount > RECENT_SHOWN && (
          <button type="button" onClick={() => setShowAll(true)} style={{ marginTop: 12, background: 'none', border: 'none', padding: '4px 0', fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer', fontFamily: 'inherit' }}>
            Show all {recentCount}
          </button>
        )}
        {olderCount > 0 && (showAll || recentCount <= RECENT_SHOWN) && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--rule)', paddingTop: 10 }}>
            <button type="button" aria-expanded={showOlder} onClick={() => setShowOlder((v) => !v)} style={{ background: 'none', border: 'none', padding: '4px 0', fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer', fontFamily: 'inherit' }}>
              {showOlder ? '▾' : '▸'} Older · {olderCount}
            </button>
            {showOlder && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {visibleOlderUnknowns.slice(0, OLDER_SHOWN).map(renderUnknown)}
                {visibleOlderSuggestions.slice(0, OLDER_SHOWN).map(renderSuggestion)}
                {olderCount > OLDER_SHOWN * 2 && <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>Showing the most recent {OLDER_SHOWN} of each.</div>}
              </div>
            )}
          </div>
        )}
      </div>

      {promote && (
        <NewContactModal
          properties={properties}
          initialPhone={promote.phone}
          initialName={knownByPhone[promote.phone]?.name}
          initialType={defaultTypeForLine(promote.quo_line, knownByPhone[promote.phone])}
          title="New contact"
          submitLabel="Add contact"
          onSubmit={(a) =>
            addUnknownAsContact({
              phone: promote.phone,
              name: a.name,
              type: a.type,
              emails: a.emails,
              organization: a.organization,
              notes: a.notes,
              tags: a.tags,
              linked_property_ids: a.linked_property_ids,
            })
          }
          onClose={() => setPromote(null)}
          onCreated={(id) => {
            setHidden((h) => new Set(h).add(promote.phone));
            setPromote(null);
            router.push(`/crm/${id}`);
          }}
        />
      )}
    </section>
  );
}

const rowStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };

const selectStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '6px 8px',
  border: '1px solid var(--rule)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  fontFamily: 'inherit',
};

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n).trim()}…` : s;
}

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso);
    const mins = Math.floor((Date.now() - then.getTime()) / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function formatPhone(p: string): string {
  const d = p.replace(/\D/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return p;
}

function smallBtn(primary: boolean): React.CSSProperties {
  return {
    background: primary ? 'var(--ink)' : 'transparent',
    color: primary ? 'var(--paper)' : 'var(--ink-3)',
    border: `1px solid ${primary ? 'var(--ink)' : 'var(--rule)'}`,
    padding: '5px 10px',
    fontSize: 10,
    letterSpacing: '.14em',
    textTransform: 'uppercase',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}
