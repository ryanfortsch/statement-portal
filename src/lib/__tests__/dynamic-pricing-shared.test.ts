import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import type {SupabaseClient} from '@supabase/supabase-js';
import {emptyPricingDrafts,neutralPricingDraft,PRICING_DRAFT_STORAGE,type PricingDrafts} from '../dynamic-pricing-drafts.ts';
import {pricingSettingsKey,pricingSharedChoice,emptyPricingSharedRecord,validateSharedPricingSettings,pricingSettingsDiff,pricingSettingChanges,replacePricingBrowserSettings,PRICING_DRAFT_BACKUP_STORAGE,type PricingSharedRecord} from '../dynamic-pricing-shared.ts';
import {readSharedPricingSettings,saveSharedPricingSettings} from '../dynamic-pricing-shared.server.ts';
const requestId='00000000-0000-4000-8000-000000000001';
function settings(base=20000):PricingDrafts {return {version:1,homes:{sample:{policy:neutralPricingDraft(base,10000,80000),version:1,groupId:null,inheritRules:false,overrides:[]}},groups:[]};}
function record(base=20000,revision=1):PricingSharedRecord {return {revision,settings:settings(base),updated_at:'2026-11-12T12:00:00Z',updated_by:'owner@synthetic.test'};}

test('shared settings compare JSONB keys and omitted optional fields without reordering rule arrays',()=>{
  assert.equal(pricingSettingsKey({z:1,a:{b:undefined,c:2}}),pricingSettingsKey({a:{c:2},z:1}));
  assert.notEqual(pricingSettingsKey([1,2]),pricingSettingsKey([2,1]));
});
test('new devices load saved drafts; an existing untracked browser requires review',()=>{
  assert.equal(pricingSharedChoice(emptyPricingDrafts(),record(),null),'load');
  assert.equal(pricingSharedChoice(settings(30000),record(),null),'conflict');
  assert.equal(pricingSharedChoice(settings(),emptyPricingSharedRecord(),null),'local');
});
test('clean browser loads new server settings, dirty browser retains edits, divergent copies require review',()=>{
  assert.equal(pricingSharedChoice(settings(),record(25000,2),record()),'load');
  assert.equal(pricingSharedChoice(settings(30000),record(),record()),'local');
  assert.equal(pricingSharedChoice(settings(30000),record(25000,2),record()),'conflict');
  assert.equal(pricingSharedChoice(settings(25000),record(25000,2),record()),'same');
  assert.equal(pricingSharedChoice(settings(),record(),record(20000,2)),'conflict');
});
test('known managed homes, overrides and inherited settings are validated before storage',()=>{
  assert.deepEqual(validateSharedPricingSettings(settings(),new Set(['sample'])),settings());
  assert.throws(()=>validateSharedPricingSettings(settings(),new Set()),/unknown property/);
  assert.throws(()=>validateSharedPricingSettings({...settings(),assignments:{foreign:null}},new Set(['sample'])),/unknown property/);
  assert.throws(()=>validateSharedPricingSettings({...settings(),extra:true},new Set(['sample'])));
  assert.throws(()=>validateSharedPricingSettings({oversize:'x'.repeat(512001)},new Set()),/500 KB/);
  const large={...emptyPricingDrafts(),assignments:Object.fromEntries(Array.from({length:201},(_,i)=>[`h${i}`,null]))};
  assert.throws(()=>validateSharedPricingSettings(large,new Set(Object.keys(large.assignments))),/200 listings/);
});
test('diff review includes group-only, assignment and account changes plus readable rule values',()=>{
  const a=settings(),b=settings(22000);b.groups=[{id:'standard',name:'Standard',policy:a.homes.sample.policy,overrides:[]}];b.homes.sample.groupId='standard';b.account={policy:a.homes.sample.policy,overrides:[]};
  assert.deepEqual(pricingSettingsDiff(a,b),{homes:['sample'],groups:['standard'],account:true});
  const rows=pricingSettingChanges({baseCents:20000,weekdayMinNights:2},{baseCents:22000,weekdayMinNights:3});
  assert.deepEqual(rows[0],{field:'Base price',browser:'$200',helm:'$220'});assert.equal(rows[1].helm,'3');
});
function storage(initial:PricingDrafts) {const values=new Map<string,string>([[PRICING_DRAFT_STORAGE,JSON.stringify(initial)]]);return {values,getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}};}
test('replacing browser drafts first preserves a bounded recovery copy',()=>{
  const s=storage(settings());let current=settings();
  for(let i=0;i<7;i++)current=replacePricingBrowserSettings(s,current,settings(21000+i));
  const backups=JSON.parse(s.getItem(PRICING_DRAFT_BACKUP_STORAGE)!);assert.equal(backups.length,5);assert.equal(backups[0].settings.homes.sample.policy.baseCents,21005);
  assert.deepEqual(JSON.parse(s.getItem(PRICING_DRAFT_STORAGE)!),current);
});
test('cross-tab edits, deletion, corruption or backup quota failures never replace local drafts',()=>{
  for(const mode of ['edit','delete','corrupt','quota']) {
    const s=storage(settings());
    if(mode==='edit')s.setItem(PRICING_DRAFT_STORAGE,JSON.stringify(settings(30000)));
    if(mode==='delete')s.values.delete(PRICING_DRAFT_STORAGE);
    if(mode==='corrupt')s.setItem(PRICING_DRAFT_BACKUP_STORAGE,'broken');
    if(mode==='quota')s.setItem=()=>{throw Error('Quota');};
    const before=s.getItem(PRICING_DRAFT_STORAGE);assert.throws(()=>replacePricingBrowserSettings(s,settings(),settings(25000)));assert.equal(s.getItem(PRICING_DRAFT_STORAGE),before);
  }
});
function dbFixture(opts:{error?:string;read?:unknown;badReceipt?:boolean;unknown?:boolean;registryFailure?:boolean}={}) {
  const calls:{kind:string;value:unknown}[]=[];
  const db={from(table:string){calls.push({kind:'table',value:table});const q={select(){return q;},eq(){return q;},order(){return q;},range(){return q;},maybeSingle(){return q;},then(resolve:(v:unknown)=>unknown){return Promise.resolve(resolve({data:table==='properties'?(opts.unknown?[]:[{id:'sample'}]):opts.read??null,error:table==='properties'?(opts.registryFailure?{message:'secret database failure'}:null):opts.error?{code:opts.error}:null}));}};return q;},async rpc(name:string,args:Record<string,unknown>){calls.push({kind:'rpc',value:{name,args}});return {data:opts.badReceipt?record(90000):{...record(),revision:Number(args.p_expected)+1,settings:args.p_settings},error:opts.error?{code:opts.error,message:'secret database failure'}:null};}} as unknown as SupabaseClient;
  return {db,calls};
}
test('missing row is empty, unavailable or corrupt storage is never represented as empty',async()=>{
  assert.deepEqual(await readSharedPricingSettings(dbFixture().db),{ok:true,value:emptyPricingSharedRecord()});
  for(const opts of [{error:'42P01'},{read:{invalid:true}}])assert.equal((await readSharedPricingSettings(dbFixture(opts).db)).ok,false);
});
test('save sends only the validated draft envelope to the dedicated CAS RPC',async()=>{
  const h=dbFixture();const result=await saveSharedPricingSettings(h.db,{expectedRevision:4,requestId,settings:settings()},' Owner@synthetic.test ');
  assert.equal(result.ok,true);if(result.ok)assert.equal(result.value.revision,5);
  assert.deepEqual(h.calls.filter(c=>c.kind==='table').map(c=>c.value),['properties']);
  assert.deepEqual(h.calls.find(c=>c.kind==='rpc')?.value,{name:'helm_save_pricing_drafts',args:{p_settings:settings(),p_expected:4,p_request:requestId,p_actor:'owner@synthetic.test'}});
});
test('invalid envelope, unknown homes and incomplete registry reads never reach the write RPC',async()=>{
  const invalid=dbFixture();assert.equal((await saveSharedPricingSettings(invalid.db,{expectedRevision:-1,requestId,settings:settings()},'owner@synthetic.test')).ok,false);assert.equal(invalid.calls.length,0);
  for(const opts of [{unknown:true},{registryFailure:true}]) {const h=dbFixture(opts);assert.equal((await saveSharedPricingSettings(h.db,{expectedRevision:0,requestId,settings:settings()},'owner@synthetic.test')).ok,false);assert.ok(!h.calls.some(c=>c.kind==='rpc'));}
});
test('CAS errors require review; failed or mismatched receipts never claim a confirmed save',async()=>{
  for(const opts of [{error:'40001'},{error:'08006'},{badReceipt:true}]) {
    const r=await saveSharedPricingSettings(dbFixture(opts).db,{expectedRevision:0,requestId,settings:settings()},'owner@synthetic.test');
    assert.equal(r.ok,false);if(!r.ok){assert.equal(r.conflict===true,opts.error==='40001');assert.ok(!r.error.includes('secret'));}
  }
});
test('both server actions require owner authorization before any settings read or write',async()=>{
  for(const allowed of [false,true]) {
    const calls:string[]=[];const mocks:Record<string,unknown>={
      '@/lib/helm-access-server':{requireOwnerEmail:async()=>{calls.push('auth');if(!allowed)throw Error('Forbidden');return 'owner@synthetic.test';}},
      '@/lib/supabase-admin':{supabaseAdmin:{}},
      '@/lib/dynamic-pricing-shared.server':{readSharedPricingSettings:async()=>{calls.push('read');},saveSharedPricingSettings:async(_db:unknown,_input:unknown,actor:string)=>{assert.equal(actor,'owner@synthetic.test');calls.push('save');}},
    };
    const code=ts.transpileModule(readFileSync(new URL('../../app/channels/pricing/settings-actions.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
    const compiled={exports:{} as Record<string,(input?:unknown)=>Promise<unknown>>};
    new Function('require','module','exports',code)((id:string)=>{assert.ok(Object.hasOwn(mocks,id));return mocks[id];},compiled,compiled.exports);
    for(const name of ['readSharedPricingSettingsAction','saveSharedPricingSettingsAction']) {if(allowed)await compiled.exports[name]({});else await assert.rejects(compiled.exports[name]({}),/Forbidden/);}
    assert.deepEqual(calls,allowed?['auth','read','auth','save']:['auth','auth']);
  }
});
