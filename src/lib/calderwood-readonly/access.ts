import { proposeStoppedCalendar } from './proposal.ts';
import { readCalderwoodChannex, compareProviders } from './channex.ts';
import { readCalderwoodCalendar, compareCalendar } from './calendar.ts';
import { readCalderwoodGuesty } from './guesty-reader.ts';
type Environment = { VERCEL_ENV?: string; VERCEL_GIT_COMMIT_REF?: string; CHANNEX_STAGING_ENABLED?: string };
export function calderwoodReadAllowed(email: string | null | undefined, env: Environment): boolean {
  return !!email?.endsWith('@risingtidestr.com') && env.VERCEL_ENV === 'preview'
    && env.VERCEL_GIT_COMMIT_REF === 'codex/channex-staging-pilot' && env.CHANNEX_STAGING_ENABLED === 'true';
}
/** Guard before acquiring any token. Token remains server-side and never enters the result. */
export async function loadCalderwoodRead(input: { email?: string | null; env: Environment; from: string; to: string; includeCalendar?: boolean }, dependencies: {
  token: () => Promise<string>; read?: typeof readCalderwoodGuesty; calendar?: typeof readCalderwoodCalendar; stagingKey?: () => string; stagingRead?: typeof readCalderwoodChannex;
}) {
  if (!calderwoodReadAllowed(input.email, input.env)) throw Error('Calderwood preview unavailable');
  // Validate the requested window before touching the existing connection.
  const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  if (!valid(input.from) || !valid(input.to) || input.from >= input.to || Date.parse(input.to) - Date.parse(input.from) > 366 * 86400000) throw Error('Choose a valid window of up to 366 days');
  try {
    const startedAt = new Date().toISOString();
    const token = await dependencies.token();
    const snapshot = await (dependencies.read ?? readCalderwoodGuesty)(token, { from: input.from, to: input.to });
    let calendar = null;
    let calendarError = false;
    if (input.includeCalendar) {
      try { const read = await (dependencies.calendar ?? readCalderwoodCalendar)(token, snapshot.window); calendar = { ...read, days: compareCalendar(read, snapshot.reservations) }; }
      catch { calendarError = true; }
    }
    let staging: (Awaited<ReturnType<typeof readCalderwoodChannex>> & { comparison: ReturnType<typeof compareProviders> }) | null = null;
    let stagingError = false;
    if (calendar && dependencies.stagingKey) {
      try { const data = await (dependencies.stagingRead ?? readCalderwoodChannex)(dependencies.stagingKey(), snapshot.window); staging = { ...data, comparison: compareProviders(calendar, data) }; }
      catch { stagingError = true; }
    }
    const proposal = calendar && staging ? proposeStoppedCalendar(snapshot.window, calendar, staging) : null;
    return { ...snapshot, calendar, calendarError, staging, stagingError, proposal, startedAt, finishedAt: new Date().toISOString() };
  } catch { throw Error('Calderwood could not be read from the existing Guesty connection. No calendar changes were made.'); }
}
