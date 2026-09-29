/** Real owner draft controls and shoot reply form; synthetic I/O only. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
const require=createRequire(import.meta.url),{webpack}=require('next/dist/compiled/webpack/webpack');
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-owner-shoot-'));
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
for(const [name,path,extra=''] of [
 ['queue','src/app/work/QueueClient.tsx','\nexport {PropertyGroup};'],
 ['contact','src/app/crm/[id]/ContactDraftEmailButton.tsx'],['property','src/app/properties/[id]/PropertyDraftOwnerEmailButton.tsx'],
 ['answer','src/app/field/shoot/[shootId]/AnswerPanel.tsx'],['owner-draft','src/lib/use-owner-email-draft.ts'],['guard','src/lib/use-draft-navigation-guard.ts'],['recover','src/lib/use-recoverable-action.ts'],
 ['picker','src/components/TeamPicker.tsx'],['unsaved','src/lib/unsaved-work.ts'],['work-types','src/lib/work-types.ts'],['supplies','src/lib/inspection-supplies.ts'],
])await writeFile(join(scratch,name+'.js'),compile(await readFile(join(root,path),'utf8')+extra));
await writeFile(join(scratch,'actions.js'),`
export const save=(kind,args)=>new Promise((resolve,reject)=>window.calls.push({kind,args,resolve,reject}));
export const acceptShoot=data=>save('accept',Object.fromEntries(data));export const declineShoot=data=>save('decline',Object.fromEntries(data));
export const bulkUpdateWorkSlips=()=>{},bulkUpdateTasks=()=>{},updateWorkSlipStatus=()=>{},updateTaskStatus=()=>{},createWorkSlip=()=>{},createTask=()=>{};
`);
await writeFile(join(scratch,'router.js'),`export {unstable_rethrow} from 'next/dist/client/components/unstable-rethrow.browser';export const useRouter=()=>({}),usePathname=()=>'/work',useSearchParams=()=>new URLSearchParams();`);
await writeFile(join(scratch,'refresh.js'),'export const useSoftRefresh=()=>()=>{};');
await writeFile(join(scratch,'link.js'),compile(`import React from 'react';export default function Link({href,children,prefetch,...props}){return <a {...props} href={href}>{children}</a>}`));
await writeFile(join(scratch,'empty.js'),'export const PhotoUploader=()=>null;');
await writeFile(join(scratch,'team.js'),`export const TEAM_MEMBERS=[];export const getTeamMember=()=>null,displayNameForEmail=e=>e,initialsForEmail=e=>e?.slice(0,2)||'+';`);
await writeFile(join(scratch,'entry.js'),compile(`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {PropertyGroup} from './queue';import {ContactDraftEmailButton} from './contact';import {PropertyDraftOwnerEmailButton} from './property';import {AnswerPanel} from './answer';import {hasUnsavedWork} from './unsaved';import {save} from './actions';
window.calls=[];window.navs=0;window.opened=[];window.confirmAnswer=false;window.confirms=0;window.guarded=hasUnsavedWork;window.confirm=()=>{window.confirms++;return window.confirmAnswer;};window.open=url=>{window.opened.push(url);return null;};
window.fetch=async(url,opts)=>{const data=await save('draft',{url,...JSON.parse(opts.body)});return {ok:data.ok,status:data.ok?200:500,json:async()=>{if(data.malformed)throw Error('Invalid JSON');return data;}};};
function Fixture(){const [id,setId]=useState('synthetic-home');window.changeId=()=>setId('different-home');const mode=new URLSearchParams(location.search).get('mode');const property={id,name:'Synthetic Home',city:'Gloucester',title:null,is_active:true};return <><a href="/away" onClick={e=>{e.preventDefault();window.navs++;}}>Leave page</a><section id={mode}>
{mode==='contact'&&<ContactDraftEmailButton contactId={id}/>}{mode==='property'&&<PropertyDraftOwnerEmailButton propertyId={id}/>}
{mode==='queue'&&<PropertyGroup propId={id} property={property} slips={[{id:'slip',title:'Synthetic slip',owner_action_required:true,category:'maintenance',priority:'normal',status:'open',property_id:id}]} myEmail="me@example.test" expanded={false} onToggleExpanded={()=>{}} selectedIds={new Set()} onToggleSelect={()=>{}} commentCounts={{}} reporterNames={{}} onAddSlip={()=>{}}/>}
{mode==='answer'&&<AnswerPanel shootId="synthetic-shoot" when="Tomorrow" what="Synthetic Home"/>}</section></>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
`));
const alias={'./actions':'actions','@/app/field/actions':'actions','@/lib/use-owner-email-draft':'owner-draft','./use-draft-navigation-guard':'guard','@/lib/use-draft-navigation-guard':'guard','@/lib/use-recoverable-action':'recover','@/lib/unsaved-work':'unsaved','./unsaved-work':'unsaved','@/lib/use-soft-refresh':'refresh','@/lib/team':'team','@/components/TeamPicker':'picker','@/components/PhotoUploader':'empty','@/lib/work-types':'work-types','@/lib/inspection-supplies':'supplies','next/navigation':'router','next/link':'link'};
await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},resolve:{modules:[join(root,'node_modules')],alias:Object.fromEntries(Object.entries(alias).map(([k,v])=>[k,join(scratch,v+'.js')]))},performance:{hints:false}});compiler.run((err,stats)=>compiler.close(()=>err||stats?.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));});
if(process.argv.includes('--compile-only')){console.log('Owner draft and shoot reply fixture compiled.');await rm(scratch,{recursive:true,force:true});process.exit(0);}
const server=createServer(async(req,res)=>{if(req.method!=='GET'){res.writeHead(405).end();return;}res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' https://synthetic.test data:");if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(await readFile(join(scratch,'bundle.js')));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>Synthetic photos and invitations</title><style>body{font:14px system-ui;--ink:#222;--paper:#fff;--rule:#ccc}section{margin:20px}button{margin:4px}input,textarea,select{margin:4px}</style><div id="root"></div><script src="/bundle.js"></script>');}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;let browser,page,checks=0;
try{
browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':await chromium.executablePath()),headless:true,args:process.platform==='darwin'?['--no-sandbox']:chromium.args});
page=await browser.newPage();page.setDefaultTimeout(10000);await page.setViewport({width:1250,height:1100});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin+'/')?r.continue():r.abort());
const reset=async(mode,extra='')=>{await page.goto(origin+'/?mode='+mode+extra);await page.waitForSelector('#'+mode);};
const click=(scope,label,twice=false)=>page.$$eval(scope+' button',(bs,label,twice)=>{const b=bs.filter(b=>b.checkVisibility()).find(b=>b.textContent.trim()===label||b.getAttribute('aria-label')===label);if(!b)throw Error('Missing button '+label);b.click();if(twice)b.click();},label,twice);
const edit=(selector,value)=>page.$eval(selector,(e,value)=>{const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));},value);
const calls=()=>page.evaluate(()=>window.calls.map(({kind,args})=>({kind,args}))),waitCalls=n=>page.waitForFunction(n=>window.calls.length===n,{},n);
const finish=(i,result={ok:true},reject=false)=>page.evaluate((i,result,reject)=>reject?window.calls[i].reject(Error('Synthetic lost response')):window.calls[i].resolve(result),i,result,reject);
const value=s=>page.$eval(s,e=>e.value),ready=s=>page.waitForFunction(s=>document.querySelector(s)&&!document.querySelector(s).matches(':disabled'),{},s);
const text=()=>page.$eval('body',e=>e.innerText),waitText=t=>page.waitForFunction(t=>document.body.textContent.includes(t),{},t);
const guard=()=>page.evaluate(()=>window.guarded()),clean=()=>page.waitForFunction(()=>!window.guarded());
const blur=s=>page.$eval(s,e=>e.dispatchEvent(new FocusEvent('focusout',{bubbles:true})));
const pass=m=>{checks++;console.log('PASS '+m);};
const submit=(scope,twice=false)=>page.$eval(scope+' form',(form,twice)=>{form.requestSubmit();if(twice)form.requestSubmit();},twice);

const nav=()=>page.evaluate(()=>window.navs);
const leave=()=>page.$$eval('a',links=>links.find(a=>a.textContent==='Leave page').click());



for(const mode of ['contact','property','queue']){
 await reset(mode);const label=mode==='contact'?'Draft Email':'Draft Owner Email';
 await click('#'+mode,label,true);await waitCalls(1);assert.equal(await guard(),true);await leave();assert.equal(await nav(),0);assert.equal((await calls())[0].args.url,mode==='contact'?'/api/crm/draft-contact-email':'/api/work/draft-owner-email');assert.equal((await calls())[0].args[mode==='contact'?'contact_id':'property_id'],'synthetic-home');pass(mode+': repeated draft clicks serialize and pending navigation is guarded');
 await finish(0,null,true);await waitText('Check Gmail before retrying');await clean();assert.equal(await page.evaluate(()=>window.opened.length),0);pass(mode+': lost response releases pending state and explains uncertainty');
 for(const response of [{ok:false,error:'Unavailable'},{ok:true},{ok:true,malformed:true},{ok:true,draft_url:'   '}]){await click('#'+mode,label);await waitCalls((await calls()).length);const i=(await calls()).length-1;await finish(i,response);await waitText('Check Gmail before retrying');await clean();assert.equal(await page.$$eval('a[href*="mail.google.com"]',a=>a.length),0);}pass(mode+': errors, missing URLs and malformed responses never show confirmed success');
 const n=(await calls()).length;await click('#'+mode,label);await waitCalls(n+1);await finish(n,{ok:true,draft_url:'https://mail.google.com/mail/u/0/#drafts/synthetic'});await waitText('Open saved Gmail draft');await clean();assert.equal(await page.$eval('a[href*="mail.google.com"]',a=>a.href),'https://mail.google.com/mail/u/0/#drafts/synthetic');await click('#'+mode,'Open Gmail draft',true);assert.equal((await calls()).length,n+1);pass(mode+': blocked popup leaves a usable link and reopening never creates another draft');
 await page.evaluate(()=>window.changeId());await waitText(label);assert.equal(await page.$$eval('a[href*="mail.google.com"]',a=>a.length),0);pass(mode+': confirmed link cannot leak onto another property or contact');
}
await reset('answer');await click('#answer',"Yes, I'll take it",true);await waitCalls(1);await click('#answer',"Can't make it");assert.equal(await page.$$eval('input[name="reason"]',a=>a.length),0);await leave();assert.equal(await nav(),0);assert.equal(await guard(),true);assert.deepEqual((await calls())[0],{kind:'accept',args:{shoot_id:'synthetic-shoot'}});pass('shoot acceptance locks alternate reply and guards pending navigation');
await finish(0,{error:'Acceptance unavailable'});await waitText('Acceptance unavailable');await clean();await click('#answer',"Yes, I'll take it");await waitCalls(2);await finish(1,null,true);await waitText('Could not confirm your reply');await clean();pass('acceptance returned and transport errors remain visible and retryable');
await click('#answer',"Can't make it");await edit('input[name="reason"]','Away that week');await leave();assert.equal(await nav(),0);await click('#answer','Back');assert.equal(await value('input[name="reason"]'),'Away that week');assert.equal(await guard(),true);pass('typed decline reason survives refused navigation and discard');
await click('#answer','Send my pass',true);await waitCalls(3);await click('#answer','Back');assert.equal(await page.$eval('input[name="reason"]',e=>e.disabled),true);assert.deepEqual((await calls())[2],{kind:'decline',args:{shoot_id:'synthetic-shoot',reason:'Away that week'}});pass('decline submission captures the reason once and prevents Back while pending');
await finish(2,{error:'Pass unavailable'});await waitText('Pass unavailable');assert.equal(await value('input[name="reason"]'),'Away that week');await click('#answer','Send my pass');await waitCalls(4);await finish(3,null,true);await waitText('Could not confirm your reply');assert.equal(await value('input[name="reason"]'),'Away that week');assert.equal(await guard(),true);pass('decline returned and transport errors preserve the draft');
await page.evaluate(()=>window.confirmAnswer=true);await click('#answer','Back');await clean();await click('#answer',"Can't make it");assert.equal(await value('input[name="reason"]'),'');await click('#answer','Send my pass');await waitCalls(5);assert.equal((await calls())[4].args.reason,'');await finish(4,{error:'Synthetic completion'});await waitText('Synthetic completion');pass('confirmed discard clears the reason and an empty optional reason can still be submitted');
assert.deepEqual(errors,[]);console.log('PASS '+checks+' owner draft and shoot reply browser checks; synthetic data only.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(scratch,{recursive:true,force:true});}
