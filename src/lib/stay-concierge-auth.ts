import { NextResponse } from 'next/server';

/**
 * Authorize a stay-concierge bridge request. Returns `null` when the caller is
 * allowed, or a Response when it is not. Same contract as authorizeCron in
 * src/lib/cron-auth.ts.
 *
 * HEADER ONLY, deliberately. The secret travels in `x-stay-concierge-key` and
 * nowhere else.
 *
 * These routes used to accept `?key=<secret>` as well, checked BEFORE the
 * header. A secret in a query string is a secret in every access log, proxy
 * log and Vercel request record it passes through, and httpx's URL logging on
 * the stay-concierge side was the leak vector behind the 2026-08-20 rotation.
 * The query form was removed from all six bridge routes; this helper exists so
 * the rule lives in one place and a new route cannot quietly reintroduce it.
 *
 * Callers on the stay-concierge side all send the header
 * (src/helm_sync.py, helm_kb_sync.py, gear_requests.py, prospect_leads.py,
 * quo_outbound_sync.py, stay_change_followups.py, facts_distiller.py,
 * trash_reminders.py), so there is nothing left reaching for the query form.
 *
 * Fails closed when STAY_CONCIERGE_KEY is unset: 503, never open. An unset
 * secret means the bridge is not configured, which is not a reason to let an
 * anonymous caller through.
 */
export function authorizeStayConcierge(req: Request): NextResponse | null {
  const expected = process.env.STAY_CONCIERGE_KEY;
  if (!expected) {
    return NextResponse.json({ error: 'sync disabled (no key configured)' }, { status: 503 });
  }
  const provided = req.headers.get('x-stay-concierge-key');
  if (provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
