// Only the disposable database initialized by pricing-shared-settings.sql.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
const args=['-X','-q','-At','-v','ON_ERROR_STOP=1'];
const sql=query=>spawnSync('psql',[...args,'-c',query],{encoding:'utf8'});
assert.equal(sql('select current_database()').stdout.trim(),'helm_synthetic_pricing_settings');
const settings='{"version":1,"homes":{},"groups":[]}';
const save=id=>`select helm_save_pricing_drafts('${settings}'::jsonb,2,'00000000-0000-4000-8000-00000000000${id}','owner@synthetic.test');`;
const first=spawn('psql',args,{stdio:['pipe','pipe','pipe']});let out='',err='';first.stderr.on('data',data=>{err+=data;});
const finished=new Promise((resolve,reject)=>{first.once('error',reject);first.once('close',resolve);});
const locked=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Lock not acquired')),5000);first.stdout.on('data',data=>{out+=data;if(out.includes('LOCKED')){clearTimeout(timer);resolve();}});});
first.stdin.end(`begin; ${save(3)}\n\\echo LOCKED\nselect pg_sleep(1);commit;`);
await locked;
const second=sql(save(4));assert.equal(await finished,0,err);assert.notEqual(second.status,0);assert.match(second.stderr,/Pricing settings changed/);
assert.equal(sql('select revision from helm_pricing_drafts;select count(*) from helm_pricing_draft_versions;').stdout.trim(),'3\n3');
assert.equal(sql(save(3)).status,0,'exact retry succeeds');
assert.equal(sql('select count(*) from helm_pricing_draft_versions;').stdout.trim(),'3','retry creates no duplicate version');
console.log('Concurrent pricing saves preserve the winner; retries create one receipt.');
