'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { MessagePreparationReview } from '@/lib/channex-messaging/preparation';
import { CALDERWOOD_MESSAGE_WORKFLOWS } from '@/lib/channex-messaging/preparation-timing';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';

const stamp = (s: string | null) => s ? new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
}).format(new Date(s)) : 'Time unverified';
const day = (s: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${s}T12:00:00Z`));
const errors: Record<string, string> = {
  SOURCES_CHANGED: 'A reservation or rule changed during the review. Refresh to read the latest setup.',
  SOURCE_READ_FAILED: 'Guesty could not confirm every reservation and time. No partial result is treated as verified.',
  IDENTITY_REVIEW_REQUIRED: 'A reservation match needs review before its message schedule can be compared.',
  READ_LIMIT_REACHED: 'The review reached its time or size limit. No partial result is treated as verified.',
};
const deliveryLabels = { sms: 'SMS', email: 'Email', sms_then_email: 'SMS, then email', ota_manual: 'Manual OTA route' };
export function PreparationReview() {
  const [review, setReview] = useState<MessagePreparationReview | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function refresh() {
    setBusy(true); setError(''); setReview(null);
    try {
      const res = await fetch('/api/channex/message-preparation', { cache: 'no-store', signal: AbortSignal.timeout(110000) });
      const body = await res.json();
      if (!res.ok || body.ok !== true || body.format !== 3) {
        setError(errors[body.code] ?? 'The review is unavailable. Check your owner sign-in and the Channex preparation status.');
      } else setReview(body);
    } catch { setError('The review could not finish. Try again when the connection is available.'); }
    finally { setBusy(false); }
  }
  return <>
    <section className="mt-6 rounded-xl border p-5 sm:p-6" style={{ borderColor: 'var(--rule)', background: 'var(--paper-2)' }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="eyebrow mb-2" style={{ color: 'var(--signal)' }}>Preparation only</p>
          <h2 className="text-xl font-semibold">Guesty continues handling messages</h2>
          <p className="mt-2 text-sm leading-6" style={{ color: 'var(--ink-3)' }}>Compare Helm’s templates and proposed send times with the six Calderwood workflows. This review creates no messages and changes no schedules.</p>
        </div>
        <Button type="button" onClick={refresh} pending={busy} watchdog={false}>{busy ? 'Checking current setup…' : review ? 'Refresh review' : 'Read current setup'}</Button>
      </div>
      <p className="mt-3 text-xs" role="status" style={{ color: 'var(--ink-3)' }}>{busy ? 'Checking reservation identities and times twice. This can take up to 80 seconds.'
        : review ? `Observed ${stamp(review.checkedAt)}. This is a point-in-time review.` : 'Uses current and upcoming Calderwood stays in the next 500 days.'}</p>
    </section>
    {error && <p role="alert" className="mt-5 border-l-4 p-4 text-sm" style={{ borderColor: 'var(--negative)', color: 'var(--negative)' }}>{error}</p>}
    {review && <section className="mt-8" aria-labelledby="handover-inputs">
      <h2 id="handover-inputs" className="text-xl font-semibold">What still needs attention</h2>
      <p className="mt-2 text-sm leading-6" style={{ color: 'var(--ink-3)' }}>Stored details can be rehearsed below. Guesty’s pending queue and the cleaner handover still need separate verification.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <article className="rounded-xl border p-5" style={{ borderColor: 'var(--rule)' }}>
          <h3 className="font-semibold">Guest access details</h3>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
            <dt>Door code</dt><dd>{review.inputs.entryCode === 'stored' ? 'Stored · masked' : review.inputs.entryCode === 'stay_code_review' ? 'Verify each stay’s code' : 'Missing'}</dd>
            <dt>Wi-Fi network</dt><dd>{review.inputs.wifiName ? 'Stored · masked' : 'Missing'}</dd>
            <dt>Wi-Fi password</dt><dd>{review.inputs.wifiPassword ? 'Stored · masked' : 'Missing'}</dd>
          </dl>
          <p className="mt-3 text-xs leading-5" style={{ color: 'var(--ink-3)' }}>Stored values are not proof that the lock or network works. Recheck source details before the switch.</p>
          <Link href="/properties/65_calderwood" className="mt-3 inline-block text-sm underline underline-offset-4">Review property details →</Link>
        </article>
        <article className="rounded-xl border p-5" style={{ borderColor: 'var(--rule)' }}>
          <h3 className="font-semibold">Cleaner reminders</h3>
          <p className="mt-3 text-sm font-medium" style={{ color: 'var(--signal)' }}>{review.inputs.cleaner.status === 'not_configured'
            ? 'No Calderwood cleaner recipient configured'
            : review.inputs.cleaner.status === 'disabled' ? 'Cleaner recipients are disabled'
            : review.inputs.cleaner.status === 'multiple_recipients' ? 'Multiple recipients need review'
            : 'Recipient and schedule access need verification'}</p>
          <p className="mt-2 text-sm leading-6" style={{ color: 'var(--ink-3)' }}>Confirm Luana’s destination, a Calderwood-only schedule link, and the arrival and checkout details she needs. The old Guesty report link has not been replaced.</p>
          <p className="mt-3 text-xs leading-5" style={{ color: 'var(--ink-3)' }}>A configured recipient alone does not verify the phone number, schedule access or SMS delivery.</p>
          <Link href="/turnovers/settings#schedule-recipients" className="mt-3 inline-block text-sm underline underline-offset-4">Review cleaner settings →</Link>
          <Link href="/channels/65_calderwood/cleaner-schedule" className="mt-3 block text-sm underline underline-offset-4">Preview arrivals and departures →</Link>
        </article>
      </div>
    </section>}
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
        <h2 className="text-xl font-semibold">Six workflows to preserve</h2>
        {review && <p className="text-sm" style={{ color: 'var(--ink-3)' }}>{review.preparedWorkflows} of 6 templates prepared · {review.missingWorkflows} missing workflows</p>}
      </div>
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--rule)' }}>
        <table className="w-full text-left text-sm min-w-[620px]">
          <thead style={{ background: 'var(--paper-2)', color: 'var(--ink-3)' }}><tr><th className="p-4 font-medium">Message</th><th className="p-4 font-medium">Guesty schedule to retain</th><th className="p-4 font-medium">Current Helm setup</th></tr></thead>
          <tbody>{CALDERWOOD_MESSAGE_WORKFLOWS.map(flow => {
            const current = review?.workflows.find(w => w.key === flow.key), r = current?.rule;
            return <tr key={flow.key} className="border-t align-top" style={{ borderColor: 'var(--rule)' }}>
              <th scope="row" className="p-4 font-medium">{flow.label}<span className="block text-xs font-normal mt-1" style={{ color: 'var(--ink-3)' }}>{flow.audience === 'guest' ? 'Guest · booking channel' : 'Cleaner · SMS'}</span></th>
              <td className="p-4">{flow.offset}</td>
              <td className="p-4 max-w-sm">{!current ? <span style={{ color: 'var(--ink-3)' }}>Run review to check</span> : !r ? <strong style={{ color: 'var(--signal)' }}>Template not set up</strong> : <>
                <strong>{r.migration ? 'Guesty template prepared' : current.source === 'property' ? 'Property template' : 'Inherited fleet template'}</strong>
                {r.migration ? <>
                  <p className="mt-1 text-xs leading-5" style={{ color: 'var(--ink-3)' }}>Source wording captured · relative schedule recorded · sending off.</p>
                  <p className="mt-1 text-xs leading-5" style={{ color: 'var(--ink-3)' }}>Planned delivery: {flow.audience === 'guest' ? 'Automatic booking-channel message' : 'Automatic cleaner SMS'}.</p>
                  {r.migration.credentialFields && <p className="mt-1 text-xs leading-5" style={{ color: 'var(--signal)' }}>Door code and Wi-Fi values must resolve from protected records.</p>}
                  {r.migration.cleanerLinkRequired && <p className="mt-1 text-xs leading-5" style={{ color: 'var(--signal)' }}>Cleaner schedule link still needs replacement and access verification.</p>}
                  {r.migration.dateFormatReview && <p className="mt-1 text-xs leading-5" style={{ color: 'var(--ink-3)' }}>The rehearsal uses Guesty’s observed date display, including the year.</p>}
                </> : <>
                  <p className="mt-1 text-xs leading-5" style={{ color: 'var(--ink-3)' }}>{r.enabled ? 'Rule enabled' : 'Rule disabled'} · {r.characterCount} characters · {r.sendMode === 'approve' ? 'Approval mode' : 'Automatic mode'}</p>
                  <p className="mt-1 text-xs leading-5" style={{ color: 'var(--ink-3)' }}>Current delivery: {deliveryLabels[r.delivery]}{r.configuredInOta ? ' · marked as covered by OTA' : ''}.</p>
                  <p className="mt-1 text-xs leading-5" style={{ color: 'var(--signal)' }}>Relative timing needs migration. Current: {r.timing}.</p>
                </>}
                <p className="mt-1 text-xs leading-5" style={{ color: 'var(--ink-3)' }}>Rendered message and delivery checks remain.</p>
                {(r.invalidMigrationPolicy || r.unsupportedFieldCount > 0 || r.malformedTemplate || r.emptyTemplate || !r.audienceMatches || !r.timezoneMatches) && <p className="mt-1 text-xs" style={{ color: 'var(--negative)' }}>Template configuration needs correction.</p>}
              </>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {review && review.extraEffectiveKeys.length > 0 && <p className="mt-3 text-sm" style={{ color: 'var(--ink-3)' }}>Additional Helm rules require separate review: {review.extraEffectiveKeys.join(', ')}.</p>}
    </section>
    {review && <section className="mt-8">
      <h2 className="text-xl font-semibold">Reservation timing review</h2>
      <p className="text-sm mt-2 mb-5 leading-6" style={{ color: 'var(--ink-3)' }}>Times use the reservation’s arrival or departure override, or an explicitly confirmed listing default. Past times are never replayed. Daylight-saving differences require Guesty’s queued timestamp.</p>
      <p className="text-sm mb-5 leading-6" style={{ color: 'var(--ink-3)' }}>Open a message below to rehearse the prepared wording with this stay’s dates. Names and access details are masked. A stored value still needs verification against Guesty; a linked lock needs a verified stay code. No preview can be sent.</p>
      {review.stays.length === 0 && <EmptyState>No current or upcoming stays were found in the review window.</EmptyState>}
      <div className="grid gap-4">{review.stays.map(stay => <article key={stay.canonicalId} className="rounded-xl border p-5" style={{ borderColor: 'var(--rule)' }}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="font-semibold">{day(stay.checkIn)} – {day(stay.checkOut)}</h3>
          <Link href={`/channels/bookings/${stay.canonicalId}`} className="text-sm underline underline-offset-4">Open reservation →</Link>
        </div>
        <ul className="divide-y" style={{ borderColor: 'var(--rule)' }}>{stay.timings.map(t => <li key={t.key} className="py-3 text-sm">
          <div className="flex flex-wrap justify-between gap-x-5 gap-y-1">
          <span>{CALDERWOOD_MESSAGE_WORKFLOWS.find(f => f.key === t.key)?.label}</span>
          <div className="sm:text-right">
            <p>{t.status === 'dst_review' ? 'Daylight-saving review required' : stamp(t.at)}</p>
            <p className="text-xs mt-1" style={{ color: t.status === 'future' ? 'var(--ink-3)' : 'var(--signal)' }}>{t.status === 'past_or_due' ? 'Past or due · history review required'
              : t.status === 'future' ? 'Proposed time · queue and holds still need verification'
              : t.status === 'dst_review' ? `Calendar: ${stamp(t.conflict?.calendarAt ?? null)} · Elapsed: ${stamp(t.conflict?.elapsedAt ?? null)}` : 'No default time has been assumed'}</p>
          </div>
          </div>
          {stay.messages.filter(m => m.key === t.key).map(message => <details key={message.key} className="mt-3 rounded-lg border p-3" style={{ borderColor: 'var(--rule)' }}>
            <summary className="cursor-pointer font-medium">{message.status === 'template_unavailable' ? 'Template needs preparation'
              : message.missingFields.length ? `${message.missingFields.length} missing ${message.missingFields.length === 1 ? 'field' : 'fields'} · Review message`
              : 'Fields present · Review masked message'}</summary>
            {message.missingFields.length > 0 && <p className="mt-3 text-xs" style={{ color: 'var(--negative)' }}>Missing: {message.missingFields.join(', ')}.</p>}
            {message.timeWordingReview && <p className="mt-3 text-xs" style={{ color: 'var(--negative)' }}>The arrival or departure time differs from the standard wording. Review the time stated in this message.</p>}
            {message.preview && <p className="mt-3 whitespace-pre-wrap rounded-lg p-4 text-sm leading-6" style={{ background: 'var(--paper-2)' }}>{message.preview}</p>}
            <p className="mt-3 text-xs" style={{ color: 'var(--ink-3)' }}>Sending remains off. Source queue, holds, recipient and delivery checks are separate.</p>
          </details>)}
        </li>)}</ul>
      </article>)}</div>
    </section>}
    <aside className="mt-8 rounded-xl border p-5 text-sm leading-6" style={{ borderColor: 'var(--rule)', background: 'var(--paper-2)' }}>
      <h2 className="font-semibold mb-2">Before messages can move to Helm</h2>
      <p>Verify all six templates, the Guesty sent and pending queue, held messages, and the cleaner SMS handover. Then validate the Channex booking-channel delivery path. A matching time alone does not authorize a send.</p>
      <Link href="/properties/65_calderwood" className="mt-3 inline-block underline underline-offset-4">Review Calderwood’s property and access details →</Link>
    </aside>
  </>;
}
