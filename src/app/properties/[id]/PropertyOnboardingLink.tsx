'use client';

import { useEffect, useState, useTransition } from 'react';
import { ensurePropertyOnboardingToken } from '@/app/projections/actions';
import { ALWAYS_CC, SEND_FROM } from '@/lib/properties';
import { renderOnboardingInviteEmail } from '@/lib/onboarding-invite-email';

type Props = {
  propertyId: string;
  /** Existing onboarding token, or null if one hasn't been generated yet. */
  initialToken: string | null;
  /** ISO timestamp of the latest submission, or null if never submitted. */
  submittedAt: string | null;
  /** Owner emails on file, so the draft can be addressed (and the button
   *  disabled with a hint when there are none). */
  ownerEmails: string[];
  /** Owner greeting ("Claudia and Vicente") for the email opener. */
  ownerGreeting: string | null;
  /** Internal property name ("21 Horton") shown in the email + preview. */
  propertyName: string;
};

/**
 * Public-form link surface for the Owner section on a property page.
 *
 * If the property has no token yet, shows a single "Generate onboarding
 * link" button. Clicking it asks the server to mint a token for this
 * property and stores it on the row. Once a token exists, the component
 * shows the public URL with a Copy button and a status line indicating
 * whether the owner has submitted yet (and when).
 *
 * "Draft email to owner" opens a preview of the invite email and, on
 * confirm, creates a Gmail draft (never sends) the operator reviews and
 * sends from Gmail. Mirrors the owner-statement draft flow.
 */
export function PropertyOnboardingLink({
  propertyId,
  initialToken,
  submittedAt,
  ownerEmails,
  ownerGreeting,
  propertyName,
}: Props) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Origin is read on the client so the previewed + drafted URL matches what
  // the Copy button produces. Empty during SSR; filled after mount.
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  // Email-draft preview + create-draft state.
  const [preparing, setPreparing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const hasOwnerEmail = ownerEmails.length > 0;

  const onGenerate = () => {
    setError(null);
    startTransition(async () => {
      try {
        const fresh = await ensurePropertyOnboardingToken(propertyId);
        setToken(fresh);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const onCopy = async () => {
    if (!token) return;
    try {
      const url = `${window.location.origin}/onboarding/${token}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.getElementById(`onboarding-url-${propertyId}`) as HTMLInputElement | null;
      input?.select();
    }
  };

  // Open the email preview. Mints a token first if the property doesn't have
  // one yet, so the previewed URL is the real link the draft will carry.
  const onOpenPreview = () => {
    setDraftError(null);
    setDraftUrl(null);
    if (token) {
      setPreviewOpen(true);
      return;
    }
    setPreparing(true);
    startTransition(async () => {
      try {
        const fresh = await ensurePropertyOnboardingToken(propertyId);
        setToken(fresh);
        setPreviewOpen(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPreparing(false);
      }
    });
  };

  const onCreateDraft = async () => {
    setDraftError(null);
    setDrafting(true);
    try {
      const res = await fetch('/api/draft-onboarding-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: propertyId, origin: window.location.origin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Draft failed (${res.status})`);
      setDraftUrl(data.draft_url);
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : String(err));
    } finally {
      setDrafting(false);
    }
  };

  const onboardingUrl = token && origin ? `${origin}/onboarding/${token}` : token ? `/onboarding/${token}` : '';
  const preview = renderOnboardingInviteEmail({
    greeting: ownerGreeting || '',
    propertyShort: propertyName,
    onboardingUrl: onboardingUrl || '(link generated when you draft)',
  });

  // Status line: when the form was last submitted, or "Not yet submitted".
  const statusLine = (() => {
    if (!submittedAt) return 'Not yet submitted';
    try {
      const then = new Date(submittedAt);
      const days = Math.floor((Date.now() - then.getTime()) / (24 * 60 * 60 * 1000));
      if (days <= 0) return 'Submitted today';
      if (days === 1) return 'Submitted yesterday';
      if (days < 14) return `Submitted ${days} days ago`;
      return `Submitted ${then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } catch {
      return 'Submitted';
    }
  })();

  const uppercaseBtn: React.CSSProperties = {
    fontSize: 11,
    letterSpacing: '.18em',
    textTransform: 'uppercase',
    fontWeight: 500,
    padding: '10px 16px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{ marginTop: 24, paddingTop: 18, borderTop: '1px dotted var(--rule)' }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Owner onboarding intake</div>

      {!token ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onGenerate}
            disabled={pending}
            style={{ ...uppercaseBtn, color: 'var(--paper)', background: 'var(--ink)', border: '1px solid var(--ink)', cursor: pending ? 'wait' : 'pointer' }}
          >
            {pending ? 'Generating…' : 'Generate onboarding link'}
          </button>
          <span style={{ fontSize: 12, color: 'var(--ink-3)', maxWidth: 480, lineHeight: 1.55 }}>
            Creates a unique public form URL the owner can fill in. Their answers
            land back on this property record.
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              id={`onboarding-url-${propertyId}`}
              readOnly
              value={`/onboarding/${token}`}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono"
              style={{ fontSize: 12, color: 'var(--ink)', background: 'var(--paper-2)', border: '1px solid var(--rule)', padding: '8px 12px', minWidth: 280, flex: 1, outline: 'none' }}
            />
            <button type="button" onClick={onCopy} style={{ ...uppercaseBtn, color: 'var(--ink)', background: 'transparent', border: '1px solid var(--rule)' }}>
              {copied ? 'Copied ✓' : 'Copy link'}
            </button>
            <a
              href={`/onboarding/${token}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 500, color: 'var(--ink-3)', textDecoration: 'none', whiteSpace: 'nowrap' }}
            >
              Preview ↗
            </a>
          </div>
          <span style={{ fontSize: 12, color: submittedAt ? 'var(--positive)' : 'var(--ink-4)', letterSpacing: '.04em' }}>
            {statusLine}
          </span>
        </div>
      )}

      {/* Draft the invite email to the owner (opens a preview, then creates a
          Gmail draft the operator reviews and sends). */}
      <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onOpenPreview}
          disabled={preparing || pending || !hasOwnerEmail}
          title={hasOwnerEmail ? 'Preview the onboarding invite, then draft it in Gmail' : 'Add an owner email in the Owner section to enable'}
          style={{
            ...uppercaseBtn,
            color: hasOwnerEmail ? 'var(--ink)' : 'var(--ink-4)',
            background: 'transparent',
            border: `1px solid ${hasOwnerEmail ? 'var(--ink)' : 'var(--rule)'}`,
            cursor: preparing ? 'wait' : hasOwnerEmail ? 'pointer' : 'not-allowed',
          }}
        >
          {preparing ? 'Preparing…' : '✉ Draft email to owner'}
        </button>
        {!hasOwnerEmail && (
          <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>Add an owner email above to enable.</span>
        )}
      </div>

      {error && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--negative)', border: '1px solid var(--negative)', padding: '8px 12px' }}>
          {error}
        </div>
      )}

      {previewOpen && (
        <PreviewModal onClose={() => setPreviewOpen(false)}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Email preview · onboarding invite</div>
          <h3 className="font-serif" style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>{propertyName}</h3>
          <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
            To: {hasOwnerEmail ? ownerEmails.join(', ') : <em style={{ color: 'var(--signal)' }}>no email on file</em>}
            <br />
            Cc: {ALWAYS_CC.join(', ')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 6 }}>From: {SEND_FROM.name} &lt;{SEND_FROM.email}&gt;</div>

          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--ink)' }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Subject</div>
            <div className="font-serif" style={{ fontSize: 16, color: 'var(--ink)' }}>{preview.subject}</div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Body</div>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.55, color: 'var(--ink)', background: 'var(--paper-2)', padding: '14px 16px', borderLeft: '3px solid var(--tide)', margin: 0, fontFamily: 'var(--font-fraunces)' }}>{preview.body}</pre>
          </div>

          {draftUrl ? (
            <div style={{ marginTop: 18, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--positive)', fontWeight: 500 }}>Draft created in Gmail.</span>
              <a href={draftUrl} target="_blank" rel="noopener noreferrer" style={{ ...uppercaseBtn, color: 'var(--paper)', background: 'var(--ink)', textDecoration: 'none' }}>
                Open in Gmail →
              </a>
              <button type="button" onClick={() => setPreviewOpen(false)} style={{ ...uppercaseBtn, color: 'var(--ink-4)', background: 'transparent', border: '1px solid var(--rule)' }}>
                Close
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 18, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={onCreateDraft}
                disabled={drafting || !hasOwnerEmail}
                style={{ ...uppercaseBtn, color: 'var(--paper)', background: 'var(--ink)', border: 'none', opacity: drafting || !hasOwnerEmail ? 0.4 : 1, cursor: drafting || !hasOwnerEmail ? 'not-allowed' : 'pointer' }}
              >
                {drafting ? 'Drafting…' : '✉ Create Gmail draft'}
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(`Subject: ${preview.subject}\n\n${preview.body}`);
                  } catch {}
                }}
                style={{ ...uppercaseBtn, color: 'var(--ink-3)', background: 'transparent', border: '1px solid var(--rule)' }}
              >
                Copy instead
              </button>
              <button type="button" onClick={() => setPreviewOpen(false)} style={{ ...uppercaseBtn, color: 'var(--ink-4)', background: 'transparent', border: '1px solid var(--rule)' }}>
                Cancel
              </button>
            </div>
          )}

          {draftError && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--negative)', border: '1px solid var(--negative)', padding: '8px 12px' }}>
              {draftError}
            </div>
          )}
        </PreviewModal>
      )}
    </div>
  );
}

/** Lightweight centered modal for the email preview. Local to this component
 *  (the statements PreviewModal isn't exported); same warm-paper styling. */
function PreviewModal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,20,20,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px', zIndex: 1000, overflowY: 'auto' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--paper)', border: '1px solid var(--ink)', padding: '28px 30px', maxWidth: 640, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}
      >
        {children}
      </div>
    </div>
  );
}
