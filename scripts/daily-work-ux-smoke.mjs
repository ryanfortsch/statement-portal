/** Real property header, coordination controls and matching rows; synthetic data only. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
const require=createRequire(import.meta.url),{webpack}=require('next/dist/compiled/webpack/webpack');
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-daily-work-'));
await writeFile(join(scratch,'loader.cjs'),`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(src){return ts.transpileModule(src,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
await writeFile(join(scratch,'actions.js'),`const rec=kind=>(...args)=>new Promise(resolve=>window.calls.push({kind,args,resolve}));export const updateWorkSlipCoordination=rec('coordinate'),updateWorkSlipAssignment=rec('assign'),attachUnplacedCleanerTextAction=rec('attach'),setAsideUnplacedCleanerTextAction=rec('aside'),parseProposedUpdate=rec('parse-fact'),applyProposedUpdate=rec('apply-fact'),dismissProposedUpdate=rec('dismiss-fact'),fileTriagedGroup=rec('file-group'),fileTriagedGroups=rec('file-groups'),dismissTriagedGroup=rec('dismiss-group');`);
await writeFile(join(scratch,'refresh.js'),'export const useSoftRefresh=()=>()=>window.refreshes++;');
await writeFile(join(scratch,'skew.js'),'export const reloadedForNewDeployment=()=>Promise.resolve(false);');
await writeFile(join(scratch,'link.js'),`import React from 'react';export default function Link({children,href,...props}){return React.createElement('a',{...props,href},children);}`);
await writeFile(join(scratch,'entry.tsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import {PropertyMasthead} from '@/app/properties/[id]/PropertyMasthead';
import {SlipAssignEditor} from '@/app/work/[id]/SlipAssignEditor';
import {SlipFollowUpEditor} from '@/app/work/[id]/SlipFollowUpEditor';
import {UnplacedCleanerTextRow} from '@/components/UnplacedCleanerTextRow';
import {ProposedPropertyUpdatesCard} from '@/app/owner-messaging/ProposedPropertyUpdatesCard';
import {TriagedPropertyUpdates} from '@/app/messaging/TriagedPropertyUpdates';
import {ConfirmProvider} from '@/components/ConfirmDialog';
window.calls=[];window.refreshes=0;
const fact={id:'fact-a',property_id:'home-a',property_name:'4 Beach',owner_name:'Synthetic Owner',category:'parking',fact_text:'Two parking spaces',raw_quote:'You can park two cars behind the house.',confidence:'high',status:'pending',source:'cleaner',created_at:new Date().toISOString()};
const choices={likely:[{id:'home-a',name:'4 Beach'}],rest:[{id:'home-b',name:'21 Harbor'}]};
createRoot(document.getElementById('root')).render(<ConfirmProvider><main>
<h1>4 Beach</h1>
<PropertyMasthead propertyId="home-a" isActive={true} todayIso="2026-10-30" bookings={[]} lockCodes={[]} cleaners={[]} wifiName="Synthetic Guest WiFi" wifiPassword="synthetic-only" keyCodeLocation="Blue box by side entrance" gateCode={null} garageCode={null} parking="Two spaces behind the house" trashDay={{kind:'day',day:'Monday',source:'row'}} ownerName="Alex Example" ownerPhone="9785550100" ownerEmail="alex@example.test" ownerPreferredContact="email" openSlipCount={3} lastInspectionAt="2026-10-29T12:00:00Z" seasonNote="Year-round" alerts={[{key:'notice',tone:'signal',text:'Synthetic property notice',href:'#notice'}]} />
<section id="coord"><h2>Coordinator</h2><SlipAssignEditor slipId="slip-a" initialAssignedToEmail={null} myEmail="ryan@risingtidestr.com" coordinator /></section>
<section id="follow"><h2>Next follow-up</h2><SlipFollowUpEditor slipId="slip-a" initialDate={null} /></section>
<section id="match"><h2>Place a cleaner text</h2><UnplacedCleanerTextRow id="message-a" when="Today" cleanerName="Synthetic Cleaner" line="4 Beach is done" body="4 Beach is done" choices={choices} /></section>
<section id="ambiguous"><UnplacedCleanerTextRow id="message-b" when="Today" cleanerName="Synthetic Cleaner" line="Both homes done" body="4 Beach and 21 Harbor are done" choices={choices} /></section>
<section id="facts"><ProposedPropertyUpdatesCard initial={[fact]} initialError={null} properties={choices.likely} source="cleaner" /></section>
<section id="uncertain"><TriagedPropertyUpdates initial={[{...fact,id:'fact-b',triage:{group_id:'g',property_id:'home-a',statement:'Two parking spaces',evidence:'One space',confidence:'medium',needs_ruling:false,verdict:'add',kb_section:'Parking',reason:'Review the difference'}}]} initialError={null} properties={choices.likely} /></section>
</main></ConfirmProvider>);
`);
const alias={'./proposed-updates-actions':join(scratch,'actions.js'),'../owner-messaging/proposed-updates-actions':join(scratch,'actions.js'),'@/lib/version-skew':join(scratch,'skew.js'),'../actions':join(scratch,'actions.js'),'@/app/turnovers/unplaced-cleaner-actions':join(scratch,'actions.js'),'@/lib/use-soft-refresh':join(scratch,'refresh.js'),'next/link':join(scratch,'link.js'),'@':join(root,'src')};
await new Promise((resolve,reject)=>{const c=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.tsx'),output:{path:scratch,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js'],modules:[join(root,'node_modules')],alias},module:{rules:[{test:/\.tsx?$/,use:join(scratch,'loader.cjs')}]},performance:{hints:false}});c.run((err,stats)=>c.close(()=>err||stats.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));});
if(process.argv.includes('--compile-only')){console.log('Daily work UX fixture compiled.');await rm(scratch,{recursive:true,force:true});process.exit(0);}
const css=`*{box-sizing:border-box}body{margin:0;background:#f7f4eb;font:14px Arial;color:#203b43;--paper:#f7f4eb;--paper-2:#eee9db;--ink:#203b43;--ink-2:#344f57;--ink-3:#586b6f;--ink-4:#738386;--rule:#d1d0c5;--signal:#9b5136;--negative:#a04040;--tide-deep:#305e63}main{max-width:1050px;margin:24px auto;padding:0 24px}h1,h2{font-family:Georgia;font-weight:400}section{margin-bottom:22px}.eyebrow{font-size:11px;letter-spacing:.12em;text-transform:uppercase}button{cursor:pointer}summary{min-height:44px}`+(await readFile('src/app/globals.css','utf8'));
const server=createServer(async(req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(join(scratch,'bundle.js')));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><div id="root"></div><script src="/bundle.js"></script>');}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;let browser;
try {
 browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':await chromium.executablePath()),headless:true,args:process.platform==='darwin'?['--no-sandbox']:chromium.args});
 const page=await browser.newPage();await page.setViewport({width:1280,height:1000});page.setDefaultTimeout(10000);
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin+'/')?r.continue():r.abort());
 await page.goto(origin);await page.waitForSelector('#coord');
 const click=(scope,label)=>page.$$eval(scope+' button',(bs,label)=>{const b=bs.find(b=>b.textContent.trim()===label||b.textContent.includes(label));if(!b)throw Error('Missing '+label);b.click();},label);
 const finish=(i,result)=>page.evaluate((i,result)=>window.calls[i].resolve(result),i,result);
 const waitCalls=n=>page.waitForFunction(n=>window.calls.length===n,{},n);
 const calls=()=>page.evaluate(()=>window.calls.map(c=>({kind:c.kind,args:c.args})));
 const edit=(selector,value)=>page.$eval(selector,(e,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));},value);
 assert.equal(await page.$eval('.rt-band-rail',e=>e.checkVisibility()),false);
 assert.ok((await page.$eval('body',e=>e.textContent)).includes('Synthetic property notice'));
 await page.click('details summary');assert.equal(await page.$eval('.rt-band-rail',e=>e.checkVisibility()),true);
 console.log('PASS visit details open in one step; notices remain visible');
 await click('#coord','Choose coordinator');assert.ok(!(await page.$eval('#coord',e=>e.textContent)).includes('Custom email'));
 await click('#coord','Assign to me');await waitCalls(1);assert.deepEqual((await calls())[0],{kind:'coordinate',args:[{id:'slip-a',coordinator_email:'ryan@risingtidestr.com'}]});
 await finish(0,{ok:false,error:'Synthetic save failed'});await page.waitForFunction(()=>document.body.textContent.includes('Retry assignment'));
 assert.ok((await page.$eval('#coord',e=>e.textContent)).includes('Choose coordinator'));
 await click('#coord','Retry assignment');await waitCalls(2);await finish(1,{ok:true});await page.waitForFunction(()=>!document.querySelector('#coord').textContent.includes('Retry assignment'));
 console.log('PASS coordinator save never changes worker; failure retains last confirmed selection and retries');
 await edit('#follow input','2026-11-02');await click('#follow','Save follow-up');await waitCalls(3);
 assert.deepEqual((await calls())[2],{kind:'coordinate',args:[{id:'slip-a',follow_up_date:'2026-11-02'}]});await finish(2,{ok:true});
 await page.waitForFunction(()=>!document.querySelector('#follow').textContent.includes('Save follow-up'));
 await edit('#follow input','');await click('#follow','Save follow-up');await waitCalls(4);assert.equal((await calls())[3].args[0].follow_up_date,null);await finish(3,{ok:true});
 console.log('PASS follow-up date saves and clears independently of the visit date');
 assert.equal(await page.$eval('#match select',e=>e.value),'home-a');assert.equal(await page.$eval('#ambiguous select',e=>e.value),'');
 assert.match(await page.$eval('#match',e=>e.textContent),/text names this house/);
 assert.equal((await calls()).filter(c=>c.kind==='attach').length,0);
 await click('#match','Confirm house');await page.waitForSelector('[role="alertdialog"]');await click('[role="alertdialog"]','Attach');await waitCalls(5);
 assert.deepEqual((await calls())[4],{kind:'attach',args:['message-a','home-a']});await finish(4,{ok:true});
 console.log('PASS one named house is suggested; multiple homes stay unselected; attachment requires confirmation');
 assert.ok(!(await page.$eval('#facts',e=>e.innerText)).includes('Review & file'));
 await page.click('#facts details summary');await click('#facts','Review & file');await waitCalls(6);
 assert.equal((await calls())[5].kind,'parse-fact');
 await finish(5,{ok:true,items:[{target:'column',column:'parking',value:'Two parking spaces'}],currentValues:{parking:'One space'},unrouted:null});
 await page.waitForFunction(()=>document.querySelector('#facts').textContent.includes('Current:'));
 const review=await page.$eval('#facts',e=>e.textContent);
 assert.match(review,/Current: One space/);assert.match(review,/Proposed/);assert.match(review,/You can park two cars/);
 assert.equal((await calls()).filter(c=>c.kind==='apply-fact').length,0);
 await click('#facts','Apply 1 change');await waitCalls(7);assert.equal((await calls())[6].kind,'apply-fact');
 await finish(6,{ok:true,columns:1,notes:0,skipped:[]});
 const uncertain=await page.$eval('#uncertain',e=>e.textContent);assert.match(uncertain,/1 to decide/);assert.match(uncertain,/Source:/);
 assert.equal(await page.$('#uncertain input[type="checkbox"]'),null);
 console.log('PASS facts group by home, show current/proposed/source before apply, and keep uncertain changes out of bulk filing');
 await page.setViewport({width:390,height:844});await new Promise(r=>setTimeout(r,100));
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 if(process.env.UX_SCREENSHOT) await page.screenshot({path:process.env.UX_SCREENSHOT,fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS phone layout has no horizontal overflow or browser errors');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(scratch,{recursive:true,force:true});}
