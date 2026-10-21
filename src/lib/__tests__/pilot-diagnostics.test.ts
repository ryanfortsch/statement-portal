import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pilotDiagnostics } from '../channex-staging/pilot-diagnostics.ts';
import { canonicalRehearsalEnabled } from '../channex-staging/canonical-revision-webhook.ts';
const now=Date.parse('2026-10-21T16:00:00Z');
const conflicts={openCount:0,resolvedCount:1,open:[]};
function state(){return {property:'HELMTEST-calderwood',captureEnabled:true,captureVersion:1,configurationVersion:1,
  configuration:{environment:'staging',topology:'single-unit',connection:'fixture',listing:'fixture',generation:1,publishEnabled:false,
    timeZone:'America/New_York',start:'2027-02-01',end:'2027-02-03',requiredSources:['fixture'],
    coverage:[{source:'fixture',start:'2027-02-01',end:'2027-02-03',complete:true,observedAt:now-1,freshUntil:now+1000}]},
  plannedCaptureVersion:0,plannedConfigurationVersion:0,planVersion:0,journalVersion:0,journal:{format:1,commands:[]},
  lastDigest:null,plannedFreshUntil:0,inputsMatchPlan:false,
  inputs:{authority:'helm',plan:{advance_notice_hours:24,booking_window_days:365,turnover_buffer_days:0,checkin_time:'16:00'},bookings:[],rateDays:[],periods:[]}};}
test('diagnostics distinguish a healthy paused publisher from write authorization',()=>{
  const report=pilotDiagnostics(state(),conflicts,now);
  assert.equal(report.publishingEnabled,false);assert.equal(report.attentionRequired,false);
  assert.equal(report.source.completeAndFresh,true);assert.equal(report.history.remaining,10000);
  assert.equal(report.canPublish,false);assert.equal(report.canSendMessages,false);
});
test('source expiry and open conflicts require attention without claiming fresh coverage or exposing payloads',()=>{
  const s=state();s.configuration.coverage[0].freshUntil=now;
  const r=pilotDiagnostics(s,{openCount:1,resolvedCount:0,open:[{revisionId:'11111111-1111-4111-8111-111111111111',
    bookingId:'22222222-2222-4222-8222-222222222222',reason:'booking_overlap',checkIn:'2027-02-01',checkOut:'2027-02-03',
    firstSeenAt:now,lastSeenAt:now,observations:1}]},now);
  assert.equal(r.attentionRequired,true);assert.equal(r.source.freshUntil,null);assert.equal(r.conflicts.openCount,1);
  assert.equal('inputs' in r,false);assert.equal('journal' in r,false);
});
test('diagnostics refuse corrupt journal, unknown properties and silently truncated conflict reads',()=>{
  for(const s of [{...state(),property:'real-home'},{...state(),journalVersion:1}])assert.throws(()=>pilotDiagnostics(s,conflicts,now));
  assert.throws(()=>pilotDiagnostics(state(),{...conflicts,openCount:1},now));
  assert.equal(canonicalRehearsalEnabled({VERCEL_ENV:'production',CHANNEX_STAGING_ENABLED:'true',CHANNEX_CANONICAL_REHEARSAL_ENABLED:'true',VERCEL_GIT_COMMIT_REF:'codex/channex-staging-pilot'}),false);
});
