import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readInventoryOperations, inventoryStatusHref, inventoryOperationsMessage, inventoryAttemptLabel, type InventoryOperations } from '../channex-inventory/operations.ts';
const now=Date.parse('2026-11-11T02:00:00Z');
function fixture(): InventoryOperations { return { format:1, propertyId:'65_calderwood', observedAt:now, authority:'guesty', publishingEnabled:false,
  planningEnabled:false, importEnabled:false, captureEnabled:false, headVersion:0, freshUntil:0, nextAttemptAt:null,
  consecutiveRecoveries:0, recentClaims:0, credentialBlocked:false, active:null, counts:{total:0,accepted:0,historicalUnknown:0}, recent:[] }; }
test('operations read is bounded, sanitized and rejects private or stale responses',async()=>{
  const f=fixture(); assert.deepEqual(await readInventoryOperations(async(name,args)=>{assert.equal(name,'helm_channex_delivery_operations');assert.deepEqual(args,{});return {data:f,error:null};},()=>now),f);
  for(const data of [null,{...f,token:'private'},{...f,observedAt:now-60000},{...f,observedAt:now+6000},{...f,counts:{total:0,accepted:1,historicalUnknown:0}},
    {...f,recent:Array(9).fill({state:'accepted',createdAt:now,recordedAt:now,retired:false,outcome:'accepted'})}]) {
    await assert.rejects(readInventoryOperations(async()=>({data,error:null}),()=>now),/^Error: Calendar sync status unavailable$/);
  }
  await assert.rejects(readInventoryOperations(async()=>({data:f,error:null}),()=>Number.NaN),/^Error: Calendar sync status unavailable$/);
  await assert.rejects(readInventoryOperations(async()=>{throw Error('PRIVATE_SENTINEL');},()=>now),/^Error: Calendar sync status unavailable$/);
});
test('status distinguishes disabled, prerequisites, unknown history and current attempt',()=>{
  const f=fixture();assert.equal(inventoryOperationsMessage(f).title,'Helm sending is off');
  f.publishingEnabled=true;assert.equal(inventoryOperationsMessage(f).title,'Calendar prerequisites incomplete');
  Object.assign(f,{authority:'helm',planningEnabled:true,importEnabled:true,captureEnabled:true,headVersion:1,freshUntil:now+30000});
  f.counts={total:2,accepted:1,historicalUnknown:1};assert.equal(inventoryOperationsMessage(f).title,'No update in flight');
  f.active={state:'uncertain',expiresAt:now-1,startedAt:now-60000,generationCurrent:true,recoverAfter:now+60000};
  assert.equal(inventoryOperationsMessage(f).title,'Update outcome unknown');
  f.consecutiveRecoveries=3;assert.equal(inventoryOperationsMessage(f).title,'Recovery limit reached');
  f.credentialBlocked=true;assert.equal(inventoryOperationsMessage(f).title,'Connection needs attention');
});
test('late receipts, expired leases and pacing never imply channel delivery',()=>{
  const f={...fixture(),authority:'helm' as const,publishingEnabled:true,planningEnabled:true,importEnabled:true,captureEnabled:true};
  f.active={state:'leased',expiresAt:now+30000,startedAt:null,generationCurrent:false,recoverAfter:null};
  assert.equal(inventoryOperationsMessage(f).title,'New information received');
  f.active.generationCurrent=true;assert.equal(inventoryOperationsMessage(f).title,'Update prepared');
  f.nextAttemptAt=now+60000;assert.equal(inventoryOperationsMessage(f).title,'Update prepared');
  f.nextAttemptAt=null;
  f.active.expiresAt=now;assert.equal(inventoryOperationsMessage(f).title,'Prepared update expired');
  f.nextAttemptAt=now+60000;assert.equal(inventoryOperationsMessage(f).title,'Waiting between updates');
  assert.equal(inventoryAttemptLabel({state:'uncertain',createdAt:now,recordedAt:now,retired:true,outcome:'uncertain'}),'Replaced · outcome still unknown');
  assert.equal(inventoryAttemptLabel({state:'accepted',createdAt:now,recordedAt:now,retired:false,outcome:'accepted'}),'Accepted by Channex');
});
test('status page authorizes before storage and cannot activate, send or claim',()=>{
  assert.equal(inventoryStatusHref('65_calderwood'),'/channels/65_calderwood/sync-status');
  assert.equal(inventoryStatusHref('21_horton'),null);assert.equal(inventoryStatusHref('constructor'),null);
  const hub=readFileSync(new URL('../../app/channels/[propertyId]/page.tsx',import.meta.url),'utf8');
  assert.match(hub,/owner && syncHref && <Link href=\{syncHref\}/);
  const page=readFileSync(new URL('../../app/channels/65_calderwood/sync-status/page.tsx',import.meta.url),'utf8');
  assert.ok(page.indexOf('if (!await isOwnerSession())')<page.indexOf('await readInventoryOperations'));
  assert.match(page,/NEXT_PUBLIC_SUPABASE_URL !== PRODUCTION_DB_URL/);
  assert.doesNotMatch(page,/runInventoryCycle|deliverInventoryOnce|\.update\(|\.insert\(/);
  const panel=readFileSync(new URL('../../app/channels/65_calderwood/sync-status/InventoryStatusPanel.tsx',import.meta.url),'utf8');
  assert.match(panel,/does not mean the queue is empty/);assert.match(panel,/Acceptance is not channel delivery/);
});
