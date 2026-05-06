'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ContactRow, ContactTouchRow, ContactType, TouchChannel } from '@/lib/crm';
import { CONTACT_TYPE_LABELS, TOUCH_CHANNEL_LABELS } from '@/lib/crm';
import { displayNameForEmail } from '@/lib/team';
import type { ContactSlip } from './page';
import {
  updateContact,
  deleteContact,
  addContactTouch,
  deleteContactTouch,
} from '../actions';

type PropertyMini = { id: string; name: string };

type Props = {
  contact: ContactRow;
  touches: ContactTouchRow[];
  properties: PropertyMini[];
  linkedSlips: ContactSlip[];
  myEmail: string;
};

export function ContactDetail({ contact, touches, properties, linkedSlips, myEmail }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Editable form state
  const [type, setType] = useState<ContactType>(contact.type);
  const [name, setName] = useState(contact.name);
  const [emails, setEmails] = useState((contact.emails ?? []).join('\n'));
  const [phone, setPhone] = useState(contact.phone ?? '');
  const [organization, setOrganization] = useState(contact.organization ?? '');
  const [tagsInput, setTagsInput] = useState((contact.tags ?? []).join(', '));
  const [notes, setNotes] = useState(contact.notes ?? '');
  const [linkedPropertyIds, setLinkedPropertyIds] = useState<string[]>(contact.linked_property_ids ?? []);

  // Touch list state (optimistic)
  const [touchList, setTouchList] = useState<ContactTouchRow[]>(touches);

  // Add-touch form
  const [touchChannel, setTouchChannel] = useState<TouchChannel>('email');
  const [touchSummary, setTouchSummary] = useState('');
  const [touchNotes, setTouchNotes] = useState('');
  const [touchSubmitting, setTouchSubmitting] = useState(false);
  const [touchErr, setTouchErr] = useState<string | null>(null);

  const propertyMap = new Map(properties.map((p) => [p.id, p.name]));

  async function saveContact(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSavedAt(null);
    const res = await updateContact({
      id: contact.id,
      type,
      name,
      emails,
      phone,
      organization,
      notes,
      tags: tagsInput,
      linked_property_ids: linkedPropertyIds,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSavedAt(new Date().toISOString());
    setEditing(false);
    router.refresh();
  }

  async function removeContact() {
    if (!confirm(`Delete contact "${contact.name}"? This cannot be undone.`)) return;
    try {
      await deleteContact({ id: contact.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function logTouch(e: React.FormEvent) {
    e.preventDefault();
    setTouchErr(null);
    const summary = touchSummary.trim();
    if (!summary) return;
    setTouchSubmitting(true);

    const tempId = `temp-${Date.now()}`;
    const optimistic: ContactTouchRow = {
      id: tempId,
      contact_id: contact.id,
      touched_at: new Date().toISOString(),
      channel: touchChannel,
      summary,
      notes: touchNotes.trim() || null,
      by_email: myEmail,
      created_at: new Date().toISOString(),
    };
    setTouchList((prev) => [optimistic, ...prev]);
    setTouchSummary('');
    setTouchNotes('');

    const res = await addContactTouch({
      contact_id: contact.id,
      channel: touchChannel,
      summary,
      notes: optimistic.notes,
    });
    setTouchSubmitting(false);
    if (!res.ok) {
      setTouchErr(res.error);
      setTouchList((prev) => prev.filter((t) => t.id !== tempId));
      return;
    }
    setTouchList((prev) => prev.map((t) => (t.id === tempId ? { ...t, id: res.id } : t)));
  }

  function removeTouch(id: string) {
    const prev = touchList;
    setTouchList((curr) => curr.filter((t) => t.id !== id));
    startTransition(async () => {
      const res = await deleteContactTouch({ id, contact_id: contact.id });
      if (!res.ok) {
        setTouchErr(res.error);
        setTouchList(prev);
      }
    });
  }

  return (
    <>
      {/* HERO */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 24, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>{CONTACT_TYPE_LABELS[contact.type]}</div>
        <h1
          className="font-serif"
          style={{
            fontSize: 38,
            lineHeight: 1.05,
            fontWeight: 300,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            maxWidth: 720,
          }}
        >
          {contact.name}
        </h1>
        {contact.organization && (
          <p style={{ marginTop: 6, fontSize: 14, color: 'var(--ink-3)' }}>{contact.organization}</p>
        )}
        {contact.tags && contact.tags.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {contact.tags.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: 10,
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-3)',
                  border: '1px solid var(--rule)',
                  padding: '2px 8px',
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* INFO + ACTIONS */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 36, width: '100%' }}>
        <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 18 }}>
          {!editing ? (
            <>
              <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 64px', fontSize: 13, marginBottom: 18 }}>
                <div>
                  <dt className="eyebrow" style={{ marginBottom: 4 }}>Emails</dt>
                  <dd className="font-mono" style={{ color: 'var(--ink)', fontSize: 12, margin: 0, lineHeight: 1.7 }}>
                    {contact.emails && contact.emails.length > 0
                      ? contact.emails.map((e, i) => (
                          <span key={e}>
                            {i > 0 && <span style={{ color: 'var(--ink-4)' }}>, </span>}
                            <a
                              href={`mailto:${e}`}
                              style={{ color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: 3 }}
                            >
                              {e}
                            </a>
                          </span>
                        ))
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow" style={{ marginBottom: 4 }}>Phone</dt>
                  <dd className="font-mono" style={{ color: 'var(--ink)', fontSize: 12, margin: 0 }}>
                    {contact.phone ? (
                      <a
                        href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`}
                        style={{ color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: 3 }}
                      >
                        {contact.phone}
                      </a>
                    ) : '—'}
                  </dd>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <dt className="eyebrow" style={{ marginBottom: 4 }}>Linked properties</dt>
                  <dd style={{ color: 'var(--ink)', margin: 0, fontSize: 13 }}>
                    {contact.linked_property_ids && contact.linked_property_ids.length > 0 ? (
                      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {contact.linked_property_ids.map((pid) => (
                          <Link
                            key={pid}
                            href={`/properties/${pid}`}
                            style={{
                              fontSize: 12,
                              color: 'var(--tide-deep)',
                              border: '1px solid var(--tide-deep)',
                              padding: '2px 8px',
                              textDecoration: 'none',
                            }}
                          >
                            {propertyMap.get(pid) ?? pid}
                          </Link>
                        ))}
                      </span>
                    ) : '—'}
                  </dd>
                </div>
                {contact.notes && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <dt className="eyebrow" style={{ marginBottom: 4 }}>Notes</dt>
                    <dd style={{ color: 'var(--ink-2)', margin: 0, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                      {contact.notes}
                    </dd>
                  </div>
                )}
              </dl>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
                  Added by {displayNameForEmail(contact.created_by_email)} on {formatDate(contact.created_at)}
                  {savedAt && ` · saved ${formatRelative(savedAt)}`}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={removeContact}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--negative)',
                      color: 'var(--negative)',
                      padding: '8px 14px',
                      fontSize: 11,
                      letterSpacing: '.18em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    style={{
                      background: 'var(--ink)',
                      color: 'var(--paper)',
                      border: '1px solid var(--ink)',
                      padding: '8px 14px',
                      fontSize: 11,
                      letterSpacing: '.18em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                    }}
                  >
                    Edit
                  </button>
                </div>
              </div>
            </>
          ) : (
            <form onSubmit={saveContact} className="flex flex-col gap-4">
              <div className="flex gap-3">
                <div style={{ flex: 1 }}>
                  <Field label="Type">
                    <select value={type} onChange={(e) => setType(e.target.value as ContactType)} style={selectStyle()}>
                      <option value="owner">Owner</option>
                      <option value="vendor">Vendor</option>
                      <option value="lead">Lead</option>
                      <option value="other">Other</option>
                    </select>
                  </Field>
                </div>
                <div style={{ flex: 2 }}>
                  <Field label="Name">
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
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
                  style={{ ...inputStyle(), fontFamily: 'inherit', resize: 'vertical' }}
                />
              </Field>

              <div className="flex gap-3">
                <div style={{ flex: 1 }}>
                  <Field label="Phone">
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle()} />
                  </Field>
                </div>
                <div style={{ flex: 1 }}>
                  <Field label="Organization">
                    <input type="text" value={organization} onChange={(e) => setOrganization(e.target.value)} style={inputStyle()} />
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
                <input type="text" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} style={inputStyle()} />
              </Field>

              <Field label="Notes">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  style={{ ...inputStyle(), fontFamily: 'inherit', resize: 'vertical' }}
                />
              </Field>

              {error && (
                <div style={{ padding: '10px 12px', borderLeft: '3px solid var(--negative)', background: 'var(--paper-2)', color: 'var(--negative)', fontSize: 12 }}>
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-3" style={{ marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
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
                  style={{
                    background: 'var(--ink)',
                    color: 'var(--paper)',
                    border: 'none',
                    padding: '10px 18px',
                    fontSize: 11,
                    letterSpacing: '.18em',
                    textTransform: 'uppercase',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Save
                </button>
              </div>
            </form>
          )}
        </div>
      </section>

      {/* OPEN WORK ACROSS LINKED PROPERTIES */}
      {(contact.linked_property_ids ?? []).length > 0 && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 36, width: '100%' }}>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
            <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
              Open Work
            </h2>
            <span className="eyebrow">
              {linkedSlips.length} active across {(contact.linked_property_ids ?? []).length} propert{(contact.linked_property_ids ?? []).length === 1 ? 'y' : 'ies'}
            </span>
          </div>
          {linkedSlips.length === 0 ? (
            <div
              style={{
                borderTop: '1px solid var(--ink)',
                padding: '24px 0',
                textAlign: 'center',
                color: 'var(--ink-3)',
                fontSize: 13,
              }}
            >
              No open work across this contact&rsquo;s linked properties.
            </div>
          ) : (
            <div style={{ borderTop: '1px solid var(--ink)' }}>
              {linkedSlips.map((s) => (
                <Link
                  key={s.id}
                  href={`/work/${s.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '14px 0',
                    borderBottom: '1px solid var(--rule)',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <span
                    style={{
                      width: 8, height: 8, borderRadius: '50%',
                      flexShrink: 0,
                      background:
                        s.priority === 'high' ? 'var(--negative)' :
                        s.priority === 'normal' ? 'var(--ink-3)' :
                        'var(--ink-4)',
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: 'var(--ink)' }}>{s.title}</div>
                    <div style={{ marginTop: 3, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.06em' }}>
                      {s.property_name}
                      {s.assigned_to_email ? ` · ${displayNameForEmail(s.assigned_to_email)}` : ' · Unclaimed'}
                      {s.location ? ` · ${s.location}` : ''}
                    </div>
                  </div>
                  {s.owner_action_required && (
                    <span
                      style={{
                        fontSize: 9, letterSpacing: '.16em', textTransform: 'uppercase',
                        color: 'var(--signal)',
                        border: '1px solid var(--signal)',
                        padding: '2px 7px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Owner
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: 9, letterSpacing: '.16em', textTransform: 'uppercase',
                      color: 'var(--ink-3)',
                      border: '1px solid var(--ink-3)',
                      padding: '2px 7px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s.status.replace('_', ' ')}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TOUCHES LOG */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%', flex: 1 }}>
        <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
          <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
            Touches
          </h2>
          <span className="eyebrow">{touchList.length} logged</span>
        </div>

        <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 18 }}>
          <form onSubmit={logTouch} className="flex flex-col gap-3" style={{ marginBottom: 24 }}>
            <div className="flex gap-3" style={{ alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <Field label="Channel">
                  <select value={touchChannel} onChange={(e) => setTouchChannel(e.target.value as TouchChannel)} style={selectStyle()}>
                    {(Object.entries(TOUCH_CHANNEL_LABELS) as [TouchChannel, string][]).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div style={{ flex: 3 }}>
                <Field label="Summary *">
                  <input
                    type="text"
                    value={touchSummary}
                    onChange={(e) => setTouchSummary(e.target.value)}
                    placeholder="e.g. Discussed Q3 maintenance budget"
                    required
                    maxLength={300}
                    style={inputStyle()}
                  />
                </Field>
              </div>
              <button
                type="submit"
                disabled={touchSubmitting || !touchSummary.trim()}
                style={{
                  background: touchSubmitting || !touchSummary.trim() ? 'var(--ink-4)' : 'var(--ink)',
                  color: 'var(--paper)',
                  border: 'none',
                  padding: '10px 18px',
                  fontSize: 11,
                  letterSpacing: '.18em',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  cursor: touchSubmitting || !touchSummary.trim() ? 'default' : 'pointer',
                  marginBottom: 0,
                  height: 'fit-content',
                }}
              >
                {touchSubmitting ? 'Logging…' : 'Log Touch'}
              </button>
            </div>
            <textarea
              value={touchNotes}
              onChange={(e) => setTouchNotes(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Notes (optional) — what was decided, what's next, etc."
              style={{ ...inputStyle(), fontFamily: 'inherit', resize: 'vertical' }}
            />
            {touchErr && (
              <div style={{ padding: '8px 12px', borderLeft: '3px solid var(--negative)', background: 'var(--paper-2)', color: 'var(--negative)', fontSize: 12 }}>
                {touchErr}
              </div>
            )}
          </form>

          {touchList.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
              No touches logged yet. Use the form above to record the first one.
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {touchList.map((t) => (
                <li
                  key={t.id}
                  style={{
                    padding: '14px 0',
                    borderBottom: '1px solid var(--rule)',
                    display: 'flex',
                    gap: 14,
                    alignItems: 'flex-start',
                  }}
                >
                  <span style={{
                    fontSize: 9, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
                    color: 'var(--tide-deep)',
                    border: '1px solid var(--tide-deep)',
                    padding: '2px 7px',
                    flexShrink: 0,
                    marginTop: 2,
                    whiteSpace: 'nowrap',
                  }}>
                    {TOUCH_CHANNEL_LABELS[t.channel]}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: 'var(--ink)' }}>{t.summary}</div>
                    {t.notes && (
                      <div style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                        {t.notes}
                      </div>
                    )}
                    <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
                      {displayNameForEmail(t.by_email)} · {formatRelative(t.touched_at)}
                    </div>
                  </div>
                  {t.by_email === myEmail && (
                    <button
                      type="button"
                      onClick={() => removeTouch(t.id)}
                      aria-label="Delete touch"
                      title="Delete (only you can delete your own touches)"
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--ink-4)',
                        fontSize: 14,
                        padding: 0,
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
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
    return formatDate(iso);
  } catch {
    return iso;
  }
}
