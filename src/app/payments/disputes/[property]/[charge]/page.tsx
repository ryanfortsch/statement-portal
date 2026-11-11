import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { FinancialsTabs } from '@/components/FinancialsTabs';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { isOwnerSession } from '@/lib/helm-access-server';
import { getActivePropertiesForStatements } from '@/lib/properties-server';
import { loadDisputePacket, type ThreadCoverage } from '@/lib/dispute-packet';
import { PrintPacketButton } from '../../PrintPacketButton';
import { ReasonSelect } from './ReasonSelect';
import { buttonClass } from '@/lib/button-class';
import {
  PLAYBOOK,
  disputeKind,
  flagThread,
  money,
  parseOtherPayments,
  reconcileOtherMeans,
  stayEvidence,
  type DisputeKind,
  type Strength,
} from '@/lib/dispute-packet-core';

/**
 * The dispute packet for one charged-back payment (2026-11-05). Every
 * dispute we lost, we lost by answering with our own story instead of the
 * question the reason code asks; this page lays out what that code needs,
 * filled from Helm's own records, for a person to print to PDF and upload in
 * the Stripe dashboard.
 *
 * Read-only. Stripe GETs and Supabase selects; nothing is submitted to Stripe
 * and nothing is written anywhere. The other payments a guest points to (a
 * cashier's check, a wire) are not recorded in Helm, so they are typed into
 * the form and carried in the URL.
 *
 * Owners only: it lays out a guest's whole folio. The path sits behind
 * /payments/disputes in OWNER_PATH_PREFIXES, and the page checks again.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

const SEPARATE_PURCHASE: readonly DisputeKind[] = ['paid_by_other_means', 'duplicate'];

const STRENGTH_WORDS: Record<Strength, { label: string; color: string }> = {
  strong: { label: 'Strong: the other payments cover the folio and this charge is a separate add-on', color: 'var(--tide-deep)' },
  arguable: { label: 'Arguable: read the gaps before submitting', color: 'var(--ink-2)' },
  weak: { label: 'Weak as it stands: read the gaps before submitting', color: 'var(--signal)' },
};

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? '').trim();
}

/** What the packet says when Guesty cut the guest's thread off. */
function incompleteThreadNote(c: ThreadCoverage): string {
  const served = `Guesty serves only the newest 25${c.guestyTotal ? ` of its ${c.guestyTotal}` : ''} posts`;
  const filled =
    c.fromLog > 0
      ? `; ${c.fromLog} earlier messages come from the concierge's own record of what the guest sent and what we sent. Guesty's automated messages and anything typed in Guesty's own inbox before then are not here`
      : ', and the concierge has no record of the earlier ones';
  return `This thread is not complete. ${served}${filled}. Export the whole thread from Guesty before submitting.`;
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York',
      });
}

const h2: React.CSSProperties = { fontFamily: 'var(--font-serif)', fontSize: 22, margin: '36px 0 10px' };
const cell: React.CSSProperties = { padding: '8px 12px 8px 0', borderBottom: '1px solid var(--rule)', verticalAlign: 'top' };
const quiet: React.CSSProperties = { color: 'var(--ink-3)', fontSize: 13 };

export default async function DisputePacketPage({
  params,
  searchParams,
}: {
  params: Promise<{ property: string; charge: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await isOwnerSession())) notFound();
  const { property, charge } = await params;
  const sp = await searchParams;

  const [packet, fleet] = await Promise.all([loadDisputePacket(property, charge), getActivePropertiesForStatements()]);
  const home = fleet.find((p) => p.id === property)?.name || property.replace(/_/g, ' ');

  if (!packet.ok) {
    return (
      <Shell home={home}>
        <p style={{ color: 'var(--signal)' }}>{packet.error}</p>
      </Shell>
    );
  }

  const { facts, link, stay, thread, threadCoverage, record, unread } = packet.data;
  const kindOverride = one(sp.kind) as DisputeKind;
  const kind: DisputeKind = kindOverride in PLAYBOOK ? kindOverride : disputeKind(facts.dispute?.reason, facts.dispute?.networkCode);
  const playbook = PLAYBOOK[kind];
  const paidText = one(sp.paid);
  const other = parseOtherPayments(paidText);
  const item = facts.item || link?.label || facts.description || 'this charge';
  const disputedCents = facts.dispute?.disputedCents ?? null;

  const recon = SEPARATE_PURCHASE.includes(kind)
    ? reconcileOtherMeans({
        folio: stay?.folio ?? [],
        payments: other.payments,
        disputed: {
          amountCents: facts.amountCents,
          disputedCents,
          refunds: facts.refunds,
          chargedOn: facts.chargedOn,
          item,
          isAddOn: !!facts.requestKey,
        },
      })
    : null;

  const guestWho = stay?.guestName || 'Guest';
  const allFlagged = thread
    ? flagThread(
        thread.map((m) => ({
          at: m.at,
          who: m.who === 'guest' ? guestWho : 'Rising Tide',
          body: m.body,
          fromLog: m.source === 'log',
        })),
        {
          item,
          guestName: stay?.guestName ?? facts.cardholderName,
          amountsCents: [facts.amountCents, disputedCents ?? 0, link?.base_cents ?? 0],
          guestWho,
        },
      )
    : null;
  // A stay dispute turns on what the guest complained about; an add-on
  // dispute on the messages about the charge.
  const showsComplaints = !SEPARATE_PURCHASE.includes(kind);
  const flagged = allFlagged
    ? allFlagged.filter((l) => l.aboutCharge || l.mentionsRefund || (showsComplaints && l.complaint))
    : null;
  // A refund request from the guest is a complaint for this count: claiming
  // "no complaint" beside one would hand the bank the guest's case.
  const complaints = allFlagged ? allFlagged.filter((l) => l.complaint).length : 0;

  const stayEv =
    stay && !SEPARATE_PURCHASE.includes(kind)
      ? stayEvidence({
          kind,
          checkIn: stay.checkIn,
          checkOut: stay.checkOut,
          bookedAt: stay.bookedAt,
          reservationStatus: stay.status,
          housePolicy: record?.housePolicy ?? null,
          agreement: record?.agreement ?? null,
          review: record?.review ?? null,
          cardholderName: facts.cardholderName,
          guestName: stay.guestName,
          complaints,
          threadComplete: !!allFlagged && threadCoverage?.complete !== false,
          proof: record?.proof ?? null,
        })
      : null;

  return (
    <Shell
      home={home}
      reason={
        <ReasonSelect
          kind={kind}
          paid={paidText}
          options={Object.values(PLAYBOOK).map((p) => ({ kind: p.kind, title: p.title }))}
        />
      }
    >
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff; } }`}</style>

      <div className="no-print" style={{ ...quiet, marginBottom: 20 }}>
        Read-only. Helm sends nothing to Stripe: print this page to PDF (Cmd+P) and upload it in the
        dispute in the Stripe dashboard{facts.dispute?.dueBy ? `, before ${facts.dispute.dueBy}` : ''}.{' '}
        <Link href="/payments/disputes" style={{ color: 'var(--tide-deep)' }}>All disputes</Link>
        <div style={{ marginTop: 10 }}>
          <PrintPacketButton />
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <tbody>
          <Row label="Home">{home}</Row>
          <Row label="Cardholder">
            {facts.cardholderName || '(no name)'} {facts.email ? `· ${facts.email}` : ''}{' '}
            {facts.cardLast4 ? `· ${facts.cardBrand || 'card'} ending ${facts.cardLast4}` : ''}
          </Row>
          <Row label="Charge">
            {money(facts.amountCents)} on {facts.chargedOn || 'unknown date'} for {item} · {facts.chargeId}
          </Row>
          <Row label="Statement descriptor">{facts.statementDescriptor || '-'}</Row>
          {stay && (
            <Row label="Stay">
              {stay.guestName || 'Guest'}, {stay.checkIn} to {stay.checkOut}
              {stay.nights ? ` (${stay.nights} nights)` : ''} · {stay.channel || 'Direct'} · {stay.confirmationCode || stay.reservationId}
            </Row>
          )}
          <Row label="Dispute">
            {facts.dispute
              ? `${money(facts.dispute.disputedCents)} · ${facts.dispute.reason || 'no reason'}${facts.dispute.networkCode ? ` (network code ${facts.dispute.networkCode})` : ''} · ${facts.dispute.status || ''}`
              : 'Could not be read from Stripe. Pick the reason below.'}
          </Row>
        </tbody>
      </table>

      {unread.length > 0 && (
        <p className="no-print" style={{ color: 'var(--signal)', fontSize: 13, marginTop: 12 }}>
          Could not read {unread.join('; ')}. The packet shows what it has; nothing missing is guessed.
        </p>
      )}

      <h2 style={h2}>What to prove</h2>
      <p style={{ margin: '0 0 8px' }}>
        <strong>What the bank is asking:</strong> {playbook.bankAsks}
      </p>
      <p className="no-print" style={{ ...quiet, margin: '0 0 12px' }}>
        In Stripe, answer &ldquo;Why should you win?&rdquo; with <strong>{playbook.winningReason}</strong>.
      </p>
      <ul className="no-print" style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
        {playbook.items.map((i) => (
          <li key={i.key} style={{ marginBottom: 4 }}>
            {i.proves} <span style={quiet}>Stripe: {i.slot.replace(/_/g, ' ')}</span>
          </li>
        ))}
      </ul>

      {/* The reason itself is picked on the hero line. Only the two reasons
          that turn on other payments need anything typed here. */}
      {SEPARATE_PURCHASE.includes(kind) && (
        <form method="get" className="no-print" style={{ marginTop: 20, display: 'grid', gap: 10, maxWidth: 720 }}>
          <input type="hidden" name="kind" value={kind} />
          <label style={{ fontSize: 13 }}>
            Other payments for this stay, one per line: method, amount, date, reference
            <textarea
              name="paid"
              defaultValue={paidText}
              rows={3}
              placeholder={"cashiers check, $12,400.00, 2026-07-08, check 1001"}
              style={{ display: 'block', width: '100%', marginTop: 4, padding: 8, fontFamily: 'var(--font-mono)', fontSize: 13 }}
            />
            <span style={quiet}>
              Methods: card, check, cashiers check, wire, ach, booking site, cash, other.
              {stay?.guestyTotalPaidCents != null && ` Guesty records ${money(stay.guestyTotalPaidCents)} paid on this reservation.`}
            </span>
          </label>
          <div>
            <button type="submit" className={buttonClass('secondary', 'sm')}>
              Apply
            </button>
          </div>
          {other.errors.length > 0 && (
            <ul style={{ color: 'var(--signal)', fontSize: 13, margin: 0, paddingLeft: 18 }}>
              {other.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </form>
      )}

      {recon && (
        <>
          <h2 style={h2}>The folio and every payment</h2>
          <p className="no-print" style={{ color: STRENGTH_WORDS[recon.strength].color, fontWeight: 600, margin: '0 0 12px' }}>
            {STRENGTH_WORDS[recon.strength].label}
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                {['Line', 'Amount', 'Paid by'].map((h) => (
                  <th key={h} className="eyebrow" style={{ ...cell, color: 'var(--ink-3)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recon.rows.map((r, i) => (
                <tr key={`${r.label}-${i}`}>
                  <td style={cell}>{r.label}</td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>{money(r.cents)}</td>
                  <td style={cell}>{r.paidBy}</td>
                </tr>
              ))}
              <tr>
                <td style={{ ...cell, fontWeight: 600 }}>Folio total</td>
                <td style={{ ...cell, fontWeight: 600 }}>{money(recon.folioCents)}</td>
                <td style={cell}>Paid by other means: {money(recon.otherPaidCents)}</td>
              </tr>
            </tbody>
          </table>

          {recon.forBank.length > 0 && (
            <>
              <h3 style={{ ...h2, fontSize: 17, margin: '24px 0 8px' }}>For the bank</h3>
              <p className="no-print" style={{ ...quiet, margin: '0 0 8px' }}>
                Paste into the duplicate charge explanation in Stripe.
              </p>
              <div style={{ border: '1px solid var(--rule)', padding: 14, fontSize: 14, lineHeight: 1.55 }}>
                {recon.forBank.map((s) => (
                  <p key={s} style={{ margin: '0 0 8px' }}>
                    {s}
                  </p>
                ))}
              </div>
            </>
          )}

          {recon.gaps.length > 0 && (
            <div className="no-print">
              <h3 style={{ ...h2, fontSize: 17, margin: '24px 0 8px', color: 'var(--signal)' }}>Before you submit</h3>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                {recon.gaps.map((g) => (
                  <li key={g} style={{ marginBottom: 4 }}>
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {SEPARATE_PURCHASE.includes(kind) ? null : !stay ? (
        <>
          <h2 style={h2}>The stay</h2>
          <p style={quiet}>
            Helm could not tie this charge to a reservation. Find the stay in Guesty and attach its confirmation,
            the policy the guest accepted and the thread.
          </p>
        </>
      ) : stayEv && (
        <>
          <h2 style={h2}>The stay</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <tbody>
              {stayEv.rows.map((r) => (
                <Row key={r.label} label={r.label}>
                  {r.value}
                </Row>
              ))}
              {record?.agreement?.driveUrl && (
                <Row label="Signed copy">
                  <a href={record.agreement.driveUrl} style={{ color: 'var(--tide-deep)' }}>
                    In Helm Records
                  </a>
                  <span className="no-print" style={quiet}> (attach the PDF)</span>
                </Row>
              )}
            </tbody>
          </table>
          {stayEv.forBank.length > 0 && (
            <>
              <h3 style={{ ...h2, fontSize: 17, margin: '24px 0 8px' }}>For the bank</h3>
              <p className="no-print" style={{ ...quiet, margin: '0 0 8px' }}>
                Paste into the explanation in Stripe.
              </p>
              <div style={{ border: '1px solid var(--rule)', padding: 14, fontSize: 14, lineHeight: 1.55 }}>
                {stayEv.forBank.map((s) => (
                  <p key={s} style={{ margin: '0 0 8px' }}>
                    {s}
                  </p>
                ))}
              </div>
            </>
          )}
          {stayEv.gaps.length > 0 && (
            <div className="no-print">
              <h3 style={{ ...h2, fontSize: 17, margin: '24px 0 8px', color: 'var(--signal)' }}>Before you submit</h3>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                {stayEv.gaps.map((g) => (
                  <li key={g} style={{ marginBottom: 4 }}>
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <h2 style={h2}>How the charge was agreed</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <tbody>
          <Row label="Payment page item">{facts.item || '-'}</Row>
          {link && (
            <>
              <Row label="Link created">
                {when(link.created_at)}
                {link.created_by ? ` by ${link.created_by}` : ''} ({link.source === 'helm' ? 'Helm' : 'guest messaging'})
              </Row>
              {link.sent_at && <Row label="Sent to guest">{when(link.sent_at)}</Row>}
              {link.sms_body && <Row label="Text sent with the link">{link.sms_body}</Row>}
              {link.paid_at && <Row label="Paid">{when(link.paid_at)}</Row>}
            </>
          )}
          <Row label="Approval text beside Pay">{facts.approvalText || 'None (links before 2026-10-20 carried none)'}</Row>
          <Row label="Terms accepted at checkout">
            {facts.termsAccepted === true ? 'Yes' : facts.termsAccepted === false ? 'No' : 'Not asked'}
          </Row>
          {facts.refunds.map((r, i) => (
            <Row key={i} label="Refund on this charge">
              {money(r.cents)} on {r.date || 'unknown date'}
              {r.note ? ` (${r.note})` : ''}
            </Row>
          ))}
        </tbody>
      </table>

      <h2 style={h2}>The guest&apos;s messages</h2>
      {threadCoverage?.complete === false && (
        <p className="no-print" style={{ ...quiet, color: 'var(--signal)', margin: '0 0 8px' }}>
          {incompleteThreadNote(threadCoverage)}
        </p>
      )}
      {flagged === null ? (
        <p style={quiet}>The conversation could not be read. Export the thread from Guesty and attach it.</p>
      ) : flagged.length === 0 ? (
        <p style={quiet}>
          No message names this charge, its amount or a refund{showsComplaints ? ', and the guest raised no complaint' : ''}.
          Search the thread by hand before submitting.
        </p>
      ) : (
        <>
          <p className="no-print" style={{ ...quiet, margin: '0 0 8px' }}>
            Messages naming this charge or its amount, every mention of a refund
            {showsComplaints ? ', and every complaint or cancellation from the guest' : ''}. Quote the guest&apos;s
            agreement; make sure no message promised more than was refunded.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <tbody>
              {flagged.map((m, i) => (
                <tr key={i}>
                  <td style={{ ...cell, whiteSpace: 'nowrap', width: 170 }}>
                    {when(m.at)}
                    <div style={quiet}>{m.who}</div>
                  </td>
                  <td style={cell}>
                    {m.body}
                    {m.fromLog && (
                      <div className="no-print" style={{ ...quiet, marginTop: 4 }}>
                        From the concierge&apos;s record; Guesty no longer serves this message
                      </div>
                    )}
                    {m.complaint && showsComplaints && (
                      <div className="no-print eyebrow" style={{ color: 'var(--signal)', marginTop: 4 }}>
                        Complaint or cancellation
                      </div>
                    )}
                    {m.mentionsRefund && (
                      <div className="no-print eyebrow" style={{ color: 'var(--signal)', marginTop: 4 }}>
                        Mentions a refund
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Shell>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <td className="eyebrow" style={{ ...cell, color: 'var(--ink-3)', width: 190, whiteSpace: 'nowrap' }}>
        {label}
      </td>
      <td style={cell}>{children}</td>
    </tr>
  );
}

function Shell({ home, reason, children }: { home: string; reason?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <div className="no-print">
        <HelmMasthead />
        <FinancialsTabs current="payments" />
      </div>
      <HelmHero
        plain
        eyebrow={`Dispute packet · ${home}`}
        title="Dispute evidence"
        line="What this dispute must prove, from Helm's own records."
        belowDescription={reason ? <div className="no-print" style={{ marginTop: 12 }}>{reason}</div> : null}
      />
      <section className="max-w-[1100px] mx-auto px-10 w-full" style={{ paddingBottom: 56 }}>
        {children}
      </section>
      <div className="no-print">
        <HelmFooter module="Dispute packet" right="Read-only · nothing is sent to Stripe" />
      </div>
    </div>
  );
}
