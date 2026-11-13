import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanerRuntimeFixture as fixture } from './fixtures/cleaner-runtime.ts';
import { runCleanerEnrollment } from '../channex-messaging/cleaner-enrollment.ts';
function enrollmentFixture() {
  const f=fixture(), release=structuredClone(f.enrollment.release!), originalRpc=f.deps.rpc;
  f.enrollment.release=null;
  const request={action:'enroll',captureId:release.captureId,templateDigest:release.templateDigest,releaseId:release.releaseId,
    reviewedRecipient:release.recipientHmac,reviewedRoute:release.routeGeneration,
    clearance:{sourceEvidenceId:release.sourceEvidenceId,sourceStoppedAt:release.sourceStoppedAt,sourceDrainedAt:release.sourceDrainedAt}};
  let writes=0;
  const deps={transport:f.transport,clock:f.deps.clock,rpc:async(name:string,args:Record<string,unknown>)=>{
    if(name==='helm_channex_cleaner_enroll') {
      writes++;const existing=!!f.enrollment.release;
      assert.equal(args.p_actor,'synthetic-owner');
      const intent=args.p_review as Record<string,unknown>;
      assert.equal(intent.releaseId,release.releaseId);assert.equal(intent.recipientRevision,f.enrollment.recipientRevision);
      f.enrollment.release={...release,reviewedAt:new Date(f.deps.clock()).toISOString()};
      return {data:{state:existing?'existing':'created',releaseId:release.releaseId},error:null};
    }
    return originalRpc(name,args);
  }};
  return {f,request,deps,writes:()=>writes,run:()=>runCleanerEnrollment(request,'synthetic-owner',deps,{enabled:true})};
}
test('cleaner enrollment is off by default; read-only review returns no private recipient data',async()=>{
  const x=enrollmentFixture();assert.equal((await runCleanerEnrollment(x.request,'synthetic-owner',x.deps)).state,'disabled');
  const out=await runCleanerEnrollment({action:'review',captureId:x.request.captureId,templateDigest:x.request.templateDigest},'synthetic-owner',x.deps,{enabled:true});
  assert.equal(out.state,'review');assert.equal(out.canSend,false);assert.equal(x.writes(),0);
  for(const secret of ['12025550123',x.f.enrollment.recipients[0].portal_token,x.f.keys.receiptKey])assert.ok(!JSON.stringify(out).includes(secret));
});
test('explicit reviewed enrollment is idempotent and never sends, registers or enables',async()=>{
  const x=enrollmentFixture();assert.equal((await x.run()).state,'created');assert.equal((await x.run()).state,'existing');
  assert.equal(x.f.counts().posts,0);assert.equal(x.f.counts().registrations,0);assert.equal(x.f.jobs.size,0);
});
test('a lost enrollment response retains the same ID and can recover its receipt',async()=>{
  const x=enrollmentFixture(),rpc=x.deps.rpc;let lose=true;
  x.deps.rpc=async(n,a)=>{const out=await rpc(n,a);if(n==='helm_channex_cleaner_enroll'&&lose){lose=false;throw Error('PRIVATE');}return out;};
  const out=await x.run();assert.equal(out.state,'uncertain');assert.equal('releaseId' in out&&out.releaseId,x.request.releaseId);
  assert.equal((await x.run()).state,'existing');
});
test('source handover, original templates and the reviewed recipient must still match',async()=>{
  for(const change of ['source','recipient','template','route','future','reversed']){
    const x=enrollmentFixture();
    if(change==='source')x.f.enrollment.authority='guesty';
    if(change==='recipient')x.f.enrollment.recipients[0].portal_token='e'.repeat(32);
    if(change==='template')x.f.enrollment.currentRules[0].body+=' changed';
    if(change==='route')x.f.enrollment.routeGeneration='00000000-0000-4000-8000-000000000008';
    if(change==='future')x.request.clearance.sourceDrainedAt=new Date(x.deps.clock()+1000).toISOString();
    if(change==='reversed')x.request.clearance.sourceStoppedAt=new Date(x.deps.clock()).toISOString();
    assert.ok(['blocked','changed','invalid'].includes((await x.run()).state),change);assert.equal(x.writes(),0,change);
  }
});
test('enrollment rechecks a concurrent recipient change before writing',async()=>{
  const x=enrollmentFixture(),rpc=x.deps.rpc;let reads=0;
  x.deps.rpc=async(n,a)=>{if(n==='helm_channex_cleaner_enrollment_snapshot'&&++reads===2)x.f.enrollment.recipients[0].enabled=false;return rpc(n,a);};
  assert.equal((await x.run()).state,'changed');assert.equal(x.writes(),0);
});
test('malformed input and invalid actor cannot reach enrollment writer',async()=>{
  for(const raw of [{},{action:'enroll'}, {...enrollmentFixture().request,extra:true}]) {
    const x=enrollmentFixture();assert.equal((await runCleanerEnrollment(raw,'synthetic-owner',x.deps,{enabled:true})).state,'invalid');assert.equal(x.writes(),0);
  }
  const x=enrollmentFixture();assert.equal((await runCleanerEnrollment(x.request,'x',x.deps,{enabled:true})).state,'invalid');assert.equal(x.writes(),0);
});
