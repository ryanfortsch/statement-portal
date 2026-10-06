import { REQUEST_PROPERTIES, airbnbUrl, validStay, type RequestNotification, type RequestReview } from './airbnb-request-notifications.ts';

// User-selected shared inbox, not the SMS sender or the guest's number.
export const REQUEST_ALERT_TO = '+19788652575';
export type AlertResult = 'disabled' | 'skipped' | 'already_attempted' | 'accepted' | 'unknown' | 'unavailable';
export type AlertDependencies = {
  claim(): Promise<boolean>;
  send(content: string): Promise<string>;
  record(status: 'accepted' | 'unknown', providerId: string | null): Promise<void>;
};
export function requestAlertText(source: RequestNotification, review: RequestReview, now: number): string | null {
  if (!Object.hasOwn(REQUEST_PROPERTIES, review.property_id) || source.messageId !== review.message_id || !validStay(review.check_in, review.check_out)) return null;
  const age = now - Date.parse(source.receivedAt);
  // No historical backfill or misleading "new" alerts for old notifications.
  if (!Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000) return null;
  const url = airbnbUrl(review.evidence_url);
  if (!url || !/^\/(hosting\/stay|rooms)\//.test(new URL(url).pathname)) return null;
  const unit = REQUEST_PROPERTIES[review.property_id as keyof typeof REQUEST_PROPERTIES].name;
  const amount = source.amountText && /^\$[\d,.]+$/.test(source.amountText) ? `\n${source.amountText} quoted in notification` : '';
  return `HELM REQUEST ALERT\n${unit}\n${review.check_in} to ${review.check_out}${amount}\nProperty verified. Booking NOT confirmed by this alert. Review current status in Airbnb:\n${url}`;
}
/** Claim before provider call. An uncertain send is never automatically retried. */
export async function deliverRequestAlert(enabled: boolean, from: string, source: RequestNotification, review: RequestReview, now: number, deps: AlertDependencies): Promise<AlertResult> {
  if (!enabled) return 'disabled';
  const content = requestAlertText(source, review, now);
  if (!content) return 'skipped';
  if (!/^\+1\d{10}$/.test(from) || from === REQUEST_ALERT_TO) return 'unavailable';
  try { if (!await deps.claim()) return 'already_attempted'; } catch { return 'unavailable'; }
  let providerId: string;
  try {
    providerId = await deps.send(content);
    if (!providerId) throw new Error('No provider ID');
  } catch {
    try { await deps.record('unknown', null); } catch { /* claim remains; do not resend */ }
    return 'unknown';
  }
  try { await deps.record('accepted', providerId); } catch { return 'unknown'; }
  return 'accepted'; // Provider acceptance is not delivery confirmation.
}
