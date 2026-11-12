import 'server-only';
import { z } from 'zod';
import { parsePreparationRules, preparedRulePolicy } from './preparation-rules.ts';
import type { MessageRpc } from './store.ts';

const id = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z.object({ format: z.literal(1), captureId: id, propertyId: z.literal('65_calderwood'),
  capturedAt: z.iso.datetime({ offset: true }), rulesSha256: hash, rules: z.unknown() }).strict();

/** Private, default-off reader. The identity and digest must come from the retained
 * capture receipt, never a query for the newest/current rules. This only supplies
 * the original templates; release, fresh provider timing and dispatch remain gated.
 */
export function createCalderwoodTemplateCaptureReader(rpc: MessageRpc, options: { enabled?: boolean } = {}) {
  return {
    async load(captureId: string, rulesSha256: string, now = Date.now()) {
      if (options.enabled !== true) return null;
      try {
        id.parse(captureId); hash.parse(rulesSha256);
        if (!Number.isSafeInteger(now)) throw Error();
        const result = await rpc('helm_channex_read_template_capture', { p_capture_id: captureId, p_rules_sha256: rulesSha256 });
        if (!result || result.error !== null) throw Error();
        if (result.data === null) return null;
        const capture = schema.parse(result.data);
        if (capture.captureId !== captureId || capture.rulesSha256 !== rulesSha256 || Date.parse(capture.capturedAt) > now) throw Error();
        const rules = parsePreparationRules(capture.rules);
        if (rules.length !== 6 || rules.some(r => !preparedRulePolicy(r, now)
          || Date.parse(String((r.migration_policy as { capturedAt: string }).capturedAt)) > Date.parse(capture.capturedAt))) throw Error();
        // Bodies stay in this server-side result; never spread it into an HTTP DTO.
        return { captureId, rulesSha256, capturedAt: capture.capturedAt, capturedRules: rules };
      } catch { throw Error('Retained message templates unavailable'); }
    },
  };
}
