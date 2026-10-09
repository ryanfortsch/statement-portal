import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const syncUrl=new URL('../channex-staging/message-sync.ts',import.meta.url).href;
// These processes receive no credentials and share only a synthetic temporary archive.
const child=`
import {readFileSync,writeFileSync,openSync,fsyncSync,closeSync,renameSync} from 'node:fs';
import {syncPilotMessages} from ${JSON.stringify(syncUrl)};
const [path,phase]=process.argv.slice(1);
const read=()=>JSON.parse(readFileSync(path,'utf8'));
const store={read:async()=>read(),save:async(unit,version,archive)=>{
 if(read().version!==version)return false;
 const fd=openSync(path+'.next','w',0o600);
 writeFileSync(fd,JSON.stringify({version:version+1,archive}));fsyncSync(fd);closeSync(fd);renameSync(path+'.next',path);
 if(phase==='interrupt')process.exit(73);
 return true;
}};
const edited=phase==='edit';
const thread={id:'synthetic-thread',unit:'front',title:'Synthetic guest',provider:'Synthetic',bookingId:null,closed:false,messageCount:2};
const messages=[
 {id:'guest-1',text:edited?'Arrival changed to 5 PM':'Arriving at 4 PM',sender:'guest',receivedAt:'2026-10-02T12:00:00Z',updatedAt:edited?'2026-10-02T13:00:00Z':'2026-10-02T12:00:00Z',attachmentCount:0},
 {id:'property-1',text:'Thank you for the update.',sender:'property',receivedAt:'2026-10-02T12:01:00Z',updatedAt:'2026-10-02T12:01:00Z',attachmentCount:0}
];
const client={readMessages:async(unit,id)=>({threads:[thread],messages:id?messages:[],selectedThread:id??null})};
await syncPilotMessages(store,client,'front');
`;
test('saved message history survives process exit, duplicate scans, edits and stale replay',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'helm-message-recovery-'));
 try{
  const path=join(directory,'archive.json');
  await writeFile(path,JSON.stringify({version:0,archive:{version:1,conversations:[]}}),{mode:0o600});
  const run=(phase:string)=>spawnSync(process.execPath,['--input-type=module','--eval',child,path,phase],{encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH,NODE_ENV:'test'}});
  const interrupted=run('interrupt');assert.equal(interrupted.status,73,interrupted.stderr);
  const durable=JSON.parse(await readFile(path,'utf8'));assert.equal(durable.archive.conversations[0].messages.length,2);
  for(const phase of ['duplicate','edit','stale']){const result=run(phase);assert.equal(result.status,0,result.stderr);}
  const saved=JSON.parse(await readFile(path,'utf8'));
  assert.equal(saved.version,4);
  assert.equal(saved.archive.conversations.length,1);
  assert.equal(saved.archive.conversations[0].messages.length,2);
  assert.equal(saved.archive.conversations[0].messages[0].text,'Arrival changed to 5 PM');
  assert.equal(saved.archive.conversations[0].messages[1].text,'Thank you for the update.');
 }finally{await rm(directory,{recursive:true,force:true});}
});
