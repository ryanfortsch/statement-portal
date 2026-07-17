'use client';

import { useActionState, useRef, useState, useTransition } from 'react';
import {
  uploadPropertyDocument,
  deletePropertyDocument,
  type UploadDocumentState,
} from '@/app/properties/actions';
import {
  DOCUMENT_CATEGORIES,
  formatBytes,
  type PropertyDocument,
} from '@/lib/property-documents';

/**
 * Documents tab body. Lists the property's filed documents (executed
 * contract auto-filed first, then operator uploads) and an upload form.
 *
 * Upload uses useActionState so a failed upload re-renders with an
 * inline error and the chosen category/label intact — same failure-soft
 * pattern as the property edit form.
 */
export function DocumentsPanel({
  propertyId,
  documents,
}: {
  propertyId: string;
  documents: PropertyDocument[];
}) {
  const action = uploadPropertyDocument.bind(null, propertyId);
  const [state, formAction, pending] = useActionState<UploadDocumentState, FormData>(action, {
    error: null,
  });
  const formRef = useRef<HTMLFormElement>(null);

  const catLabel = (id: string) =>
    DOCUMENT_CATEGORIES.find((c) => c.id === id)?.label ?? 'Other';

  // Body-only: the page wraps this in a CollapsibleSection ("Documents"),
  // which owns the section chrome — rendering a second h2 here would
  // double-head the fold.
  return (
    <div>
      {/* Upload form */}
      <form
        ref={formRef}
        action={formAction}
        style={{
          paddingTop: 4,
          marginBottom: 28,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          gap: 14,
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 240px' }}>
          <span className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 600 }}>Label</span>
          <input
            name="label"
            type="text"
            placeholder="e.g. 2026 STR insurance policy"
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '0 0 160px' }}>
          <span className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 600 }}>Category</span>
          <select name="category" defaultValue="insurance" style={inputStyle}>
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 220px' }}>
          <span className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 600 }}>File</span>
          <input
            name="file"
            type="file"
            required
            accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt"
            style={{ fontSize: 12, color: 'var(--ink-3)' }}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          style={{
            fontSize: 11,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            color: 'var(--paper)',
            background: 'var(--ink)',
            border: '1px solid var(--ink)',
            padding: '10px 18px',
            fontWeight: 600,
            cursor: pending ? 'wait' : 'pointer',
            opacity: pending ? 0.7 : 1,
          }}
        >
          {pending ? 'Uploading…' : 'Upload'}
        </button>
      </form>

      {state.error && (
        <div
          style={{
            marginTop: -14,
            marginBottom: 24,
            padding: '12px 16px',
            borderLeft: '3px solid var(--negative)',
            background: 'var(--paper-2)',
            fontSize: 13,
            color: 'var(--negative)',
            lineHeight: 1.5,
          }}
        >
          {state.error}
        </div>
      )}

      {/* List */}
      {documents.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55 }}>
          Nothing filed yet. Upload insurance policies, tax certificates, inspection reports, or
          anything worth keeping with this property. The executed management contract files itself
          here automatically when a prospect is promoted.
        </p>
      ) : (
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {documents.map((d) => (
            <div
              key={d.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto',
                gap: 18,
                alignItems: 'baseline',
                padding: '16px 0',
                borderBottom: '1px solid var(--rule)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <a
                  href={d.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 15, color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: 3 }}
                >
                  {d.label}
                </a>
                <div style={{ marginTop: 3, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
                  {catLabel(d.category)}
                  {d.size_bytes ? ` · ${formatBytes(d.size_bytes)}` : ''}
                  {d.source === 'contract-auto' ? ' · auto-filed' : d.uploaded_by_email ? ` · ${d.uploaded_by_email.split('@')[0]}` : ''}
                </div>
              </div>
              {d.source === 'contract-auto' && (
                <span
                  style={{
                    fontSize: 9, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
                    color: 'var(--paper)', background: 'var(--tide-deep)', padding: '2px 8px', whiteSpace: 'nowrap',
                  }}
                >
                  Contract
                </span>
              )}
              <a
                href={d.file_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)', textDecoration: 'none', whiteSpace: 'nowrap' }}
              >
                Open ↗
              </a>
              <DeleteDocButton propertyId={propertyId} documentId={d.id} label={d.label} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeleteDocButton({ propertyId, documentId, label }: { propertyId: string; documentId: string; label: string }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirming) {
          setConfirming(true);
          setTimeout(() => setConfirming(false), 3000);
          return;
        }
        start(async () => {
          await deletePropertyDocument(propertyId, documentId);
        });
      }}
      title={`Delete "${label}"`}
      style={{
        background: 'transparent',
        border: 'none',
        fontSize: 11,
        letterSpacing: '.14em',
        textTransform: 'uppercase',
        color: confirming ? 'var(--negative)' : 'var(--ink-4)',
        cursor: pending ? 'wait' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {pending ? 'Removing…' : confirming ? 'Confirm?' : 'Delete'}
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--rule)',
  borderBottom: '1px solid var(--ink)',
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 14,
  padding: '9px 11px',
  outline: 'none',
  boxSizing: 'border-box',
};
