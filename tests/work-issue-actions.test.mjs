import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function actions({ email='operator@example.test', failure=false }={}) {
  const calls=[], refreshed=[];
  const source=ts.transpileModule(readFileSync(new URL('../src/app/work/issue-actions.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const mocks={ '@/auth':{auth:async()=>({user:{email}})}, 'next/cache':{revalidatePath:(...args)=>refreshed.push(args)}, '@/lib/supabase-admin':{supabaseAdmin:{rpc:async(name,args)=>{calls.push({name,args});return {error:failure?{message:'Synthetic database detail'}:null};}}} };
  const module={exports:{}};new Function('require','module','exports',source)(id=>{if(!(id in mocks))throw Error(`Unexpected import ${id}`);return mocks[id];},module,module.exports);
  return {...module.exports,calls,refreshed};
}
const primaryId='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
test('link actions require a signed-in actor and valid bounded IDs before any database write',async()=>{
  const signedOut=actions({email:null});assert.equal((await signedOut.linkWorkReports({primaryId,reportIds:[other]})).ok,false);assert.deepEqual(signedOut.calls,[]);
  const a=actions();for(const args of [{primaryId:'bad',reportIds:[other]},{primaryId,reportIds:[]},{primaryId,reportIds:Array(25).fill(other)},{primaryId,reportIds:['bad']}])assert.equal((await a.linkWorkReports(args)).ok,false);
  assert.deepEqual(a.calls,[]);assert.deepEqual(a.refreshed,[]);
});
test('link and separation use the server actor and only refresh after confirmed success',async()=>{
  const a=actions();assert.equal((await a.linkWorkReports({primaryId,reportIds:[other],actor:'spoof@example.test'})).ok,true);
  assert.deepEqual(a.calls[0],{name:'link_work_issue',args:{p_primary:primaryId,p_reports:[other],p_actor:'operator@example.test'}});
  assert.ok(a.refreshed.some(([path])=>path==='/work/[id]'));assert.ok(a.refreshed.some(([path])=>path==='/properties/[id]'));
  assert.equal((await a.separateWorkReports({issueId:primaryId,reportIds:[primaryId,other]})).ok,true);
  assert.deepEqual(a.calls[1],{name:'separate_work_issue',args:{p_issue:primaryId,p_reports:[primaryId,other],p_actor:'operator@example.test'}});
  const failed=actions({failure:true});const result=await failed.linkWorkReports({primaryId,reportIds:[other]});assert.equal(result.ok,false);assert.doesNotMatch(result.error,/database detail/);assert.equal(failed.calls.length,1);assert.deepEqual(failed.refreshed,[]);
});
