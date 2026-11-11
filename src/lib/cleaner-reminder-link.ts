/** Private cleaner links are resolved only for the Calderwood reminder pilot.
 * No credentials are minted and no sender is enabled here. */
import { z } from 'zod';
import { canReadCalderwoodStays, isCleanerPortalToken } from './cleaner-stay-access.ts';
import { toE164Phone } from './guests-identity-core.ts';
import { MASK, type MergeContext } from './automations-core.ts';

export const CLEANER_REMINDER_RECIPIENT_FIELDS = 'phone,portal_token,enabled,property_ids,region,language';
export const cleanerReminderRecipientSchema = z.object({
  enabled: z.boolean(), property_ids: z.array(z.string()).max(500), region: z.string().min(1).max(100),
  phone: z.string().max(100).nullable().optional(),
  portal_token: z.string().refine(isCleanerPortalToken).nullable().optional(),
  language: z.enum(['en', 'pt']).nullable().optional(),
});
export type CleanerLinkRule = { key: string; property_id: string | null; audience: string; delivery: string };
export type CleanerReminderLink = { phone: string; token: string; url: string; language: 'en' };

/** Refuse broad scopes, ambiguity and unavailable access. The migrated wording
 * is English, so changing language requires another template review. */
export function resolveCleanerReminderLink(propertyId: string, recipients: readonly unknown[]): CleanerReminderLink | null {
  if (propertyId !== '65_calderwood' || recipients.length > 200) return null;
  const parsed = z.array(cleanerReminderRecipientSchema).safeParse(recipients);
  if (!parsed.success) return null;
  const covering = parsed.data.filter(r => r.enabled && (r.property_ids.includes(propertyId)
    || (r.property_ids.length === 0 && r.region === 'bridgeport_ct')));
  if (covering.length !== 1) return null;
  const r = covering[0], phone = toE164Phone(r.phone);
  if (!phone || !canReadCalderwoodStays(r) || r.language !== 'en') return null;
  const token = r.portal_token!;
  return { phone, token, url: `https://helm.risingtidestr.com/c/${token}/stays`, language: 'en' };
}

export function cleanerReminderRuleAllowsLink(propertyId: string, rule: CleanerLinkRule | null | undefined): boolean {
  return propertyId === '65_calderwood' && rule?.property_id === propertyId
    && rule.audience === 'cleaner' && rule.delivery === 'sms'
    && ['cleaner_reminder', 'cleaner_arrival'].includes(rule.key);
}

/** Previews need only a masked presence marker. A guest or fleet rule never
 * receives a bearer URL, even if its template requests this field. */
export function withCleanerReminderLink(ctx: MergeContext, propertyId: string,
  rule: CleanerLinkRule | null | undefined, recipients: readonly unknown[], wire = false): MergeContext {
  const link = cleanerReminderRuleAllowsLink(propertyId, rule) ? resolveCleanerReminderLink(propertyId, recipients) : null;
  return { ...ctx, cleaner_schedule_url: link ? wire ? link.url : MASK : null };
}

/** Re-read access directly before the provider call. A revoked, rotated,
 * reassigned or broadened enrollment discards the old body and never retries.
 * Provider errors can echo a request body, so only a fixed error leaves here. */
export async function deliverVerifiedCleanerReminder<T>(propertyId: string, rule: CleanerLinkRule,
  recipients: readonly unknown[], deps: { recheck: () => Promise<readonly unknown[]>;
    send: (link: CleanerReminderLink) => Promise<T>; clock?: () => number }): Promise<T> {
  const clock = deps.clock ?? Date.now, started = clock();
  const first = cleanerReminderRuleAllowsLink(propertyId, rule) ? resolveCleanerReminderLink(propertyId, recipients) : null;
  if (!first) throw Error('Cleaner schedule access needs review');
  let last;
  try { last = resolveCleanerReminderLink(propertyId, await deps.recheck()); }
  catch { throw Error('Cleaner schedule access could not be rechecked'); }
  const elapsed = clock() - started;
  if (!last || JSON.stringify(first) !== JSON.stringify(last) || !Number.isFinite(elapsed) || elapsed < 0 || elapsed > 5000)
    throw Error('Cleaner schedule access changed; nothing sent');
  try { return await deps.send(last); }
  catch { throw Error('Cleaner reminder delivery could not be confirmed; review before retrying'); }
}
