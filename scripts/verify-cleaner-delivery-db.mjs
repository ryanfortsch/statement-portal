// Local loopback-only PostgreSQL rehearsal. No app env or hosted credentials.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
assert.ok(process.argv[2] && isAbsolute(process.argv[2]));
const { default: EmbeddedPostgres } = await import(pathToFileURL(process.argv[2]).href);
const root = await mkdtemp(join(tmpdir(), 'helm-cleaner-db-'));
const pg = new EmbeddedPostgres({ databaseDir: join(root,'data'), port: 55441, user: 'postgres',
 password: randomBytes(24).toString('hex'), persistent: true,
 postgresFlags: ['-h','127.0.0.1','-k',root], onLog: () => {}, onError: () => {} });
let running = false;
const clients = [];
const connect = async () => { const c = pg.getPgClient(); await c.connect(); clients.push(c);
 await c.query("set statement_timeout='8s'; set lock_timeout='6s'"); return c; };
const sql = await readFile(new URL('../docs/guesty-exit/staging-storage/cleaner-delivery.sql', import.meta.url), 'utf8');
const read = async c => (await c.query('select public.helm_pilot_cleaner_delivery_read() as history')).rows[0].history;
const append = async (c, expected, history) => (await c.query('select public.helm_pilot_cleaner_delivery_append($1,$2) as ok',[expected,history])).rows[0].ok;
try {
 await pg.initialise(); await pg.start(); running = true;
 const owner = await connect(), a = await connect(), b = await connect();
 await owner.query('create role anon; create role authenticated; create role service_role;');
 await owner.query(sql);
 await a.query('set role service_role'); await b.query('set role service_role');
 const zero = await read(a);
 const claim = { id:'claim-a',event:{type:'start',recipientId:'HELMTEST-cleaner-a',attemptId:'attempt-a'} };
 const one = { ...zero, version:1,records:[claim] };
 const other = { ...one,records:[{...claim,id:'claim-b',event:{...claim.event,attemptId:'attempt-b'}}] };
 const apid = (await a.query('select pg_backend_pid() as pid')).rows[0].pid;
 const bpid = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;
 await a.query('begin'); assert.equal(await append(a,0,one),true);
 const pending = append(b,0,other); pending.catch(() => {});
 let blocked = false;
 for (let i=0;i<200;i++) {
  blocked = (await owner.query('select $1::int=any(pg_blocking_pids($2)) as blocked',[apid,bpid])).rows[0].blocked;
  if (blocked) break; await delay(10);
 }
 assert.equal(blocked,true,'second connection must actually wait on row lock');
 await a.query('commit'); assert.equal(await pending,false); assert.deepEqual(await read(b),one);
 console.log('PASS: competing sessions, one committed claim and one stale rejection');
 const delivered = {id:'receipt-a',event:{type:'result',recipientId:'HELMTEST-cleaner-a',attemptId:'attempt-a',state:'delivered',providerId:'provider-a'}};
 const two = {...one,version:2,records:[claim,delivered]};
 await a.query('begin'); assert.equal(await append(a,1,two),true); await a.query('rollback');
 assert.deepEqual(await read(b),one); assert.equal(await append(b,1,two),true);
 for (const bad of [
  {...two,version:3,records:[claim,delivered,delivered]},
  {...two,version:3,records:[claim,delivered,{id:'x',event:{...delivered.event,content:'forbidden'}}]},
  {...two,version:3,messageId:'other',records:[claim,delivered,{id:'x',event:claim.event}]},
  {...two,version:3,records:[delivered,claim,{id:'x',event:claim.event}]},
 ]) await assert.rejects(append(a,2,bad));
 assert.deepEqual(await read(a),two);
 await owner.query(sql); assert.deepEqual(await read(a),two);
 const permissions=(await owner.query(`select has_function_privilege('anon','public.helm_pilot_cleaner_delivery_read()','execute') as anon,
 has_function_privilege('authenticated','public.helm_pilot_cleaner_delivery_append(integer,jsonb)','execute') as auth,
 has_schema_privilege('service_role','helm_cleaner_rehearsal','usage') as direct,
 to_regclass('public.automation_sends') is not null as live_queue`)).rows[0];
 assert.deepEqual(permissions,{anon:false,auth:false,direct:false,live_queue:false});
 await assert.rejects(a.query('select * from helm_cleaner_rehearsal.delivery'),/permission denied/);
 console.log('PASS: rollback, append-only identity, duplicate rejection, setup reapply and privileges');
 for(const c of clients) await c.end(); clients.length=0;
 await pg.stop(); running=false; await pg.start(); running=true;
 const fresh=await connect(); await fresh.query('set role service_role'); assert.deepEqual(await read(fresh),two);
 console.log('PASS: committed claim and provider receipt survive database restart');
} finally {
 for(const c of clients) await c.end().catch(()=>{});
 if(running) await pg.stop();
 await rm(root,{recursive:true,force:true});
}
