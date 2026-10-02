'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { BoardReport } from '@/lib/channex-staging/board';
import { nights, TEST_START, TEST_END, type Member } from '@/lib/channex-staging/core';
import styles from './staging.module.css';
import { BookingRehearsal } from './BookingRehearsal';
import { ShadowPlan } from './ShadowPlan';

const dates = nights(TEST_START, TEST_END);
const members: { id: Member; title: string; subtitle: string }[] = [
  { id: 'whole', title: 'Whole house', subtitle: 'Guesty calendar copy' },
  { id: 'front', title: 'Front unit', subtitle: 'Channex staging · 12 guests' },
  { id: 'back', title: 'Back unit', subtitle: 'Channex staging · 4 guests' },
];
const label = { clear: 'No conflict found', blocked: 'Blocked by a stay or closure', unknown: 'Unverified' };
const dateLabel = (date: string, short = false) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: short ? 'short' : 'long', day: 'numeric', ...(short ? {} : { year: 'numeric' }) });
const timeLabel = (date: string) => new Date(date).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function StagingBoard({ enabled }: { enabled: boolean }) {
  const [report, setReport] = useState<BoardReport | null>(null);
  const [busy, setBusy] = useState(enabled);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(31);
  const [selected, setSelected] = useState({ member: 'whole' as Member, date: '2027-02-01' });
  const [refreshCount, setRefreshCount] = useState(0);
  const refresh = () => { setBusy(true); setError(''); setRefreshCount((count) => count + 1); };
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch('/api/channels/staging', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) throw new Error('Your session expired. Sign in to refresh this workspace.');
        if (!response.ok) throw new Error('The staging workspace could not refresh. Try again in a moment.');
        return await response.json() as BoardReport;
      })
      .then((data) => { if (!controller.signal.aborted) setReport(data); })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) { setReport(null); setError(cause instanceof Error ? cause.message : 'The staging workspace could not refresh.'); }
      })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [enabled, refreshCount]);
  const visible = dates.slice(offset, offset + 14);
  const selectedCell = report?.cells.find((cell) => cell.member === selected.member && cell.date === selected.date);
  const parentNight = report?.parentNights.find((night) => night.date === selected.date);
  const inventory = report?.inventory.find((night) => night.unit === selected.member && night.date === selected.date);
  const allStopped = report?.stoppedNights === 240;
  const current = report?.currentParentNights ?? 0;
  const selectWindow = (next: number) => {
    const start = Math.min(Math.max(next, 0), dates.length - 14);
    setOffset(start); setSelected((old) => ({ ...old, date: dates[start] }));
  };

  return <div className={styles.workspace}>
    <header className={styles.topbar}>
      <Link href="/channels" className={styles.brand}>helm<span>.</span></Link>
      <span className={styles.breadcrumb}>Channels <span>/</span> 17 Beach</span>
      <span className={styles.environment}>Staging</span>
      <Link href="/channels/pilot" className={styles.quietLink}>Inbox & calendar pilot ↗</Link>
    </header>
    <main className={styles.main}>
      <div className={styles.heading}>
        <div><p className={styles.eyebrow}>17 BEACH · INTEGRATION WORKSPACE</p><h1>Three listings. One calendar.</h1><p className={styles.description}>Review the whole house alongside the two test units.</p></div>
        <div className={styles.refresh}><button type="button" onClick={() => void refresh()} disabled={busy || !enabled} aria-label="Refresh staging and whole-house calendar reads"><span aria-hidden="true">↻</span> {busy ? 'Reading…' : 'Refresh'}</button><span>{report ? `Read ${timeLabel(report.asOf)} ET` : 'Read-only workspace'}</span></div>
      </div>
      <div className={styles.notice}><span className={styles.noticeDot} /><p><strong>Review only.</strong> Refresh reads the sources. This workspace does not publish availability or change bookings.</p></div>
      {!enabled ? <section className={styles.empty}><h2>Staging connection is not enabled here</h2><p>This workspace runs in a configured development or preview environment. The staging key and Helm sign-in stay on the server.</p><Link href="/channels">Back to Channels →</Link></section> : <>
        {error && <div className={styles.error} role="alert">{error} <Link href="/auth/signin?callbackUrl=%2Fchannels%2Fstaging">Sign in</Link></div>}
        <section className={styles.summary} aria-label="Connection checks" aria-busy={busy}>
          <div><span>Test inventory</span><strong>{report ? allStopped ? 'Closed to sale' : 'Needs review' : '—'}</strong><small>{report ? `${report.stoppedNights} of 240 unit-nights verified stopped` : 'Checking January through April'}</small></div>
          <div><span>Whole-house coverage</span><strong>{report ? `${current} / 120 nights` : '—'}</strong><small>Calendar copies less than 2 hours old</small></div>
          <div><span>Active test stays</span><strong>{report ? report.bookings.filter((booking) => booking.status !== 'cancelled').length : '—'}</strong><small>{report ? `${report.bookings.filter((booking) => booking.status === 'cancelled').length} cancelled test stays` : 'Reading Channex staging'}</small></div>
        </section>
        {report && (!allStopped || report.overlapNights > 0) && <div className={styles.error} role="status">{!allStopped ? 'Stop-sell is not verified for every test night. Inspect the source before progressing. ' : ''}{report.overlapNights > 0 ? `${report.overlapNights} nights have a whole-house closure overlapping a test stay.` : ''}</div>}
        <section className={styles.sourceStrip} aria-label="Data sources">
          <div><span className={report?.channex.state === 'ready' ? styles.connectedDot : styles.pendingDot} /><strong>Channex staging</strong><p>{report?.channex.message ?? 'Checking the two pilot units…'}</p></div>
          <div><span className={report?.parent.state === 'ready' && current === 120 ? styles.connectedDot : styles.pendingDot} /><strong>Whole house · Guesty</strong><p>{report?.parent.message ?? 'Checking Helm’s existing calendar copy…'}</p></div>
        </section>
        <section className={styles.calendarSection} aria-label="Linked calendar review">
          <div className={styles.toolbar}>
            <div className={styles.months} aria-label="Pilot month">{['January', 'February', 'March', 'April'].map((month, index) => <button type="button" key={month} aria-pressed={visible[0]?.slice(5, 7) === String(index + 1).padStart(2, '0')} onClick={() => selectWindow(dates.indexOf(`2027-${String(index + 1).padStart(2, '0')}-01`))}>{month}<span> 2027</span></button>)}</div>
            <div className={styles.paging}><button type="button" aria-label="Previous 14 nights" disabled={offset === 0} onClick={() => selectWindow(offset - 14)}>←</button><span>{dateLabel(visible[0], true)} – {dateLabel(visible[visible.length - 1], true)}</span><button type="button" aria-label="Next 14 nights" disabled={offset >= dates.length - 14} onClick={() => selectWindow(offset + 14)}>→</button></div>
          </div>
          <div className={styles.reviewLayout}>
            <div className={styles.calendarPane}>
              <div className={styles.tableScroll} tabIndex={0} aria-label="Calendar; scroll horizontally on small screens">
                <table className={styles.calendar}><caption className={styles.srOnly}>Potential inventory conflicts, not published availability. Select a night for details.</caption><thead><tr><th scope="col">Listing</th>{visible.map((date) => <th key={date} scope="col" className={date === selected.date ? styles.selectedDate : ''}><span>{new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}</span><b>{Number(date.slice(-2))}</b></th>)}</tr></thead><tbody>{members.map((member) => <tr key={member.id}><th scope="row"><strong>{member.title}</strong><span>{member.subtitle}</span></th>{visible.map((date) => {
                  const cell = report?.cells.find((item) => item.member === member.id && item.date === date);
                  const state = cell?.state ?? 'unknown', active = selected.date === date && selected.member === member.id;
                  return <td key={date}><button type="button" className={`${styles.night} ${styles[state]} ${active ? styles.selectedNight : ''}`} onClick={() => setSelected({ member: member.id, date })} aria-pressed={active} aria-label={`${member.title}, ${dateLabel(date)}: ${label[state]}${cell?.overlap ? ', overlap to review' : ''}`} title={`${member.title}: ${label[state]}`}><span aria-hidden="true">{cell?.overlap ? '!' : state === 'blocked' ? '—' : state === 'unknown' ? '·' : ''}</span></button></td>;
                })}</tr>)}</tbody></table>
              </div>
              <div className={styles.legend}><span><i className={styles.clear} />No conflict found</span><span><i className={styles.blocked} />Stay / closure</span><span><i className={styles.unknown} />Unverified source</span></div>
              <p className={styles.calendarNote}>Empty nights are not an offer to book. Unit rates remain test-only; checkout days are excluded.</p>
            </div>
            <aside className={styles.inspector} aria-label="Selected night details" aria-live="polite">
              <p className={styles.eyebrow}>NIGHT DETAILS</p><h2>{dateLabel(selected.date, true)}<span>2027</span></h2><p className={styles.unitName}>{members.find((member) => member.id === selected.member)?.title}</p>
              <span className={`${styles.verdict} ${styles[selectedCell?.state ?? 'unknown']}`}>{label[selectedCell?.state ?? 'unknown']}</span>
              {selectedCell?.reasons.length ? <ul>{selectedCell.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul> : <p>{report ? 'No overlapping stays or closures found in the reviewed sources.' : 'Source checks appear here after the workspace loads.'}</p>}
              <dl><div><dt>Whole-house copy</dt><dd>{parentNight ? `${timeLabel(parentNight.syncedAt)} ET` : 'Not available'}</dd></div>{selected.member !== 'whole' && <><div><dt>Channex stop-sell</dt><dd>{inventory?.stopSell === true ? 'On' : inventory?.stopSell === false ? 'Off · review required' : 'Unverified'}</dd></div><div><dt>Arrival minimum</dt><dd>{inventory?.minStay ? `${inventory.minStay} nights` : 'Unverified'}</dd></div><div><dt>Raw inventory</dt><dd>{inventory?.inventory ?? 'Unverified'}</dd></div></>}</dl>
            </aside>
          </div>
        </section>
        <section className={styles.bookings} aria-label="Test bookings">
          <div className={styles.sectionHeading}><h2>Test bookings</h2><a href="https://staging.channex.io/bookings" target="_blank" rel="noreferrer">Open Channex ↗</a></div>
          <p>Current booking records, including cancelled stays. No guest details are imported.</p>
          {report?.bookings.length ? <div className={styles.bookingRows}>{report.bookings.map((booking) => <div key={`${booking.member}-${booking.bookingId}`} className={styles.bookingRow}><div><strong>{booking.member === 'front' ? 'Front unit' : 'Back unit'}</strong><small>Test stay · {booking.bookingId.slice(0, 8)}</small></div><span>{dateLabel(booking.checkIn, true)} → {dateLabel(booking.checkOut, true)}</span><span className={booking.status === 'cancelled' ? styles.cancelled : styles.activeBooking}>{booking.status === 'cancelled' ? 'Cancelled' : booking.status === 'modified' ? 'Updated' : 'Confirmed'}</span></div>)}</div> : <p className={styles.emptyBookings}>{report?.channex.state === 'ready' ? 'No test bookings found.' : busy ? 'Reading test bookings…' : 'Connect Channex staging to see test bookings.'}</p>}
        </section>
        {report && <ShadowPlan key={report.asOf} report={report} />}
        <BookingRehearsal />
        <footer className={styles.footer}><span>January–April pilot · America/New_York</span><span>Read-only · Manual refresh · No calendar publishing</span></footer>
      </>}
    </main>
  </div>;
}
