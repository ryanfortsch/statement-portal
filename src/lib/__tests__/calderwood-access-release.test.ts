import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewCalderwoodAccessRelease, type AccessReleaseInput } from '../calderwood-rehearsal/access-release.ts';
const base: AccessReleaseInput = {
  now: new Date('2027-01-15T20:00:00Z'), maxEvidenceAgeMs: 300000,
  stay: { propertyId: 'fictional-home', reservationId: 'fictional-stay', revision: 'r1',
    status: 'confirmed', clockVerified: true, arrivalAt: '2027-01-15T21:00:00Z', departureAt: '2027-01-18T16:00:00Z' },
  evidence: { propertyId: 'fictional-home', reservationId: 'fictional-stay', revision: 'r1',
    observedAt: '2027-01-15T20:00:00Z', form: 'complete', hold: 'clear', credential: 'ready' },
};
const review = (changes: Partial<AccessReleaseInput> = {}) => reviewCalderwoodAccessRelease({ ...base, ...changes });
function allWithheld(result: ReturnType<typeof review>) {
  for (const key of ['portalInformation', 'codeMessageTiming', 'portalCode'] as const) assert.equal(result[key].status, 'withheld');
  assert.equal(result.canSend, false); assert.equal(result.canReveal, false);
}
test('form completion cannot bypass the existing release time, including summer time', () => {
  for (const [arrivalAt, departureAt, releaseAt] of [
    ['2027-01-15T21:00:00Z','2027-01-18T16:00:00Z','2027-01-15T20:00:00Z'],
    ['2027-07-15T20:00:00Z','2027-07-18T15:00:00Z','2027-07-15T19:00:00Z'],
  ]) {
    const before = new Date(Date.parse(releaseAt) - 1);
    const input = { stay: { ...base.stay, arrivalAt, departureAt }, now: before,
      evidence: { ...base.evidence!, observedAt: before.toISOString() } };
    const result = review(input);
    assert.equal(result.releaseAt, new Date(releaseAt).toISOString());
    assert.equal(result.portalInformation.status, 'candidate');
    assert.equal(result.codeMessageTiming.status, 'withheld');
    assert.equal(result.portalCode.status, 'withheld');
    const at = review({ ...input, now: new Date(releaseAt) });
    assert.equal(at.codeMessageTiming.status, 'candidate'); assert.equal(at.portalCode.status, 'candidate');
    assert.equal(at.canSend, false); assert.equal(at.canReveal, false);
  }
});
test('form completion applies to the portal without silently changing the existing code-message prerequisite', () => {
  for (const form of ['incomplete', 'unknown'] as const) {
    const result = review({ evidence: { ...base.evidence!, form } });
    assert.equal(result.codeMessageTiming.status, 'candidate');
    assert.equal(result.portalCode.status, 'withheld'); assert.equal(result.portalInformation.status, 'withheld');
  }
});
test('held or unknown hold state blocks both code paths after the form is completed', () => {
  for (const hold of ['held', 'unknown'] as const) {
    const result = review({ evidence: { ...base.evidence!, hold } });
    assert.equal(result.portalInformation.status, 'candidate');
    assert.equal(result.portalCode.status, 'withheld'); assert.equal(result.codeMessageTiming.status, 'withheld');
  }
});
test('missing or unverified credential cannot become a release candidate', () => {
  for (const credential of ['missing', 'unknown'] as const) {
    const result = review({ evidence: { ...base.evidence!, credential } });
    assert.equal(result.portalCode.status, 'withheld'); assert.equal(result.codeMessageTiming.status, 'withheld');
  }
});
test('changed identity or revision cannot reuse form/hold evidence', () => {
  for (const key of ['propertyId', 'reservationId', 'revision'] as const)
    allWithheld(review({ stay: { ...base.stay, [key]: 'changed' } }));
  allWithheld(review({ evidence: null }));
});
test('canceled, unconfirmed and ended stays do not disclose information', () => {
  for (const status of ['cancelled', 'pending', 'unknown']) allWithheld(review({ stay: { ...base.stay, status } }));
  allWithheld(review({ now: new Date(base.stay.departureAt) }));
});
test('stale, future, naive or invalid timestamps fail closed', () => {
  for (const observedAt of ['2027-01-15T19:54:59Z', '2027-01-15T20:00:01Z', '2027-01-15T20:00:00', '2027-02-30T20:00:00Z'])
    allWithheld(review({ evidence: { ...base.evidence!, observedAt } }));
  for (const arrivalAt of ['2027-02-30T21:00:00Z', '2027-01-15T21:00:00', 'bad'])
    allWithheld(review({ stay: { ...base.stay, arrivalAt } }));
  allWithheld(review({ stay: { ...base.stay, clockVerified: false } }));
  allWithheld(review({ stay: { ...base.stay, departureAt: base.stay.arrivalAt } }));
  allWithheld(review({ now: new Date(NaN) }));
  allWithheld(review({ maxEvidenceAgeMs: 0 }));
});
test('freshness boundary is inclusive and recalculation never clears an existing hold', () => {
  assert.equal(review({ evidence: { ...base.evidence!, observedAt: '2027-01-15T19:55:00Z' } }).portalCode.status, 'candidate');
  const moved: AccessReleaseInput = { ...base, now: new Date('2027-01-16T20:00:00Z'),
    stay: { ...base.stay, arrivalAt: '2027-01-16T21:00:00Z', revision: 'r2' },
    evidence: { ...base.evidence!, revision: 'r2', observedAt: '2027-01-16T20:00:00Z', hold: 'held' } };
  assert.equal(reviewCalderwoodAccessRelease(moved).portalCode.status, 'withheld');
  assert.equal(moved.evidence!.hold, 'held');
});

test('a verified changed arrival preserves the existing one-hour offset', () => {
  const stay = { ...base.stay, arrivalAt: '2027-01-15T23:00:00Z', revision: 'r2' };
  const result = review({ stay, evidence: { ...base.evidence!, revision: 'r2' } });
  assert.equal(result.releaseAt, '2027-01-15T22:00:00.000Z');
  assert.equal(result.portalCode.status, 'withheld');
});
