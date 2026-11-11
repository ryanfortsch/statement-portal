import { z } from 'zod';
import { createHash } from 'node:crypto';
import { AUTOMATION_TRIGGERS, AUTOMATION_DELIVERIES, MERGE_FIELDS, templateFields } from '../automations-core.ts';
import { CALDERWOOD_MESSAGE_WORKFLOWS } from './preparation-timing.ts';
import { preparedPolicy } from './template-migration.ts';

const ruleSchema = z.object({ id: z.uuid(), key: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
  property_id: z.literal('65_calderwood').nullable(), audience: z.enum(['guest', 'cleaner']),
  trigger: z.enum(AUTOMATION_TRIGGERS), offset_days: z.number().int().min(-365).max(365),
  at_local: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/).nullable(),
  timezone: z.string().max(80), channel_exclusions: z.array(z.string().max(100)).max(30),
  delivery: z.enum(AUTOMATION_DELIVERIES), send_mode: z.enum(['auto', 'approve']),
  min_nights: z.number().int().min(1).max(1000).nullable(), subject: z.string().max(2000).nullable(),
  body: z.string().max(16000), enabled: z.boolean(), configured_in_ota: z.boolean(),
  migration_policy: z.unknown().optional(),
}).strict();
export const MESSAGE_RULE_FIELDS = 'id,key,property_id,audience,trigger,offset_days,at_local,timezone,channel_exclusions,delivery,send_mode,min_nights,subject,body,enabled,configured_in_ota,migration_policy';
export type PreparationRule = z.infer<typeof ruleSchema>;
export function parsePreparationRules(value: unknown) {
  const rows = z.array(ruleSchema).max(200).parse(value);
  if (new Set(rows.map(r => r.id)).size !== rows.length
    || new Set(rows.map(r => `${r.property_id ?? 'fleet'}:${r.key}`)).size !== rows.length) throw Error('Ambiguous rules');
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}
/** Inventory only. Presence/renderability cannot prove parity with a Guesty template. */
export function reviewPreparationRules(value: unknown) {
  const rows = parsePreparationRules(value);
  const workflows = CALDERWOOD_MESSAGE_WORKFLOWS.map(flow => {
    const r = rows.find(r => r.key === flow.key && r.property_id === '65_calderwood')
      ?? rows.find(r => r.key === flow.key && r.property_id === null);
    if (!r) return { ...flow, source: 'missing' as const, rule: null };
    const policy = r.property_id === '65_calderwood' && !r.enabled && r.configured_in_ota
      && r.send_mode === 'approve' ? preparedPolicy(r.key, r.body, r.migration_policy) : null;
    const fields = templateFields(r.body);
    const unsupportedFieldCount = fields.filter(f => !(MERGE_FIELDS as readonly string[]).includes(f)).length;
    const malformed = /[{}]/.test(r.body.replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, ''));
    return { ...flow, source: r.property_id ? 'property' as const : 'fleet' as const,
      rule: { id: r.id, enabled: r.enabled, sendMode: r.send_mode, delivery: r.delivery,
        configuredInOta: r.configured_in_ota, audienceMatches: r.audience === flow.audience,
        timezoneMatches: r.timezone === 'America/New_York', characterCount: r.body.length,
        // Only recognized field names leave the server; no source text or secret values.
        fields: fields.filter(f => (MERGE_FIELDS as readonly string[]).includes(f)), unsupportedFieldCount,
        malformedTemplate: malformed, emptyTemplate: !r.body.trim(),
        bodySha256: createHash('sha256').update(r.body).digest('hex'),
        migration: policy ? { state: policy.state, capturedAt: policy.capturedAt,
          timingRecorded: true as const, credentialFields: fields.includes('wifi_password') || fields.includes('door_code'),
          cleanerLinkRequired: fields.includes('cleaner_schedule_url'),
          dateFormatReview: fields.includes('check_in_long') || fields.includes('check_out_long') } : null,
        invalidMigrationPolicy: r.migration_policy != null && !policy,
        timing: r.trigger === 'booking_confirmed' ? 'Immediate when planned'
          : `${r.offset_days} day(s) from ${r.trigger}; ${r.at_local?.slice(0, 5) ?? 'no local clock configured'}`,
        // Current generic schema has no confirmedAt/ETA/ETD relative-minute policy.
        relativeTimingSupported: false as const, templateParityVerified: false as const },
    };
  });
  return { workflows, missingWorkflows: workflows.filter(w => w.source === 'missing').length,
    preparedWorkflows: workflows.filter(w => w.rule?.migration).length,
    propertySpecificWorkflows: workflows.filter(w => w.source === 'property').length,
    extraEffectiveKeys: [...new Set(rows.map(r => r.key))].filter(k => !workflows.some(w => w.key === k)) };
}
