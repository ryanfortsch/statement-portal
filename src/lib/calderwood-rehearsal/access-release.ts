/** Synthetic review boundary only. Never accepts or returns a credential. */
export type AccessReleaseInput = {
  now: Date;
  maxEvidenceAgeMs: number;
  stay: {
    propertyId: string; reservationId: string; revision: string;
    status: string; clockVerified: boolean; arrivalAt: string; departureAt: string;
  };
  evidence: {
    propertyId: string; reservationId: string; revision: string; observedAt: string;
    form: 'complete' | 'incomplete' | 'unknown';
    hold: 'clear' | 'held' | 'unknown';
    credential: 'ready' | 'missing' | 'unknown';
  } | null;
};
export type AccessReviewDecision = { status: 'withheld' | 'candidate'; reason: string };
function instant(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return NaN;
  const day = Date.parse(value.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== value.slice(0, 10)) return NaN;
  return Date.parse(value);
}
const withheld = (reason: string): AccessReviewDecision => ({ status: 'withheld', reason });
const candidate = (reason: string): AccessReviewDecision => ({ status: 'candidate', reason });

export function reviewCalderwoodAccessRelease(input: AccessReleaseInput) {
  const { stay, evidence } = input;
  const now = input.now.getTime();
  const arrival = instant(stay.arrivalAt), departure = instant(stay.departureAt);
  const observed = instant(evidence?.observedAt);
  let blocked = '';
  if (!Number.isFinite(now) || !Number.isFinite(input.maxEvidenceAgeMs) || input.maxEvidenceAgeMs <= 0
      || !stay.propertyId.trim() || !stay.reservationId.trim() || !stay.revision.trim())
    blocked = 'Valid review time, freshness limit and stay identity are required.';
  else if (stay.status !== 'confirmed') blocked = 'The current stay is not confirmed.';
  else if (stay.clockVerified !== true || !Number.isFinite(arrival) || !Number.isFinite(departure) || departure <= arrival)
    blocked = 'Verified arrival and departure instants are required.';
  else if (now >= departure) blocked = 'The stay has ended; withhold further access disclosure.';
  else if (!evidence || evidence.propertyId !== stay.propertyId || evidence.reservationId !== stay.reservationId || evidence.revision !== stay.revision)
    blocked = 'Evidence must match this property, reservation and current revision.';
  else if (!Number.isFinite(observed) || observed > now || now - observed > input.maxEvidenceAgeMs)
    blocked = 'Current, nonfuture evidence is required.';

  const releaseAt = !blocked ? new Date(arrival - 60 * 60 * 1000).toISOString() : null;
  const formComplete = evidence?.form === 'complete';
  const portalInformation = blocked ? withheld(blocked) : formComplete
    ? candidate('Form complete. Non-code information is eligible for review.')
    : withheld('Complete the required contact form before showing property information.');
  let codeMessageTiming: AccessReviewDecision;
  if (blocked) codeMessageTiming = withheld(blocked);
  else if (evidence?.hold !== 'clear') codeMessageTiming = withheld(evidence?.hold === 'held'
    ? 'Operator hold applies to code disclosure in both the message and portal.'
    : 'The operator hold state is unverified.');
  else if (evidence?.credential !== 'ready') codeMessageTiming = withheld('A current credential must be verified without exposing its value.');
  else if (now < arrival - 60 * 60 * 1000) codeMessageTiming = withheld('The existing one-hour-before-arrival release time has not arrived.');
  else codeMessageTiming = candidate('Release timing and hold checks pass. Sending still needs history and ownership reconciliation.');
  const portalCode = codeMessageTiming.status !== 'candidate' ? { ...codeMessageTiming }
    : !formComplete ? withheld('The portal also requires the contact form to be complete.')
    : candidate('Form, release timing and hold checks pass. Portal authorization is a separate requirement.');
  return { mode: 'rehearsal' as const, releaseAt, portalInformation, codeMessageTiming, portalCode,
    canSend: false as const, canReveal: false as const };
}
