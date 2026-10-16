// Fixed fictional receipts in temporary loopback PostgreSQL. No hosted credentials or SMS.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHmac, randomBytes } from 'node:crypto';
import { createCleanerDeliveryDb } from '../src/lib/calderwood-rehearsal/cleaner-delivery-db.ts';
import { createCleanerReceiptInboxDb, ingestCleanerDeliveryReceipt, drainCleanerReceiptInbox } from '../src/lib/calderwood-rehearsal/cleaner-receipt-inbox.ts';
import { runCleanerDeliveryRehearsal } from '../src/lib/calderwood-rehearsal/cleaner-delivery-worker.ts';
import { reconcileCleanerDeliveryReceipt } from '../src/lib/calderwood-rehearsal/cleaner-delivery-receipts.ts';
assert.ok(process.argv[2] && isAbsolute(process.argv[2]));
const { default: EmbeddedPostgres } = await import(pathToFileURL(process.argv[2]).href);
const root = await mkdtemp(join(tmpdir(), 'helm-cleaner-inbox-'));
const pg = new EmbeddedPostgres({ databaseDir: join(root, 'data'), port: 55442, user: 'postgres',
 password: randomBytes(24).toString('hex'), persistent: true,
 postgresFlags: ['-h', '127.0.0.1', '-k', root], onLog: () => {}, onError: () => {} });
const clients = []; let running = false;
const connect = async (service = false) => { const c = pg.getPgClient(); await c.connect(); clients.push(c);
 await c.query("set statement_timeout='8s'; set lock_timeout='6s'"); if (service) await c.query('set role service_role'); return c; };
const restart = async () => { for (const c of clients) await c.end(); clients.length=0;
 await pg.stop(); running=false; await pg.start(); running=true; };
const sql = await readFile(new URL('../docs/guesty-exit/staging-storage/cleaner-delivery.sql',import.meta.url),'utf8');
const inboxSql = await readFile(new URL('../docs/guesty-exit/staging-storage/cleaner-receipts.sql',import.meta.url),'utf8');
const stores = client => {
 const fetcher = async (url, init) => {
  assert.equal(init?.method,'POST'); const path=String(url); const prefix='https://jgkblfozftcvymvwhhii.supabase.co/rest/v1/rpc/';
  assert.ok(path.startsWith(prefix)); const name=path.slice(prefix.length), args=JSON.parse(String(init.body));
  let query, params;
  switch(name) {
   case 'helm_pilot_cleaner_delivery_read': query='select public.helm_pilot_cleaner_delivery_read() as result'; params=[]; break;
   case 'helm_pilot_cleaner_delivery_append': query='select public.helm_pilot_cleaner_delivery_append($1,$2) as result'; params=[args.expected_version,args.next_history]; break;
   case 'helm_pilot_cleaner_receipt_enqueue': query='select public.helm_pilot_cleaner_receipt_enqueue($1) as result'; params=[args.incoming_receipt]; break;
   case 'helm_pilot_cleaner_receipt_pending': query='select public.helm_pilot_cleaner_receipt_pending($1,$2) as result'; params=[args.after_sequence,args.batch_limit]; break;
   case 'helm_pilot_cleaner_receipt_apply': query='select public.helm_pilot_cleaner_receipt_apply($1,$2,$3) as result'; params=[args.receipt_id,args.expected_version,args.next_history]; break;
   default: throw Error('Unexpected RPC');
  }
  return Response.json((await client.query(query,params)).rows[0].result);
 };
 return { delivery:createCleanerDeliveryDb('https://jgkblfozftcvymvwhhii.supabase.co','synthetic',fetcher),
 inbox:createCleanerReceiptInboxDb('https://jgkblfozftcvymvwhhii.supabase.co','synthetic',fetcher) };
};
const now=Date.parse('2030-01-10T14:00:00Z'), key=randomBytes(32).toString('base64');
const normalized = (recipient='a') => ({id:`HELMTEST-inbox-receipt-${recipient}`,providerId:`HELMTEST-inbox-provider-${recipient}`,recipientId:`HELMTEST-cleaner-${recipient}`});
const signed = (recipient='a') => {
 const r=normalized(recipient); const body={id:r.id,type:'message.delivered',data:{object:{id:r.providerId,
  phoneNumberId:'HELMTEST-ops-line',direction:'outgoing',status:'delivered',to:[r.recipientId],text:'fictional body must not persist'}}};
 return {rawBody:JSON.stringify(body),signature:`hmac;1;${now};${createHmac('sha256',Buffer.from(key,'base64')).update(`${now}.${JSON.stringify(body)}`).digest('base64')}`,testSigningKey:key,now};
};
const run = async (store,recipient='a') => {
 const plan={messageId:'HELMTEST-cleaner-message',recipientId:`HELMTEST-cleaner-${recipient}`,attemptId:`HELMTEST-inbox-attempt-${recipient}`,
  bookingRevision:'fixture-v1',contentRevision:'template-v1',fireAt:now,expiresAt:now+60000};
 return runCleanerDeliveryRehearsal({store,plan,now:()=>now,simulation:{mode:'synthetic',dispatch:async()=>({state:'accepted',providerId:normalized(recipient).providerId})},
 readContext:async()=>({messageId:plan.messageId,bookingRevision:plan.bookingRevision,contentRevision:plan.contentRevision,status:'confirmed',held:false,
 owner:'helm',previousSenderStopped:true,observedAt:now-1000,validUntil:now+60000})});
};
try {
 await pg.initialise(); await pg.start(); running=true;
 let owner=await connect(); await owner.query('create role anon; create role authenticated; create role service_role;');
 await owner.query(sql); await owner.query(inboxSql);
 let a=await connect(true), b=await connect(true), sa=stores(a), sb=stores(b);
 assert.equal((await ingestCleanerDeliveryReceipt({inbox:sa.inbox,...signed()})).status,'stored');
 assert.equal((await drainCleanerReceiptInbox(sa)).unmatched,1); assert.equal((await sa.delivery.read()).version,0);
 const stored=(await owner.query('select receipt from helm_cleaner_rehearsal.receipt_inbox')).rows;
 assert.deepEqual(stored,[{receipt:normalized()}]);
 await restart(); owner=await connect(); a=await connect(true); b=await connect(true); sa=stores(a); sb=stores(b);
 assert.equal((await sa.inbox.pending()).length,1);
 assert.equal((await run(sa.delivery)).status,'accepted');
 await a.query('begin'); assert.equal((await drainCleanerReceiptInbox(sa)).applied,1);
 assert.equal((await sa.delivery.read()).version,3); assert.deepEqual(await sa.inbox.pending(),[]);
 await a.query('rollback'); assert.equal((await sa.delivery.read()).version,2); assert.equal((await sa.inbox.pending()).length,1);
 console.log('PASS: early authenticated receipt survives restart; receipt completion and ledger roll back together');
 const raced=await Promise.all([drainCleanerReceiptInbox(sa),drainCleanerReceiptInbox(sb)]);
 assert.equal(raced.reduce((n,r)=>n+r.applied,0),1);
 assert.equal((await sa.delivery.read()).version,3); assert.deepEqual(await sa.inbox.pending(),[]);
 assert.equal((await ingestCleanerDeliveryReceipt({inbox:sa.inbox,...signed()})).status,'duplicate');
 await assert.rejects(sa.inbox.enqueue({...normalized(),providerId:'HELMTEST-conflict'}));
 await assert.rejects(a.query("select public.helm_pilot_cleaner_receipt_enqueue($1)",[{...normalized(),id:'HELMTEST-extra',body:'forbidden'}]));
 assert.equal((await run(sa.delivery,'b')).status,'accepted');
 await reconcileCleanerDeliveryReceipt({store:sa.delivery,...signed('b')});
 const before=(await sa.delivery.read()).version;
 await ingestCleanerDeliveryReceipt({inbox:sa.inbox,...signed('b')});
 assert.equal((await drainCleanerReceiptInbox(sa)).applied,1); assert.equal((await sa.delivery.read()).version,before);
 console.log('PASS: concurrent drains, duplicate ingestion, conflict rejection and existing-event repair');
 const extra={...normalized(),id:'HELMTEST-validation-probe'};
 await sa.inbox.enqueue(extra);
 const history=(await owner.query('select history from helm_cleaner_rehearsal.delivery')).rows[0].history;
 const bad={...history,version:history.version+1,records:[...history.records,{id:`receipt:${extra.id}`,event:{type:'result',recipientId:extra.recipientId,
  attemptId:'HELMTEST-wrong-attempt',state:'delivered',providerId:extra.providerId}}]};
 await assert.rejects(a.query('select public.helm_pilot_cleaner_receipt_apply($1,$2,$3)',[extra.id,history.version,bad]));
 assert.equal((await sa.inbox.pending()).length,1); assert.equal((await sa.delivery.read()).version,history.version);
 assert.equal((await a.query('select public.helm_pilot_cleaner_receipt_apply($1,$2,$3) as status',[extra.id,0,bad])).rows[0].status,'stale');
 assert.equal((await drainCleanerReceiptInbox(sa)).applied,1);
 await owner.query(inboxSql);
 await assert.rejects(a.query('select * from helm_cleaner_rehearsal.receipt_inbox'),/permission denied/);
 const privilege=(await owner.query(`select has_function_privilege('anon','public.helm_pilot_cleaner_receipt_enqueue(jsonb)','execute') as anon,
 has_function_privilege('authenticated','public.helm_pilot_cleaner_receipt_pending(bigint,integer)','execute') as auth,
 has_function_privilege('anon','public.helm_pilot_cleaner_receipt_apply(text,integer,jsonb)','execute') as apply`)).rows[0];
 assert.deepEqual(privilege,{anon:false,auth:false,apply:false});
 const version=(await sa.delivery.read()).version;
 await restart(); a=await connect(true); sa=stores(a);
 assert.deepEqual(await sa.inbox.pending(),[]); assert.equal((await sa.delivery.read()).version,version);
 assert.equal((await run(sa.delivery)).status,'delivered'); assert.equal((await run(sa.delivery,'b')).status,'delivered');
 assert.equal((await ingestCleanerDeliveryReceipt({inbox:sa.inbox,...signed()})).status,'duplicate');
 console.log('PASS: atomic match validation, setup reapply, restricted access and restart without replay');
} finally {
 for(const c of clients) await c.end().catch(()=>{});
 if(running) await pg.stop();
 await rm(root,{recursive:true,force:true});
}
