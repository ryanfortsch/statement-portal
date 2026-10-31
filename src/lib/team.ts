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
 * `countersign`: signs staff documents (offer letters) for Rising Tide STR,
 * LLC; their name prints on the employer's signature line. `staff_copy`:
 * copied on every staff document email (the signing link and the signed copy).
 * `dispatch`: plans who goes where: names someone else on a walk, takes
 * someone else off one, and creates, publishes or hands out a Field packet.
 * Ryan and Dotti (2026-10-30; Ryan runs the company, so he holds every
 * duty's authority); `hasDuty` is the gate, so moving it is one line here.
 * Notices resolve through `src/lib/team-recipients.ts`; nothing in the app
 * should name a teammate's inbox directly.
 */
export type TeamDuty = 'field_pay' | 'creative' | 'countersign' | 'staff_copy' | 'dispatch';

export type TeamMember = {
  email: string;        // canonical id
  name: string;         // first + last
  short: string;        // first name, used in pills/badges
  initials: string;     // 1-2 chars for the avatar
  /** The person's colour on the week grid's marks, so two sets of
   *  initials never read as one hand. Presentation only. */
  hue?: string;
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
    hue: '#0b2545',
    role: 'principal',
    access: 'owner',
    active: true,
    duties: ['field_pay', 'countersign', 'dispatch'],
  },
  {
    email: 'allie@risingtidestr.com',
    name: 'Allie O\'Brien',
    short: 'Allie',
    initials: 'AO',
    hue: '#2f6f6a',
    role: 'operations',
    access: 'owner',
    active: true,
    duties: ['staff_copy'],
  },
  {
    email: 'dotti@risingtidestr.com',
    name: 'Dotti Maguire',
    short: 'Dotti',
    initials: 'DM',
    hue: '#6b3a6b',
    role: 'principal',
    access: 'owner',
    active: true,
    duties: ['creative', 'dispatch'],
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
    hue: '#1c4a6b',
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

/** Whether a login holds a duty on the roster (its Workspace email only). */
export function hasDuty(email: string | null | undefined, duty: TeamDuty): boolean {
  return (getTeamMember(email)?.duties ?? []).includes(duty);
}

/**
 * The teammate behind ANY address they have worked under: their Workspace
 * email, or a Field contractor address listed in `fieldEmails`. For names,
 * initials and colours only. Roles still resolve through getTeamMember,
 * which reads the Workspace email alone.
 */
export function teamMemberForAnyEmail(email: string | null | undefined): TeamMember | null {
  if (!email) return null;
  const e = email.toLowerCase().trim();
  return (
    TEAM_MEMBERS.find((m) => m.email.toLowerCase() === e) ??
    TEAM_MEMBERS.find((m) => (m.fieldEmails ?? []).some((f) => f.toLowerCase() === e)) ??
    null
  );
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

/** The person's mark colour on the week grid; a teammate not on the roster
 *  (a one-off address) reads in the quiet ink. */
export function hueForEmail(email: string | null | undefined): string {
  return getTeamMember(email)?.hue ?? '#51677d';
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
