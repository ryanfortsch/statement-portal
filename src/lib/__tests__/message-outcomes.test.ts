import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleOutcomes, workKeys, noteStatus, workStatus, liveVisit, type OutcomeSource, type WorkRow } from '../message-outcomes.ts';
import { recentFollowups } from '../recent-followups.ts';
const row:WorkRow={id:'slip',title:'Repair thermostat',status:'open',assigned_to_type:'unassigned',assigned_to_email:null,assigned_to_label:null,scheduled_date:null,completed_at:null,from_guest_request_key:'source-key',from_quo_message_id:null,from_gmail_message_id:null};
const source:OutcomeSource={id:'card',followup_refs:{work:[{request_key:'source-key',id:'slip',title:'Old title',state:'filed',error:''}],notes:[],error:''}};
test('actual work record controls title, assignee and completion',()=>{
 const result=assembleOutcomes(source,[{...row,title:'Confirmed work',status:'done',assigned_to_label:'Test technician',completed_at:'2026-09-30T12:00:00Z'}]);
 assert.equal(result.work.length,1);assert.equal(result.work[0].status,'done');assert.equal(result.work[0].assignee,'Test technician');assert.equal(result.work[0].title,'Confirmed work');
});
test('same property or person cannot link unrelated work',()=>{assert.equal(assembleOutcomes({id:'unrelated'},[row]).work.length,0);});
test('legacy SMS and email IDs use their matching source columns only',()=>{
 assert.equal(assembleOutcomes({id:'x',external_message_id:'external',channel:'sms_quo'},[{...row,from_gmail_message_id:'external'}]).work.length,0);
 assert.equal(assembleOutcomes({id:'x',external_message_id:'external',channel:'email_gmail'},[{...row,from_gmail_message_id:'external'}]).work.length,1);
});
test('deduplicates slip found by more than one source key',()=>assert.equal(assembleOutcomes(source,[row,row]).work.length,1));
test('missing linked work is unavailable, never completed or unassigned',()=>{const w=assembleOutcomes(source,[]).work[0];assert.equal(w.status,'unavailable');assert.equal(w.assignee,'');});
test('a failed lookup never says there are no related tasks',()=>{const value=assembleOutcomes({id:'x',followup_refs:{work:[{id:'',request_key:'q',title:'',state:'lookup',error:''}],notes:[],error:''}},[],true);assert.match(value.error,/refreshed/);assert.equal(value.work[0].status,'unavailable');});
test('proposed and skipped work remain explicit when there is no slip',()=>{for(const state of ['proposed','skipped']) assert.equal(assembleOutcomes({id:'x',followup_refs:{work:[{id:'',request_key:'x',title:'Task',state,error:''}],notes:[],error:''}},[]).work[0].status,state);});
test('pending note does not imply delivery',()=>{assert.equal(noteStatus({id:'x',audience:'cleaner',recipient:'Test',status:'pending',body:'',error:''}),'Draft awaiting approval');});
test('uncertain delivery overrides a pending status',()=>{assert.equal(noteStatus({id:'x',audience:'cleaner',recipient:'Test',status:'pending',body:'',error:'Unconfirmed'}),'Needs review');});
test('unknown states remain unknown',()=>{assert.equal(workStatus('new_state','Test'),'Status unknown');assert.equal(noteStatus({id:'x',audience:'owner',recipient:'Test',status:'new_state',body:'',error:''}),'Status unknown');});
test('assignment and active work are distinct',()=>{assert.equal(workStatus('open','Unassigned'),'Unassigned');assert.equal(workStatus('open','Technician'),'Assigned');assert.equal(workStatus('in_progress','Technician'),'Underway');});
test('empty IDs cannot become broad database matches',()=>{assert.deepEqual(workKeys([{id:'x',external_message_id:'',followup_refs:{work:[{request_key:'',id:'',title:'Test',state:'proposed',error:''}],notes:[],error:''}}]),{id:[],from_guest_request_key:[],from_quo_message_id:[],from_gmail_message_id:[]});});
test('resolved followups preserve the source message and actual outcomes',()=>{
 const outcomes=assembleOutcomes(source,[row]);
 const list=recentFollowups([{id:'source',status:'approved',created_at:'2026-09-30T12:00:00Z',resolved_at:null,outcomes}]);
 assert.equal(list.length,1);assert.equal(list[0].outcomes?.work[0].id,'slip');
 assert.equal(recentFollowups([{id:'none',status:'approved',created_at:'',resolved_at:null,outcomes:{work:[],notes:[],error:''}}]).length,0);
});

test('a live visit provides assignment without claiming the task is completed',()=>{
 const stop={status:'pending',completed_at:null,inspection_packets:{id:'packet',status:'claimed',visit_date:'2026-10-01',awarded_contractor_id:'person'}};
 assert.equal(liveVisit(stop,null,new Map([['person','Test inspector']]))?.name,'Test inspector');
 assert.equal(liveVisit({...stop,completed_at:'2026-10-01'},null,new Map()),null);
 assert.equal(liveVisit(stop,'2026-10-01',new Map()),null);
 assert.equal(liveVisit({...stop,inspection_packets:{...stop.inspection_packets,status:'cancelled'}},null,new Map()),null);
});
