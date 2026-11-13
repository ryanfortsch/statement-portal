import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { cleanerReminderRecipientSchema, resolveCleanerReminderLink } from '../cleaner-reminder-link.ts';
import { CleanerSmsTransport } from './cleaner-sms-transport.ts';
import { cleanerReferenceSchema, cleanerEnrollmentRequestSchema, cleanerEnrollmentOverviewSchema } from './cleaner-runtime-contract.ts';
import { createCalderwoodTemplateCaptureReader } from './template-retention.ts';
import { parsePreparationRules } from './preparation-rules.ts';
import type { MessageRpc } from './store.ts';

const id = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), revision = z.string().regex(/^[a-f0-9]{32}$/);
const instant = z.iso.datetime({ offset: true });
export const cleanerReleaseSchema = z.object({ releaseId: id, captureId: id, templateDigest: hash,
  routeGeneration: id, recipientRevision: revision, keyId: z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/),
  recipientHmac: hash, targetHmac: hash, sourceStoppedAt: instant, sourceDrainedAt: instant, sourceEvidenceId: id,
  actor: z.string().min(3).max(200), reviewedAt: instant }).strict().refine(r =>
  Date.parse(r.sourceStoppedAt) <= Date.parse(r.sourceDrainedAt) && Date.parse(r.sourceDrainedAt) <= Date.parse(r.reviewedAt));
const snapshotSchema = z.object({ format: z.literal(1), observedAt: instant,
  authority: z.enum(['guesty','helm']), automationsEnabled: z.boolean(), scopeEnabled: z.boolean(),
  routeGeneration: id.nullable(), recipientRevision: revision.nullable(),
  recipients: z.array(cleanerReminderRecipientSchema).max(200), currentRules: z.unknown(),
  release: cleanerReleaseSchema.nullable() }).strict();
type Reference = z.infer<typeof cleanerReferenceSchema>;
type Dependencies = { rpc: MessageRpc; transport: CleanerSmsTransport; clock?: () => number };

/** Private reader; never return recipients, tokens, hashes or templates directly
 * to the browser. An observed source configuration is not source queue proof. */
export async function readCleanerEnrollment(reference: Reference, rpc: MessageRpc, now: () => number) {
  const started = now();
  const out = await rpc('helm_channex_cleaner_enrollment_snapshot', { p_capture_id: reference.captureId, p_digest: reference.templateDigest });
  const at = now();
  if (!out || out.error !== null || !Number.isSafeInteger(started) || !Number.isSafeInteger(at) || at < started || at-started > 30000) throw Error();
  const s = snapshotSchema.parse(out.data);
  if (Date.parse(s.observedAt)>at || at-Date.parse(s.observedAt)>30000) throw Error();
  return { ...s, currentRules: parsePreparationRules(s.currentRules) };
}
export function cleanerRecipientProof(s: Awaited<ReturnType<typeof readCleanerEnrollment>>, transport: CleanerSmsTransport) {
  const link = resolveCleanerReminderLink('65_calderwood', s.recipients);
  if (!link || !s.recipientRevision) throw Error();
  const r = s.recipients.find(r => r.enabled && r.property_ids.length===1 && r.property_ids[0]==='65_calderwood')!;
  const attempt = transport.attempt(link.phone, 'Enrollment identity check'); if (!attempt) throw Error();
  return { keyId: attempt.keyId, targetHmac: attempt.targetHmac,
    recipientHmac: transport.fingerprint('recipient',JSON.stringify([r.region,r.property_ids,link.phone,link.token,link.language])) };
}
export function sameCleanerEnrollment(a: Awaited<ReturnType<typeof readCleanerEnrollment>>, b: Awaited<ReturnType<typeof readCleanerEnrollment>>) {
  const { observedAt: _a, ...first }=a, { observedAt: _b,...second }=b; void _a; void _b;
  return isDeepStrictEqual(first,second);
}
export async function reviewCleanerEnrollment(reference: Reference, deps: Dependencies) {
  const now=deps.clock??Date.now;
  const [s, archive]=await Promise.all([readCleanerEnrollment(reference,deps.rpc,now),
    createCalderwoodTemplateCaptureReader(deps.rpc,{enabled:true}).load(reference.captureId,reference.templateDigest,now())]);
  if(!archive) throw Error();
  const original=archive.capturedRules.filter(r=>r.audience==='cleaner');
  const templatesReady=original.length===2 && original.every(r=>isDeepStrictEqual(r,s.currentRules.find(c=>c.id===r.id))) && s.currentRules.length===2;
  let proof: ReturnType<typeof cleanerRecipientProof>|null=null;
  try { proof=cleanerRecipientProof(s,deps.transport); } catch { /* Minimal unavailable state only. */ }
  const overview=cleanerEnrollmentOverviewSchema.parse({...reference,observedAt:s.observedAt,authority:s.authority,
    automationsEnabled:s.automationsEnabled,scopeEnabled:s.scopeEnabled,routeGeneration:s.routeGeneration,
    recipientReady:!!proof,templatesReady,recipientReview:proof?.recipientHmac??null,releaseId:s.release?.releaseId??null,
    configurationReady:true,canEnroll:!s.release && s.authority==='helm' && s.scopeEnabled && !!s.routeGeneration && !!proof && templatesReady,canSend:false});
  return {s,proof,overview};
}
/** Explicit owner action only; the runtime never calls this function. Clearance
 * is a human's assertion about retained external evidence, not inferred from
 * an empty history or invented from a current timestamp. Lost replies reuse ID. */
export async function runCleanerEnrollment(raw: unknown, actor: string, deps: Dependencies, options: {enabled?:boolean}={}) {
  const result=(state:string,releaseId?:string)=>({state,...(releaseId?{releaseId}:{}),canSend:false as const});
  if(options.enabled!==true) return result('disabled');
  const parsed=cleanerEnrollmentRequestSchema.safeParse(raw);
  if(!parsed.success || actor.trim().length<3 || actor.trim().length>200) return result('invalid');
  const request=parsed.data, reference={captureId:request.captureId,templateDigest:request.templateDigest}, now=deps.clock??Date.now;
  try {
    const started=now(), first=await reviewCleanerEnrollment(reference,deps);
    if(request.action==='review') return {state:'review',review:first.overview,canSend:false as const};
    if(!first.proof || !first.overview.templatesReady || first.proof.recipientHmac!==request.reviewedRecipient
      || first.s.routeGeneration!==request.reviewedRoute || Date.parse(request.clearance.sourceDrainedAt)>started)
      return result('changed');
    if(!first.overview.canEnroll && first.s.release?.releaseId!==request.releaseId) return result('blocked');
    const second=await readCleanerEnrollment(reference,deps.rpc,now);
    if(!sameCleanerEnrollment(first.s,second)) return result('changed');
    const checked=now();
    if(!Number.isSafeInteger(started)||!Number.isSafeInteger(checked)||checked<started||checked-started>25000) return result('changed');
    const intent={releaseId:request.releaseId,...reference,routeGeneration:request.reviewedRoute,
      recipientRevision:second.recipientRevision!,...first.proof,...request.clearance,
      reviewStartedAt:new Date(started).toISOString(),reviewCheckedAt:new Date(checked).toISOString()};
    try {
      const out=await deps.rpc('helm_channex_cleaner_enroll',{p_review:intent,p_actor:actor.trim()});
      if(!out||out.error!==null) throw Error();
      const saved=z.object({state:z.enum(['created','existing']),releaseId:z.literal(request.releaseId)}).strict().parse(out.data);
      return result(saved.state,saved.releaseId);
    } catch { return result('uncertain',request.releaseId); }
  } catch { return result('unavailable'); }
}
