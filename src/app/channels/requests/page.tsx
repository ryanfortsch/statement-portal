import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { isServiceConfigured } from '@/lib/supabase-admin';
import { loadRequestQueue, requestConflicts } from '@/lib/airbnb-request-queue.server';
import { REQUEST_PROPERTIES } from '@/lib/airbnb-request-notifications';
import { saveRequestReview } from './actions';
import styles from './requests.module.css';

export const dynamic = 'force-dynamic';
export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  if (!session?.user?.email?.endsWith('@risingtidestr.com')) redirect('/auth/signin?callbackUrl=%2Fchannels%2Frequests');
  const params = await searchParams;
  const enabled = process.env.AIRBNB_REQUEST_QUEUE_ENABLED === 'true';
  let queue: Awaited<ReturnType<typeof loadRequestQueue>> | null = null;
  let error = '';
  if (enabled && isServiceConfigured) {
    try { queue = await loadRequestQueue(); } catch { error = 'We could not load Quo notifications. Refresh to retry; this is not an empty inbox.'; }
  }
  const reviews = new Map(queue?.reviews.map(r => [r.message_id, r]));
  const conflicts = new Map<string, Awaited<ReturnType<typeof requestConflicts>>>();
  const reviewed = queue?.reviews ?? [];
  for (let offset = 0; offset < reviewed.length; offset += 10) {
    const batch = await Promise.all(reviewed.slice(offset, offset + 10).map(async review => [review.message_id, await requestConflicts(review)] as const));
    for (const [id, result] of batch) conflicts.set(id, result);
  }
  const pending = queue?.items.filter(i => !reviews.has(i.messageId)).length ?? 0;
  return <main className={styles.workspace}>
    <header className={styles.topbar}><Link href="/channels">helm. <span>/ Channels</span></Link><span className={styles.badge}>Review only</span></header>
    <section className={styles.heading}><div><p className={styles.eyebrow}>17 BEACH · REQUEST DESK</p><h1>Airbnb requests</h1><p>From notification to a verified property. Acceptance and replies stay in Airbnb.</p></div><Link className={styles.button} href="/channels/requests">Refresh</Link></section>
    <section className={styles.summary}><div><strong>{queue ? pending : '—'}</strong><span>Needs verification</span></div><div><strong>{queue ? reviews.size : '—'}</strong><span>Property reviewed</span></div><p>Quo notifications are leads, not confirmed stays. Calendar checks show recorded overlaps only.</p></section>
    {!enabled || !isServiceConfigured ? <div className={styles.notice}><h2>Ready for activation</h2><p>This queue is disabled. Apply its review-table migration and enable AIRBNB_REQUEST_QUEUE_ENABLED in the intended environment before using live notifications.</p></div> : null}
    {error ? <p role="alert" className={styles.notice}>{error}</p> : null}
    {typeof params.error === 'string' ? <p role="alert" className={styles.notice}>{params.error}</p> : null}
    {params.saved ? <p role="status" className={styles.notice}>Property review saved. No reservation was accepted and no calendar was changed.</p> : null}
    {queue && !queue.reviewsReady ? <p role="alert" className={styles.notice}>Review storage is unavailable. Notifications can be read, but assignments cannot be saved.</p> : null}
    {queue ? <p className={styles.scope}>Last 30 days · newest {queue.truncated ? '1,000 incoming Quo events only. Older events may be omitted.' : 'incoming Quo events'} · Recognized “requests to stay” notifications</p> : null}
    {queue && queue.items.length === 0 ? <div className={styles.empty}><h2>No matching requests in this window</h2><p>New signed Quo request notifications will appear here on refresh. This does not mean there are no pending requests in Airbnb.</p></div> : null}
    <div className={styles.list}>{queue?.items.map(item => {
      const review = reviews.get(item.messageId);
      const conflict = conflicts.get(item.messageId);
      return <article className={styles.card} key={item.messageId}>
        <div className={styles.cardTitle}><div className={styles.avatar}>{item.guest[0]}</div><div><h2>{item.guest}</h2><p>{item.datesText} <span>· {item.amountText} quoted in SMS</span></p></div><span className={styles.badge}>{review ? 'Property reviewed' : 'Unassigned request'}</span></div>
        <div className={styles.cardBody}><section><p className={styles.eyebrow}>SOURCE NOTIFICATION</p><blockquote>{item.body}</blockquote><p className={styles.scope}>Received {new Date(item.receivedAt).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET</p><a className={styles.primary} href={item.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open in Airbnb ↗</a><p className={styles.hint}>Check the listing and full dates after opening. An Airbnb sign-in may be required. This SMS sender is not the guest’s phone number.</p></section>
          <section className={styles.review}>{review ? <><p className={styles.eyebrow}>VERIFIED BY STAFF</p><h3>{review.property_id === 'other' ? 'Other property' : REQUEST_PROPERTIES[review.property_id].name}</h3><p>{review.check_in} → {review.check_out}</p><p className={conflict?.count ? styles.warning : styles.hint}>{conflict?.label}</p><p className={styles.hint}>Live availability and whole-house holds still need verification before acceptance. No hold has been placed by this queue.</p><a href={review.evidence_url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open verification link ↗</a><p className={styles.scope}>Reviewed by {review.reviewed_by}</p></> : <form action={saveRequestReview}>
            <input type="hidden" name="messageId" value={item.messageId} />
            <h3>Verify the property</h3><p className={styles.hint}>Read the Airbnb page, then record what it shows. Dates need an explicit year.</p>
            <label>Property<select name="property" required defaultValue=""><option value="" disabled>Choose after opening Airbnb</option>{Object.entries(REQUEST_PROPERTIES).map(([id,p]) => <option key={id} value={id}>{p.name}</option>)}<option value="other">Other property</option></select></label>
            <div className={styles.dates}><label>Arrival<input type="date" name="start" required /></label><label>Departure<input type="date" name="end" required /></label></div>
            <label>Opened reservation or listing URL<input name="evidence" type="url" placeholder="https://www.airbnb.com/hosting/stay/…" required /></label>
            <label className={styles.check}><input type="checkbox" name="verified" value="yes" required />I checked this property and these dates in Airbnb.</label>
            <button className={styles.primary} disabled={!queue.reviewsReady}>Save property review</button>
          </form>}</section></div>
      </article>;
    })}</div>
    <footer className={styles.footer}>Next: verify unit + whole-house calendars, protect the dates, then accept in Airbnb. This queue does not send messages, create bookings, place holds, or authorize acceptance.</footer>
  </main>;
}
