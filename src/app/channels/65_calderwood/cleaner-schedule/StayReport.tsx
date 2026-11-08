import type { CleanerStayReport } from '@/lib/cleaner-stay-report';
import styles from './report.module.css';

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T12:00:00Z`));
}
function clock(value: string | null) {
  if (!value) return 'Time not set';
  const [h, m] = value.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h >= 12 ? 'PM' : 'AM'}`;
}

export function StayReport({ report }: { report: CleanerStayReport }) {
  return <section className={styles.report} aria-labelledby="stay-report-title">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>Guest stays</p><h2 id="stay-report-title">{report.propertyName}</h2>
        <p>Current stays and arrivals through {dateLabel(report.through)}.</p></div>
      <div className={styles.count}><strong>{report.stays.length}</strong><span>{report.stays.length === 1 ? 'stay' : 'stays'}</span></div>
    </header>
    <p className={styles.explanation}>Ready by is the home’s cleaning deadline. Guest check-in times are reviewed in Message handover. Departure times include confirmed checkout adjustments. Review any agreed exceptions before sharing.</p>
    {report.guestCountCheck && <p className={styles.explanation} role="status">
      {report.guestCountCheck.status === 'verified' && report.guestCountCheck.checkedAt
        ? <>Missing guest counts verified with Guesty at {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' }).format(new Date(report.guestCountCheck.checkedAt))}. This preview does not change booking records.</>
        : <>Some guest counts could not be verified with Guesty. Unknown counts stay blank; reload to try again.</>}
    </p>}
    {report.stays.length === 0 ? <p className={styles.empty}>No confirmed guest stays in this window.</p> :
      <ol className={styles.list}>{report.stays.map(stay => <li key={stay.checkIn} className={styles.stay}>
        <div className={styles.dates}>
          <div><span className={styles.label}>Arrival day</span><time dateTime={stay.checkIn}>{dateLabel(stay.checkIn)}</time><span>{stay.arrivalTime ? `Ready by ${clock(stay.arrivalTime)}` : 'Ready-by time not set'}</span></div>
          <span className={styles.arrow} aria-hidden="true">→</span>
          <div><span className={styles.label}>Departure</span><time dateTime={stay.checkOut}>{dateLabel(stay.checkOut)}</time><span>{clock(stay.checkoutTime)}</span></div>
          <div className={styles.guests}><span className={styles.label}>Guests</span><strong>{stay.guests ?? '—'}</strong>{stay.guests === null && <small>Not verified</small>}{stay.guestCountSource === 'guesty' && <small>Guesty verified</small>}</div>
        </div>
        {(stay.staying || stay.adjusted || stay.noCleaning || stay.needsReview) && <div className={styles.badges}>
          {stay.staying && <span>Current stay</span>}
          {stay.adjusted && <span>Checkout adjusted</span>}
          {stay.noCleaning && <span>No checkout cleaning</span>}
          {stay.needsReview && <span className={styles.review}>Dates need review</span>}
        </div>}
      </li>)}</ol>}
    <footer className={styles.footer}>Guest names, contact details, access codes and prices are excluded. Owner holds and cleaning assignments remain on the cleaning schedule.</footer>
  </section>;
}
