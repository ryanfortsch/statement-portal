import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { createCalderwoodTemplateCaptureReader } from './template-retention.ts';
import { releaseCalderwoodGuestTemplates } from './template-release.ts';
import { parsePreparationRules, preparedRulePolicy } from './preparation-rules.ts';
import { CALDERWOOD_MESSAGE_WORKFLOWS } from './preparation-timing.ts';
import { templateReferenceSchema, templateReviewSchema, templateWorkflowRequestSchema } from './template-workflow-contract.ts';
import type { MessageRpc } from './store.ts';

type Deps = { rpc: MessageRpc; clock?: () => number; current: () => Promise<{
  authority: 'guesty' | 'helm'; automationsEnabled: boolean; rules: unknown;
}> };
const captureReceipt = templateReferenceSchema.extend({ count: z.literal(6), reused: z.boolean() }).strict();

/** Minimal owner DTO. Original text, credentials, recipients and source payloads
 * stay private. Explicit capture identities only; never select the latest archive. */
export async function reviewCalderwoodTemplateRelease(raw: unknown, deps: Deps) {
  const reference = templateReferenceSchema.parse(raw), now = deps.clock ?? Date.now;
  const archive = await createCalderwoodTemplateCaptureReader(deps.rpc, { enabled: true })
    .load(reference.captureId, reference.rulesSha256, now());
  if (!archive) throw Error('Template review unavailable');
  const current = await deps.current(), rules = parsePreparationRules(current.rules);
  const original = archive.capturedRules;
  const expected = original.map(r => r.audience === 'guest' ? { ...r, enabled: true,
    configured_in_ota: false, send_mode: 'auto', migration_policy: null } : r);
  const configuration = isDeepStrictEqual(rules, original) ? 'prepared'
    : isDeepStrictEqual(rules, expected) ? 'released' : 'changed';
  return templateReviewSchema.parse({ ...reference, capturedAt: archive.capturedAt,
    observedAt: new Date(now()).toISOString(), authority: current.authority, automationsEnabled: current.automationsEnabled,
    configuration, workflows: CALDERWOOD_MESSAGE_WORKFLOWS.map(flow => {
      const r = original.find(r => r.key === flow.key)!;
      const policy = preparedRulePolicy(r, now()); if (!policy) throw Error('Template review unavailable');
      return { key: flow.key, label: flow.label, audience: flow.audience, timing: flow.offset,
        characterCount: r.body.length, bodySha256: policy.bodySha256 };
    }), canSend: false });
}

/** Called only behind the owner DAL. Every mutation is an explicit separate POST.
 * Capture preserves all six original rules; release changes exactly four guest
 * flags through the installed transaction. Neither enables the home or a sender. */
export async function runCalderwoodTemplateWorkflow(raw: unknown, actor: string, deps: Deps,
  options: { enabled?: boolean } = {}) {
  if (options.enabled !== true) return { state: 'disabled' as const, canSend: false as const };
  const parsed = templateWorkflowRequestSchema.safeParse(raw);
  if (!parsed.success || !actor.trim() || actor.trim().length > 200)
    return { state: 'invalid' as const, canSend: false as const };
  const request = parsed.data;
  if (request.action === 'review') {
    return { state: 'review' as const, review: await reviewCalderwoodTemplateRelease({ captureId: request.captureId,
      rulesSha256: request.rulesSha256 }, deps), canSend: false as const };
  }
  if (request.action === 'capture') {
    // A response can be lost after commit. Never claim rollback or retry here.
    try {
      const result = await deps.rpc('helm_channex_capture_templates', { p_actor: actor.trim() });
      if (!result || result.error !== null) throw Error();
      const receipt = captureReceipt.parse(result.data);
      return { state: 'captured' as const, reference: { captureId: receipt.captureId, rulesSha256: receipt.rulesSha256 },
        reused: receipt.reused, canSend: false as const };
    } catch { return { state: 'uncertain' as const, canSend: false as const }; }
  }
  const reference = { captureId: request.captureId, rulesSha256: request.rulesSha256 };
  const review = await reviewCalderwoodTemplateRelease(reference, deps);
  // Released permits reconciliation of the SAME request after an uncertain
  // result, even after a later handover. SQL verifies the original actor and ID.
  if (review.configuration === 'changed' || (review.configuration === 'prepared'
    && (review.authority !== 'guesty' || review.automationsEnabled)))
    return { state: 'blocked' as const, canSend: false as const };
  return releaseCalderwoodGuestTemplates({ ...reference, releaseId: request.releaseId }, actor, deps.rpc, { enabled: true });
}
