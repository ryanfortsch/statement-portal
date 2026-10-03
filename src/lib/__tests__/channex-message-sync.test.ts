import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyMessageArchive,mergeMessageArchive,syncPilotMessages,type SavedConversation} from '../channex-staging/message-sync.ts';
const c:SavedConversation={thread:{id:'t1',unit:'front',title:'Synthetic',provider:'Test',bookingId:null,closed:false,messageCount:1},messages:[{id:'m1',text:'First',sender:'guest',receivedAt:'2026-10-02T12:00:00Z',updatedAt:'2026-10-02T12:00:00Z',attachmentCount:0}]};
test('duplicate snapshots deduplicate and absent records never delete history',()=>{
 const first=mergeMessageArchive(emptyMessageArchive(),[c],'front');
 assert.deepEqual(mergeMessageArchive(first,[c],'front'),first);
 assert.deepEqual(mergeMessageArchive(first,[],'front'),first);
 assert.throws(()=>mergeMessageArchive(first,[c],'back'),/ownership/);
});
test('stale edits cannot replace newer text; conflicting timestamps fail',()=>{
 const first=mergeMessageArchive(emptyMessageArchive(),[c],'front');
 const newer={...c,messages:[{...c.messages[0],text:'Edited',updatedAt:'2026-10-02T12:00:00.000001Z'}]};
 const edited=mergeMessageArchive(first,[newer],'front');
 assert.equal(mergeMessageArchive(edited,[c],'front').conversations[0].messages[0].text,'Edited');
 assert.throws(()=>mergeMessageArchive(first,[{...c,messages:[{...c.messages[0],text:'Conflict'}]}],'front'),/Conflicting/);
});
test('partial reads save nothing, and CAS conflicts are surfaced',async()=>{
 let writes=0;
 const store={read:async()=>({version:1,archive:emptyMessageArchive()}),save:async()=>{writes++;return false;}};
 await assert.rejects(()=>syncPilotMessages(store,{readMessages:async(_unit,id)=>{if(id)throw Error('Provider unavailable');return {threads:[c.thread],messages:[],selectedThread:null};}},'front'));
 assert.equal(writes,0);
 await assert.rejects(()=>syncPilotMessages(store,{readMessages:async()=>({threads:[],messages:[],selectedThread:null})},'front'),/Concurrent/);
 assert.equal(writes,1);
});
test('successful complete read saves normalized history once',async()=>{
 let saved=emptyMessageArchive();
 const result=await syncPilotMessages({read:async()=>({version:0,archive:saved}),save:async(unit,v,a)=>{assert.equal(unit,'front');assert.equal(v,0);saved=a;return true;}},{readMessages:async(_unit,id)=>({threads:[c.thread],messages:id?c.messages:[],selectedThread:id??null})},'front');
 assert.deepEqual(result,{threads:1,messages:1});assert.equal(saved.conversations[0].messages[0].text,'First');
});
