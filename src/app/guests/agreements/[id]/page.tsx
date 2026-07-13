import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  AGREEMENT_KIND_LABEL,
  AGREEMENT_STATUS_LABEL,
  agreementStatus,
  type GuestAgreementRow,
} from '@/lib/agreement-types';
import { fmtAgreementDate, fmtAgreementMoney } from '@/lib/agreement-base';
import {
  countersignAgreement,
  markAgreementSent,
  sendAgreementToGuest,
  unvoidAgreement,
  voidAgreement,
} from '../actions';
import { SubmitButton } from '@/components/SubmitButton';
import { CopyLinkButton } from './CopyLinkButton';

export const dynamic = 'force-dynamic';

/**
 * Agreement detail — the operator's control surface for one guest rental
 * agreement: signing link, send/countersign/void actions, and the audit
 * trail. The document itself lives at ./doc (internal preview) and at the
 * public /agreement/<token> signing page.
 */
export default async function AgreementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await supabaseAdmin.from('guest_agreements').select('*').eq('id', id).maybeSingle();
  if (!data) notFound();
  const a = data as GuestAgreementRow;
  const status = agreementStatus(a);

  const signPath = `/agreement/${a.signing_token}`;
  const pdfHref = `/api/agreement-pdf?id=${encodeURIComponent(a.id)}`;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="marketing" />

      {/* Header */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 24, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          <Link href="/guests?tab=agreements" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>
            ← Agreements
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
          <h1
            className="font-serif"
            style={{ fontSize: 36, lineHeight: 1.05, fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}
          >
            {a.property_address}
          </h1>
          <StatusChip status={status} />
        </div>
        <p style={{ marginTop: 8, fontSize: 14, color: 'var(--ink-3)' }}>
          {a.guest_name}
          {a.guest_email ? ` · ${a.guest_email}` : ''}
          {a.guest_phone ? ` · ${a.guest_phone}` : ''}
        </p>
      </section>

      {/* Meta strip */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 28 }}>
        <div
          style={{
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--ink)',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
          }}
        >
          <Field label="Kind" value={AGREEMENT_KIND_LABEL[a.kind]} />
          <Field label="Stay" value={`${fmtAgreementDate(a.stay_start)} – ${fmtAgreementDate(a.stay_end)}`} />
          <Field label="Rental fee" value={fmtAgreementMoney(a.rental_fee)} />
          <Field
            label="Deposit"
            value={
              a.deposit_kind === 'none' || a.deposit_amount == null
                ? 'None'
                : `${fmtAgreementMoney(a.deposit_amount)} (${a.deposit_kind})`
            }
            last
          />
        </div>
      </section>

      {/* Document + link actions */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 36 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Document</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Link
            href={`/guests/agreements/${a.id}/doc`}
            target="_blank"
            style={{ ...linkBtnStyle, background: 'var(--ink)', color: 'var(--paper)' }}
          >
            Open document
          </Link>
          <CopyLinkButton path={signPath} />
          <a href={pdfHref} style={linkBtnStyle}>Download PDF</a>
          {!a.guest_signed_at && !a.voided_at && (
            <Link href={`/guests/agreements/${a.id}/edit`} style={linkBtnStyle}>
              Edit
            </Link>
          )}
          {a.drive_url && (
            <a href={a.drive_url} target="_blank" rel="noreferrer" style={linkBtnStyle}>
              Executed PDF in Drive ↗
            </a>
          )}
        </div>
        <p style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-4)', maxWidth: 640, lineHeight: 1.55 }}>
          Signing link: <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11 }}>{signPath}</span>
          . Anyone with the link can view and sign this agreement, so share it only with the guest.
        </p>
      </section>

      {/* Workflow actions */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 36 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Workflow</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 720 }}>
          {/* Step: send */}
          <WorkflowRow
            done={!!a.sent_at}
            label={a.sent_at ? `Sent ${fmtStamp(a.sent_at)}` : 'Send the signing link to the guest'}
          >
            {!a.voided_at && !a.guest_signed_at && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {a.guest_email ? (
                  <form action={sendAgreementToGuest}>
                    <input type="hidden" name="id" value={a.id} />
                    <SubmitButton
                      label={a.sent_at ? 'Resend email' : 'Email signing link'}
                      busyLabel="Sending…"
                      style={actionPrimary}
                    />
                  </form>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--ink-4)', alignSelf: 'center' }}>
                    Add a guest email (Edit) to send from Helm, or copy the link and text it.
                  </span>
                )}
                {!a.sent_at && (
                  <form action={markAgreementSent}>
                    <input type="hidden" name="id" value={a.id} />
                    <SubmitButton label="Mark as sent" busyLabel="Marking…" style={actionGhost} spinnerTone="ink" />
                  </form>
                )}
              </div>
            )}
          </WorkflowRow>

          {/* Step: guest signs */}
          <WorkflowRow
            done={!!a.guest_signed_at}
            label={
              a.guest_signed_at
                ? `Signed ${fmtStamp(a.guest_signed_at)} by ${a.guest_signed_name ?? a.guest_name}`
                : 'Guest signs at the link (typed-name signature, ESIGN/UETA audit trail)'
            }
          />

          {/* Step: countersign */}
          <WorkflowRow
            done={!!a.countersigned_at}
            label={
              a.countersigned_at
                ? `Countersigned ${fmtStamp(a.countersigned_at)}. Executed PDF ${a.executed_email_sent_at ? 'emailed to the guest' : 'email pending'}.`
                : 'Countersign to execute (emails the final PDF + archives to Drive)'
            }
          >
            {a.guest_signed_at && !a.countersigned_at && !a.voided_at && (
              <form action={countersignAgreement}>
                <input type="hidden" name="id" value={a.id} />
                <SubmitButton label="Countersign as Allie" busyLabel="Executing…" style={actionPrimary} />
              </form>
            )}
          </WorkflowRow>
        </div>
      </section>

      {/* Void */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 48 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Danger zone</div>
        {a.voided_at ? (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--signal)', fontWeight: 600 }}>
              Voided {fmtStamp(a.voided_at)}. The signing link is dead.
            </span>
            <form action={unvoidAgreement}>
              <input type="hidden" name="id" value={a.id} />
              <SubmitButton label="Restore" busyLabel="Restoring…" style={actionGhost} spinnerTone="ink" />
            </form>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <form action={voidAgreement}>
              <input type="hidden" name="id" value={a.id} />
              <SubmitButton label="Void agreement" busyLabel="Voiding…" style={actionDanger} spinnerTone="ink" />
            </form>
            <span style={{ fontSize: 12, color: 'var(--ink-4)', maxWidth: 480, lineHeight: 1.5 }}>
              Kills the signing link. Use for superseded terms, then create a fresh agreement
              {a.guest_signed_at ? ' (this one is signed, so it can no longer be edited)' : ''}.
            </span>
          </div>
        )}
      </section>

      {/* Audit + notes */}
      {(a.guest_signed_at || a.internal_notes) && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 96 }}>
          {a.guest_signed_at && (
            <>
              <div className="eyebrow" style={{ marginBottom: 12 }}>Audit</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.8, fontFamily: 'var(--font-mono), monospace' }}>
                <div>signed_name: {a.guest_signed_name}</div>
                <div>signed_at: {a.guest_signed_at}</div>
                {a.guest_signed_ip && <div>ip: {a.guest_signed_ip}</div>}
                {a.guest_email_sent_at && <div>signed_copy_emailed: {a.guest_email_sent_at}</div>}
                {a.countersigned_at && <div>countersigned_at: {a.countersigned_at}</div>}
                {a.executed_email_sent_at && <div>executed_emailed: {a.executed_email_sent_at}</div>}
              </div>
            </>
          )}
          {a.internal_notes && (
            <>
              <div className="eyebrow" style={{ margin: '24px 0 10px' }}>Internal notes</div>
              <p style={{ fontSize: 13, color: 'var(--ink)', maxWidth: 640, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {a.internal_notes}
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}

// ─── Bits ───────────────────────────────────────────────────────────────────

const actionBtnBase: React.CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '.06em',
  padding: '8px 14px',
};
const actionPrimary: React.CSSProperties = { ...actionBtnBase, color: 'var(--paper)', background: 'var(--ink)', border: '1px solid var(--ink)' };
const actionGhost: React.CSSProperties = { ...actionBtnBase, color: 'var(--ink)', background: 'transparent', border: '1px solid var(--ink)' };
const actionDanger: React.CSSProperties = { ...actionBtnBase, color: 'var(--signal)', background: 'transparent', border: '1px solid var(--signal)' };

const linkBtnStyle: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '.06em',
  color: 'var(--ink)',
  border: '1px solid var(--ink)',
  padding: '8px 14px',
  textDecoration: 'none',
};

function StatusChip({ status }: { status: keyof typeof AGREEMENT_STATUS_LABEL }) {
  const tone =
    status === 'executed' ? { color: '#1d6b46', border: '#1d6b46' } :
    status === 'signed' ? { color: 'var(--signal)', border: 'var(--signal)' } :
    status === 'voided' ? { color: 'var(--ink-4)', border: 'var(--ink-4)' } :
    { color: 'var(--ink-3)', border: 'var(--rule)' };
  return (
    <span
      style={{
        fontSize: 11,
        letterSpacing: '.1em',
        textTransform: 'uppercase',
        fontWeight: 700,
        color: tone.color,
        border: `1px solid ${tone.border}`,
        padding: '4px 10px',
      }}
    >
      {AGREEMENT_STATUS_LABEL[status]}
    </span>
  );
}

function WorkflowRow({
  done,
  label,
  children,
}: {
  done: boolean;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <span
        aria-hidden="true"
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          flexShrink: 0,
          marginTop: 1,
          border: `2px solid ${done ? '#1d6b46' : 'var(--rule)'}`,
          background: done ? '#1d6b46' : 'transparent',
          color: 'var(--paper)',
          fontSize: 11,
          lineHeight: '14px',
          textAlign: 'center',
          fontWeight: 700,
        }}
      >
        {done ? '✓' : ''}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        <span style={{ fontSize: 13, color: done ? 'var(--ink)' : 'var(--ink-3)', lineHeight: 1.5 }}>{label}</span>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div style={{ padding: '14px 16px 14px 0', borderRight: last ? 'none' : '1px solid var(--rule)' }}>
      <div className="eyebrow" style={{ fontSize: 10, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 14, color: 'var(--ink)' }}>{value}</div>
    </div>
  );
}

function fmtStamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
}
