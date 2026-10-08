// Explicit local PostgreSQL rehearsal. No credentials, network, or provider transport.
// Run: node scripts/verify-inventory-pipeline.mjs /absolute/path/to/pglite/dist/index.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isAbsolute } from 'node:path';
import { planInventory } from '../src/lib/channex-staging/inventory-planner.ts';
import { projectInventory } from '../src/lib/channex-staging/inventory-projection.ts';
import { createInventoryPlanningStore } from '../src/lib/channex-staging/inventory-planning-store.ts';
import { createInventoryJournalStore } from '../src/lib/channex-staging/inventory-journal-store.ts';
import { prepareInventoryDispatch } from '../src/lib/channex-staging/inventory-worker.ts';
import { recordInventoryCommand, replayInventoryJournal } from '../src/lib/channex-staging/inventory-journal.ts';

assert.ok(process.argv[2] && isAbsolute(process.argv[2]), 'Pass an absolute local PGlite module path');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const origin = 'https://jgkblfozftcvymvwhhii.supabase.co';
// Supabase serializes actual requests; this transport runs only allowlisted SQL locally.
const transport = async (input, init) => {
  const request = new Request(input, init?.method === 'GET' ? {...init, body:undefined} : init);
  const url = new URL(request.url);
  assert.equal(url.origin, origin);
  let value;
  if (request.method === 'GET' && url.pathname === '/rest/v1/helm_pilot_inventory_state') {
    assert.equal(url.searchParams.get('id'), 'eq.1');
    value = (await db.query('select version,journal from helm_pilot_inventory_state where id=1')).rows[0];
    // PostgREST emits this bounded bigint as a JSON number; PGlite returns a string.
    value.version = Number(value.version);
  } else {
    assert.equal(request.method, 'POST');
    const p = await request.json();
    switch (url.pathname) {
      case '/rest/v1/rpc/helm_pilot_inventory_planning_read':
        value = (await db.query('select helm_pilot_inventory_planning_read() as value')).rows[0].value;
        break;
      case '/rest/v1/rpc/helm_pilot_inventory_plan_commit':
        value = (await db.query('select helm_pilot_inventory_plan_commit($1,$2,$3,$4,$5) as value',
          [p.expected_snapshot,p.expected_configuration,p.expected_journal,p.next_journal,p.fresh_until])).rows[0].value;
        break;
      case '/rest/v1/rpc/helm_pilot_inventory_append':
        value = (await db.query('select helm_pilot_inventory_append($1,$2) as value',
          [p.expected_version,p.next_journal])).rows[0].value;
        break;
      default: throw new Error('Unexpected request; network is forbidden');
    }
  }
  return new Response(JSON.stringify(value), {headers:{'content-type':'application/json'}});
};
try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  for (const file of ['inventory-store.sql','inventory-planning.sql']) {
    await db.exec(readFileSync(new URL(`../docs/guesty-exit/staging-storage/${file}`,import.meta.url),'utf8'));
  }
  let now = Date.now();
  const state = {configurationVersion:1,connection:'synthetic',property:'home',listing:'home',generation:1,
    snapshot:{version:1,resources:['home'],listings:[{id:'home',resources:['home']}],requiredSources:['canonical'],
      coverage:[{source:'canonical',resources:['home'],start:'2027-01-01',end:'2027-02-01',complete:true,freshUntil:now+600000}],
      bookings:[],holds:[{id:'maintenance',resources:['home'],start:'2027-01-01',end:'2027-01-02'}]}};
  await db.query('insert into helm_pilot_inventory_snapshot values(1,1,1,$1)',[state]);
  await db.exec('set role service_role');
  const planning = createInventoryPlanningStore(origin,'synthetic-key',transport);
  const history = () => createInventoryJournalStore(origin,'synthetic-key',transport);
  const jobs = async () => replayInventoryJournal((await history().read()).journal).queue.list();
  const plan = () => planInventory(planning,'2027-01-01','2027-01-03',()=>now);
  assert.equal((await plan()).status,'queued');
  assert.equal((await plan()).status,'unchanged');
  const id = (await jobs())[0].id;
  assert.deepEqual((await jobs())[0].days,[{date:'2027-01-01',available:0,stopSell:true},{date:'2027-01-02',available:1,stopSell:false}]);
  const refresh = async () => {
    const latest = await planning.read();
    const projection = projectInventory(latest.snapshot,latest.listing,'2027-01-01','2027-01-03',now);
    return {environment:'staging',connection:latest.connection,property:latest.property,generation:latest.generation,
      version:projection.version,digest:projection.digest,authority:'helm',enabled:true,complete:projection.complete,freshUntil:projection.freshUntil};
  };
  const prepare = () => prepareInventoryDispatch(history(),id,()=>now,1000,refresh);
  const job = await prepare();
  assert.ok(job);
  assert.equal((await jobs())[0].status,'submitting', 'durable barrier precedes simulated send');
  // One simulated provider receipt. Deliberately omit accepted save, as if the process died.
  const receipts = [{digest:job.digest,generation:job.generation}];
  assert.equal(await prepare(),null,'restart must not resend a submitting attempt');
  now += 1001;
  await recordInventoryCommand(history(),{kind:'expire',now});
  assert.equal((await jobs())[0].status,'uncertain');
  assert.equal(await prepare(),null,'expired ambiguous attempt requires reconciliation');
  const result = await recordInventoryCommand(history(),{kind:'reconcile',id,token:job.token,
    evidence:{settled:true,complete:true,...receipts[0]}});
  assert.equal(result.saved,true);
  assert.equal(result.result,true);
  assert.equal((await jobs())[0].status,'verified');
  assert.equal(await prepare(),null);
  assert.equal((await plan()).status,'unchanged');
  assert.equal(receipts.length,1);
  console.log('PASS: real planner + Supabase adapters + local SQL + worker; holds preserved; durable dispatch barrier; restart/expiry refuse resend; receipt reconciliation; repeated planning unchanged');
} finally {
  await db.close();
}
