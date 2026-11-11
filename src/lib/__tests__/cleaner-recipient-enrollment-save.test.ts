import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { normalizeLanguage } from '../cleaner-digest-core.ts';

/** Exercise the real server action with a synthetic database and no providers. */
function actionFixture(options: {signedIn?:boolean; missingColumn?:boolean} = {}) {
  const writes: Array<{table:string; op:string; fields:Record<string,unknown>}> = [];
  const db = { from(table:string) {
    let op='read';
    const query = {
      select:()=>query, eq:()=>query, in:()=>query,
      insert:(fields:Record<string,unknown>)=>{op='insert';writes.push({table,op,fields});return query;},
      update:(fields:Record<string,unknown>)=>{op='update';writes.push({table,op,fields});return query;},
      then: (resolve:(value:unknown)=>unknown) => Promise.resolve(resolve(
        table==='properties' ? {data:[{id:'65_calderwood',region:'bridgeport_ct'}],error:null}
        : table==='regions' ? {data:[{id:'bridgeport_ct'}],error:null}
        : options.missingColumn && writes.at(-1)?.fields.daily_digest_enabled !== undefined
          ? {data:null,error:{code:'PGRST204'}} : {data:op==='read'?[]:[{phone:'+15555550199'}],error:null},
      )),
    }; return query;
  }};
  const mocks: Record<string,unknown> = {
    'node:crypto':{randomBytes:()=>({toString:()=> '0123456789abcdef'})},
    'next/navigation':{redirect:(url:string)=>{throw Error(`REDIRECT:${url}`);}},
    'next/cache':{revalidatePath:()=>{}}, '@/auth':{auth:async()=>options.signedIn===false?null:{user:{email:'owner@example.test'}}},
    '@/lib/team':{}, '@/lib/supabase-admin':{supabaseAdmin:db}, '@/lib/checkout-schedule':{},
    '@/lib/cleaner-digest':{normalizeLanguage}, '@/lib/property-scope':{CAPE_ANN_REGION:'cape_ann',REGION_LABELS:{bridgeport_ct:'Bridgeport'}},
    '@/lib/quo-lines':{normalizePhone:(value:string)=>value.replace(/\D/g,'').slice(-10)},
    '@/lib/mine-checkout-changes':{}, '@/lib/extension-holds':{}, '@/lib/turnover-notes':{}, '@/lib/cleaner-note':{},
  };
  const source=readFileSync(new URL('../../app/turnovers/schedule/actions.ts',import.meta.url),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const compiled={exports:{} as Record<string,(form:FormData)=>Promise<void>>};
  new Function('require','module','exports',output)((id:string)=>{
    assert.ok(Object.hasOwn(mocks,id),`Unmocked import: ${id}`);return mocks[id];
  },compiled,compiled.exports);
  return {save:compiled.exports.saveRecipientAction,writes};
}
function form() {
  const result=new FormData();
  Object.entries({phone:'5555550199',displayName:'Synthetic cleaner',region:'bridgeport_ct',propertyIds:'65_calderwood',
    language:'en',enabled:'true',dailyDigestPreference:'present'}).forEach(([k,v])=>result.set(k,v));
  return result;
}
test('new active portal recipient stores the daily opt-out in the same insert as the token',async()=>{
  const h=actionFixture();await assert.rejects(h.save(form()),/saved=recipient/);
  assert.equal(h.writes[0].op,'insert');assert.equal(h.writes[0].fields.enabled,true);
  assert.equal(h.writes[0].fields.daily_digest_enabled,false);assert.equal(h.writes[0].fields.portal_token,'0123456789abcdef');
  assert.deepEqual(h.writes[0].fields.property_ids,['65_calderwood']);
});
test('explicit daily opt-in persists, while an older open edit form preserves its stored preference',async()=>{
  const h=actionFixture(), f=form(); f.set('dailyDigestEnabled','true');
  await assert.rejects(h.save(f),/saved=recipient/);assert.equal(h.writes[0].fields.daily_digest_enabled,true);
  const old=actionFixture(), legacy=form();legacy.set('originalPhone','+15555550199');legacy.delete('dailyDigestPreference');
  await assert.rejects(old.save(legacy),/saved=recipient/);
  assert.equal(Object.hasOwn(old.writes[0].fields,'daily_digest_enabled'),false);
  assert.equal(Object.hasOwn(old.writes[0].fields,'portal_token'),false);
});
test('absent schema cannot silently drop the requested opt-out and save an enrolled recipient',async()=>{
  const h=actionFixture({missingColumn:true});await assert.rejects(h.save(form()),/err=save_failed/);
  assert.equal(h.writes.length,1);assert.equal(h.writes[0].fields.daily_digest_enabled,false);
});
test('signed-out save stops before database writes',async()=>{
  const h=actionFixture({signedIn:false});await assert.rejects(h.save(form()),/auth\/signin/);assert.deepEqual(h.writes,[]);
});
