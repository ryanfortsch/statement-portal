'use client';

import { useState } from 'react';
import { AutomationHoldControls } from '@/components/AutomationHoldControls';
import { holdReleaseBlockReason } from '@/lib/automation-hold-control';

const planned = { property_id: 'synthetic-home', planned_check_in: '2027-01-01', planned_check_out: '2027-01-04' };
const confirmed = { property_id: 'synthetic-home', status: 'confirmed', duplicate_of: null, check_in: '2027-01-01', check_out: '2027-01-04' };
const scenarios = ['Confirmed', 'Cancelled', 'Unconfirmed', 'Dates changed', 'Duplicate', 'Unavailable', 'Controls disabled'] as const;
type Scenario = typeof scenarios[number];
export function HoldRehearsal() {
  const [scenario, setScenario] = useState<Scenario>('Confirmed');
  const [held, setHeld] = useState(true);
  const [notice, setNotice] = useState('');
  const booking = scenario === 'Unavailable' ? undefined : { ...confirmed,
    status: scenario === 'Cancelled' ? 'cancelled' : scenario === 'Unconfirmed' ? 'pending' : 'confirmed',
    check_in: scenario === 'Dates changed' ? '2027-01-02' : confirmed.check_in,
    duplicate_of: scenario === 'Duplicate' ? 'synthetic-canonical' : null };
  const reason = holdReleaseBlockReason(planned, booking);
  return <main style={{ maxWidth: 720, padding: 24, margin: '0 auto', lineHeight: 1.6 }}>
    <h1>Message hold rehearsal</h1>
    <p><strong>Synthetic data only.</strong> These controls change browser memory. They do not call the database or send messages. Refresh resets the rehearsal.</p>
    <label htmlFor="hold-scenario">Booking situation </label>
    <select id="hold-scenario" value={scenario} onChange={event => { setScenario(event.target.value as Scenario); setHeld(true); setNotice(''); }}>
      {scenarios.map(value => <option key={value}>{value}</option>)}
    </select>
    <section style={{ border: '1px solid var(--rule)', padding: 20, marginTop: 20 }}>
      <h2>Sample guest: arrival message</h2>
      <p>Status: <strong>{held ? 'Held by operator' : 'Scheduled (simulation)'}</strong></p>
      <p>Planned stay: January 1 to January 4, 2027.</p>
      {held ? <AutomationHoldControls blockedReason={reason} pending={false}
        onRelease={scenario !== 'Controls disabled' && !reason ? () => { setHeld(false); setNotice('Simulated release completed. Nothing was sent.'); } : undefined} />
        : <button type="button" onClick={() => { setHeld(true); setNotice('Simulated hold completed.'); }}>Hold this message</button>}
      <p role="status" aria-live="polite">{notice}</p>
    </section>
    <p>This checks the shared controls and booking explanations. Database persistence and competing worker actions are tested separately.</p>
  </main>;
}
