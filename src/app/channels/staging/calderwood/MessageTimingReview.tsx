import { reviewCalderwoodMessageTiming } from '@/lib/calderwood-readonly/message-timing';
import type { readCalderwoodGuesty } from '@/lib/calderwood-readonly/guesty-reader';

const displayTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short',
});
const format = (at: string | null) => at ? displayTime.format(new Date(at)) : 'Unverified';
const basis = (value: string | null) => !value ? 'unverified' : value.startsWith('listing.') ? 'listing default' : 'reservation time';

export default function MessageTimingReview({ reservations, observedAt, localClockError, confirmationError }: {
  reservations: Awaited<ReturnType<typeof readCalderwoodGuesty>>['reservations']; observedAt: string; localClockError: boolean; confirmationError: boolean;
}) {
  const confirmed = reservations.filter(r => r.status === 'confirmed').sort((a, b) => a.start.localeCompare(b.start));
  const dayOffsetConflicts = confirmed.flatMap(r => reviewCalderwoodMessageTiming(r, new Date(observedAt))).filter(r => r.dayOffsetConflict).length;
  return <section aria-labelledby="message-timing-review" className="space-y-4 rounded-lg border bg-white p-5">
    <div><h2 id="message-timing-review" className="text-lg font-semibold">Message timing review</h2>
      <p className="mt-1 text-sm text-slate-600">{confirmed.length} confirmed stays · New York time · {confirmed.filter(r => r.timing.clockVerified).length} with local clock evidence · {confirmed.filter(r => r.timing.confirmation).length} with confirmation timestamps.</p></div>
    <p className="text-sm">Six recurring templates only; see Message workflow coverage for the fourteen additional templates and source conditions. Guesty remains the sender. These calculations use its local arrival/departure fields, reservation confirmation timestamps, and your existing workflow offsets. They are previews, not confirmed queue entries.</p>
    <aside className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950"><strong>Timing source:</strong> Guesty’s search timestamps disagree with its local clock fields. The local fields match the sampled booking’s visible 4 PM arrival and 11 AM departure. This preview temporarily uses Guesty’s older reservation API. A supported production timing source still needs validation before migration.</aside>
    {dayOffsetConflicts > 0 && <aside className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><strong>{dayOffsetConflicts} messages need a daylight-saving check.</strong> Keeping the same local clock and counting 24 hours per day produce different times. The affected rows show both possibilities and withhold a proposed time until the existing Guesty queue is reconciled.</aside>}
    {localClockError && <p role="status" className="text-sm text-amber-900">Local clock verification could not complete. Arrival/departure calculations remain withheld. The review supports up to 12 confirmed stays; try a narrower window if needed.</p>}
    {confirmationError && <p role="status" className="text-sm text-amber-900">Confirmation timestamps could not be verified. Those calculations remain withheld; the local arrival/departure review is preserved.</p>}
    <p className="text-sm text-slate-600">Confirmation calculations use Guesty’s reservation confirmation event, not the date a record was created. Missing or inconsistent timing stays unverified. A calculated time does not prove a message was sent; past messages must not be replayed automatically.</p>
    {confirmed.length === 0 && <p className="text-sm">No confirmed stays were returned in this window. Other reservation statuses remain in the booking review.</p>}
    <div className="divide-y rounded-lg border">{confirmed.map(reservation => {
      const rows = reviewCalderwoodMessageTiming(reservation, new Date(observedAt));
      return <details key={reservation.id} className="p-4">
        <summary className="cursor-pointer text-sm font-medium">{reservation.start} to {reservation.end} · {reservation.source}
          <span className="mt-1 block font-normal text-slate-600">{reservation.timing.clockVerified ? 'Local arrival' : 'Unverified API arrival interpretation'}: {format(reservation.timing.arrivalAt)} · {reservation.timing.clockVerified ? 'Local departure' : 'Unverified API departure interpretation'}: {format(reservation.timing.departureAt)}</span>
        </summary>
        {reservation.timing.localEvidence && <p className="mt-3 text-xs text-slate-600">Arrival source: {basis(reservation.timing.localEvidence.arrivalBasis)} · Departure source: {basis(reservation.timing.localEvidence.departureBasis)}.
          {reservation.timing.localEvidence.disagreesWithSearch && <> Search feed comparison: {format(reservation.timing.localEvidence.searchArrivalAt)} arrival / {format(reservation.timing.localEvidence.searchDepartureAt)} departure. These search timestamps are not used for the calculations.</>}
        </p>}
        <p className="mt-2 text-xs text-slate-600">Reservation confirmed: {format(reservation.timing.confirmation?.at ?? null)}. {reservation.timing.confirmation ? 'Source: Guesty reservation confirmation event.' : 'No creation date or channel timestamp substituted.'}</p>
        {reservation.timing.issues.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm text-amber-900">{reservation.timing.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
        <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm">
          <thead><tr>{['Message', 'Calculated time for review', 'Evidence still needed'].map(label => <th className="pb-2 pr-4" scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr className="border-t align-top" key={row.key}>
            <th scope="row" className="py-3 pr-4 font-normal"><strong className="font-medium">{row.label}</strong><span className="block text-xs text-slate-500">{row.audience} · {row.offset}</span></th>
            <td className="py-3 pr-4">{row.dayOffsetConflict ? <div className="space-y-1 text-amber-950"><strong className="font-medium">Needs queue check</strong><p className="text-xs">Same local clock: {format(row.dayOffsetConflict.calendarAt)}</p><p className="text-xs">24 hours per day: {format(row.dayOffsetConflict.elapsedAt)}</p></div> : format(row.at)}</td><td className="py-3">{row.review}</td>
          </tr>)}</tbody>
        </table></div>
      </details>;
    })}</div>
    <p className="text-xs text-slate-500">Nothing in this review is saved or queued. Unverified times can also indicate a missing or ambiguous clock time during daylight-saving changes. Channel applicability, expiry, access-code readiness and sender ownership remain separate checks.</p>
  </section>;
}
