/** Existing worker assignments and office accountability are separate. */
export function coordinationPatch(input: { coordinator_email?: string | null; follow_up_date?: string | null }, teamEmails: string[]):
  { ok: true; patch: { coordinator_email?: string | null; follow_up_date?: string | null } } | { ok: false; error: string } {
  const patch: { coordinator_email?: string | null; follow_up_date?: string | null } = {};
  if (input.coordinator_email !== undefined) {
    const email = input.coordinator_email?.trim().toLowerCase() || null;
    if (email && !teamEmails.includes(email)) return { ok: false, error: 'Choose a current team member to coordinate this work.' };
    patch.coordinator_email = email;
  }
  if (input.follow_up_date !== undefined) {
    const date = input.follow_up_date || null;
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date)) return { ok: false, error: 'Choose a valid follow-up date.' };
    patch.follow_up_date = date;
  }
  return { ok: true, patch };
}
