/**
 * Rising Tide team roster — the humans who can own work in Helm.
 *
 * A constant for now (small team, low churn). Once we onboard contractors
 * or add roles the picker should drive off, lift this into Supabase
 * (`team_members` table). The TeamPicker component is built so the
 * shape never has to change: row by row.
 *
 * Email is the stable identity used everywhere else in Helm
 * (work_slips.assigned_to_email, tasks.assigned_to_email, comment
 * authors, etc.) so that's the picker's return value.
 */

export type TeamMemberRole = 'principal' | 'operations' | 'inspector' | 'contractor';

/**
 * What a login may open. `owner` sees everything; `staff` sees operations
 * and not money (statements, books, forecast, contracts, prospects, owner
 * messaging, contractor pay). Any @risingtidestr.com sign-in that is not
 * listed here at all is staff. See `src/lib/helm-access.ts`.
 */
export type TeamAccess = 'owner' | 'staff';

/**
 * A duty a notice is addressed to, independent of who holds it today.
 * `field_pay`: approves and pays Field packets and answers contractor
 * questions. `creative`: runs the creative program (shoots, view counts).
 * Notices resolve through `src/lib/team-recipients.ts`; nothing in the app
 * should name a teammate's inbox directly.
 */
export type TeamDuty = 'field_pay' | 'creative';

export type TeamMember = {
  email: string;        // canonical id
  name: string;         // first + last
  short: string;        // first name, used in pills/badges
  initials: string;     // 1-2 chars for the avatar
  role: TeamMemberRole;
  access: TeamAccess;
  active: boolean;      // false = hidden from picker but old assignments still resolve
  duties?: TeamDuty[];
  /**
   * First day on the team, YYYY-MM-DD. Before it the member is listed, so
   * an assignment made today resolves to their name, but receives no
   * notices: the ops digest and contractor threads reach them from this
   * day, not from the day the row was added.
   */
  starts?: string;
  /**
   * Other addresses this person has worked under on the Field roster (a
   * contractor record from before they joined the team). Nobody approves
   * their own work: `isOwnWork` refuses a packet awarded to any of these.
   */
  fieldEmails?: string[];
};

export const TEAM_MEMBERS: TeamMember[] = [
  {
    email: 'ryan@risingtidestr.com',
    name: 'Ryan Fortsch',
    short: 'Ryan',
    initials: 'RF',
    role: 'principal',
    access: 'owner',
    active: true,
    duties: ['field_pay'],
  },
  {
    email: 'allie@risingtidestr.com',
    name: 'Allie O\'Brien',
    short: 'Allie',
    initials: 'AO',
    role: 'operations',
    access: 'owner',
    active: true,
  },
  {
    email: 'dotti@risingtidestr.com',
    name: 'Dotti Maguire',
    short: 'Dotti',
    initials: 'DM',
    role: 'principal',
    access: 'owner',
    active: true,
    duties: ['creative'],
  },
  // Operations Manager from 2026-11-01. Staff access: operations, not
  // money (see helm-access.ts). Listed ahead of her Workspace seat so an
  // assignment made today resolves to her name the day she signs in. Her
  // contractor record (delaneyjordan@outlook.com) stays on the Field
  // roster for the history behind it, flagged employee on her start date.
  {
    email: 'delaney@risingtidestr.com',
    name: 'Delaney Jordan',
    short: 'Delaney',
    initials: 'DJ',
    role: 'operations',
    access: 'staff',
    active: true,
    starts: '2026-11-01',
    fieldEmails: ['delaneyjordan@outlook.com'],
  },
];

export function getTeamMember(email: string | null | undefined): TeamMember | null {
  if (!email) return null;
  const e = email.toLowerCase().trim();
  return TEAM_MEMBERS.find((m) => m.email.toLowerCase() === e) ?? null;
}

/** Active members suitable for an assign-to picker (filters role if needed). */
export function assignableTeam(): TeamMember[] {
  return TEAM_MEMBERS.filter((m) => m.active);
}

/**
 * Display label for an assigned email — uses the team short name if the
 * email is on the roster, falls back to the local part of the address
 * otherwise (handles contractors / one-offs).
 */
export function displayNameForEmail(email: string | null | undefined): string {
  if (!email) return 'Unassigned';
  const m = getTeamMember(email);
  if (m) return m.short;
  return email.split('@')[0];
}

/**
 * The byline on what the whole team reads, the Playbook: an owner's edit
 * reads as Rising Tide, a staff member's under their own name. Staff read
 * Ryan or Rising Tide, never Dotti (Dotti, 2026-10-07), and naming one
 * owner over another tells a reader nothing they act on.
 */
export function teamBylineForEmail(email: string | null | undefined): string {
  const m = getTeamMember(email);
  if (!email || m?.access === 'owner') return 'Rising Tide';
  return displayNameForEmail(email);
}

/** 1-2 char initials for the avatar — same fallback rules as displayName. */
export function initialsForEmail(email: string | null | undefined): string {
  if (!email) return '·';
  const m = getTeamMember(email);
  if (m) return m.initials;
  const local = email.split('@')[0];
  return local.slice(0, 2).toUpperCase();
}

/**
 * True when the packet's contractor is the person approving it: the same
 * address, or one of the approver's own `fieldEmails`. Staff approve
 * submitted Field work (2026-10-20); nobody approves their own.
 */
export function isOwnWork(approverEmail: string | null | undefined, contractorEmail: string | null | undefined): boolean {
  const c = (contractorEmail ?? '').toLowerCase().trim();
  const a = (approverEmail ?? '').toLowerCase().trim();
  if (!c || !a) return false;
  if (c === a) return true;
  return (getTeamMember(a)?.fieldEmails ?? []).some((e) => e.toLowerCase().trim() === c);
}
