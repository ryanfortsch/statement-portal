import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readAuthorizedCleanerStays, canReadCalderwoodStays, CLEANER_STAY_ACCESS_FIELDS } from '../cleaner-stay-access.ts';

const token = '0123456789abcdef';
const access = () => ({ portal_token: token, enabled: true, property_ids: ['65_calderwood'], language: 'en' });
const report = () => ({ propertyName:'Synthetic home', from:'2026-11-11', through:'2027-11-11',
  stays:[{ checkIn:'2026-11-24', checkOut:'2026-11-28', arrivalTime:'15:00', checkoutTime:'11:00',
    guests:null, staying:false, adjusted:false, noCleaning:false, needsReview:false }] });

test('invalid tokens cannot touch either the authorization store or the report', async () => {
  for (const invalid of ['', token+'x', token.toUpperCase(), '../'+token, token+'\n', undefined, [token]]) {
    assert.deepEqual(await readAuthorizedCleanerStays(invalid, { recipient: async()=>{throw Error('must not read');},
      report: async()=>{throw Error('must not read');} }), {status:'not_found'});
  }
});
test('only active, exactly scoped Calderwood recipients may read; no regional or malformed fallbacks', async () => {
  for (const row of [null, {}, {...access(), enabled:false}, {...access(), enabled:'true'}, {...access(), property_ids:[]},
    {...access(), property_ids:['other']}, {...access(), property_ids:['65_calderwood','other']},
    {...access(), property_ids:['65_calderwood','65_calderwood']}, {...access(), property_ids:null},
    {...access(), portal_token:'fedcba9876543210'}, {...access(), language:'invalid'}]) {
    let reads = 0;
    assert.deepEqual(await readAuthorizedCleanerStays(token, {recipient:async()=>row, report:async()=>{reads++;return report();}}), {status:'not_found'});
    assert.equal(reads,0);
  }
  assert.equal(canReadCalderwoodStays(access()),true);
  assert.equal(canReadCalderwoodStays({...access(),enabled:false}),false);
});
test('authorization is checked before and after reading; valid legacy token lengths and language defaults work', async () => {
  for (const [value,language] of [[token,'en'],[token.repeat(2),'pt'],[token,null]] as const) {
    const calls:string[]=[];
    const result=await readAuthorizedCleanerStays(value,{recipient:async t=>{assert.equal(t,value);calls.push('access');return {...access(),portal_token:value,language};},
      report:async()=>{calls.push('report');return report();}});
    assert.deepEqual(calls,['access','report','access']);
    assert.deepEqual(result,{status:'ready',language:language??'pt',report:report()});
  }
});
test('rotation, deletion, disablement, scope change or language change while loading discards the report', async () => {
  for (const after of [null,{...access(),enabled:false},{...access(),property_ids:[]},
    {...access(),property_ids:['other']},{...access(),portal_token:'fedcba9876543210'},{...access(),language:'pt'}]) {
    let calls=0;
    assert.deepEqual(await readAuthorizedCleanerStays(token,{recipient:async()=>++calls===1?access():after,report:async()=>report()}),{status:'not_found'});
  }
});
test('store and report failures never become an empty successful schedule or leak error text', async () => {
  for (const failAt of ['first','report','last']) {
    let calls=0;
    const result=await readAuthorizedCleanerStays(token,{
      recipient:async()=>{calls++;if((failAt==='first'&&calls===1)||(failAt==='last'&&calls===2))throw Error('PRIVATE sentinel');return access();},
      report:async()=>{if(failAt==='report')throw Error('PRIVATE sentinel');return report();},
    });
    assert.deepEqual(result,{status:'unavailable'});
  }
  let calls=0;
  assert.deepEqual(await readAuthorizedCleanerStays(token,{recipient:async()=>++calls===1?access():null,
    report:async()=>{throw Error('private');}}),{status:'not_found'});
});
test('strict report projection removes identifiers, contacts, source metadata and secrets', async () => {
  const unsafe={...report(),guest_name:'PRIVATE',portal_token:token,guestCountCheck:{status:'verified'},
    stays:[{...report().stays[0],guest_name:'PRIVATE',phone:'PRIVATE',bookingId:'PRIVATE',entryCode:'PRIVATE',guestCountSource:'guesty'}]};
  const result=await readAuthorizedCleanerStays(token,{recipient:async()=>access(),report:async()=>unsafe});
  assert.deepEqual(result,{status:'ready',language:'en',report:report()});
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|portal_token|guestCountSource/);
});
test('invalid dates, excessive windows and malformed report rows fail closed; truly empty reports remain valid', async () => {
  for (const value of [null,{}, {...report(),through:'2030-01-01'}, {...report(),stays:[{...report().stays[0],checkIn:'2026-02-30'}]},
    {...report(),stays:[{...report().stays[0],checkOut:'2026-11-23'}]}, {...report(),stays:[{...report().stays[0],guests:-1}]}]) {
    assert.deepEqual(await readAuthorizedCleanerStays(token,{recipient:async()=>access(),report:async()=>value}),{status:'unavailable'});
  }
  const empty={...report(),stays:[]};
  assert.deepEqual(await readAuthorizedCleanerStays(token,{recipient:async()=>access(),report:async()=>empty}),{status:'ready',language:'en',report:empty});
});
test('portal uses the authorization wrapper and canonical-only report; it has no selector, grant or send operation', () => {
  const route=readFileSync(new URL('../../app/c/[token]/stays/page.tsx',import.meta.url),'utf8');
  const reader=readFileSync(new URL('../cleaner-stay-report.server.ts',import.meta.url),'utf8');
  assert.match(route,/await readAuthorizedCleanerStays\(token/);
  assert.match(route,/\.select\(CLEANER_STAY_ACCESS_FIELDS\)\.eq\('portal_token', value\)/);
  assert.match(route,/if \(r.error\) throw/); assert.match(route,/loadCalderwoodPortalReport\(supabaseAdmin, todayET\(\)\)/);
  assert.match(route,/result.status === 'not_found'\) notFound\(\)/);
  assert.match(route,/force-dynamic/); assert.match(route,/no-referrer/);
  assert.doesNotMatch(route,/searchParams|sendMessage|\.insert\(|\.update\(|loadCalderwoodCleanerReport|readCleanerCountToken/);
  assert.equal(CLEANER_STAY_ACCESS_FIELDS,'portal_token,enabled,property_ids,language');
  const canonicalOnly=reader.split('export async function loadCalderwoodPortalReport')[1].split('export async function loadCalderwoodCleanerReport')[0];
  assert.doesNotMatch(canonicalOnly,/enrichCleanerGuestCounts|loadCleanerCountSource|readCleanerCountToken/);
});
