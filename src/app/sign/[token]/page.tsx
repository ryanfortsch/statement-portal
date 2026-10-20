import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LetterDocument } from '@/components/staff-documents/LetterDocument';
import { SignSubmitButton } from '@/components/projections/SigningButtons';
import { staffDocumentByToken } from '@/lib/staff-documents-db';
import { cleanLinkToken } from '@/lib/link-token';
import { signStaffDocument } from './actions';

export const dynamic = 'force-dynamic';

// Token-gated and personal: never indexed, even if a link leaks.
export const metadata: Metadata = {
  title: 'Review and sign · Rising Tide',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

const INK = '#1e2e34';
const SIGNAL = '#c85a3a';

export default async function StaffDocumentSignPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ signed?: string; notice?: string }>;
}) {
  const { token: raw } = await params;
  const token = cleanLinkToken(raw);
  if (!token) notFound();
  const doc = await staffDocumentByToken(token);
  if (!doc || doc.status === 'draft') notFound();
  const { signed, notice } = await searchParams;

  const banner =
    doc.status === 'void'
      ? 'This document was withdrawn and can no longer be signed.'
      : signed === '1' && doc.signed_at
        ? 'Thank you. Your signature is recorded, and you will get the fully signed copy by email once it is countersigned.'
        : notice
          ? notice
          : null;

  const signingForm =
    doc.status === 'sent' ? (
      <form action={signStaffDocument} className="sd-noprint" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <style>{`
          .rt-sign-btn { background: ${INK}; color: #faf7f1; border: none; font-size: 11px; font-weight: 600; letter-spacing: .18em; text-transform: uppercase; padding: 13px 20px; align-self: flex-start; }
        `}</style>
        <input type="hidden" name="token" value={doc.token} />
        <input type="hidden" name="digest" value={doc.body_digest} />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          Type your full name to sign
          <input
            name="signed_name"
            required
            autoComplete="name"
            defaultValue=""
            placeholder={doc.recipient_name}
            style={{ fontFamily: "'Fraunces', Georgia, serif", fontStyle: 'italic', fontSize: 22, padding: '8px 4px', border: 'none', borderBottom: `1px solid ${INK}`, background: 'transparent', color: INK, outline: 'none' }}
          />
        </label>
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.5 }}>
          <input type="checkbox" name="agree" required style={{ marginTop: 3 }} />
          I have read this document and agree to it. Typing my name above is my electronic signature.
        </label>
        <SignSubmitButton />
      </form>
    ) : undefined;

  return (
    <>
      {banner && (
        <div
          className="sd-noprint"
          role="status"
          style={{ background: doc.status === 'void' ? '#f3e3dc' : '#e8efe4', color: INK, padding: '14px 20px', fontSize: 14, textAlign: 'center', borderBottom: `2px solid ${doc.status === 'void' ? SIGNAL : '#5b7b4e'}` }}
        >
          {banner}
        </div>
      )}
      <LetterDocument doc={doc} signingForm={signingForm} />
    </>
  );
}
