import {test} from 'node:test';
import assert from 'node:assert/strict';
import {persistentHoldEnvironment,validPersistentHoldRequest} from '../channex-staging/hold-rehearsal.ts';
const env = {CHANNEX_STAGING_ENABLED:'true',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/channex-staging-pilot',CHANNEX_STAGING_DB_PROJECT_REF:'jgkblfozftcvymvwhhii',CHANNEX_STAGING_DB_URL:'https://jgkblfozftcvymvwhhii.supabase.co'};
test('persistent hold boundary requires exact preview branch and isolated project',()=>{
 assert.equal(persistentHoldEnvironment(env),true);
 for(const key of Object.keys(env)) assert.equal(persistentHoldEnvironment({...env,[key]:'other'}),false,key);
 assert.equal(persistentHoldEnvironment({...env,VERCEL_ENV:'production'}),false);
});
test('persistent hold payload requires boolean and preserves precise version',()=>{
 const body={hold:false,expectedUpdatedAt:'2026-10-13 12:34:56.123456+00'};
 assert.equal(validPersistentHoldRequest(body),true);
 assert.equal(body.expectedUpdatedAt,'2026-10-13 12:34:56.123456+00');
 for(const value of [null,{},[],{...body,hold:'false'},{...body,expectedUpdatedAt:'invalid'}]) assert.equal(validPersistentHoldRequest(value),false);
});
