import { getTeamMember } from './team.ts';
import { dutyEmails } from './team-recipients.ts';

/**
 * Who a staff document's emails come from and copy, in one place, so the
 * page can show it before Send and the sender cannot drift from it. Every
 * email speaks as the countersigner (the `countersign` duty in team.ts,
 * Ryan): his name in the From line and the sign-off, replies to his inbox,
 * and a copy to him, whoever pressed the button. Whoever holds the
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

export function staffDocumentEnvelope(fromEmail: string): StaffDocumentEnvelope {
  const by = dutyEmails('countersign')[0] ?? null;
  const name = getTeamMember(by)?.name ?? 'Rising Tide';
  return {
    fromName: by ? `${name}, Rising Tide` : 'Rising Tide',
    fromEmail,
    replyTo: by,
    cc: [...new Set([...(by ? [by] : []), ...dutyEmails('staff_copy')])],
    signOff: name,
  };
}

/** The verified sending address, with the same fallback the other senders use. */
export function staffDocumentFromEmail(): string {
  return process.env.RESEND_FROM_EMAIL || 'allie@risingtidestr.com';
}
