import Link from 'next/link';
import { auth } from '@/auth';
import { notFound, redirect } from 'next/navigation';
import { getGuestyToken } from '@/lib/guesty-client';
import { calderwoodReadAllowed, loadCalderwoodRead } from '@/lib/calderwood-readonly/access';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const metadata = { title: 'Calderwood comparison | Helm', robots: { index: false, follow: false } };
export default async function CalderwoodPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const env = { VERCEL_ENV: process.env.VERCEL_ENV, VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF, CHANNEX_STAGING_ENABLED: process.env.CHANNEX_STAGING_ENABLED };
  const session = await auth();
  if (!session?.user?.email) redirect('/auth/signin?callbackUrl=%2Fchannels%2Fstaging%2Fcalderwood');
  if (!calderwoodReadAllowed(session.user.email, env)) notFound();
  const params = await searchParams;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const defaultEnd = new Date(Date.parse(today + 'T00:00:00Z') + 90 * 86400000).toISOString().slice(0, 10);
  const from = typeof params.from === 'string' ? params.from : today;
  const to = typeof params.to === 'string' ? params.to : defaultEnd;
  let result: Awaited<ReturnType<typeof loadCalderwoodRead>> | null = null;
  let error = '';
  if (params.load === '1') {
    try { result = await loadCalderwoodRead({ email: session.user.email, env, from, to, includeCalendar: true }, { token: getGuestyToken, stagingKey: () => process.env.CHANNEX_STAGING_API_KEY ?? '' }); }
    catch (e) { error = e instanceof Error ? e.message : 'Snapshot unavailable'; }
  }
  return <main className="mx-auto max-w-6xl space-y-6 p-6">
    <Link href="/channels/staging" className="text-sm underline">Back to staging workspace</Link>
    <header><p className="text-sm text-slate-500">Migration review · Read only</p><h1 className="text-2xl font-semibold">65 Calderwood</h1>
      <p className="mt-2 text-sm text-slate-600">Read current reservations through Helm’s existing Guesty connection. Guesty continues managing the live calendar.</p></header>
    <form method="get" className="flex flex-wrap items-end gap-4 rounded-lg border p-4">
      <input type="hidden" name="load" value="1" />
      <label className="grid gap-1 text-sm">From<input className="rounded border p-2" type="date" name="from" required defaultValue={from} /></label>
      <label className="grid gap-1 text-sm">Until (exclusive)<input className="rounded border p-2" type="date" name="to" required defaultValue={to} /></label>
      <button className="rounded bg-slate-900 px-4 py-2 text-white" type="submit">Compare calendars</button>
    </form>
    <aside className="rounded-lg bg-amber-50 p-4 text-sm text-amber-950">Staging comparison only: Channex has an isolated test property with placeholder pricing and no sales channels. Differences are expected. Authoritative booking revisions and independent channel delivery checks are still missing. An empty result does not mean dates are available.</aside>
    {error && <p role="alert" className="rounded border border-red-300 p-4 text-sm">{error}</p>}
    {result?.calendarError && <p role="alert" className="rounded border border-amber-300 p-4 text-sm">Reservations loaded, but the calendar read failed. Pricing and block coverage remain unverified.</p>}
    {result?.stagingError && <p role="alert" className="rounded border border-amber-300 p-4 text-sm">Channex staging could not be verified. Its mapping, channel isolation, key access or calendar response needs review. Guesty results remain visible.</p>}
    {result?.staging && <section className="space-y-3">
      <h2 className="text-lg font-semibold">Guesty live vs Channex staging</h2>
      <p className="text-sm">{result.staging.comparison.length} nights compared · {result.staging.comparison.filter(r => r.differences.length).length} with differences · {result.staging.comparison.filter(r => r.missing.length).length} with missing evidence · {result.staging.comparison.filter(r => r.test.stopSell !== true).length} without verified stop-sell</p>
      <p className="text-xs text-slate-500">Staging read {result.staging.finishedAt}. Minimum comparison uses arrival minimum only; through-stay and maximum-stay semantics remain unverified. Matching fields do not prove booking, block ownership, fees, policies or channel parity.</p>
      <div className="max-h-[32rem] overflow-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-50"><tr>{['Night', 'Guesty live', 'Channex test', 'Differences / missing evidence'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{result.staging.comparison.map(row => <tr key={row.date} className="border-t align-top">
        <td className="whitespace-nowrap p-3">{row.date}</td>
        <td className="p-3">{row.live ? <>{row.live.status}<br />{row.live.currency ?? '?'} {row.live.price ?? '?'} · min {row.live.minNights ?? '?'}<br />{row.live.reasons.join(', ')}</> : 'Missing night'}</td>
        <td className="p-3"><strong>{row.safety}</strong><br />Inventory {row.test.inventory ?? '?'} · USD {row.test.price ?? '?'}<br />Min arrival {row.test.minArrival ?? '?'} / through {row.test.minThrough ?? '?'}</td>
        <td className="p-3">{[...row.missing, ...row.differences].join(' · ') || 'Displayed fields agree; broader parity unverified'}</td>
      </tr>)}</tbody></table></div>
    </section>}
    {result?.calendar && <section className="space-y-3">
      <h2 className="font-semibold">{result.calendar.days.length} calendar nights returned · {result.calendar.missingDates.length} missing · {result.calendar.days.filter(d => d.issues.length).length} nights to review</h2>
      <p className="text-sm text-slate-600">Guesty posted rates in the listed currency, not a guest quote or proof of PriceLabs delivery. Reads are sequential; a mismatch may reflect a change between requests. No dates are cleared for sale by this review.</p>
      {result.calendar.missingDates.length > 0 && <p role="alert" className="text-sm text-amber-800">Missing dates: {result.calendar.missingDates.join(', ')}</p>}
      <div className="max-h-[32rem] overflow-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-50"><tr>{['Night', 'Guesty status', 'Rate', 'Minimum', 'Restrictions / blocks', 'Review'].map(label => <th key={label} className="p-3 font-medium">{label}</th>)}</tr></thead>
      <tbody>{result.calendar.days.map(day => <tr key={day.date} className="border-t align-top"><td className="whitespace-nowrap p-3">{day.date}</td><td className="p-3">{day.status}</td><td className="whitespace-nowrap p-3">{day.price !== null && day.currency ? `${day.currency} ${day.price.toFixed(2)}` : 'Unknown'}</td><td className="p-3">{day.minNights ?? 'Unknown'}</td><td className="p-3">{[...day.reasons, ...(day.cta ? ['No arrivals'] : []), ...(day.ctd ? ['No departures'] : []), ...(day.requestToBook ? ['Request to book'] : []), ...(day.allotment !== null ? [`Allotment: ${day.allotment}`] : [])].join(' · ') || 'None reported'}</td><td className="p-3">{day.issues.join(' · ') || 'No discrepancy detected'}</td></tr>)}</tbody></table></div>
    </section>}
    {result && <section className="space-y-3"><h2 className="font-semibold">{result.reservations.length} reservation records returned</h2>
      <p className="text-xs text-slate-500">Read completed {result.finishedAt}. Local stay dates shown; checkout excluded. All returned statuses are shown.</p>
      <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr>{['Reservation ID', 'Arrival', 'Departure', 'Status', 'Source'].map(label => <th key={label} className="p-3 font-medium">{label}</th>)}</tr></thead>
        <tbody>{result.reservations.map(row => <tr key={row.id} className="border-t"><td className="p-3 font-mono text-xs">{row.id}</td><td className="p-3">{row.start}</td><td className="p-3">{row.end}</td><td className="p-3">{row.status}</td><td className="p-3">{row.source}</td></tr>)}</tbody></table></div>
      <p className="text-xs text-slate-500">This view is not saved to the staging database and does not update bookings or message guests.</p>
    </section>}
  </main>;
}
