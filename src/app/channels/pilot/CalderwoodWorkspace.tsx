'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { addDays, baseline, canonicalBookings, compareReservations, freshness, intersects, localDay, occupancyEvents, validDay, type WorkspaceData } from '@/lib/calderwood-workspace';
import { CHANNEL_LABELS } from '@/lib/channels-types';
import s from './workspace.module.css';

function channelLabel(channel: string) { return CHANNEL_LABELS[channel as keyof typeof CHANNEL_LABELS] ?? channel; }
function dateLabel(day: string) { return validDay(day) ? new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'Unknown date'; }
function timestamp(value: string | null) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : 'Not recorded'; }
function money(value: number | null, currency: string | null) {
  if (value == null || !Number.isFinite(Number(value))) return 'Not captured';
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return `${Number(value).toLocaleString('en-US')} · currency unknown`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value));
}

export function CalderwoodWorkspace({ data }: { data: WorkspaceData }) {
  const today = localDay(data.asOf);
  const [start, setStart] = useState(today);
  const [daysCount, setDaysCount] = useState(14);
  const [tab, setTab] = useState<'calendar' | 'reservations' | 'baseline'>('calendar');
  const [query, setQuery] = useState('');
  const [channel, setChannel] = useState('all');
  const [selection, setSelection] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  useEffect(() => { if (selection) detailRef.current?.focus({ preventScroll: true }); }, [selection]);
  const guestyTimes = data.guesty.map(g => g.synced_at).filter((value): value is string => !!value && Number.isFinite(Date.parse(value))).sort();
  const end = addDays(start, daysCount);
  const days = Array.from({ length: daysCount }, (_, i) => addDays(start, i));
  const bookings = canonicalBookings(data.bookings);
  const comparisons = compareReservations(data.bookings, data.guesty);
  const problems = comparisons.filter(c => c.issues.length);
  const allEvents = occupancyEvents(data);
  const matches = (name: string | null, source: string, code = '') => (!query || `${name ?? ''} ${code}`.toLowerCase().includes(query.toLowerCase())) && (channel === 'all' || channelLabel(source).toLowerCase() === channelLabel(channel).toLowerCase());
  const events = allEvents.filter(e => intersects(e.start, e.end, start, end) && matches(e.label, e.channel, bookings.find(b => b.id === e.bookingId)?.external_confirmation_code ?? ''));
  const rows = bookings.filter(b => intersects(b.check_in, b.check_out, start, end) && (showCancelled || b.status !== 'cancelled') && matches(b.guest_name, b.channel, b.external_confirmation_code ?? '')).sort((a, b) => a.check_in.localeCompare(b.check_in));
  const selectedBooking = bookings.find(b => b.id === selection);
  const selectedEvent = allEvents.find(e => e.id === selection);
  const selectedComparison = comparisons.find(c => `guesty:${c.guesty.guesty_reservation_id}` === selection);
  const selectedIssues = selectedBooking ? comparisons.filter(c => c.booking?.id === selectedBooking.id).flatMap(c => c.issues) : selectedComparison?.issues ?? [];
  const comparisonAvailable = !data.sources.bookings && !data.sources.guesty;
  const sourceErrors = Object.values(data.sources).filter(Boolean);
  const overlapDays = days.filter(day => allEvents.filter(e => e.kind === 'booking' && e.start <= day && e.end > day).length > 1);
  const invalidBookings = bookings.filter(b => !validDay(b.check_in) || !validDay(b.check_out) || b.check_in >= b.check_out);
  const lanes: string[] = [];
  const placed = events.map(event => {
    let lane = lanes.findIndex(last => last <= event.start);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = event.end;
    return { event, lane };
  });
  function exportBaseline() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(baseline(data), null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `65-calderwood-baseline-${today}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className={s.workspace}>
    <header className={s.topbar}><Link href="/channels" className={s.brand}>⌂ <strong>Helm</strong><span> / Channels</span></Link><span className={s.live}>Read-only reservation review</span><Link href="/">Back to Helm ↗</Link></header>
    <div className={s.layout}>
      <aside className={s.sidebar}>
        <p className={s.eyebrow}>PROPERTY WORKSPACE</p><h1>65 Calderwood</h1><p className={s.address}>{data.property?.address ?? 'Property address not loaded'}</p><span className={s.pill}>Read-only pilot</span>
        <nav aria-label="Calderwood workspace">{([['calendar', '▦', 'Calendar'], ['reservations', '▤', 'Reservations'], ['baseline', '≡', 'Migration baseline']] as const).map(([key, icon, label]) => <button key={key} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}><span aria-hidden>{icon}</span>{label}</button>)}</nav>
        <div className={s.sidebarLinks}><Link href="/messaging">Existing guest messaging ↗</Link></div>
        <div className={s.sidebarNote}><strong>One property at a time</strong><p>This workspace reviews imported records. It does not change calendar authority or channel connections.</p></div>
      </aside>
      <main className={s.main}>
        <div className={s.heading}><div><p className={s.eyebrow}>65 CALDERWOOD / {tab === 'baseline' ? 'BASELINE' : 'OPERATIONS'}</p><h2>{tab === 'calendar' ? 'Calendar' : tab === 'reservations' ? 'Reservations' : 'Migration baseline'}</h2><p>Imported records, with the evidence to check them.</p></div><div className={s.snapshot}><span>Snapshot {timestamp(data.asOf)}</span><button onClick={() => window.location.reload()}>Refresh records</button></div></div>
        {sourceErrors.length > 0 && <div role="alert" className={s.warning}><strong>Some records are unavailable.</strong> {sourceErrors.join('. ')}. Missing data is not an empty calendar.</div>}
        <div className={s.summary}>
          <div><span>Upcoming / in progress</span><strong>{data.sources.bookings ? '—' : bookings.filter(b => ['confirmed', 'completed'].includes(b.status) && b.check_out > today).length}</strong><small>Helm stays · excludes duplicate rows</small></div>
          <div><span>Reservation differences</span><strong>{comparisonAvailable ? problems.length : '—'}</strong><small>{comparisonAvailable ? 'Against imported Guesty records' : 'Comparison unavailable'}</small></div>
          <div><span>Blocked dates captured</span><strong>{data.sources.blocks ? '—' : data.blocks.length}</strong><small>Guesty blocks · coverage unverified</small></div>
        </div>
        {tab !== 'baseline' && <>
          <div className={s.toolbar}>
            <label className={s.search}><span className={s.srOnly}>Search guest or confirmation code</span><input type="search" placeholder="Search guest or confirmation…" value={query} onChange={e => setQuery(e.target.value)} /></label>
            <label><span className={s.srOnly}>Channel</span><select value={channel} onChange={e => setChannel(e.target.value)}><option value="all">All channels</option>{['airbnb', 'vrbo', 'booking_com', 'direct', 'manual', 'block', 'other', 'guesty'].map(c => <option key={c} value={c}>{channelLabel(c)}</option>)}</select></label>
            <div className={s.dates}><button aria-label="Previous period" onClick={() => setStart(addDays(start, -daysCount))}>‹</button><label><span className={s.srOnly}>Period start</span><input type="date" value={start} onChange={e => validDay(e.target.value) && setStart(e.target.value)} /></label><button aria-label="Next period" onClick={() => setStart(addDays(start, daysCount))}>›</button><button onClick={() => setStart(today)}>Today</button></div>
            <label><span className={s.srOnly}>Period length</span><select value={daysCount} onChange={e => setDaysCount(Number(e.target.value))}><option value={14}>14 nights</option><option value={28}>28 nights</option></select></label>
          </div>
          <div className={s.range}><strong>{dateLabel(start)} – {dateLabel(addDays(end, -1))}</strong><span>America/New_York · checkout day excluded</span></div>
          {overlapDays.length > 0 && <div className={s.warning}>{overlapDays.length} nights have overlapping Helm records in this period. Review before relying on occupancy; these may be duplicate records.</div>}
          {invalidBookings.length > 0 && <div className={s.warning}>{invalidBookings.length} Helm records have invalid dates and cannot be plotted. They remain in the baseline export.</div>}
          {tab === 'calendar' ? <section className={s.calendar} aria-label="Calderwood occupancy calendar">
            <div className={s.calendarLabel}><strong>65 Calderwood</strong><span>{events.length} visible stays / block ranges</span></div>
            <div className={s.calendarScroll}><div style={{ minWidth: daysCount * 58 }}>
              <div className={s.dayHeader} style={{ gridTemplateColumns: `repeat(${daysCount},1fr)` }}>{days.map(day => <div key={day} className={day === today ? s.today : ''}><span>{new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}</span><strong>{day.slice(8)}</strong><small>{day.slice(5, 7)}</small></div>)}</div>
              <div className={s.tracks} style={{ height: Math.max(170, lanes.length * 46 + 28) }}>
                <div className={s.gridLines} style={{ gridTemplateColumns: `repeat(${daysCount},1fr)` }}>{days.map(day => <div key={day} className={day === today ? s.todayLine : ''} />)}</div>
                {placed.map(({ event, lane }) => {
                  const left = Math.max(0, (Date.parse(event.start) - Date.parse(start)) / 86400000);
                  const right = Math.min(daysCount, (Date.parse(event.end) - Date.parse(start)) / 86400000);
                  return <button key={event.id} className={`${s.bar} ${event.kind === 'guesty' ? s.guestyBar : event.kind === 'block' || event.status === 'block' ? s.blockBar : ''}`} style={{ left: `${left / daysCount * 100}%`, width: `${(right - left) / daysCount * 100}%`, top: lane * 46 + 16 }} aria-label={`${event.label}, ${dateLabel(event.start)} to ${dateLabel(event.end)}, ${event.kind === 'guesty' ? 'Guesty discrepancy' : channelLabel(event.channel)}`} aria-pressed={selection === event.id} title={`${event.label} · ${event.start} → ${event.end}`} onClick={() => setSelection(event.id)}><span className={s.channelIcon}>{event.kind === 'block' ? '⊘' : event.kind === 'guesty' ? '!' : channelLabel(event.channel).slice(0, 1)}</span><span>{event.label}</span></button>;
                })}
                {!events.length && <p className={s.calendarEmpty}>{sourceErrors.length ? 'Some occupancy sources are unavailable.' : query || channel !== 'all' ? 'No records match these filters.' : 'No recorded occupancy in this period.'}</p>}
              </div>
            </div></div>
            <div className={s.legend}><span><i /> Helm stay</span><span><i className={s.blockSwatch} /> Calendar block</span><span><i className={s.guestySwatch} /> Guesty discrepancy</span></div>
            <p className={s.caption}>Empty nights are unverified, not confirmed availability. Pending requests are in Reservations. Separate calendar blocks do not include a reason in the source.</p>
          </section> : <section className={s.card}><div className={s.listHeader}><strong>{rows.length} records in this period</strong><label><input type="checkbox" checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)} /> Include cancelled</label></div><div className={s.tableScroll}><table><thead><tr><th>Guest / confirmation</th><th>Channel</th><th>Arrival → departure</th><th>Status</th><th>Source</th></tr></thead><tbody>{rows.map(b => <tr key={b.id}><td><button className={s.textButton} onClick={() => setSelection(b.id)}>{b.guest_name ?? 'Guest name unavailable'}</button><small>{b.external_confirmation_code ?? 'No confirmation code'}</small></td><td>{channelLabel(b.channel)}</td><td className={s.nowrap}>{dateLabel(b.check_in)} → {dateLabel(b.check_out)}</td><td>{b.status}</td><td>{b.source.replaceAll('_', ' ')}</td></tr>)}</tbody></table></div>{!rows.length && <p className={s.empty}>No matching records in this period. Check source status and filters.</p>}</section>}
        </>}
        {tab === 'baseline' && <section className={s.card}>
          <div className={s.listHeader}><div><h3>Evidence captured so far</h3><p className={s.caption}>Export this snapshot before comparing it with Guesty. This is not a complete migration backup.</p></div><button disabled={!data.configured} onClick={exportBaseline}>Download baseline JSON</button></div>
          <div className={s.baselineRows}>{[
            ['Reservations', data.sources.bookings ?? `${bookings.length} canonical Helm records · ${data.bookings.length - bookings.length} duplicate rows excluded`],
            ['Guesty comparison', data.sources.guesty ?? `${data.guesty.length} imported reservation records · not a live API pull`],
            ['Calendar blocks', data.sources.blocks ?? `${data.blocks.length} dated blocks · source coverage has not been verified`],
            ['Rates, fees & policies', 'Still needed: current nightly prices, stay restrictions, listing fees and cancellation policies.'],
            ['Payments & balances', 'Still needed: deposits, outstanding balances, refunds and settlement records. Booking amounts alone are insufficient.'],
            ['Messages & operations', 'Still needed: conversation history, scheduled messages, templates, cleaner handoff and access instructions.'],
          ].map(([name, detail]) => <div key={name}><strong>{name}</strong><p>{detail}</p></div>)}</div>
        </section>}
        <p className={s.caption}>Guesty record imports: {guestyTimes.length ? `${timestamp(guestyTimes[0])} – ${timestamp(guestyTimes.at(-1)!)}. Oldest copy: ${freshness(guestyTimes[0], data.asOf, 30).toLowerCase()}.` : 'No import timestamps available.'} Snapshot time is the time this page read the database.</p>
        <section className={s.card}>
          <div className={s.listHeader}><div><h3>Reservation reconciliation</h3><p className={s.caption}>All imported dates · explicit IDs and confirmation codes only. No records are changed.</p></div><span className={s.pill}>{comparisonAvailable ? `${problems.length} to review` : 'Unavailable'}</span></div>
          {!comparisonAvailable ? <p className={s.empty}>Both reservation sources must load before a comparison is meaningful.</p> : !problems.length ? <p className={s.empty}>{data.guesty.length ? 'No date/status differences found among imported Guesty records. This does not verify live channels or financial parity.' : 'No Guesty records were returned; parity is unverified.'}</p> : <div className={s.issueList}>{problems.map(c => <button key={c.guesty.guesty_reservation_id} onClick={() => setSelection(`guesty:${c.guesty.guesty_reservation_id}`)}><span><strong>{c.guesty.guest_name ?? c.guesty.confirmation_code ?? 'Guesty reservation'}</strong><small>{c.guesty.check_in ?? '?'} → {c.guesty.check_out ?? '?'}</small></span><span>{c.issues.join(' · ')} ↗</span></button>)}</div>}
          <p className={s.caption}>Helm-only records: {comparisonAvailable ? bookings.filter(b => !comparisons.some(c => c.booking?.id === b.id)).length : 'unknown'}. These may be direct stays or calendar imports; they are not automatically errors.</p>
        </section>
        <section className={s.card}><div className={s.listHeader}><h3>Calendar feed health</h3><span className={s.caption}>iCal import status only</span></div><div className={s.feeds}>{data.feeds.map(f => <div key={f.id}><strong>{channelLabel(f.channel)}</strong><span>{!f.is_active ? 'Inactive' : !f.ical_import_enabled ? 'Feed disabled' : f.last_import_status === 'error' ? 'Import failed' : f.last_import_status !== 'success' ? 'No successful import' : freshness(f.last_imported_at, data.asOf, 1.5)}</span><small>{timestamp(f.last_imported_at)}</small></div>)}</div>{!data.feeds.length && <p className={s.empty}>Feed status {data.sources.feeds ? 'unavailable' : 'not recorded'}.</p>}<p className={s.caption}>A recent iCal import does not prove rates, messaging or outbound connectivity.</p></section>
      </main>
      {selection && <aside ref={detailRef} tabIndex={-1} onKeyDown={e => { if (e.key === 'Escape') setSelection(null); }} className={s.detail} aria-label="Reservation details"><div className={s.detailHeader}><span>65 Calderwood</span><button aria-label="Close reservation details" onClick={() => setSelection(null)}>×</button></div>
        <p className={s.eyebrow}>READ-ONLY RECORD</p><h2>{selectedBooking?.guest_name ?? selectedComparison?.guesty.guest_name ?? selectedEvent?.label ?? 'Reservation'}</h2>
        {selectedIssues.length > 0 && <div className={s.warning}>{[...new Set(selectedIssues)].join(' · ')}</div>}
        {selectedBooking ? <>
          <span className={s.pill}>{channelLabel(selectedBooking.channel)} · {selectedBooking.status}</span>
          <dl><dt>Arrival</dt><dd>{dateLabel(selectedBooking.check_in)}</dd><dt>Departure</dt><dd>{dateLabel(selectedBooking.check_out)}</dd><dt>Guests</dt><dd>{selectedBooking.num_guests ?? 'Not captured'}</dd><dt>Confirmation</dt><dd>{selectedBooking.external_confirmation_code ?? 'Not captured'}</dd></dl>
          <h3>Recorded amounts</h3><dl>{([['Gross', selectedBooking.gross_amount], ['Cleaning', selectedBooking.cleaning_fee], ['Taxes', selectedBooking.taxes], ['Payout', selectedBooking.payout]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{money(value, selectedBooking.currency)}</dd></div>)}</dl><p className={s.caption}>Imported booking amounts. Outstanding balance and payment status have not been captured here.</p>
          <h3>Source evidence</h3><dl><dt>Source</dt><dd>{selectedBooking.source.replaceAll('_', ' ')}</dd><dt>Last seen</dt><dd>{timestamp(selectedBooking.last_seen_at)}</dd><dt>Updated</dt><dd>{timestamp(selectedBooking.updated_at)}</dd><dt>External ID</dt><dd>{selectedBooking.external_booking_id ?? 'Not recorded'}</dd></dl>
        </> : selectedComparison ? <><h3>Guesty copy</h3><dl><dt>Dates</dt><dd>{selectedComparison.guesty.check_in ?? '?'} → {selectedComparison.guesty.check_out ?? '?'}</dd><dt>Status</dt><dd>{selectedComparison.guesty.status ?? 'Unknown'}</dd><dt>Imported</dt><dd>{timestamp(selectedComparison.guesty.synced_at)}</dd><dt>Freshness</dt><dd>{freshness(selectedComparison.guesty.synced_at, data.asOf, 30)}</dd><dt>Guesty ID</dt><dd>{selectedComparison.guesty.guesty_reservation_id}</dd></dl><h3>Helm copy</h3>{selectedComparison.booking ? <><p>{selectedComparison.booking.check_in} → {selectedComparison.booking.check_out} · {selectedComparison.booking.status}</p><button onClick={() => setSelection(selectedComparison.booking!.id)}>Inspect Helm record</button></> : <p>No unique canonical match. Review the IDs in Guesty before changing anything.</p>}</> : selectedEvent ? <><p>{dateLabel(selectedEvent.start)} → {dateLabel(selectedEvent.end)}</p><p>Blocked nights copied from Guesty. Reason and complete source coverage are not stored.</p></> : <p>This record is no longer present in the snapshot.</p>}
        <div className={s.sidebarNote}>This workspace cannot change reservations or channel connections.</div>
      </aside>}
    </div>
  </div>;
}
