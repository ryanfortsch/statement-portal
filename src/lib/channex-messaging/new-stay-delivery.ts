import 'server-only';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { overrideBodyProblem, renderTemplate } from '../automations-core.ts';
import { fixedNewStayInputs, loadVerifiedNewStay } from './new-stay-provider.ts';
import { createNewStayScheduleInputReader, planAdmittedStay } from './new-stay-schedule-inputs.ts';
import { newStayScheduleRequest } from './new-stay-schedule-runtime.ts';
import { createCalderwoodTemplateCaptureReader } from './template-retention.ts';
import { createChannexJobStore, type MessageRpc } from './store.ts';
import { ChannexMessageWorker, type ChannexJob } from './worker.ts';
import { ChannexMessageTransport } from './transport.ts';
import { retainedGuestSendId, guestKeys } from './schedule-coordinator.ts';
import { retainedCleanerSendId } from './cleaner-runtime.ts';
import { CleanerSmsTransport } from './cleaner-sms-transport.ts';
import { CleanerSmsWorker, parseCleanerSmsJob } from './cleaner-sms-worker.ts';
import { createCleanerSmsStore } from './cleaner-sms-store.ts';
import { cleanerRecipientProof, readCleanerEnrollment, sameCleanerEnrollment } from './cleaner-enrollment.ts';

type Deps = { rpc: MessageRpc; channexKey: () => Promise<string>;
  sms: () => Promise<{ apiKey: string; receiptKey: string; keyId: string }>;
  fetcher?: typeof fetch; clock?: () => number };
type Loaded = Awaited<ReturnType<typeof loadVerifiedNewStay>>;
const requestSchema = newStayScheduleRequest.extend({ sendId: newStayScheduleRequest.shape.bookingId }).strict();
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** Each job has its own deadline and request budget. A receipt write uses the
 * unwrapped RPC so an exhausted provider budget cannot erase the outcome. */
function budget(deps: Deps, audience: 'guest' | 'cleaner') {
  const clock = deps.clock ?? Date.now, started = clock(); let last = started, reads = 0, posts = 0;
  const now = () => { const at = clock();
    if (!Number.isSafeInteger(started) || !Number.isSafeInteger(at) || at < last || at - started >= 135000) throw Error();
    last = at; return at; };
  const rpc: MessageRpc = async (name, args) => { now(); const out = await deps.rpc(name,args); now(); return out; };
  const fetcher: typeof fetch = async (url, init) => {
    now(); const u = new URL(String(url));
    if (init?.method === 'GET' && init.body === undefined) { if (++reads > 29) throw Error(); }
    else if (init?.method === 'POST' && (audience === 'guest'
      ? u.origin === 'https://app.channex.io' && /^\/api\/v1\/message_threads\/[a-f0-9-]+\/messages$/.test(u.pathname)
      : String(u) === 'https://api.quo.com/v1/messages')) { if (++posts > 1) throw Error(); }
    else throw Error();
    return (deps.fetcher ?? fetch)(url, { ...init, signal: AbortSignal.any([
      AbortSignal.timeout(Math.min(8000, 135000-(now()-started))), ...(init.signal ? [init.signal] : [])]) });
  };
  return { now, rpc, fetcher, result: (state: string) => ({ state, providerReads: reads, providerPosts: posts }) };
}

function guestRender(job: ChannexJob, s: Loaded,
  rules: NonNullable<Awaited<ReturnType<ReturnType<typeof createCalderwoodTemplateCaptureReader>['load']>>>['capturedRules'], at: number) {
  if (job.environment !== s.scope.environment || job.propertyId !== s.scope.propertyId || job.channelId !== s.scope.channelId
    || job.provider !== s.scope.provider || job.bookingId !== s.route.remoteBookingId || job.threadId !== s.route.threadId
    || job.contextRevision !== s.context.contextRevision) throw Error();
  const row = s.ledger.find(r => r.id === job.sendId);
  const original = rules.find(r => r.id === row?.automation_id && r.audience === 'guest');
  if (!row || !original || !guestKeys.some(k => k === original.key) || row.automation_key !== original.key
    || job.sendId !== retainedGuestSendId(s.booking.id, original.key as typeof guestKeys[number])) throw Error();
  const plan = planAdmittedStay(s,rules,at).find(p => p.key === original.key);
  if (plan?.state !== 'existing_schedule' || !plan.fireAt || Date.parse(plan.fireAt) > at
    || at >= Date.parse(plan.fireAt)+1800000 || Date.parse(row.fire_at) !== Date.parse(plan.fireAt)) throw Error();
  if (!isDeepStrictEqual(s.currentRules.find(r => r.id === original.id),
    { ...original, enabled:true, configured_in_ota:false, send_mode:'auto', migration_policy:null })) throw Error();
  const body = renderTemplate(original.body,s.merge);
  if (!body.text || body.missing.length || Buffer.byteLength(body.text)>10240 || overrideBodyProblem(body.text)
    || /[{}]/.test(body.text) || sha(body.text)!==job.bodySha256) throw Error();
  return { text:body.text, contextRevision:s.context.contextRevision };
}

/** Dispatch only a pre-existing deterministic job. No enrollment, scheduling,
 * release, history repair or retry. Fresh admission/provider checks run twice;
 * the existing SQL claim is the final one-use authority for a provider POST. */
export async function dispatchNewStayGuest(raw: unknown, deps: Deps, options: { enabled?: boolean } = {}) {
  if (options.enabled !== true) return { state:'disabled', providerReads:0, providerPosts:0 };
  const b = budget(deps,'guest');
  try {
    const request = requestSchema.parse(raw), store = createChannexJobStore(b.rpc);
    const job = await store.read(request.sendId);
    if (!job) throw Error();
    if (job.state !== 'prepared' || job.attemptId !== null) return b.result('needs_reconciliation');
    const archive = await createCalderwoodTemplateCaptureReader(b.rpc,{enabled:true})
      .load(request.templateCaptureId,request.templateDigest,b.now());
    if (!archive) throw Error();
    const key = await deps.channexKey(); b.now();
    const load = () => loadVerifiedNewStay(request.bookingId,{...b,channexKey:async()=>key});
    const first = await load(), rendered = guestRender(job,first,archive.capturedRules,b.now());
    const worker = new ChannexMessageWorker({enabled:true,
      transport:new ChannexMessageTransport({scope:first.scope,apiKey:key,sendEnabled:true,fetcher:b.fetcher}),
      store:{read:store.read,finish:createChannexJobStore(deps.rpc).finish,claim:async(id,attemptId,attempt)=>{
        try { const current = guestRender(job,await load(),archive.capturedRules,b.now());
          if (!isDeepStrictEqual(current,rendered)) return false;
        } catch { return false; }
        return store.claim(id,attemptId,attempt);
      }} });
    const out = await worker.dispatch(job.sendId,async current=>{
      b.now(); if (!isDeepStrictEqual(current,job)) throw Error(); return rendered;
    });
    return b.result(out.state);
  } catch { return b.result('blocked'); }
}

export async function dispatchNewStayCleaner(raw: unknown, deps: Deps, options: { enabled?: boolean } = {}) {
  if (options.enabled !== true) return { state:'disabled', providerReads:0, providerPosts:0 };
  const b = budget(deps,'cleaner');
  try {
    const request = requestSchema.parse(raw), store = createCleanerSmsStore(b.rpc,{enabled:true});
    const rawJob = await store.read(request.sendId); if (!rawJob) throw Error();
    const job = parseCleanerSmsJob(rawJob);
    if (job.state !== 'prepared') return b.result('needs_reconciliation');
    if (job.bookingId !== request.bookingId || job.releaseId !== request.cleanerReleaseId
      || job.sendId !== retainedCleanerSendId(request.bookingId,job.key)) throw Error();
    const archive = await createCalderwoodTemplateCaptureReader(b.rpc,{enabled:true})
      .load(request.templateCaptureId,request.templateDigest,b.now());
    if (!archive) throw Error();
    const transport = new CleanerSmsTransport({...await deps.sms(),sendEnabled:true,clock:b.now,fetcher:b.fetcher});
    const reference = {captureId:request.templateCaptureId,templateDigest:request.templateDigest};
    let verified: ReturnType<typeof fixedNewStayInputs> | null = null;
    const fresh = async (provider = true) => {
      const before = await readCleanerEnrollment(reference,b.rpc,b.now);
      const s = provider ? await loadVerifiedNewStay(request.bookingId,{...b,channexKey:deps.channexKey})
        : await createNewStayScheduleInputReader(b.rpc,{enabled:true}).load(request.bookingId,b.now);
      if (!s || (!provider && (!verified || !isDeepStrictEqual(fixedNewStayInputs(s),verified)))) throw Error();
      const enrollment = await readCleanerEnrollment(reference,b.rpc,b.now), release = enrollment.release;
      const proof = cleanerRecipientProof(enrollment,transport);
      if (!sameCleanerEnrollment(before,enrollment) || !release || release.releaseId !== request.cleanerReleaseId
        || release.captureId !== request.templateCaptureId || release.templateDigest !== request.templateDigest
        || enrollment.authority !== 'helm' || !enrollment.automationsEnabled || !enrollment.scopeEnabled
        || release.routeGeneration !== s.context.routeGeneration || enrollment.routeGeneration !== s.context.routeGeneration
        || release.recipientRevision !== enrollment.recipientRevision || release.keyId !== proof.keyId
        || release.recipientHmac !== proof.recipientHmac || release.targetHmac !== proof.targetHmac
        || Date.parse(release.reviewedAt)>b.now()) throw Error();
      const rule = archive.capturedRules.find(r => r.key === job.key);
      if (!rule || !isDeepStrictEqual(rule,s.currentRules.find(r=>r.id===rule.id))
        || !isDeepStrictEqual(rule,enrollment.currentRules.find(r=>r.id===rule.id))) throw Error();
      const plan = planAdmittedStay(s,archive.capturedRules,b.now()).find(p => p.key === job.key);
      if (plan?.state !== 'existing_schedule' || !plan.fireAt || Date.parse(plan.fireAt)!==Date.parse(job.fireAt)) throw Error();
      if (provider) { const { route: _route, ...snapshot } = s as Loaded; void _route; verified = fixedNewStayInputs(snapshot); }
      return {contextRevision:s.context.contextRevision,rule,clocks:s.admission.clocks,
        propertyName:s.merge.property_name??'',recipients:enrollment.recipients};
    };
    // Provider scans precede the short one-use claim window. Within that window
    // recheck the same database snapshot and enrollment, then let SQL atomically
    // validate current clocks, holds, source and recipient. Slow provider reads
    // must not consume a claim only to exceed the SMS transport's five seconds.
    const initial = await fresh(), final = await fresh();
    if (!isDeepStrictEqual(initial,final)) throw Error();
    const out = await new CleanerSmsWorker({enabled:true,transport,clock:b.now,
      store:{...store,finish:createCleanerSmsStore(deps.rpc,{enabled:true}).finish}}).dispatch(job.sendId,async current=>{
      if (!isDeepStrictEqual(current,job)) throw Error();
      return fresh(false);
    });
    return b.result(out.state);
  } catch { return b.result('blocked'); }
}

/** Receipt recovery deliberately bypasses admission, booking, enrollment and
 * source readiness. It can only GET the saved provider ID and finish that attempt. */
export async function reconcileNewStayCleaner(sendId: string, deps: Pick<Deps,'rpc'|'sms'|'fetcher'|'clock'>) {
  let reads = 0;
  try {
    const clock=deps.clock??Date.now, started=clock(); let last=started;
    const now=()=>{const at=clock();
      if(!Number.isSafeInteger(started)||!Number.isSafeInteger(at)||at<last||at-started>=30000)throw Error();
      last=at;return at;
    };
    const base=createCleanerSmsStore(deps.rpc,{enabled:true});
    const fetcher: typeof fetch=async(url,init)=>{
      const at=now(); if(init?.method!=='GET'||init.body!==undefined||++reads>1)throw Error();
      return (deps.fetcher??fetch)(url,{...init,signal:AbortSignal.any([
        AbortSignal.timeout(Math.min(8000,30000-(at-started))),...(init.signal?[init.signal]:[])])});
    };
    const out=await new CleanerSmsWorker({enabled:true,clock:now,store:{...base,read:async id=>{
      now();const job=await base.read(id);now();return job;
    }},transport:new CleanerSmsTransport({...await deps.sms(),sendEnabled:false,fetcher,clock:now})}).reconcile(sendId);
    return {state:out.state,providerReads:reads,providerPosts:0};
  } catch {return {state:'unconfirmed',providerReads:reads,providerPosts:0};}
}
