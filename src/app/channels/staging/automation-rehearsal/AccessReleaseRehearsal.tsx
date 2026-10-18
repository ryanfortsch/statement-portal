'use client';
import { useState } from 'react';
import { reviewCalderwoodAccessRelease, type AccessReleaseInput } from '@/lib/calderwood-rehearsal/access-release';

const situations = ['Form complete before 3 PM', '3 PM, form incomplete', '3 PM, form complete', '3 PM, operator hold',
  '3 PM, hold state unknown', 'Changed stay, old evidence', 'Cancelled stay', 'After checkout', 'Stale evidence', 'Code unverified'] as const;
export function AccessReleaseRehearsal() {
  const [situation, setSituation] = useState<typeof situations[number]>('Form complete before 3 PM');
  const input: AccessReleaseInput = {
    now: new Date('2027-01-15T20:00:00Z'), maxEvidenceAgeMs: 300000,
    stay: { propertyId: 'fictional-home', reservationId: 'fictional-stay', revision: 'r1', status: 'confirmed',
      clockVerified: true, arrivalAt: '2027-01-15T21:00:00Z', departureAt: '2027-01-18T16:00:00Z' },
    evidence: { propertyId: 'fictional-home', reservationId: 'fictional-stay', revision: 'r1',
      observedAt: '2027-01-15T20:00:00Z', form: 'complete', hold: 'clear', credential: 'ready' },
  };
  if (situation === 'Form complete before 3 PM') {
    input.now = new Date('2027-01-15T19:59:00Z'); input.evidence!.observedAt = input.now.toISOString();
  }
  if (situation === '3 PM, form incomplete') input.evidence!.form = 'incomplete';
  if (situation === '3 PM, operator hold') input.evidence!.hold = 'held';
  if (situation === '3 PM, hold state unknown') input.evidence!.hold = 'unknown';
  if (situation === 'Changed stay, old evidence') {
    input.stay.revision = 'r2'; input.stay.arrivalAt = '2027-01-16T21:00:00Z';
  }
  if (situation === 'Cancelled stay') input.stay.status = 'cancelled';
  if (situation === 'After checkout') input.now = new Date('2027-01-18T16:00:00Z');
  if (situation === 'Stale evidence') input.evidence!.observedAt = '2027-01-15T19:54:00Z';
  if (situation === 'Code unverified') input.evidence!.credential = 'unknown';
  const result = reviewCalderwoodAccessRelease(input);
  return <section aria-labelledby="access-release-rehearsal" style={{ border: '1px solid var(--rule)', padding: 20, marginTop: 24 }}>
    <h2 id="access-release-rehearsal">Portal and code-release rehearsal</h2>
    <p>Fictional January 15 arrival at 4 PM Eastern. The code message keeps its existing 3 PM time. Completing the contact form unlocks non-code property information; code disclosure also respects release time and any operator hold.</p>
    <label htmlFor="access-release-situation">Access situation </label>
    <select id="access-release-situation" value={situation} onChange={event => setSituation(event.target.value as typeof situation)}>
      {situations.map(value => <option key={value}>{value}</option>)}
    </select>
    <dl aria-live="polite" style={{ marginTop: 16 }}>
      {([['Portal property information', result.portalInformation], ['Code-message timing', result.codeMessageTiming], ['Portal code disclosure', result.portalCode]] as const).map(([label, decision]) => <div key={label} style={{ marginBottom: 16 }}>
        <dt><strong>{label}: {decision.status === 'candidate' ? 'Eligible for review' : 'Withheld'}</strong></dt>
        <dd style={{ margin: 0 }}>{decision.reason}</dd>
      </div>)}
    </dl>
    <p>No real code is loaded, displayed or sent. This checks policy only. Production needs reservation-scoped authorization, current server-side evidence and message history/ownership checks. The sample uses a five-minute evidence limit; production policy is still pending. A hold cannot retract a code a guest already received.</p>
  </section>;
}
