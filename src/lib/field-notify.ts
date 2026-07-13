/**
 * Field email notifications (Resend). Plain, on-brand transactional emails:
 * the invite link, a claim confirmation, and an office heads-up when a packet
 * is submitted. SMS via Quo is a Phase 2 add.
 */
import 'server-only';
import { sendTransactionalViaResend as baseTransactional } from '@/lib/resend';
import { sendMessage, listPhoneNumbers, normalizePhone } from '@/lib/quo';
import { haversineMiles } from '@/lib/proximity';
import { loadPacketDetail, getContractorReliability } from '@/lib/field-packets';
import { fieldDb } from '@/lib/field-db';
import { dollars, fmtVisitTime, packetHeadline } from '@/lib/field-types';
import type { ContractorRow, PacketRow } from '@/lib/field-types';

const FROM_NAME = 'Rising Tide Field';
const OFFICE_CC = 'allie@risingtidestr.com';

// All Field email goes out from a dedicated Field sender (if FIELD_FROM_EMAIL is
// set, else the default Resend sender) with replies routed to the office —
// otherwise contractor replies land in whatever inbox the default sender uses.
// Wraps the base sender so no call site has to repeat it.
function sendTransactionalViaResend(args: Parameters<typeof baseTransactional>[0]): Promise<boolean> {
  return baseTransactional({ fromEmail: process.env.FIELD_FROM_EMAIL || undefined, replyTo: OFFICE_CC, ...args });
}

export function fieldBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.AUTH_URL ||
    'https://helm.risingtidestr.com'
  ).replace(/\/$/, '');
}

/** An AUTHENTICATED deep-link to a packet: routes through the magic-link token
 *  so it works even from a fresh browser with no session cookie yet (Quo's
 *  in-app browser, a new phone). The token route logs them in, then bounces to
 *  the packet. A bare /field/packet/<id> would dead-end on the logged-out
 *  welcome page. */
function packetLink(portalToken: string, packetId: string): string {
  return `${fieldBaseUrl()}/field/${portalToken}?next=${encodeURIComponent(`/field/packet/${packetId}`)}`;
}

function shell(body: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#1e2e34;line-height:1.6;">
    <div style="font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:#c85a3a;font-weight:600;margin-bottom:8px;">Rising Tide Field</div>
    ${body}
    <p style="font-size:12px;color:#7a8a90;margin-top:28px;border-top:1px solid #e6ded2;padding-top:14px;">Rising Tide STR · Gloucester, MA · Questions? Reply to this email or call (978) 865-2387.</p>
  </div>`;
}

function btn(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#1e2e34;color:#faf7f1;text-decoration:none;font-size:13px;font-weight:600;letter-spacing:.06em;padding:12px 22px;margin:8px 0;">${label}</a>`;
}

/** Trade-appropriate noun for emails/SMS (so a cleaner isn't told to "inspect"). */
function tradeWord(trade: string | null | undefined): string {
  if (trade === 'maintenance') return 'maintenance';
  if (trade === 'cleaning') return 'cleaning';
  if (trade === 'creative') return 'content';
  return 'inspection';
}

export async function sendInviteEmail(contractor: ContractorRow): Promise<boolean> {
  const link = `${fieldBaseUrl()}/field/${contractor.portal_token}`;
  const word = tradeWord(contractor.trade);
  const creative = contractor.trade === 'creative';
  const secondLine = creative
    ? "you've been invited to create content for Rising Tide. Open your portal to set up your account (W-9 + agreement), and we'll line up your first shoot and assets from there."
    : `you've been invited to pick up ${word} work near Gloucester. Open your portal to set up your account, then browse and claim paid packets.`;
  const html = shell(`
    <h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px;margin:0 0 14px;">You're invited to ${word} work with Rising Tide</h1>
    <p>Hi ${contractor.full_name.split(' ')[0]}, ${secondLine}</p>
    ${btn(link, 'Open my portal')}
    <p style="font-size:12px;color:#7a8a90;margin:6px 0 0;">Or paste this link into your browser:<br><a href="${link}" style="color:#1e2e34;word-break:break-all;">${link}</a></p>
    <p style="font-size:12px;color:#7a8a90;">This link is personal to you. Please don't forward it.</p>
  `);
  return sendTransactionalViaResend({
    to: contractor.email,
    subject: 'Your Rising Tide Field portal',
    fromName: FROM_NAME,
    html,
    text: creative
      ? `Open your Rising Tide Field portal to get started: ${link}`
      : `Open your Rising Tide Field portal to claim ${word} work: ${link}`,
  });
}

/** Contractor receipt when their submitted packet passes office review. */
export async function sendApprovedEmail(
  contractor: Pick<ContractorRow, 'email' | 'full_name' | 'portal_token'>,
  packet: { title: string; totalCents?: number; bonusCents?: number; bonusReason?: string | null },
): Promise<boolean> {
  const bonus = packet.bonusCents ?? 0;
  const escReason = (packet.bonusReason ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const bonusLine =
    bonus > 0
      ? `<p style="border-left:3px solid #c85a3a;padding:10px 14px;background:#faf3ec;"><strong>Plus a ${dollars(bonus)} bonus</strong>${escReason ? ` for ${escReason}` : ''}. ${packet.totalCents ? `Total queued: <strong>${dollars(packet.totalCents)}</strong>.` : ''}</p>`
      : '';
  const html = shell(`
    <h1 style="font-family:Georgia,serif;font-weight:400;font-size:24px;margin:0 0 14px;">Approved — payment queued</h1>
    <p>Nice work — <strong>${packet.title}</strong> passed review. Your payment is queued; you'll get a receipt the moment it's sent.</p>
    ${bonusLine}
    ${btn(`${fieldBaseUrl()}/field/${contractor.portal_token}`, 'See open work')}
  `);
  return sendTransactionalViaResend({
    to: contractor.email,
    subject: `Approved: ${packet.title}`,
    fromName: FROM_NAME,
    html,
    text: `${packet.title} was approved — your payment is queued.`,
  });
}

/** Contractor notice when a packet they held is released/reassigned away. */
export async function sendReassignedEmail(
  contractor: Pick<ContractorRow, 'email' | 'full_name' | 'portal_token'>,
  packet: Pick<PacketRow, 'title'>,
): Promise<boolean> {
  const html = shell(`
    <h1 style="font-family:Georgia,serif;font-weight:400;font-size:24px;margin:0 0 14px;">A packet came off your plate</h1>
    <p><strong>${packet.title}</strong> was released back to the team, so you're no longer on it. No worries — more work is always posting.</p>
    ${btn(`${fieldBaseUrl()}/field/${contractor.portal_token}`, 'See open work')}
  `);
  return sendTransactionalViaResend({
    to: contractor.email,
    subject: `Released: ${packet.title}`,
    fromName: FROM_NAME,
    html,
    text: `${packet.title} was released back to the team; you're no longer on it.`,
  });
}

/** Contractor notice when the office RAISES the agreed price on a packet they
 *  already hold (scope grew, etc.). Only ever an increase, so it's good news. */
export async function sendEstimateRaisedEmail(
  contractor: Pick<ContractorRow, 'email' | 'full_name' | 'portal_token'>,
  packet: Pick<PacketRow, 'id' | 'title' | 'posted_price_cents'>,
  oldCents: number,
  reason?: string | null,
): Promise<boolean> {
  const link = packetLink(contractor.portal_token, packet.id);
  const escReason = (reason ?? '').trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = shell(`
    <h1 style="font-family:Georgia,serif;font-weight:400;font-size:24px;margin:0 0 14px;">Your pay went up on ${packet.title}</h1>
    <p>Good news — we raised the estimate on <strong>${packet.title}</strong> from ${dollars(oldCents)} to <strong>${dollars(packet.posted_price_cents)}</strong>${escReason ? ` — ${escReason}` : ''}. Same job, more pay; nothing else changes, still confirmed after your visit.</p>
    ${btn(link, 'View packet')}
  `);
  return sendTransactionalViaResend({
    to: contractor.email,
    subject: `Pay raised to ${dollars(packet.posted_price_cents)}: ${packet.title}`,
    fromName: FROM_NAME,
    cc: OFFICE_CC,
    html,
    text: `Good news — we raised your pay on ${packet.title} from ${dollars(oldCents)} to ${dollars(packet.posted_price_cents)}${reason && reason.trim() ? ` — ${reason.trim()}` : ''}. ${link}`,
  });
}

export async function sendClaimConfirmation(
  contractor: ContractorRow,
  packet: PacketRow,
): Promise<boolean> {
  const link = packetLink(contractor.portal_token, packet.id);
  const html = shell(`
    <h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px;margin:0 0 14px;">You claimed ${packet.title}</h1>
    <p>You're booked for <strong>${packet.visit_date}${fmtVisitTime(packet.visit_time) ? ` at ${fmtVisitTime(packet.visit_time)}` : ''}</strong>${packet.complete_by ? `, to be <strong>completed by ${fmtVisitTime(packet.complete_by)}</strong>` : ''}. Estimated pay is <strong>${dollars(packet.posted_price_cents)}</strong>, confirmed after your visit. Open the packet for the route, each property's window, and entry details.</p>
    ${btn(link, 'View packet')}
  `);
  return sendTransactionalViaResend({
    to: contractor.email,
    subject: `Confirmed: ${packet.title} on ${packet.visit_date}${fmtVisitTime(packet.visit_time) ? ` at ${fmtVisitTime(packet.visit_time)}` : ''}`,
    fromName: FROM_NAME,
    cc: OFFICE_CC,
    html,
    text: `You claimed ${packet.title} on ${packet.visit_date}. Estimated pay ${dollars(packet.posted_price_cents)}, confirmed after your visit. ${link}`,
  });
}

export async function sendContractorOnboardedEmail(contractor: ContractorRow): Promise<boolean> {
  const html = shell(`
    <h1 style="font-family:Georgia,serif;font-weight:400;font-size:24px;margin:0 0 14px;">New inspector signed up: ${contractor.full_name}</h1>
    <p>${contractor.full_name} (${contractor.email}${contractor.phone ? `, ${contractor.phone}` : ''}) finished setup. Two things before they can claim work:</p>
    <p>1. <strong>Run their background check</strong>, then mark it <strong>cleared</strong> on the roster (we send people into owners' homes, so claiming is gated on it).<br/>2. Collect their W-9 into QuickBooks and hit <strong>mark W-9 on file</strong> so 1099 tracking stays current.</p>
    ${btn(`${fieldBaseUrl()}/operations/contractors`, 'Open roster')}
  `);
  return sendTransactionalViaResend({
    to: OFFICE_CC,
    subject: `Field: ${contractor.full_name} signed up — needs background check`,
    fromName: FROM_NAME,
    html,
    text: `${contractor.full_name} finished setup. Run their background check and mark it cleared on the roster (claiming is gated on it), and collect their W-9.`,
  });
}

export async function sendPaidEmail(
  contractor: ContractorRow,
  amountCents: number,
  opts: { method?: string | null; reference?: string | null } = {},
): Promise<boolean> {
  const via = opts.method ? ` via <strong>${opts.method}</strong>` : '';
  const ref = opts.reference ? `<p style="font-size:13px;color:#7a8a90;">Reference: ${opts.reference}</p>` : '';
  const html = shell(`
    <h1 style="font-family:Georgia,serif;font-weight:400;font-size:24px;margin:0 0 14px;">You've been paid</h1>
    <p>Rising Tide just recorded <strong>${dollars(amountCents)}</strong> paid to you${via} for completed work. Thanks for the great work — more packets are always posting.</p>
    ${ref}
    ${btn(`${fieldBaseUrl()}/field/${contractor.portal_token}`, 'See open work')}
  `);
  return sendTransactionalViaResend({
    to: contractor.email,
    subject: `Payment recorded — ${dollars(amountCents)}`,
    fromName: FROM_NAME,
    html,
    text: `Rising Tide recorded ${dollars(amountCents)} paid to you${opts.method ? ` via ${opts.method}` : ''}${opts.reference ? ` (ref ${opts.reference})` : ''}.`,
  });
}

async function resolveQuoFrom(): Promise<string | null> {
  if (!process.env.QUO_API_KEY) return null;
  let from = process.env.QUO_FROM_NUMBER;
  if (!from) {
    try {
      const phones = await listPhoneNumbers();
      from = phones[0]?.number;
    } catch {
      return null;
    }
  }
  if (!from) return null;
  return from.startsWith('+') ? from : `+1${normalizePhone(from)}`;
}

/**
 * Text active inspectors when a packet publishes — "new work near you" — so
 * they don't have to keep refreshing the portal. Only contractors whose home
 * is within their service radius of the cluster are notified (those without a
 * home location get everything). No-op if Quo isn't configured.
 */
export async function notifyContractorsOfPacket(packetId: string): Promise<number> {
  const from = await resolveQuoFrom();
  if (!from) return 0;
  const packet = await loadPacketDetail(packetId);
  if (!packet || packet.status !== 'published') return 0;

  // Only text contractors of this packet's trade who can actually claim right
  // now — active, onboarded (agreement signed + W-9 on file), with a phone.
  // Texting someone a job they can't take is noise that erodes trust.
  const { data } = await fieldDb()
    .from('contractors')
    .select('id, full_name, phone, portal_token, home_lat, home_lng, service_radius_miles, status, trade')
    .eq('status', 'active')
    .eq('trade', packet.trade)
    .eq('w9_on_file', true)
    // Claim-eligible = check underway or cleared (matches canClaim), so a
    // pending-check contractor is pinged for new packets too.
    .in('background_check_status', ['cleared', 'pending'])
    .not('agreement_signed_at', 'is', null)
    .not('phone', 'is', null);
  const contractors = (data ?? []) as Array<
    Pick<ContractorRow, 'id' | 'full_name' | 'phone' | 'portal_token' | 'home_lat' | 'home_lng' | 'service_radius_miles'>
  >;

  // Ping the most reliable inspectors first (proven on-time + low-rework get
  // the head start on a first-come claim). New/unproven inspectors sort in the
  // middle, not last, so they still get a real shot to build a record.
  const reliability = await getContractorReliability();
  contractors.sort((a, b) => (reliability.get(b.id)?.score ?? 70) - (reliability.get(a.id)?.score ?? 70));

  const date = (() => {
    try {
      return new Date(`${packet.visit_date}T00:00:00`).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return packet.visit_date;
    }
  })();
  const when = fmtVisitTime(packet.visit_time) ? `${date} ${fmtVisitTime(packet.visit_time)}` : date;
  const headline = packetHeadline(packet);

  let sent = 0;
  for (const c of contractors) {
    if (!c.phone) continue;
    if (
      c.home_lat != null &&
      c.home_lng != null &&
      packet.centroid_lat != null &&
      packet.centroid_lng != null
    ) {
      const miles = haversineMiles(
        { lat: c.home_lat, lng: c.home_lng },
        { lat: packet.centroid_lat, lng: packet.centroid_lng },
      );
      if (miles > (c.service_radius_miles ?? 40)) continue;
    }
    const link = `${fieldBaseUrl()}/field/${c.portal_token}`;
    const to = c.phone.startsWith('+') ? c.phone : `+1${normalizePhone(c.phone)}`;
    const content = `Rising Tide Field: new work near you — ${headline}, ${when} · est. ${dollars(packet.posted_price_cents)}. Claim it: ${link}`;
    try {
      await sendMessage({ from, to, content });
      sent++;
    } catch {
      // swallow per-contractor send errors
    }
  }
  return sent;
}

/** Daily cron: re-ping inspectors about published packets whose claim
 *  deadline has arrived and are still unclaimed. Once per cron run, so no
 *  spam tracking needed. */
export async function renotifyDuePackets(): Promise<number> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const { data } = await fieldDb()
    .from('inspection_packets')
    .select('id')
    .eq('status', 'published')
    .lte('claim_deadline', `${today}T23:59:59`);
  let n = 0;
  for (const r of (data ?? []) as { id: string }[]) {
    const sent = await notifyContractorsOfPacket(r.id).catch(() => 0);
    if (sent) n++;
  }
  return n;
}

/** Tell the contractor the office bounced their packet back for fixes — the one
 *  state transition that REQUIRES contractor action, so it can't be silent. */
export async function sendChangesRequestedEmail(
  contractor: Pick<ContractorRow, 'email' | 'full_name' | 'portal_token'>,
  packet: Pick<PacketRow, 'id' | 'title'>,
  note: string,
): Promise<boolean> {
  const link = packetLink(contractor.portal_token, packet.id);
  const html = shell(`
    <h1 style="font-family:Georgia,serif;font-weight:400;font-size:24px;margin:0 0 14px;">Changes requested on ${packet.title}</h1>
    <p>The office needs a few fixes before this packet is approved${note ? `:</p><p style="border-left:3px solid #c85a3a;padding-left:12px;color:#1e2e34;">${note}` : ''}</p>
    <p>Re-do the flagged stops and submit again.</p>
    ${btn(link, 'Open packet')}
  `);
  return sendTransactionalViaResend({
    to: contractor.email,
    subject: `Changes requested: ${packet.title}`,
    fromName: FROM_NAME,
    html,
    text: `Changes requested on ${packet.title}${note ? `: ${note}` : ''}. Re-do the stops and submit again: ${link}`,
  });
}

/** Visit-day reminder: text contractors whose claimed packet is today. */
export async function remindClaimedVisitsToday(): Promise<number> {
  const from = await resolveQuoFrom();
  if (!from) return 0;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const { data } = await fieldDb()
    .from('inspection_packets')
    .select('id, title, awarded_contractor_id')
    .in('status', ['claimed', 'in_progress'])
    .eq('visit_date', today)
    .not('awarded_contractor_id', 'is', null);
  let sent = 0;
  for (const p of (data ?? []) as { id: string; title: string; awarded_contractor_id: string }[]) {
    const { data: c } = await fieldDb().from('contractors').select('phone, portal_token').eq('id', p.awarded_contractor_id).maybeSingle();
    const cc = c as { phone: string | null; portal_token: string } | null;
    if (!cc?.phone) continue;
    const to = cc.phone.startsWith('+') ? cc.phone : `+1${normalizePhone(cc.phone)}`;
    try {
      await sendMessage({ from, to, content: `Rising Tide Field: your visit is today — ${p.title}. ${packetLink(cc.portal_token, p.id)}` });
      sent++;
    } catch {
      // swallow per-contractor send errors
    }
  }
  return sent;
}

/** Morning digest to the office: what needs a human today. No-op (no email) if
 *  nothing is actionable, so it never becomes noise. */
export async function sendOfficeFieldDigest(): Promise<boolean> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 2);
  const soonStr = soon.toISOString().split('T')[0];

  const { data } = await fieldDb()
    .from('inspection_packets')
    .select('status, visit_date')
    .in('status', ['published', 'claimed', 'in_progress', 'submitted']);
  const rows = (data ?? []) as { status: string; visit_date: string }[];
  const outToday = rows.filter((p) => (p.status === 'claimed' || p.status === 'in_progress') && p.visit_date === today).length;
  // Same time-aware rule as the board: a claimed same-day packet only reads
  // "at risk" after 1 PM ET (an hour into the 12:00–2:45 window); before that
  // it's just today's upcoming work. Fully past days always count.
  const hourEt = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date()),
  );
  const atRisk = rows.filter(
    (p) => p.status === 'claimed' && (p.visit_date < today || (p.visit_date === today && hourEt >= 13)),
  ).length;
  const unclaimedSoon = rows.filter((p) => p.status === 'published' && p.visit_date >= today && p.visit_date <= soonStr).length;
  const submitted = rows.filter((p) => p.status === 'submitted').length;
  if (outToday + atRisk + unclaimedSoon + submitted === 0) return false;

  const line = (n: number, label: string) => (n > 0 ? `<li><strong>${n}</strong> ${label}</li>` : '');
  const html = shell(`
    <h1 style="font-family:Georgia,serif;font-weight:400;font-size:22px;margin:0 0 12px;">Field — today</h1>
    <ul style="padding-left:18px;margin:0 0 8px;">
      ${line(atRisk, 'claimed but not started (at risk)')}
      ${line(outToday, 'out today')}
      ${line(unclaimedSoon, 'unclaimed within 48h')}
      ${line(submitted, 'awaiting your approval')}
    </ul>
    ${btn(`${fieldBaseUrl()}/operations/packets`, 'Open the board')}
  `);
  return sendTransactionalViaResend({
    to: OFFICE_CC,
    subject: `Field today: ${atRisk ? `${atRisk} at risk · ` : ''}${submitted ? `${submitted} to approve · ` : ''}${unclaimedSoon} unclaimed soon`,
    fromName: FROM_NAME,
    html,
    text: `Field today — at risk: ${atRisk}, out today: ${outToday}, unclaimed within 48h: ${unclaimedSoon}, awaiting approval: ${submitted}.`,
  });
}

/** A contractor tapped "Send a note" in the portal. Goes to Ryan (cc office),
 *  with reply-to set to the contractor so Ryan can answer straight from his
 *  inbox, and their phone surfaced for a quick text back. */
export async function sendContractorQuestionEmail(
  contractor: Pick<ContractorRow, 'full_name' | 'email' | 'phone'>,
  message: string,
): Promise<boolean> {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safe = esc(message.trim().slice(0, 2000));
  const name = esc(contractor.full_name);
  const email = esc(contractor.email);
  const phone = contractor.phone ? esc(contractor.phone) : null;
  const first = esc(contractor.full_name.split(' ')[0]);
  const html = shell(`
    <h1 style="font-family:Georgia,serif;font-weight:400;font-size:24px;margin:0 0 6px;">Question from ${name}</h1>
    <p style="font-size:12px;color:#7a8a90;margin:0 0 16px;">${email}${phone ? ` &middot; ${phone}` : ''}</p>
    <p style="white-space:pre-wrap;font-size:15px;margin:0 0 18px;">${safe}</p>
    <p style="font-size:13px;color:#7a8a90;border-top:1px solid #e6ded2;padding-top:14px;">Reply to this email to answer ${first} directly${phone ? `, or text ${phone}` : ''}.</p>
  `);
  return sendTransactionalViaResend({
    to: 'ryan@risingtidestr.com',
    cc: OFFICE_CC,
    subject: `Field question from ${contractor.full_name}`,
    fromName: FROM_NAME,
    replyTo: contractor.email,
    html,
    text: `${contractor.full_name} (${contractor.email}${contractor.phone ? `, ${contractor.phone}` : ''}) asks:\n\n${message.trim()}`,
  });
}

export async function sendNewApplicantEmail(app: {
  full_name: string; email: string; phone: string | null; area: string | null;
  has_transport: boolean | null; source: string | null;
}): Promise<boolean> {
  const details = [
    `<strong>${app.full_name}</strong>`,
    app.email,
    app.phone || '',
    app.area ? `Based in ${app.area}` : '',
    app.has_transport != null ? `Vehicle: ${app.has_transport ? 'yes' : 'no'}` : '',
    app.source ? `Source: ${app.source}` : '',
  ].filter(Boolean).join(' · ');

  const html = shell(`
    <h1 style="font-family:Georgia,serif;font-weight:400;font-size:24px;margin:0 0 14px;">New Field applicant</h1>
    <p style="font-size:14px;">${details}</p>
    ${btn(`${fieldBaseUrl()}/operations/contractors/applicants`, 'Review in Helm')}
  `);
  return sendTransactionalViaResend({
    to: OFFICE_CC,
    subject: `New Field applicant: ${app.full_name}`,
    fromName: FROM_NAME,
    cc: 'ryan@risingtidestr.com',
    html,
    text: `New Field applicant: ${app.full_name} (${app.email}). Review at ${fieldBaseUrl()}/operations/contractors/applicants`,
  });
}

export async function sendPacketSubmittedEmail(
  contractor: ContractorRow,
  packet: PacketRow,
): Promise<boolean> {
  const html = shell(`
    <h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px;margin:0 0 14px;">Packet submitted for review</h1>
    <p><strong>${contractor.full_name}</strong> finished <strong>${packet.title}</strong> (${packet.visit_date}). Review the completed inspections in Helm before it counts as done.</p>
    ${btn(`${fieldBaseUrl()}/operations/packets/${packet.id}`, 'Review in Helm')}
  `);
  return sendTransactionalViaResend({
    to: OFFICE_CC,
    subject: `Field packet submitted: ${packet.title}`,
    fromName: FROM_NAME,
    cc: 'ryan@risingtidestr.com',
    html,
    text: `${contractor.full_name} submitted ${packet.title} (${packet.visit_date}) for review.`,
  });
}
