import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getOrCreatePropertyOnboardingToken } from '../property-onboarding-token.ts';
function tokenFixture(initial: string | null = null) {
  let token = initial, exists = true, reads = 0, writes = 0, writeError = false, lookupError = false;
  const db = { from(table: string) {
    assert.equal(table, 'properties'); let replacement: string | undefined, requireNull = false;
    const query = {
      select(columns: string) { assert.equal(columns, 'onboarding_token'); return query; },
      eq(column: string, value: string) { assert.equal(column, 'id'); assert.equal(value, 'home'); return query; },
      is(column: string, value: null) { assert.equal(column, 'onboarding_token'); assert.equal(value, null); requireNull = true; return query; },
      update(value: { onboarding_token: string }) { replacement = value.onboarding_token; return query; },
      async maybeSingle() {
        if (replacement !== undefined) {
          writes++; if (writeError) return { data: null, error: { message: 'Write unavailable' } };
          if (!exists || (requireNull && token !== null)) return { data: null, error: null };
          token = replacement; return { data: { onboarding_token: token }, error: null };
        }
        reads++; return { data: exists ? { onboarding_token: token } : null, error: lookupError ? { message: 'Read unavailable' } : null };
      },
    }; return query;
  } } as unknown as SupabaseClient;
  return { db, get token() { return token; }, get writes() { return writes; }, get reads() { return reads; }, failWrite() { writeError = true; }, failRead() { lookupError = true; }, missing() { exists = false; } };
}
test('existing onboarding token is returned without replacing it', async () => { const f = tokenFixture('existing'); assert.equal(await getOrCreatePropertyOnboardingToken(f.db,'home'),'existing'); assert.equal(f.writes,0); });
test('simultaneous token requests return the same persisted winner', async () => {
  const f = tokenFixture(); const tokens = await Promise.all(Array.from({length:8},()=>getOrCreatePropertyOnboardingToken(f.db,'home')));
  assert.equal(new Set(tokens).size,1); assert.equal(tokens[0],f.token); assert.match(tokens[0],/^[0-9a-f]{32}$/); assert.equal(f.writes,8); assert.equal(f.reads,15);
});
test('failed token write cannot return an unpersisted URL', async () => { const f=tokenFixture();f.failWrite();await assert.rejects(getOrCreatePropertyOnboardingToken(f.db,'home'),/Write unavailable/);assert.equal(f.token,null); });
test('missing property cannot receive a token', async () => { const f=tokenFixture();f.missing();await assert.rejects(getOrCreatePropertyOnboardingToken(f.db,'home'),/Property not found/);assert.equal(f.writes,0); });
test('failed lookup stops token creation', async () => { const f=tokenFixture();f.failRead();await assert.rejects(getOrCreatePropertyOnboardingToken(f.db,'home'),/Read unavailable/);assert.equal(f.writes,0); });
test('unexpected empty stored token cannot be silently overwritten or returned as success', async () => { const f=tokenFixture('');await assert.rejects(getOrCreatePropertyOnboardingToken(f.db,'home'),/Could not confirm/);assert.equal(f.token,''); });
const source=ts.transpileModule(readFileSync(new URL('../../app/feed-actions.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function feedFixture() {
  let signedIn=true, configured=true, dbError=false, throws=false, concierge:unknown={ok:true,data:{ok:true,dismissed:1}};
  const writes:unknown[]=[],calls:unknown[]=[],paths:string[]=[];
  const env={NEXT_PUBLIC_SUPABASE_URL:'https://synthetic.test',SUPABASE_SERVICE_ROLE_KEY:'synthetic-only'};
  const deps:Record<string,unknown>={
    '@/auth':{auth:async()=>signedIn?{user:{email:'synthetic@example.test'}}:null},
    'next/cache':{revalidatePath:(p:string)=>paths.push(p)},
    '@/lib/stay-concierge':{dismissConciergeAttention:async(...args:unknown[])=>{calls.push(args);return concierge;}},
    '@supabase/supabase-js':{createClient:()=>({from:(table:string)=>({upsert:async(row:unknown,options:unknown)=>{assert.equal(table,'home_feed_dismissals');writes.push({row,options});if(throws)throw Error('Transport');return {error:dbError?{message:'Synthetic DB failure'}:null};}})})},
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actions:Record<string,(...args:any[])=>Promise<any>>={};
  runInNewContext(source,{exports:actions,require:(name:string)=>{assert.ok(name in deps);return deps[name];},process:{get env(){return configured?env:{};}}});
  return {actions,writes,calls,paths,signOut(){signedIn=false;},unconfigured(){configured=false;},failDb(){dbError=true;},failTransport(){throws=true;},respond(value:unknown){concierge=value;}};
}
for(const type of ['slip','task','email','inbound','plink-paid','plink-unpaid'])test('feed dismissal remains scoped and view-only for '+type,async()=>{const f=feedFixture();assert.equal((await f.actions.dismissFeedItem(type,'item')).ok,true);assert.equal(f.writes.length,1);assert.equal(JSON.stringify(f.writes[0]),JSON.stringify({row:{user_email:'synthetic@example.test',item_type:type,item_id:'item'},options:{onConflict:'user_email,item_type,item_id'}}));assert.deepEqual(f.paths,['/']);assert.equal(f.calls.length,0);});
for(const kind of ['auth','config','db','transport','invalid'])test('feed reports '+kind+' failure without a success refresh',async()=>{const f=feedFixture();if(kind==='auth')f.signOut();if(kind==='config')f.unconfigured();if(kind==='db')f.failDb();if(kind==='transport')f.failTransport();assert.equal((await f.actions.dismissFeedItem(kind==='invalid'?'bad':'slip','item')).ok,false);assert.equal(f.paths.length,0);});
for(const result of [{ok:false,error:{kind:'network'}},{ok:true,data:{ok:false,dismissed:0}}])test('concierge refusal stays visible: '+JSON.stringify(result),async()=>{const f=feedFixture();f.respond(result);assert.equal((await f.actions.dismissFeedItem('concierge','alert')).ok,false);assert.equal(f.paths.length,0);assert.equal(f.writes.length,0);});
test('confirmed concierge clear retains its shared alert behavior',async()=>{const f=feedFixture();assert.equal((await f.actions.dismissFeedItem('concierge','alert')).ok,true);assert.equal(JSON.stringify(f.calls),JSON.stringify([['alert','synthetic@example.test']]));assert.deepEqual(f.paths,['/']);});
