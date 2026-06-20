/**
 * Field email notifications (Resend). Plain, on-brand transactional emails:
 * the invite link, a claim confirmation, and an office heads-up when a packet
 * is submitted. SMS via Quo is a Phase 2 add.
 */
import 'server-only';
import { sendTransactionalViaResend } from '@/lib/resend';
import { dollars } from '@/lib/field-types';
import type { ContractorRow, PacketRow } from '@/lib/field-types';

const FROM_NAME = 'Rising Tide Field';
const OFFICE_CC = 'allie@risingtidestr.com';

export function fieldBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.AUTH_URL ||
    'https://helm.risingtidestr.com'
  ).replace(/\/$/, '');
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

export async function sendInviteEmail(contractor: ContractorRow): Promise<boolean> {
  const link = `${fieldBaseUrl()}/field/${contractor.portal_token}`;
  const html = shell(`
    <h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px;margin:0 0 14px;">You're invited to inspect with Rising Tide</h1>
    <p>Hi ${contractor.full_name.split(' ')[0]}, you've been invited to pick up inspection work near Gloucester. Open your portal to set up your account, then browse and claim paid inspection packets.</p>
    ${btn(link, 'Open my portal')}
    <p style="font-size:12px;color:#7a8a90;">This link is personal to you. Please don't forward it.</p>
  `);
  return sendTransactionalViaResend({
    to: contractor.email,
    subject: 'Your Rising Tide Field portal',
    fromName: FROM_NAME,
    html,
    text: `Open your Rising Tide Field portal to claim inspection work: ${link}`,
  });
}

export async function sendClaimConfirmation(
  contractor: ContractorRow,
  packet: PacketRow,
): Promise<boolean> {
  const link = `${fieldBaseUrl()}/field/packet/${packet.id}`;
  const html = shell(`
    <h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px;margin:0 0 14px;">You claimed ${packet.title}</h1>
    <p>You're booked for <strong>${packet.visit_date}</strong>. Pay for the packet is <strong>${dollars(packet.posted_price_cents)}</strong>. Open the packet for the route, each property's window, and entry details.</p>
    ${btn(link, 'View packet')}
  `);
  return sendTransactionalViaResend({
    to: contractor.email,
    subject: `Confirmed: ${packet.title} on ${packet.visit_date}`,
    fromName: FROM_NAME,
    cc: OFFICE_CC,
    html,
    text: `You claimed ${packet.title} on ${packet.visit_date} for ${dollars(packet.posted_price_cents)}. ${link}`,
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
