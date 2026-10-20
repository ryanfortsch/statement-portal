import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { SubmitButton } from '@/components/SubmitButton';
import { CopyLinkButton } from '@/components/projections/SigningButtons';
import { LetterDocument } from '@/components/staff-documents/LetterDocument';
import { isOwnerSession } from '@/lib/helm-access-server';
import { getTeamMember } from '@/lib/team';
import { dutyEmails } from '@/lib/team-recipients';
import { staffDocumentById } from '@/lib/staff-documents-db';
import { STAFF_DOCUMENT_STATUS_LABEL } from '@/lib/staff-documents';
import {
  countersignStaffDocument,
  resendSigningLink,
  sendStaffDocument,
  updateStaffDocument,
  voidStaffDocument,
} from '../actions';

export const dynamic = 'force-dynamic';

const input: React.CSSProperties = {
  width: '100%',
  padding: '9px 10px',
  fontSize: 14,
  border: '1px solid var(--rule)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  fontFamily: 'inherit',
};
const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--ink-3)' };
const darkButton: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: 'none',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  padding: '12px 18px',
  cursor: 'pointer',
};
const ghostButton: React.CSSProperties = { ...darkButton, background: 'transparent', color: 'var(--ink)', border: '1px solid var(--ink)' };

function fmtWhen(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default async function StaffDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string }>;
}) {
  if (!(await isOwnerSession())) notFound();
  const [{ id }, { msg }, session, h] = await Promise.all([params, searchParams, auth(), headers()]);
  const doc = await staffDocumentById(id);
  if (!doc) notFound();

  const host = h.get('x-forwarded-host') || h.get('host') || '';
  const proto = h.get('x-forwarded-proto') || 'https';
  const signUrl = `${proto}://${host}/sign/${doc.token}`;
  const countersigner = dutyEmails('countersign')[0] ?? null;
  const mayCountersign = !!session?.user?.email && session.user.email.toLowerCase() === countersigner;
  const counterName = getTeamMember(countersigner)?.name ?? 'The countersigner';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <HelmHero plain eyebrow="Helm · Staff documents" title={doc.title} />

      <section className="max-w-[1100px] mx-auto" style={{ width: '100%', padding: '0 24px 24px' }}>
        <Link href="/staff-documents" style={{ fontSize: 13, color: 'var(--ink-3)' }}>← All staff documents</Link>
        {msg && (
          <p role="status" style={{ margin: '14px 0 0', padding: '10px 14px', borderLeft: '3px solid var(--signal)', background: 'var(--paper-2, #fff)', fontSize: 14 }}>{msg}</p>
        )}

        <div style={{ marginTop: 18, border: '1px solid var(--rule)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 14 }}>
            <strong>{STAFF_DOCUMENT_STATUS_LABEL[doc.status]}</strong>
            <span style={{ color: 'var(--ink-3)' }}> · for {doc.recipient_name} ({doc.recipient_email})</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
            {doc.sent_at && <div>Sent {fmtWhen(doc.sent_at)}{doc.sent_by_email ? ` by ${getTeamMember(doc.sent_by_email)?.name ?? doc.sent_by_email}` : ''}</div>}
            {doc.signed_at && <div>Signed {fmtWhen(doc.signed_at)} as “{doc.signed_name}”</div>}
            {doc.countersigned_at && <div>Countersigned {fmtWhen(doc.countersigned_at)} by {doc.countersigned_name}</div>}
            {doc.voided_at && <div>Withdrawn {fmtWhen(doc.voided_at)}</div>}
          </div>

          {doc.status !== 'draft' && doc.status !== 'void' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13 }}>
              <span style={{ color: 'var(--ink-3)' }}>Signing link</span>
              <CopyLinkButton text={signUrl} label="Copy link" />
              <a href={`/api/staff-document-pdf?id=${doc.id}`} style={{ color: 'var(--ink)', fontSize: 13 }}>Download PDF</a>
              {doc.drive_url && <a href={doc.drive_url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)', fontSize: 13 }}>Open in Drive</a>}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {doc.status === 'draft' && (
              <form action={sendStaffDocument}>
                <input type="hidden" name="id" value={doc.id} />
                <SubmitButton
                  label={`Send to ${doc.recipient_name.split(' ')[0]} for signature`}
                  busyLabel="Sending…"
                  style={darkButton}
                  confirm={{ title: 'Send for signature?', body: `${doc.recipient_email} gets a link to read and sign. The text is frozen once it is sent.`, confirmLabel: 'Send' }}
                />
              </form>
            )}
            {doc.status === 'sent' && (
              <form action={resendSigningLink}>
                <input type="hidden" name="id" value={doc.id} />
                <SubmitButton label="Email the link again" busyLabel="Sending…" style={ghostButton} spinnerTone="ink" />
              </form>
            )}
            {doc.status === 'signed' && (
              mayCountersign ? (
                <form action={countersignStaffDocument}>
                  <input type="hidden" name="id" value={doc.id} />
                  <SubmitButton
                    label="Countersign and send"
                    busyLabel="Countersigning, filing…"
                    style={darkButton}
                    confirm={{ title: 'Countersign for Rising Tide?', body: `Your name goes on the employer's signature line, and the signed PDF is emailed to ${doc.recipient_name} and filed in Drive.`, confirmLabel: 'Countersign' }}
                  />
                </form>
              ) : (
                <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>{counterName} countersigns this.</p>
              )
            )}
            {(doc.status === 'draft' || doc.status === 'sent') && (
              <form action={voidStaffDocument}>
                <input type="hidden" name="id" value={doc.id} />
                <SubmitButton
                  label="Withdraw"
                  busyLabel="Withdrawing…"
                  style={ghostButton}
                  spinnerTone="ink"
                  confirm={{ title: 'Withdraw this document?', body: 'The signing link will say it was withdrawn and nothing can be signed.', confirmLabel: 'Withdraw', tone: 'danger' }}
                />
              </form>
            )}
          </div>
        </div>

        {doc.status === 'draft' && (
          <details style={{ marginTop: 18, border: '1px solid var(--rule)', padding: '14px 18px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>Edit draft</summary>
            <form action={updateStaffDocument} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
              <input type="hidden" name="id" value={doc.id} />
              <label style={label}>Title<input name="title" required defaultValue={doc.title} style={input} /></label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
                <label style={label}>Signer&apos;s full name<input name="recipient_name" required defaultValue={doc.recipient_name} style={input} /></label>
                <label style={label}>Signer&apos;s email<input name="recipient_email" type="email" required defaultValue={doc.recipient_email} style={input} /></label>
              </div>
              <label style={label}>
                Document text
                <textarea name="body_md" required rows={18} defaultValue={doc.body_md} style={{ ...input, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 13 }} />
              </label>
              <div><SubmitButton label="Save" busyLabel="Saving…" style={darkButton} /></div>
            </form>
          </details>
        )}
      </section>

      <section style={{ width: '100%', padding: '0 24px 80px' }}>
        <div className="max-w-[1100px] mx-auto" style={{ border: '1px solid var(--rule)' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-3)', padding: '10px 14px', borderBottom: '1px solid var(--rule)' }}>
            What {doc.recipient_name.split(' ')[0]} sees
          </div>
          <LetterDocument doc={doc} />
        </div>
      </section>

      <HelmFooter module="Team · Staff documents" right={STAFF_DOCUMENT_STATUS_LABEL[doc.status]} />
    </div>
  );
}
