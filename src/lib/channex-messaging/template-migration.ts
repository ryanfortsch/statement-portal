import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { templateFields, MERGE_FIELDS } from '../automations-core.ts';
import { CALDERWOOD_MESSAGE_WORKFLOWS, MIGRATION_TIMING, type CalderwoodMessageKey } from './preparation-timing.ts';
export { MIGRATION_TIMING } from './preparation-timing.ts';

// Captured source text is private input, never a source fixture or public artifact.
// These offsets record the observed configuration. They do not authorize scheduling.
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const migrationPolicySchema = z.object({
  version: z.literal(1), state: z.literal('prepared'), source: z.literal('guesty'),
  capturedAt: z.iso.datetime(), sourceSha256: hash, bodySha256: hash,
  fieldMappingVersion: z.literal(1), timing: z.union([
    z.object({ anchor: z.enum(['confirmed_at', 'arrival']), minutes: z.number().int() }).strict(),
    z.object({ anchor: z.enum(['arrival', 'departure']), days: z.number().int(), dayMode: z.literal('verify_source_queue') }).strict(),
  ]),
}).strict();
export type MigrationPolicy = z.infer<typeof migrationPolicySchema>;
const sourceBody = z.string().min(1).max(16000).refine(s => !!s.trim() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s));
const captureSchema = z.object({ observedAt: z.iso.datetime(), source: z.string().min(1).max(1000),
  property: z.literal('65_calderwood'), templates: z.object({
    booking_confirmed: sourceBody, pre_arrival: sourceBody, checkin_day: sourceBody,
    pre_checkout: sourceBody, cleaner_reminder: sourceBody, cleaner_arrival: sourceBody,
  }).strict(),
}).strict();
const fieldMap = { guest_first: 'guest_first', checkin: 'check_in_long', checkout: 'check_out_long',
  listing_nickname: 'property_name', listing_lock_code: 'door_code' } as const;
const expectedFields: Record<CalderwoodMessageKey, string[]> = {
  booking_confirmed: ['guest_first'], pre_arrival: ['checkin', 'checkout', 'guest_first'],
  checkin_day: ['guest_first', 'listing_lock_code'], pre_checkout: ['guest_first'],
  cleaner_reminder: ['checkin', 'checkout', 'listing_nickname'], cleaner_arrival: ['checkout', 'listing_nickname'],
};
function fail(): never { throw Error('Template migration requires source review'); }
/** All six or nothing. Literal wording/line breaks survive; substitutions are explicit. */
export function compileCalderwoodTemplates(value: unknown, now: number) {
  const parsed = captureSchema.safeParse(value);
  if (!parsed.success || !Number.isFinite(now)) return fail();
  const capture = parsed.data;
  if (Date.parse(capture.observedAt) > now) return fail();
  const rows = CALDERWOOD_MESSAGE_WORKFLOWS.map(flow => {
    const source = capture.templates[flow.key];
    if (/[{}]/.test(source.replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, ''))
      || JSON.stringify(templateFields(source).sort()) !== JSON.stringify(expectedFields[flow.key])) return fail();
    let body = source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
      (_, field: keyof typeof fieldMap) => `{{${fieldMap[field]}}}`);
    if (flow.key === 'checkin_day') {
      // Source has an embedded Wi-Fi credential. Extract only to replace it;
      // no clear credential is returned, persisted, logged or sent to the browser.
      const matches = [...body.matchAll(/^Name: ([^\r\n{}]+)\r?\nPassword: ([^\r\n{}]+)$/gm)];
      if (matches.length !== 1) return fail();
      const [literal, network, password] = matches[0];
      if (!network.trim() || !password.trim() || password.length < 4) return fail();
      body = body.replace(literal, 'Name: {{wifi_name}}\nPassword: {{wifi_password}}');
      if (body.includes(password)) return fail();
    } else if (/^Password:/im.test(body)) return fail();
    if (flow.key === 'cleaner_reminder') {
      const links = body.match(/https:\/\/app\.guesty\.com\/reservations\?viewId=[a-f0-9]{24}/g) ?? [];
      if (links.length !== 1) return fail();
      body = body.replace(links[0], '{{cleaner_schedule_url}}');
    }
    if (/https?:\/\/[^\s]*guesty\./i.test(body)
      || templateFields(body).some(f => !(MERGE_FIELDS as readonly string[]).includes(f))) return fail();
    const migration_policy: MigrationPolicy = { version: 1, state: 'prepared', source: 'guesty',
      capturedAt: capture.observedAt, sourceSha256: sha(source), bodySha256: sha(body),
      fieldMappingVersion: 1, timing: MIGRATION_TIMING[flow.key] };
    return { key: flow.key, body, migration_policy };
  });
  return rows;
}

/** A changed template or unsupported policy cannot retain a prepared badge. */
export function preparedPolicy(key: string, body: string, value: unknown): MigrationPolicy | null {
  const parsed = migrationPolicySchema.safeParse(value);
  const timing = MIGRATION_TIMING[key as CalderwoodMessageKey];
  if (!parsed.success || !timing || parsed.data.bodySha256 !== sha(body)) return null;
  // JSONB key ordering differs from JS, so compare the named fields.
  const actual = parsed.data.timing;
  if (actual.anchor !== timing.anchor || ('minutes' in timing
    ? !('minutes' in actual) || actual.minutes !== timing.minutes
    : !('days' in actual) || actual.days !== timing.days || actual.dayMode !== timing.dayMode)) return null;
  return parsed.data;
}
