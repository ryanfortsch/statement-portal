import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { SubmitButton } from '@/components/SubmitButton';
import { isOwnerSession } from '@/lib/helm-access-server';
import { listStaffDocuments } from '@/lib/staff-documents-db';
import { STAFF_DOCUMENT_STATUS_LABEL } from '@/lib/staff-documents';
import { createStaffDocument } from './actions';

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

function fmtDay(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
}

export default async function StaffDocumentsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  // Owners only; the proxy turns staff away too (OWNER_PATH_PREFIXES).
  if (!(await isOwnerSession())) notFound();
  const [{ error }, docs] = await Promise.all([searchParams, listStaffDocuments()]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <HelmHero plain eyebrow="Helm · Team" title="Staff documents" />

      <section className="max-w-[1100px] mx-auto" style={{ width: '100%', padding: '0 24px 32px' }}>
        <p style={{ fontSize: 14, color: 'var(--ink-3)', maxWidth: 680, lineHeight: 1.6, margin: '0 0 20px' }}>
          Offer letters and other agreements a team member signs online. They sign at a private link, the countersigner signs for Rising Tide, and the signed PDF is emailed to them and filed in Drive.
        </p>
        {docs.length === 0 ? (
          <p style={{ fontSize: 14, color: 'var(--ink-3)' }}>No documents yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                <th style={{ padding: '8px 6px', borderBottom: '1px solid var(--rule)' }}>Document</th>
                <th style={{ padding: '8px 6px', borderBottom: '1px solid var(--rule)' }}>For</th>
                <th style={{ padding: '8px 6px', borderBottom: '1px solid var(--rule)' }}>Status</th>
                <th style={{ padding: '8px 6px', borderBottom: '1px solid var(--rule)' }}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td style={{ padding: '10px 6px', borderBottom: '1px solid var(--rule)' }}>
                    <Link href={`/staff-documents/${d.id}`} style={{ color: 'var(--ink)', fontWeight: 600 }}>{d.title}</Link>
                  </td>
                  <td style={{ padding: '10px 6px', borderBottom: '1px solid var(--rule)' }}>{d.recipient_name}</td>
                  <td style={{ padding: '10px 6px', borderBottom: '1px solid var(--rule)' }}>{STAFF_DOCUMENT_STATUS_LABEL[d.status]}</td>
                  <td style={{ padding: '10px 6px', borderBottom: '1px solid var(--rule)', color: 'var(--ink-3)' }}>{fmtDay(d.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="max-w-[1100px] mx-auto" style={{ width: '100%', padding: '0 24px 80px' }}>
        <details open={docs.length === 0 || !!error} style={{ border: '1px solid var(--rule)', padding: '14px 18px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>New document</summary>
          {error && <p role="alert" style={{ color: 'var(--signal)', fontSize: 13, margin: '12px 0 0' }}>{error}</p>}
          <form action={createStaffDocument} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
            <label style={label}>Title<input name="title" required placeholder="Offer of Employment: Operations Manager" style={input} /></label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
              <label style={label}>Signer&apos;s full name<input name="recipient_name" required style={input} /></label>
              <label style={label}>Signer&apos;s email<input name="recipient_email" type="email" required style={input} /></label>
            </div>
            <label style={label}>
              Document text (Markdown: # headings, - lists, | tables |, **bold**). The signature lines are added for you.
              <textarea name="body_md" required rows={18} style={{ ...input, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 13 }} />
            </label>
            <div>
              <SubmitButton label="Save draft" busyLabel="Saving…" style={darkButton} />
            </div>
          </form>
        </details>
      </section>

      <HelmFooter module="Team · Staff documents" right={`${docs.length} document${docs.length === 1 ? '' : 's'}`} />
    </div>
  );
}
