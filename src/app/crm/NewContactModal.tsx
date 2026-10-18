'use client';

import { useRef, useState } from 'react';
import type { ContactType } from '@/lib/crm';
import { createContact } from './actions';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { PropertyCheckboxes } from './PropertyCheckboxes';

/**
 * The New contact form: a modal over /crm ("+ New contact") and over the
 * number triage card on /messaging ("New contact" on a number Helm does not
 * know yet, phone prefilled). Draft-guarded; a lost response keeps the draft
 * and says to check the list before retrying, so a retry never duplicates.
 */

type PropertyMini = { id: string; name: string };

export function NewContactModal({
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
  // The contact an operations manager adds most is a vendor or a cleaner.
  const [type, setType] = useState<ContactType>(initialType ?? 'vendor');
  const [name, setName] = useState('');
  const [emails, setEmails] = useState('');
  const [phone, setPhone] = useState(initialPhone ?? '');
  const [organization, setOrganization] = useState('');
  const [tags, setTags] = useState('');
  const [linkedPropertyIds, setLinkedPropertyIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const saving = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const snapshot = JSON.stringify([type, name, emails, phone, organization, tags, linkedPropertyIds, notes]);
  const [original] = useState(snapshot);
  const dirty = snapshot !== original;
  useUnsavedWorkGuard(dirty || submitting || uncertain);

  function requestClose() {
    if (saving.current) return;
    if ((dirty || uncertain) && !window.confirm('Discard this unfinished contact?')) return;
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setUncertain(false);
    setErr(null);
    setSubmitting(true);
    const submitFn = onSubmit ?? createContact;
    try {
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
    } catch {
      setUncertain(true);
      setErr('Could not confirm whether the contact was created. Your draft is kept. Check the contact list in another tab before retrying to avoid a duplicate.');
    } finally {
      saving.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={requestClose}
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
            {title ?? 'New contact'}
          </h2>
          <button
            type="button"
            onClick={requestClose}
            disabled={submitting}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--ink-3)', padding: '0 4px' }}
          >
            ✕
          </button>
        </div>

        <form onSubmit={submit}>
          <fieldset disabled={submitting} className="flex flex-col gap-4" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="flex gap-3">
            <div style={{ flex: 1 }}>
              <Field label="Type *">
                <select value={type} onChange={(e) => setType(e.target.value as ContactType)} style={selectStyle()}>
                  <option value="vendor">Vendor</option>
                  <option value="owner">Owner</option>
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
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Linked properties</div>
              <PropertyCheckboxes properties={properties} value={linkedPropertyIds} onChange={setLinkedPropertyIds} />
            </div>
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
              {err}{uncertain && <> <a href="/crm" target="_blank" rel="noopener noreferrer">View saved contacts</a></>}
            </div>
          )}

          <div className="flex justify-end gap-3" style={{ marginTop: 6 }}>
            <button
              type="button"
              onClick={requestClose}
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
              {submitting ? 'Saving…' : (submitLabel ?? 'Create contact')}
            </button>
          </div>
        </fieldset>
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

