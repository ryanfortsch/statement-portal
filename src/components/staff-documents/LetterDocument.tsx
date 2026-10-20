import type React from 'react';
import { inlineRuns, parseLetter, type StaffDocumentRow } from '@/lib/staff-documents';
import { getTeamMember } from '@/lib/team';
import { dutyEmails } from '@/lib/team-recipients';

/**
 * A staff document as the signer reads it and as the PDF prints it: the
 * letter body (rendered from its Markdown as React elements, never HTML),
 * then the two signature blocks and, once signed, the certificate. Inline
 * styles only, like the statement render page, so the Puppeteer print
 * matches the screen. `signingForm` sits where the signer's block goes
 * until they sign.
 */

const INK = '#1e2e34';
const INK_3 = '#506068';
const RULE = '#d9d2c3';
const PAPER = '#faf7f1';
const SIGNAL = '#c85a3a';

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineRuns(text).map((r, i) => (r.bold ? <strong key={i}>{r.text}</strong> : <span key={i}>{r.text}</span>))}
    </>
  );
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function SignatureBlock({
  heading,
  name,
  role,
  signedName,
  signedAt,
  children,
}: {
  heading: string;
  name: string;
  role?: string;
  signedName: string | null;
  signedAt: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ flex: '1 1 260px', minWidth: 240, breakInside: 'avoid' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: INK_3, marginBottom: 14 }}>{heading}</div>
      {signedName && signedAt ? (
        <>
          <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontStyle: 'italic', fontSize: 26, color: INK, borderBottom: `1px solid ${INK}`, paddingBottom: 6 }}>
            {signedName}
          </div>
          <div style={{ fontSize: 13, marginTop: 8 }}>{name}{role ? `, ${role}` : ''}</div>
          <div style={{ fontSize: 12, color: INK_3, marginTop: 2 }}>Signed {fmtWhen(signedAt)}</div>
        </>
      ) : children ? (
        children
      ) : (
        <>
          <div style={{ borderBottom: `1px solid ${INK}`, height: 34 }} />
          <div style={{ fontSize: 13, marginTop: 8 }}>{name}{role ? `, ${role}` : ''}</div>
          <div style={{ fontSize: 12, color: INK_3, marginTop: 2 }}>Date</div>
        </>
      )}
    </div>
  );
}

export function LetterDocument({
  doc,
  signingForm,
}: {
  doc: StaffDocumentRow;
  signingForm?: React.ReactNode;
}) {
  const blocks = parseLetter(doc.body_md);
  // The name on the employer's line: whoever countersigned, else whoever
  // holds the countersign duty (team.ts), who is the one who will.
  const counter = getTeamMember(doc.countersigned_by_email ?? dutyEmails('countersign')[0]);
  const counterName = doc.countersigned_name || counter?.name || 'Rising Tide';
  return (
    <div style={{ background: PAPER, color: INK, minHeight: '100vh' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500;600&display=swap');
        .sd-sheet { max-width: 760px; margin: 0 auto; padding: 56px 48px 72px; font-family: 'Inter', -apple-system, sans-serif; font-size: 15px; line-height: 1.65; }
        .sd-sheet table { width: 100%; border-collapse: collapse; margin: 6px 0 18px; font-size: 14px; }
        .sd-sheet th, .sd-sheet td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid ${RULE}; }
        .sd-sheet th { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: ${INK_3}; font-weight: 600; }
        .sd-sheet td:first-child { width: 30%; }
        .sd-sheet p { margin: 0 0 14px; }
        .sd-sheet ul, .sd-sheet ol { margin: 0 0 16px; padding-left: 22px; }
        .sd-sheet li { margin-bottom: 4px; }
        @media print {
          .sd-noprint { display: none !important; }
          .sd-sheet { padding: 0; max-width: none; }
          body { background: #fff; }
        }
        @media (max-width: 640px) { .sd-sheet { padding: 32px 18px 56px; } }
      `}</style>
      <article className="sd-sheet">
        <div style={{ fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', color: SIGNAL, marginBottom: 28 }}>
          Rising Tide STR, LLC
        </div>
        {blocks.map((b, i) => {
          if (b.kind === 'heading') {
            const size = b.level === 1 ? 30 : b.level === 2 ? 20 : 16;
            return (
              <div
                key={i}
                role="heading"
                aria-level={b.level}
                style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: b.level === 1 ? 400 : 600, fontSize: size, lineHeight: 1.25, margin: b.level === 1 ? '0 0 22px' : '26px 0 10px', breakAfter: 'avoid' }}
              >
                <Inline text={b.text} />
              </div>
            );
          }
          if (b.kind === 'paragraph') return <p key={i}><Inline text={b.text} /></p>;
          if (b.kind === 'list') {
            const items = b.items.map((it, j) => <li key={j}><Inline text={it} /></li>);
            return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
          }
          const hasHeader = b.header.some((h) => h.trim().length > 0);
          return (
            <table key={i}>
              {hasHeader && (
                <thead>
                  <tr>{b.header.map((h, j) => <th key={j}><Inline text={h} /></th>)}</tr>
                </thead>
              )}
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>{r.map((c, k) => <td key={k}><Inline text={c} /></td>)}</tr>
                ))}
              </tbody>
            </table>
          );
        })}

        <section id="signatures" style={{ marginTop: 40, paddingTop: 24, borderTop: `1px solid ${RULE}`, breakInside: 'avoid' }}>
          <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
            <SignatureBlock
              heading="Rising Tide STR, LLC"
              name={counterName}
              role="Owner"
              signedName={doc.countersigned_at ? counterName : null}
              signedAt={doc.countersigned_at}
            />
            <SignatureBlock
              heading="Accepted"
              name={doc.recipient_name}
              signedName={doc.signed_name}
              signedAt={doc.signed_at}
            >
              {signingForm}
            </SignatureBlock>
          </div>
        </section>

        {doc.signed_at && (
          <section style={{ marginTop: 40, padding: '16px 18px', border: `1px solid ${RULE}`, fontSize: 12, color: INK_3, lineHeight: 1.6, breakInside: 'avoid' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 8, color: INK }}>Certificate of signature</div>
            <div>Signed electronically by {doc.signed_name} on {fmtWhen(doc.signed_at)}{doc.signed_ip ? ` from ${doc.signed_ip}` : ''}.</div>
            {doc.countersigned_at && <div>Countersigned by {counterName} for Rising Tide STR, LLC on {fmtWhen(doc.countersigned_at)}.</div>}
            <div style={{ wordBreak: 'break-all' }}>Document fingerprint (SHA-256): {doc.signed_digest || doc.body_digest}</div>
          </section>
        )}
      </article>
    </div>
  );
}
