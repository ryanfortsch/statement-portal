import {test} from 'node:test';
import assert from 'node:assert/strict';
import {syncSharedRevisions} from '../channex-staging/shared-sync.ts';
import {emptyOwnershipJournal,type OwnershipJournal} from '../channex-staging/ownership-journal.ts';
import type {Revision} from '../channex-staging/core.ts';
const r:Revision={id:'revision',bookingId:'test',member:'back',status:'new',checkIn:'2027-03-01',checkOut:'2027-03-22',receivedAt:'2026-10-02T12:00:00Z'};
function fixture(){let version=0,journal=emptyOwnershipJournal(),acks=0,failAck=true;return {store:{read:async()=>({version,journal}),replace:async(v:number,j:OwnershipJournal)=>{if(version!==v)return false;version++;journal=j;return true;}},client:{inspect:async()=>[],readRevisions:async()=>[r],acknowledge:async()=>{assert.equal(version,1);acks++;if(failAck)throw new Error('ACK response lost');}},get version(){return version},get acks(){return acks},recover(){failAck=false}};}
test('lost ACK retries durable revision without duplicating storage',async()=>{const f=fixture();await assert.rejects(syncSharedRevisions(f.store,f.client),/ACK/);f.recover();const out=await syncSharedRevisions(f.store,f.client);assert.equal(f.version,1);assert.equal(out.duplicates,1);assert.equal(out.acknowledged,1);assert.equal(f.acks,2);});
test('failed persistence prevents ACK',async()=>{const f=fixture();await assert.rejects(syncSharedRevisions({...f.store,replace:async()=>{throw new Error('offline')}},f.client),/offline/);assert.equal(f.acks,0);});
test('failed durable reread prevents ACK',async()=>{const f=fixture();let reads=0;await assert.rejects(syncSharedRevisions({...f.store,read:async()=>{if(++reads>2)throw new Error('offline');return f.store.read();}},f.client),/offline/);assert.equal(f.acks,0);});
