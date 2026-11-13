import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export async function verifyGuestMessageControls(sql:(query:string)=>string,asyncSql:(query:string)=>Promise<string>){
// Install empty private control functions against actual runtime-created jobs.
const beforeControls = sql("select jsonb_agg(to_jsonb(r) order by id) from message_automations r;");
sql(`create table cleaner_schedule_recipients(phone text primary key, display_name text not null,
 portal_token text not null unique, enabled boolean not null default false, property_ids text[] not null default '{}',
 region text not null default 'cape_ann',language text not null default 'pt',daily_digest_enabled boolean not null default false);
`);
sql(readFileSync(new URL('../supabase/migrations/20261113090000_channex_cleaner_schedule.sql', import.meta.url), 'utf8'));
sql(readFileSync(new URL('../supabase/migrations/20261113160000_channex_cleaner_enrollment.sql', import.meta.url), 'utf8'));
const beforeHolds = sql("select (select count(*) from helm_channex_messages.hold_events)||':'||(select count(*) from helm_channex_messages.cleaner_hold_events)||':'||(select count(*) from automation_sends);");
sql(readFileSync(new URL('../supabase/migrations/20261113220000_channex_message_controls.sql', import.meta.url), 'utf8'));
assert.equal(sql("select (select count(*) from helm_channex_messages.hold_events)||':'||(select count(*) from helm_channex_messages.cleaner_hold_events)||':'||(select count(*) from automation_sends);"),beforeHolds);
assert.equal(sql("select jsonb_agg(to_jsonb(r) order by id) from message_automations r;"),beforeControls);
for(const signature of ['helm_channex_message_control_read(uuid)','helm_channex_message_control(uuid,text,boolean,text)']) {
 for(const role of ['anon','authenticated'])assert.equal(sql(`select has_function_privilege('${role}','${signature}','execute');`),'f');
 assert.equal(sql(`select has_function_privilege('service_role','${signature}','execute');`),'t');
}
const controlRead=(sid:string)=>JSON.parse(sql(`set role service_role; select helm_channex_message_control_read('${sid}');`));
const controlSql=(sid:string,token:string,held:boolean)=>`select helm_channex_message_control('${sid}','${token}',${held},'synthetic-owner');`;
const guestSend=sql("select send_id from helm_channex_messages.jobs where state='prepared' order by fire_at desc limit 1;");
assert.ok(guestSend);
let guestControl=controlRead(guestSend);assert.equal(guestControl.canHold,true);assert.equal(guestControl.lane,'guest');
const competed=await Promise.all([asyncSql('set role service_role; '+controlSql(guestSend,guestControl.token,true)),asyncSql('set role service_role; '+controlSql(guestSend,guestControl.token,true))]);
assert.deepEqual(competed.map(x=>JSON.parse(x).state).sort(),['changed','conflict']);
let heldGuest=controlRead(guestSend);assert.equal(heldGuest.held,true);assert.equal(heldGuest.canResume,true);
assert.equal(JSON.parse(sql(controlSql(guestSend,guestControl.token,false))).state,'conflict');
for(const mutation of ["update properties set automations_enabled=false where id='65_calderwood'",`update bookings set check_out=check_out+1 where id='${heldGuest.bookingId}'`,
 `update helm_channex_messages.jobs set expires_at=clock_timestamp()-interval '30 seconds', fire_at=clock_timestamp()-interval '1 minute', prepared_at=clock_timestamp()-interval '3 minutes',source_evidence_at=clock_timestamp()-interval '4 minutes' where send_id='${guestSend}'`]) {
 assert.equal(sql(`begin; ${mutation}; select (helm_channex_message_control_read('${guestSend}')->>'canResume')::boolean; rollback;`),'f');
}
assert.equal(JSON.parse(sql(controlSql(guestSend,heldGuest.token,false))).state,'changed');
assert.equal(JSON.parse(sql(controlSql(guestSend,heldGuest.token,false))).state,'conflict','lost response replay cannot alter hold again');
// ABA: hold -> resume -> hold cannot accept the first held screen's token.
guestControl=controlRead(guestSend);assert.equal(JSON.parse(sql(controlSql(guestSend,guestControl.token,true))).state,'changed');
assert.equal(JSON.parse(sql(controlSql(guestSend,heldGuest.token,false))).state,'conflict');
heldGuest=controlRead(guestSend);assert.equal(JSON.parse(sql(controlSql(guestSend,heldGuest.token,false))).state,'changed');

console.log('PASS: guest holds, concurrent stale-screen refusal, resume eligibility and ABA fencing');
}
