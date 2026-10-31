import { NextResponse } from 'next/server';
import { enabledAgendaAccounts, syncAppointmentSources } from '@/lib/appointment-capture-server';
export const runtime = 'nodejs';
export const maxDuration = 300;
/** Cron-only, no unsigned header or session fallback. Never sends messages. */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const accounts = enabledAgendaAccounts();
  if (accounts.length > 3) return NextResponse.json({ error: 'Capture supports at most three explicitly enabled accounts.' }, { status: 503 });
  const results = await Promise.allSettled(accounts.map(email => syncAppointmentSources(email)));
  return NextResponse.json({ enabled: accounts.length, results: results.map((r, i) => ({ account: accounts[i], ...(r.status === 'fulfilled' ? r.value : { state: 'failed' }) })) }, { status: results.some(r => r.status === 'rejected') ? 503 : 200 });
}
