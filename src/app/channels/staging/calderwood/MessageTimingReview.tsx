import { reviewCalderwoodMessageTiming } from '@/lib/calderwood-readonly/message-timing';
import type { readCalderwoodGuesty } from '@/lib/calderwood-readonly/guesty-reader';

const displayTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short',
});
const format = (at: string | null) => at ? displayTime.format(new Date(at)) : 'Unverified';

export default function MessageTimingReview({ reservations, observedAt }: {
  reservations: Awaited<ReturnType<typeof readCalderwoodGuesty>>['reservations']; observedAt: string;
}) {
  const confirmed = reservations.filter(r => r.status === 'confirmed').sort((a, b) => a.start.localeCompare(b.start));
  return <section aria-labelledby="message-timing-review" className="space-y-4 rounded-lg border bg-white p-5">
    <div><h2 id="message-timing-review" className="text-lg font-semibold">Message timing review</h2>
      <p className="mt-1 text-sm text-slate-600">{confirmed.length} confirmed stays · New York time · Guesty API timestamps awaiting clock verification.</p></div>
    <p className="text-sm">Guesty remains the sender. Message schedules are withheld until its API timestamps agree with independent booking and automation evidence. The six existing workflow offsets are retained below.</p>
    <aside className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950"><strong>Clock discrepancy found on October 16:</strong> the sampled stay’s API timestamps convert to noon arrival and 7 AM departure in New York, while Guesty’s visible instructions use 4 PM and 11 AM. We have not applied a guessed timezone correction. The API interpretations below are not verified arrival or sending times.</aside>
    <p className="text-sm text-slate-600">Confirmation time is not supplied by this read. Missing or inconsistent timing stays unverified, with no assumed 4 PM arrival or 11 AM departure. Past times are shown for review only.</p>
    {confirmed.length === 0 && <p className="text-sm">No confirmed stays were returned in this window. Other reservation statuses remain in the booking review.</p>}
    <div className="divide-y rounded-lg border">{confirmed.map(reservation => {
      const rows = reviewCalderwoodMessageTiming(reservation, new Date(observedAt));
      return <details key={reservation.id} className="p-4">
        <summary className="cursor-pointer text-sm font-medium">{reservation.start} to {reservation.end} · {reservation.source}
          <span className="mt-1 block font-normal text-slate-600">API arrival interpretation: {format(reservation.timing.arrivalAt)} · API departure interpretation: {format(reservation.timing.departureAt)}</span>
        </summary>
        {reservation.timing.issues.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm text-amber-900">{reservation.timing.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
        <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm">
          <thead><tr>{['Message', 'Verified proposed time', 'Evidence still needed'].map(label => <th className="pb-2 pr-4" scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr className="border-t align-top" key={row.key}>
            <th scope="row" className="py-3 pr-4 font-normal"><strong className="font-medium">{row.label}</strong><span className="block text-xs text-slate-500">{row.audience} · {row.offset}</span></th>
            <td className="py-3 pr-4">{format(row.at)}</td><td className="py-3">{row.review}</td>
          </tr>)}</tbody>
        </table></div>
      </details>;
    })}</div>
    <p className="text-xs text-slate-500">Nothing in this review is saved or queued. Unverified times can also indicate a missing or ambiguous clock time during daylight-saving changes. Channel applicability, expiry, access-code readiness and sender ownership remain separate checks.</p>
  </section>;
}
