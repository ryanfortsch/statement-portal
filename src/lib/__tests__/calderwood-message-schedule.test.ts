import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calderwoodMessageSchedule, type ScheduleInput} from '../calderwood-rehearsal/message-schedule.ts';
const baseline: ScheduleInput = {checkIn:'2027-01-15',checkOut:'2027-01-18',confirmationAt:'2027-01-01T15:00:00Z',now:new Date('2027-01-01T15:00:00Z'),status:'confirmed'};
const row = (input: ScheduleInput,key:string) => calderwoodMessageSchedule(input).find(r=>r.key===key)!;
test('six verified workflows inherit reservation timing and calculate confirmed offsets',()=>{
 const rows=calderwoodMessageSchedule(baseline);
 assert.equal(rows.length,6);
 assert.equal(rows.filter(r=>r.status==='needs-review').length,0);
 assert.equal(row(baseline,'confirmation').fireAt,'2027-01-01T15:30:00.000Z');
 assert.equal(row(baseline,'key_code').fireAt,'2027-01-15T20:00:00.000Z');
 assert.equal(row(baseline,'cleaner_arrival').fireAt,'2027-01-15T14:00:00.000Z');
 assert.equal(row(baseline,'cleaner_reminder').date,'2027-01-05');
});
test('3 PM code and 9 AM cleaner stay local through summer and DST weekends',()=>{
 for(const [checkIn,code,cleaner] of [['2027-07-15','19','13'],['2027-03-14','19','13'],['2027-11-07','20','14']]) {
 const input={...baseline,checkIn,checkOut:checkIn.slice(0,8)+'20'};
 assert.equal(row(input,'key_code').fireAt,`${checkIn}T${code}:00:00.000Z`);
 assert.equal(row(input,'cleaner_arrival').fireAt,`${checkIn}T${cleaner}:00:00.000Z`);
 }
});
test('explicit local clocks use calendar days across DST and reject missing local times',()=>{
 const input={...baseline,checkIn:'2027-03-15',checkOut:'2027-03-18',localTimes:{pre_arrival:'09:00',cleaner_reminder:'09:00',pre_checkout:'10:00'}};
 assert.equal(row(input,'pre_arrival').fireAt,'2027-03-14T13:00:00.000Z');
 assert.equal(row(input,'cleaner_reminder').fireAt,'2027-03-05T14:00:00.000Z');
 assert.equal(row({...input,localTimes:{pre_arrival:'02:30'}},'pre_arrival').status,'needs-review');
});
test('late imports never become send-now, holds persist, sent history wins over cancellation',()=>{
 const late={...baseline,now:new Date('2027-01-16T00:00:00Z')};
 assert.equal(row(late,'key_code').status,'needs-review');
 assert.equal(row({...late,held:['key_code']},'key_code').status,'held');
 assert.equal(row({...late,status:'cancelled',held:['key_code']},'key_code').status,'cancelled');
 assert.equal(row({...late,status:'cancelled',sent:['key_code']},'key_code').status,'already-sent');
});
test('moved dates recompute review proposals without replaying held or sent messages',()=>{
 const moved: ScheduleInput={...baseline,checkIn:'2027-01-20',checkOut:'2027-01-24',held:['key_code'],sent:['confirmation']};
 assert.equal(row(moved,'key_code').status,'held');
 assert.equal(row(moved,'key_code').fireAt,'2027-01-20T20:00:00.000Z');
 assert.equal(row(moved,'confirmation').status,'already-sent');
 assert.equal(row(moved,'pre_checkout').date,'2027-01-23');
});
test('bad stay dates and missing confirmation cannot invent timing',()=>{
 assert.throws(()=>calderwoodMessageSchedule({...baseline,checkIn:'2027-02-30'}));
 assert.throws(()=>calderwoodMessageSchedule({...baseline,checkOut:baseline.checkIn}));
 assert.equal(row({...baseline,confirmationAt:null},'confirmation').status,'needs-review');
});

test('Guesty day offsets inherit listing times and reservation ETA/ETD overrides',()=>{
 assert.equal(row(baseline,'pre_arrival').fireAt,'2027-01-14T21:00:00.000Z');
 assert.equal(row(baseline,'pre_checkout').fireAt,'2027-01-17T16:00:00.000Z');
 assert.equal(row(baseline,'cleaner_reminder').fireAt,'2027-01-05T21:00:00.000Z');
 const adjusted={...baseline,checkInTime:'18:00',checkOutTime:'12:00'};
 assert.equal(row(adjusted,'pre_arrival').fireAt,'2027-01-14T23:00:00.000Z');
 assert.equal(row(adjusted,'pre_checkout').fireAt,'2027-01-17T17:00:00.000Z');
 assert.equal(row(adjusted,'key_code').fireAt,'2027-01-15T22:00:00.000Z');
 assert.equal(row(adjusted,'cleaner_arrival').fireAt,'2027-01-15T16:00:00.000Z');
});
