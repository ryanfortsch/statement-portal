'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ContactRow, ContactType, UnknownNumberRow } from '@/lib/crm';
import { CONTACT_TYPE_LABELS } from '@/lib/crm';
import type { ContactReconcileSuggestionRow } from '@/lib/quo-reconcile';
import type { LastTouch } from './page';
import {
  createContact,
  addUnknownAsContact,
  dismissUnknownNumber,
  attachUnknownToContact,
  acceptContactSuggestion,
  dismissContactSuggestion,
} from './actions';
import { SyncGmailButton } from './SyncGmailButton';
import { SyncQuoButton } from './SyncQuoButton';
import { SyncQuoContactsButton } from './SyncQuoContactsButton';

type PropertyMini = { id: string; name: string };

type Props = {
  contacts: ContactRow[];
  properties: PropertyMini[];
  counts: Record<ContactType | 'all', number>;
  lastTouchByContact: Record<string, LastTouch>;
  unknownNumbers: UnknownNumberRow[];
  suggestions: ContactReconcileSuggestionRow[];
};

type FilterId = 'all' | ContactType;

export function CrmListClient({ contacts, properties, counts, lastTouchByContact, unknownNumbers, suggestions }: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterId>('all');
  const [query, setQuery] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [promotePhone, setPromotePhone] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busyPhone, setBusyPhone] = useState<string | null>(null);
  // Per-unknown-row "attach to existing contact" selection + inline result.
  const [attachSel, setAttachSel] = useState<Record<string, string>>({});
  const [attachMsg, setAttachMsg] = useState<Record<string, string>>({});
  // Suggestions: dismissed row IDs (optimistic hide), busy id, add-contact type picker.
  const [hiddenSuggestions, setHiddenSuggestions] = useState<Set<string>>(new Set());
  const [busySuggestion, setBusySuggestion] = useState<string | null>(null);
  const [suggestionTypeFor, setSuggestionTypeFor] = useState<Record<string, ContactType>>({});
  const [suggestionErr, setSuggestionErr] = useState<Record<string, string>>({});

  const propertyMap = useMemo(() => new Map(properties.map((p) => [p.id, p.name])), [properties]);

  // Contacts for the attach picker: phone-less ones first (the likely targets,
  // e.g. an owner missing their number), each sorted by name.
  const attachOptions = useMemo(() => {
    return [...contacts].sort((a, b) => {
      const ap = a.phone ? 1 : 0;
      const bp = b.phone ? 1 : 0;
      if (ap !== bp) return ap - bp;
      return a.name.localeCompare(b.name);
    });
  }, [contacts]);

  const visibleUnknowns = useMemo(
    () => unknownNumbers.filter((u) => !hidden.has(u.phone)),
    [unknownNumbers, hidden],
  );

  async function onDismiss(phone: string) {
    setBusyPhone(phone);
    const res = await dismissUnknownNumber({ phone });
    setBusyPhone(null);
    if (res.ok) {
      setHidden((h) => new Set(h).add(phone));
      router.refresh();
    }
  }

  async function onAttach(phone: string) {
    const contactId = attachSel[phone];
    if (!contactId) return;
    setBusyPhone(phone);
    const res = await attachUnknownToContact({ phone, contactId });
    setBusyPhone(null);
    if (res.ok) {
      if (res.filled) {
        setHidden((h) => new Set(h).add(phone));
        router.refresh();
      } else {
        // Linked, but the contact already had a different primary number, so
        // this one won't auto-recognize. Keep the row visible with a note.
        setAttachMsg((m) => ({
          ...m,
          [phone]: `Linked to ${res.contactName}, but they already have a primary phone, so edit the contact to make this their main number.`,
        }));
      }
    } else {
      setAttachMsg((m) => ({ ...m, [phone]: res.error }));
    }
  }

  const visibleSuggestions = useMemo(
    () => suggestions.filter((s) => !hiddenSuggestions.has(s.id)),
    [suggestions, hiddenSuggestions],
  );

  async function onAcceptSuggestion(s: ContactReconcileSuggestionRow) {
    setBusySuggestion(s.id);
    setSuggestionErr((m) => { const n = { ...m }; delete n[s.id]; return n; });
    const contactType = suggestionTypeFor[s.id] ?? 'other';
    const res = await acceptContactSuggestion({ id: s.id, contactType });
    setBusySuggestion(null);
    if (!res.ok) {
      setSuggestionErr((m) => ({ ...m, [s.id]: res.error }));
      return;
    }
    setHiddenSuggestions((h) => new Set(h).add(s.id));
    router.refresh();
    if (res.contactId) router.push(`/crm/${res.contactId}`);
  }

  async function onDismissSuggestion(id: string) {
    setBusySuggestion(id);
    const res = await dismissContactSuggestion({ id });
    setBusySuggestion(null);
    if (res.ok) {
      setHiddenSuggestions((h) => new Set(h).add(id));
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((c) => {
      if (filter !== 'all' && c.type !== filter) return false;
      if (q) {
        const haystack = [
          c.name,
          c.organization ?? '',
          ...(c.emails ?? []),
          c.phone ?? '',
          ...(c.tags ?? []),
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [contacts, filter, query]);

  return (
    <>
      {/* QUO ADDRESS BOOK SUGGESTIONS */}
      {visibleSuggestions.length > 0 && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 8, paddingBottom: 16, width: '100%' }}>
          <div style={{ border: '1px solid var(--tide)', padding: '16px 18px' }}>
            <div className="eyebrow" style={{ color: 'var(--tide)', marginBottom: 12 }}>
              From your Quo address book · {visibleSuggestions.length}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {visibleSuggestions.map((s) => (
                <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                      {s.suggested_name ?? formatPhone(s.phone ?? '')}
                    </span>
                    {s.phone && s.suggested_name && (
                      <span className="font-mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                        {formatPhone(s.phone)}
                      </span>
                    )}
                    <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-3)', minWidth: 160 }}>
                      {s.reason}
                    </span>
                    {s.suggestion_type === 'add_contact' && (
                      <select
                        value={suggestionTypeFor[s.id] ?? 'other'}
                        onChange={(e) => setSuggestionTypeFor((m) => ({ ...m, [s.id]: e.target.value as ContactType }))}
                        style={{
                          fontSize: 11,
                          padding: '5px 7px',
                          border: '1px solid var(--rule)',
                          background: 'var(--paper)',
                          color: 'var(--ink)',
                          fontFamily: 'inherit',
                        }}
                      >
                        <option value="owner">Owner</option>
                        <option value="vendor">Vendor</option>
                        <option value="lead">Lead</option>
                        <option value="other">Other</option>
                      </select>
                    )}
                    <button
                      type="button"
                      disabled={busySuggestion === s.id}
                      onClick={() => onAcceptSuggestion(s)}
                      style={smallBtn(true)}
                    >
                      {busySuggestion === s.id ? '…' : suggestionLabel(s.suggestion_type)}
                    </button>
                    <button
                      type="button"
                      disabled={busySuggestion === s.id}
                      onClick={() => onDismissSuggestion(s.id)}
                      style={smallBtn(false)}
                    >
                      Skip
                    </button>
                  </div>
                  {suggestionErr[s.id] && (
                    <div style={{ fontSize: 11, color: 'var(--negative)', paddingLeft: 2 }}>{suggestionErr[s.id]}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* NEW NUMBERS REACHING OUT — Quo triage queue */}
      {visibleUnknowns.length > 0 && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 8, paddingBottom: 16, width: '100%' }}>
          <div style={{ border: '1px solid var(--signal)', padding: '16px 18px' }}>
            <div className="eyebrow" style={{ color: 'var(--signal)', marginBottom: 12 }}>
              New numbers reaching out · {visibleUnknowns.length}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {visibleUnknowns.map((u) => (
                <div key={u.phone} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
                    <span className="font-mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
                      {formatPhone(u.phone)}
                    </span>
                    <span style={{ flex: 1, minWidth: 200, fontSize: 12, color: 'var(--ink-3)' }}>
                      {u.last_body ? `“${truncate(u.last_body, 90)}”` : 'Reached out'}
                      {u.last_message_at && (
                        <span style={{ color: 'var(--ink-4)' }}>{' · '}{formatRelative(u.last_message_at)}</span>
                      )}
                    </span>
                    {/* Attach to an existing contact (fills their phone) before
                        the "create new" path, so an owner already in Helm isn't
                        duplicated. */}
                    <select
                      value={attachSel[u.phone] ?? ''}
                      onChange={(e) => setAttachSel((s) => ({ ...s, [u.phone]: e.target.value }))}
                      style={{
                        fontSize: 12,
                        padding: '6px 8px',
                        maxWidth: 200,
                        border: '1px solid var(--rule)',
                        background: 'var(--paper)',
                        color: 'var(--ink)',
                        fontFamily: 'inherit',
                      }}
                    >
                      <option value="">Attach to existing…</option>
                      {attachOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.phone ? '' : ' · no #'}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busyPhone === u.phone || !attachSel[u.phone]}
                      onClick={() => onAttach(u.phone)}
                      style={smallBtn(!!attachSel[u.phone])}
                    >
                      {busyPhone === u.phone ? '…' : 'Attach'}
                    </button>
                    <button type="button" onClick={() => setPromotePhone(u.phone)} style={smallBtn(false)}>
                      Add as new
                    </button>
                    <button
                      type="button"
                      disabled={busyPhone === u.phone}
                      onClick={() => onDismiss(u.phone)}
                      style={smallBtn(false)}
                    >
                      {busyPhone === u.phone ? '…' : 'Dismiss'}
                    </button>
                  </div>
                  {attachMsg[u.phone] && (
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', paddingLeft: 2 }}>{attachMsg[u.phone]}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* TAB ROW + SEARCH + NEW */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 16, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Pill active={filter === 'all'} label="All" count={counts.all} onClick={() => setFilter('all')} />
          <Pill active={filter === 'owner'} label="Owners" count={counts.owner} onClick={() => setFilter('owner')} />
          <Pill active={filter === 'vendor'} label="Vendors" count={counts.vendor} onClick={() => setFilter('vendor')} />
          <Pill active={filter === 'lead'} label="Leads" count={counts.lead} onClick={() => setFilter('lead')} accent="var(--signal)" />
          <Pill active={filter === 'other'} label="Other" count={counts.other} onClick={() => setFilter('other')} />
          <span style={{ flex: 1 }} />
          <input
            type="search"
            placeholder="Search name, email, tag…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              minWidth: 240,
              padding: '8px 12px',
              border: '1px solid var(--rule)',
              background: 'var(--paper)',
              fontSize: 13,
              color: 'var(--ink)',
              fontFamily: 'inherit',
            }}
          />
          <SyncGmailButton />
          <SyncQuoButton />
          <SyncQuoContactsButton />
          <button
            type="button"
            onClick={() => setShowNew(true)}
            style={{
              background: 'var(--ink)',
              color: 'var(--paper)',
              border: '1px solid var(--ink)',
              padding: '8px 14px',
              fontSize: 11,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + New Contact
          </button>
        </div>
      </section>

      {/* LIST */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        {filtered.length === 0 ? (
          <div
            style={{
              borderTop: '1px solid var(--ink)',
              padding: '40px 0',
              textAlign: 'center',
              color: 'var(--ink-3)',
            }}
          >
            {contacts.length === 0
              ? 'No contacts yet. Click "+ New Contact" to add one.'
              : 'No contacts match this filter.'}
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {filtered.map((c) => (
              <Link
                key={c.id}
                href={`/crm/${c.id}`}
                style={{
                  display: 'block',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto auto',
                    gap: 24,
                    alignItems: 'baseline',
                    padding: '20px 0',
                    borderBottom: '1px solid var(--rule)',
                  }}
                >
                  <div>
                    <h2 className="font-serif" style={{ fontSize: 20, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
                      {c.name}
                    </h2>
                    <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>
                      {c.organization && <>{c.organization} · </>}
                      {c.emails && c.emails.length > 0 ? c.emails[0] : ''}
                      {c.linked_property_ids && c.linked_property_ids.length > 0 && (
                        <>
                          {' · '}
                          {c.linked_property_ids
                            .map((pid) => propertyMap.get(pid) ?? pid)
                            .join(', ')}
                        </>
                      )}
                    </div>
                    {lastTouchByContact[c.id] && (
                      <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
                        <span style={{ color: 'var(--tide-deep)', fontWeight: 600 }}>{lastTouchByContact[c.id].channel}</span>
                        {' · '}
                        &ldquo;{truncate(lastTouchByContact[c.id].summary, 80)}&rdquo;
                        {' · '}
                        {formatRelative(lastTouchByContact[c.id].at)}
                      </div>
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: 9, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
                      color: typeColor(c.type),
                      border: `1px solid ${typeColor(c.type)}`,
                      padding: '2px 8px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {CONTACT_TYPE_LABELS[c.type]}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.18em', textTransform: 'uppercase' }}>
                    Open →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {showNew && (
        <NewContactModal
          properties={properties}
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false);
            router.push(`/crm/${id}`);
          }}
        />
      )}

      {promotePhone && (
        <NewContactModal
          properties={properties}
          initialPhone={promotePhone}
          initialType="lead"
          title="Add as contact"
          submitLabel="Add Contact"
          onSubmit={(a) =>
            addUnknownAsContact({
              phone: promotePhone,
              name: a.name,
              type: a.type,
              emails: a.emails,
              organization: a.organization,
              notes: a.notes,
              tags: a.tags,
              linked_property_ids: a.linked_property_ids,
            })
          }
          onClose={() => setPromotePhone(null)}
          onCreated={(id) => {
            setHidden((h) => new Set(h).add(promotePhone));
            setPromotePhone(null);
            router.push(`/crm/${id}`);
          }}
        />
      )}
    </>
  );
}

function Pill({
  active,
  label,
  count,
  onClick,
  accent,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
  accent?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? 'var(--ink)' : 'transparent',
        color: active ? 'var(--paper)' : (accent ?? 'var(--ink)'),
        border: `1px solid ${active ? 'var(--ink)' : (accent ?? 'var(--rule)')}`,
        padding: '6px 14px',
        fontSize: 11,
        letterSpacing: '.14em',
        textTransform: 'uppercase',
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      {label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{count}</span>
    </button>
  );
}

function typeColor(type: ContactType): string {
  switch (type) {
    case 'owner': return 'var(--tide-deep)';
    case 'vendor': return 'var(--ink-3)';
    case 'lead': return 'var(--signal)';
    case 'other': return 'var(--ink-4)';
  }
}

function NewContactModal({
  properties,
  onClose,
  onCreated,
  initialPhone,
  initialType,
  title,
  submitLabel,
  onSubmit,
}: {
  properties: PropertyMini[];
  onClose: () => void;
  onCreated: (id: string) => void;
  initialPhone?: string;
  initialType?: ContactType;
  title?: string;
  submitLabel?: string;
  onSubmit?: (args: {
    type: ContactType;
    name: string;
    emails?: string;
    phone?: string | null;
    organization?: string | null;
    notes?: string | null;
    tags?: string;
    linked_property_ids?: string[];
  }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
}) {
  const [type, setType] = useState<ContactType>(initialType ?? 'owner');
  const [name, setName] = useState('');
  const [emails, setEmails] = useState('');
  const [phone, setPhone] = useState(initialPhone ?? '');
  const [organization, setOrganization] = useState('');
  const [tags, setTags] = useState('');
  const [linkedPropertyIds, setLinkedPropertyIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    const submitFn = onSubmit ?? createContact;
    const res = await submitFn({
      type,
      name,
      emails,
      phone,
      organization,
      notes,
      tags,
      linked_property_ids: linkedPropertyIds,
    });
    setSubmitting(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    onCreated(res.id);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(30, 46, 52, 0.5)',
        zIndex: 60,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '40px 16px',
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--paper)',
          maxWidth: 520,
          width: '100%',
          padding: 28,
          border: '1px solid var(--ink)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <div className="flex items-baseline justify-between" style={{ marginBottom: 20 }}>
          <h2 className="font-serif" style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
            {title ?? 'New Contact'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--ink-3)', padding: '0 4px' }}
          >
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex gap-3">
            <div style={{ flex: 1 }}>
              <Field label="Type *">
                <select value={type} onChange={(e) => setType(e.target.value as ContactType)} style={selectStyle()}>
                  <option value="owner">Owner</option>
                  <option value="vendor">Vendor</option>
                  <option value="lead">Lead</option>
                  <option value="other">Other</option>
                </select>
              </Field>
            </div>
            <div style={{ flex: 2 }}>
              <Field label="Name *">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Marci Bailey"
                  required
                  maxLength={200}
                  style={inputStyle()}
                />
              </Field>
            </div>
          </div>

          <Field label="Emails (one per line, or comma-separated)">
            <textarea
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              rows={2}
              placeholder="bailey@example.com&#10;backup@example.com"
              style={{ ...inputStyle(), fontFamily: 'inherit', resize: 'vertical' }}
            />
          </Field>

          <div className="flex gap-3">
            <div style={{ flex: 1 }}>
              <Field label="Phone">
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(978) 555-1234"
                  style={inputStyle()}
                />
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Organization">
                <input
                  type="text"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="e.g. Cape Ann Elite"
                  style={inputStyle()}
                />
              </Field>
            </div>
          </div>

          {properties.length > 0 && (
            <Field label="Linked properties">
              <select
                multiple
                value={linkedPropertyIds}
                onChange={(e) => setLinkedPropertyIds(Array.from(e.target.selectedOptions).map((o) => o.value))}
                style={{ ...selectStyle(), minHeight: 100 }}
              >
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <p style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)' }}>Hold ⌘ to select multiple.</p>
            </Field>
          )}

          <Field label="Tags (comma-separated)">
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g. cleaner, on-call"
              style={inputStyle()}
            />
          </Field>

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything worth remembering."
              style={{ ...inputStyle(), fontFamily: 'inherit', resize: 'vertical' }}
            />
          </Field>

          {err && (
            <div style={{ padding: '10px 12px', borderLeft: '3px solid var(--negative)', background: 'var(--paper-2)', color: 'var(--negative)', fontSize: 12 }}>
              {err}
            </div>
          )}

          <div className="flex justify-end gap-3" style={{ marginTop: 6 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: '1px solid var(--rule)',
                color: 'var(--ink-3)',
                padding: '10px 16px',
                fontSize: 11,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                background: submitting ? 'var(--ink-4)' : 'var(--ink)',
                color: 'var(--paper)',
                border: 'none',
                padding: '10px 18px',
                fontSize: 11,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                fontWeight: 600,
                cursor: submitting ? 'wait' : 'pointer',
              }}
            >
              {submitting ? 'Saving…' : (submitLabel ?? 'Create Contact')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      {children}
    </label>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid var(--rule)',
    background: 'var(--paper)',
    fontSize: 13,
    color: 'var(--ink)',
    fontFamily: 'inherit',
  };
}

function selectStyle(): React.CSSProperties {
  return {
    ...inputStyle(),
    appearance: 'none',
  };
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n).trim()}…` : s;
}

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso);
    const diffMs = Date.now() - then.getTime();
    const mins = Math.floor(diffMs / 60_000);
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

function suggestionLabel(type: string): string {
  if (type === 'add_contact') return 'Add to Helm';
  if (type === 'fill_email') return 'Add email';
  if (type === 'fill_org') return 'Add org';
  return 'Accept';
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
