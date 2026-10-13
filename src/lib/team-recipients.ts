/**
 * Who a notice reaches, resolved from the team list by role and duty on the
 * day it is sent. No module should name a teammate's inbox: the roster says
 * who runs operations, who approves field pay and who runs the creative
 * program, and a member with a `starts` date joins each list on that day.
 *
 * Dependency-free apart from team.ts, so it runs under the test runner and
 * from a cron. The `.ts` extension is what lets Node resolve the import.
 */
import { TEAM_MEMBERS, type TeamDuty, type TeamMember } from './team.ts';

/** Today's date in Gloucester, YYYY-MM-DD. Start dates are compared to this. */
export function todayET(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
}

/** Listed, active, and on or past their start date. */
export function onTeam(m: TeamMember, today: string = todayET()): boolean {
  return m.active && (!m.starts || m.starts <= today);
}

/** Everyone holding `duty` today, in roster order. */
export function dutyEmails(duty: TeamDuty, today: string = todayET()): string[] {
  return TEAM_MEMBERS.filter((m) => onTeam(m, today) && (m.duties ?? []).includes(duty)).map((m) => m.email);
}

/**
 * Everyone running day-to-day operations today (role `operations`), in
 * roster order. Never empty: with no operations seat on the team the people
 * who approve field pay stand in, so a notice always has somewhere to go.
 */
export function operationsEmails(today: string = todayET()): string[] {
  const ops = TEAM_MEMBERS.filter((m) => m.role === 'operations' && onTeam(m, today)).map((m) => m.email);
  return ops.length ? ops : dutyEmails('field_pay', today);
}

/**
 * The one inbox a contractor's reply lands in: the staff operations manager
 * once she has started, else the owners' operations seat, else whoever
 * approves field pay.
 */
export function fieldReplyTo(today: string = todayET()): string {
  const ops = TEAM_MEMBERS.filter((m) => m.role === 'operations' && onTeam(m, today));
  const staff = ops.find((m) => m.access === 'staff');
  return (staff ?? ops[0])?.email ?? dutyEmails('field_pay', today)[0] ?? TEAM_MEMBERS[0].email;
}

/**
 * The office, for a Field notice: the first operations seat is the
 * recipient, the other operations seats and whoever approves field pay ride
 * on copy. Resend takes one `to`, so the shape is to + cc, never a list.
 */
export function officeNotice(today: string = todayET()): { to: string; cc: string[] } {
  const ops = operationsEmails(today);
  const pay = dutyEmails('field_pay', today);
  const to = ops[0] ?? pay[0] ?? TEAM_MEMBERS[0].email;
  const cc = [...ops.slice(1), ...pay].filter((e, i, all) => e !== to && all.indexOf(e) === i);
  return { to, cc };
}

/** The person who approves field pay, with operations on copy. */
export function fieldPayNotice(today: string = todayET()): { to: string; cc: string[] } {
  const pay = dutyEmails('field_pay', today);
  if (pay.length === 0) return officeNotice(today);
  const to = pay[0];
  const cc = [...pay.slice(1), ...operationsEmails(today)].filter((e, i, all) => e !== to && all.indexOf(e) === i);
  return { to, cc };
}

/** The person who runs the creative program, falling back to the office. */
export function creativeLeadEmail(today: string = todayET()): string {
  return dutyEmails('creative', today)[0] ?? officeNotice(today).to;
}
