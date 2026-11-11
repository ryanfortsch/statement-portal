import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { receivesDailyDigest, authorizeDigestDelivery, readDigestEnrollment } from '../cleaner-digest-enrollment.ts';
import { shapeRecipient, RECIPIENT_COLS } from '../cleaner-digest-core.ts';
import { canReadCalderwoodStays, calderwoodAccessUnchanged } from '../cleaner-stay-access.ts';

const row = () => ({ phone:'+15555550199', display_name:'Synthetic cleaner', portal_token:'0123456789abcdef',
  enabled:true, daily_digest_enabled:true, property_ids:['65_calderwood'], region:'bridgeport_ct', language:'en' as const });

test('active portal-only recipient keeps arrival-report access and never joins the daily summary', () => {
  const portalOnly = shapeRecipient({...row(), daily_digest_enabled:false});
  assert.equal(canReadCalderwoodStays(portalOnly),true);
  assert.equal(receivesDailyDigest(portalOnly),false);
  assert.equal(receivesDailyDigest(row()),true);
  assert.equal(receivesDailyDigest({...row(),enabled:false}),false);
  assert.equal(receivesDailyDigest({...row(),daily_digest_enabled:undefined}),false);
  assert.equal(canReadCalderwoodStays({...portalOnly,enabled:false}),false);
});

test('existing enrollment survives the additive migration; explicit false stays false', async () => {
  const values = await readDigestEnrollment(async fields => {
    assert.equal(fields,`${RECIPIENT_COLS},daily_digest_enabled`);
    return {data:[row(),{...row(),daily_digest_enabled:false}],error:null};
  });
  assert.deepEqual(values.map(receivesDailyDigest),[true,false]);
});

test('missing columns and stale schema caches block sending rather than assuming legacy enrollment', async () => {
  for (const code of ['42703','PGRST204']) {
    let reads = 0;
    await assert.rejects(readDigestEnrollment(async()=>{reads++;return {data:null,error:{code}};}),/unavailable/);
    assert.equal(reads,1);
  }
});

test('new-schema uncertainty, outages and denied reads never fall back to enrollment', async () => {
  for (const response of [
    {data:null,error:null}, {data:[],error:{code:'57014'}}, {data:[row()],error:{code:'42501'}},
    ...[undefined,null,'true',1].map(value=>({data:[{...row(),daily_digest_enabled:value}],error:null})),
  ]) {
    let reads=0;
    await assert.rejects(readDigestEnrollment(async()=>{reads++;return response;}),/unavailable/);
    assert.equal(reads,1);
  }
  await assert.rejects(readDigestEnrollment(async()=>({data:null,error:{code:'42703'}})),/unavailable/);
});

test('last-moment opt-out, disabled recipient, deleted row or altered destination/scope suppress the send', async () => {
  for(const current of [null, {...row(),enabled:false}, {...row(),daily_digest_enabled:false},
    {...row(),phone:'+15555550299'}, {...row(),portal_token:'fedcba9876543210'},
    {...row(),property_ids:[]}, {...row(),property_ids:['another_home']}, {...row(),region:'cape_ann'}, {...row(),language:'pt' as const}]) {
    assert.equal(await authorizeDigestDelivery(row(),async()=>current),false);
  }
  assert.equal(await authorizeDigestDelivery(row(),async()=>{throw Error('private');}),false);
  assert.equal(await authorizeDigestDelivery(row(),async()=>row()),true);
  let read=false;
  assert.equal(await authorizeDigestDelivery({...row(),daily_digest_enabled:false},async()=>{read=true;return row();}),false);
  assert.equal(read,false);
});

test('revoking or rotating pilot access invalidates its checkout and arrival views together', () => {
  for(const after of [null,{...row(),enabled:false},{...row(),property_ids:[]},{...row(),portal_token:'fedcba9876543210'}]) {
    assert.equal(calderwoodAccessUnchanged(row(),after),false);
  }
  assert.equal(calderwoodAccessUnchanged(row(),{...row(),daily_digest_enabled:false}),true);
});

test('all digest entry points share the enrollment filter and the final pre-provider check', () => {
  const read=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');
  const service=read('../cleaner-digest.ts');
  for(const name of ['previewRecipientBodies','regionsWithEnabledRecipients','sendDigest','autoSendTomorrowDigest']) {
    // Name may be followed by other declarations, so bound at next exported function.
    const body=service.split(`export async function ${name}(`)[1]?.split('export async function ')[0];
    assert.ok(body,`${name} exists`); assert.match(body,/filter\(receivesDailyDigest\)/);
  }
  const sender=service.split('export async function sendDigest(')[1].split('/** Tomorrow')[0];
  assert.match(sender,/await authorizeDigestDelivery\(r,/);
  assert.match(sender,/if \(!authorized\) \{[\s\S]*?continue;/);
  assert.ok(sender.indexOf('await authorizeDigestDelivery')<sender.indexOf('await sendMessage'));
  const save=read('../../app/turnovers/schedule/actions.ts').split('export async function saveRecipientAction')[1].split('// ─── owner blocks')[0];
  assert.match(save,/dailyDigestPreference/); assert.match(save,/\.\.\.digestFields/);
  const portal=read('../../app/c/[token]/page.tsx');
  assert.ok(portal.indexOf('if (calderwoodPortal && !canReadCalderwoodStays')<portal.indexOf('await buildCheckoutSchedule'));
  assert.match(portal,/!calderwoodAccessUnchanged\(recipientRow, current.data\)\) notFound/);
  const migration=read('../../../supabase/migrations/20261111140000_cleaner_daily_digest_enrollment.sql');
  assert.match(migration,/daily_digest_enabled boolean not null default true/);
  assert.doesNotMatch(migration,/\b(?:INSERT INTO|UPDATE|DELETE FROM|DROP)\b/i);
});
