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

export type TeamMember = {
  email: string;        // canonical id
  name: string;         // first + last
  short: string;        // first name, used in pills/badges
  initials: string;     // 1-2 chars for the avatar
  role: TeamMemberRole;
  active: boolean;      // false = hidden from picker but old assignments still resolve
};

export const TEAM_MEMBERS: TeamMember[] = [
  {
    email: 'ryan@risingtidestr.com',
    name: 'Ryan Fortsch',
    short: 'Ryan',
    initials: 'RF',
    role: 'principal',
    active: true,
  },
  {
    email: 'allie@risingtidestr.com',
    name: 'Allie O\'Brien',
    short: 'Allie',
    initials: 'AO',
    role: 'operations',
    active: true,
  },
  {
    email: 'dotti@risingtidestr.com',
    name: 'Dotti Maguire',
    short: 'Dotti',
    initials: 'DM',
    role: 'principal',
    active: true,
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

/** 1-2 char initials for the avatar — same fallback rules as displayName. */
export function initialsForEmail(email: string | null | undefined): string {
  if (!email) return '·';
  const m = getTeamMember(email);
  if (m) return m.initials;
  const local = email.split('@')[0];
  return local.slice(0, 2).toUpperCase();
}
