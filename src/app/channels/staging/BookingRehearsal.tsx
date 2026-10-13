'use client';

import { useState } from 'react';
import { bookingRehearsal, REHEARSAL_DATES } from '@/lib/channex-staging/rehearsal';
import styles from './staging.module.css';

export function BookingRehearsal() {
  const [steps] = useState(bookingRehearsal);
  const [selected, setSelected] = useState('whole-booked');
  const step = steps.find((item) => item.id === selected)!;
  const passed = steps.filter((item) => item.passed).length;
  return <details className={styles.rehearsal}>
    <summary><span>Booking-rule rehearsal</span><small>{passed} / {steps.length} synthetic checks</small></summary>
    <p className={styles.rehearsalScope}>Simulated bookings and calendar events. These results test the calculation; they do not verify live Guesty synchronization or change any booking.</p>
    <div className={styles.rehearsalLayout}>
      <div className={styles.scenarios} role="group" aria-label="Booking rehearsal scenarios">{steps.map((item, index) => <button key={item.id} type="button" aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><span>{String(index + 1).padStart(2, '0')}</span>{item.title}<small>{item.passed ? 'Pass' : 'Review'}</small></button>)}</div>
      <div className={styles.scenarioResult} aria-live="polite">
        <p className={styles.eyebrow}>SYNTHETIC SCENARIO</p><h2>{step.title}</h2><p>{step.explanation}</p>
        <table><caption>Calculated inventory · February 2027</caption><thead><tr><th scope="col">Night</th><th scope="col">Whole</th><th scope="col">Front</th><th scope="col">Back</th></tr></thead><tbody>{REHEARSAL_DATES.map((date) => <tr key={date}><th scope="row">Feb {Number(date.slice(-2))}</th>{(['whole', 'front', 'back'] as const).map((member) => {
          const cell = step.cells.find((item) => item.date === date && item.member === member)!;
          return <td key={member}><span className={`${styles.verdict} ${styles[cell.state]}`}>{cell.state === 'clear' ? 'Unoccupied' : cell.state === 'unknown' ? 'Unverified' : 'Closed'}</span></td>;
        })}</tr>)}</tbody></table>
        {!step.passed && <p className={styles.error} role="alert">Calculation differs from the expected result: {step.mismatches.join(', ')}</p>}
        {step.overlapNights > 0 && <p className={styles.error}>Overlap detected on {step.overlapNights} nights. Both simulated bookings are retained for review.</p>}
        <p className={styles.rehearsalScope}>Unverified nights calculate as zero inventory. All API tests retain stop-sell and the 20-night minimum. Whole-house closures are calculated only; nothing is sent to Guesty.</p>
      </div>
    </div>
  </details>;
}
