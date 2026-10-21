import { getTeamMember } from './team.ts';
import { dutyEmails } from './team-recipients.ts';

/**
 * Who a staff document's emails come from and copy, in one place, so the
 * page can show it before Send and the sender cannot drift from it. Every
 * email speaks as the countersigner (the `countersign` duty in team.ts,
 * Ryan): his name in the From line and the sign-off, replies to his inbox,
 * and a copy to him, whoever pressed the button. It is sent FROM his own
 * address (Dotti, 2026-10-21: "send from ryan, not onboarding generic
 * email"): Resend sends as any address on the verified domain, so his
 * address is used whenever it shares the domain of RESEND_FROM_EMAIL, and
 * the generic sender is only the fallback. Resend does not file the email in
 * his Gmail Sent folder; the copy to him is his record. Whoever holds the
 * `staff_copy` duty (Allie, 2026-10-21) is copied too. The address itself is the
 * verified Resend sender (RESEND_FROM_EMAIL), the same one the owner
 * contract and onboarding mail use. Pure; the `.ts` extensions let Node's
 * test runner import it.
 */
export type StaffDocumentEnvelope = {
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  cc: string[];
  signOff: string;
};

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

export function staffDocumentEnvelope(verifiedFrom: string): StaffDocumentEnvelope {
  const by = dutyEmails('countersign')[0] ?? null;
  const name = getTeamMember(by)?.name ?? 'Rising Tide';
  const ownAddress = !!by && domainOf(by) === domainOf(verifiedFrom);
  return {
    fromName: by ? name : 'Rising Tide',
    fromEmail: ownAddress && by ? by : verifiedFrom,
    replyTo: by,
    cc: [...new Set([...(by ? [by] : []), ...dutyEmails('staff_copy')])],
    signOff: name,
  };
}

/** The verified sending address, with the same fallback the other senders use. */
export function staffDocumentFromEmail(): string {
  return process.env.RESEND_FROM_EMAIL || 'allie@risingtidestr.com';
}
