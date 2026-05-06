'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createWorkSlip } from '@/app/work/actions';
import { TeamPicker } from '@/components/TeamPicker';
import {
  type WorkSlipCategory,
  type WorkSlipPriority,
  WORK_SLIP_CATEGORY_LABELS,
} from '@/lib/work-types';

type Props = {
  propertyId: string;
  propertyName: string;
  myEmail: string;
};

/**
 * "+ New slip" button + inline modal scoped to a single property. Property
 * is locked (we're already on its page). On success, refreshes the page so
 * the new slip appears in the Open Work section without a full reload.
 *
 * Mirrors the WorkSlipModal in QueueClient.tsx but trims the property
 * picker since context implies it.
 */
export function PropertyAddSlipButton({ propertyId, propertyName, myEmail }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState<WorkSlipCategory>('maintenance');
  const [priority, setPriority] = useState<WorkSlipPriority>('normal');
  const [scheduledDate, setScheduledDate] = useState('');
  const [assignedToEmail, setAssignedToEmail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setTitle('');
    setDescription('');
    setLocation('');
    setCategory('maintenance');
    setPriority('normal');
    setScheduledDate('');
    setAssignedToEmail(null);
    setErr(null);
    setSubmitting(false);
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    const res = await createWorkSlip({
      property_id: propertyId,
      title,
      description: description || undefined,
      location: location || undefined,
      category,
      priority,
      scheduled_date: scheduledDate || null,
      assigned_to_email: assignedToEmail,
    });
    setSubmitting(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    close();
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          background: 'var(--ink)',
          color: 'var(--paper)',
          border: '1px solid var(--ink)',
          padding: '6px 12px',
          fontSize: 11,
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        + New slip
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={close}
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
            <div className="flex items-baseline justify-between" style={{ marginBottom: 6 }}>
              <h2 className="font-serif" style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
                New Work Slip
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--ink-3)', padding: '0 4px' }}
              >
                ✕
              </button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--ink-3)', letterSpacing: '.06em', marginTop: 0, marginBottom: 20 }}>
              Property: <strong style={{ color: 'var(--ink)' }}>{propertyName}</strong>
            </p>

            <form onSubmit={submit} className="flex flex-col gap-4">
              <Field label="Title *">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Brief description of what needs to happen"
                  required
                  maxLength={200}
                  style={inputStyle()}
                />
              </Field>

              <div className="flex gap-3">
                <div style={{ flex: 1 }}>
                  <Field label="Category">
                    <select value={category} onChange={(e) => setCategory(e.target.value as WorkSlipCategory)} style={selectStyle()}>
                      {(Object.entries(WORK_SLIP_CATEGORY_LABELS) as [WorkSlipCategory, string][]).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div style={{ flex: 1 }}>
                  <Field label="Priority">
                    <select value={priority} onChange={(e) => setPriority(e.target.value as WorkSlipPriority)} style={selectStyle()}>
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                    </select>
                  </Field>
                </div>
              </div>

              <Field label="Location (optional)">
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Kitchen, Master Bath"
                  maxLength={200}
                  style={inputStyle()}
                />
              </Field>

              <Field label="Scheduled date (optional)">
                <input
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  style={inputStyle()}
                />
              </Field>

              <Field label="Assignee">
                <TeamPicker value={assignedToEmail} onChange={setAssignedToEmail} myEmail={myEmail} placeholder="Unassigned" />
              </Field>

              <Field label="Description (optional)">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  placeholder="Any extra detail…"
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
                  onClick={close}
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
                  {submitting ? 'Creating…' : 'Create Work Slip'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
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
