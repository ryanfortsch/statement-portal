import 'server-only';
import { z } from 'zod';
import type { MessageRpc } from './store.ts';

const id = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const request = z.object({ releaseId: id, captureId: id, rulesSha256: hash }).strict();
const receipt = request.extend({ guestRules: z.literal(4), reused: z.boolean() }).strict();
export type TemplateReleaseResult =
  | { state: 'disabled' | 'invalid' | 'uncertain'; canSend: false }
  | { state: 'released' | 'existing'; releaseId: string; guestRules: 4; canSend: false };

/** Private explicit operation; a caller must authenticate the owner and present
 * the retained capture for review. Default off; the owner workflow is its only
 * application caller. No background/cron activation is provided here.
 * Keep the same request and actor when reconciling an uncertain database result.
 * This releases template configuration only: it cannot enable a home or scope,
 * prove source drainage, register jobs, or send messages. */
export async function releaseCalderwoodGuestTemplates(raw: unknown, actor: string, rpc: MessageRpc,
  options: { enabled?: boolean } = {}): Promise<TemplateReleaseResult> {
  if (options.enabled !== true) return { state: 'disabled', canSend: false };
  const parsed = request.safeParse(raw);
  if (!parsed.success || typeof actor !== 'string' || !actor.trim() || actor.trim().length > 200)
    return { state: 'invalid', canSend: false };
  const r = parsed.data;
  try {
    const result = await rpc('helm_channex_release_templates', {
      p_release_id: r.releaseId, p_capture_id: r.captureId, p_rules_sha256: r.rulesSha256, p_actor: actor.trim(),
    });
    if (!result || result.error !== null) throw Error();
    const saved = receipt.parse(result.data);
    if (saved.releaseId !== r.releaseId || saved.captureId !== r.captureId || saved.rulesSha256 !== r.rulesSha256) throw Error();
    return { state: saved.reused ? 'existing' : 'released', releaseId: saved.releaseId, guestRules: 4, canSend: false };
  } catch { return { state: 'uncertain', canSend: false }; }
}
