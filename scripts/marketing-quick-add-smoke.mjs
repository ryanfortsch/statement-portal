/** Marketing memory and quick-add forms; synthetic I/O only. */
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
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-marketing-quick-add-'));
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;


for(const [name,path] of [
 ['marketing','src/app/guests/marketing/MarketingMemoryEditor.tsx'],['contact','src/app/guests/contacts/AddGuestContactForm.tsx'],['prospect','src/app/properties/prospects/AddProspectForm.tsx'],
 ['guard','src/lib/use-draft-navigation-guard.ts'],['recover','src/lib/use-recoverable-action.ts'],['unsaved','src/lib/unsaved-work.ts'],
])await writeFile(join(scratch,name+'.js'),compile(await readFile(join(root,path),'utf8')));
await writeFile(join(scratch,'actions.js'),`
const save=(kind,data)=>new Promise((resolve,reject)=>window.calls.push({kind,args:Object.fromEntries(data),resolve,reject}));
export const saveMarketing=data=>save('marketing',data),manuallyAddContact=data=>save('contact',data),createProspectProperty=data=>save('prospect',data);
`);
await writeFile(join(scratch,'router.js'),`export {unstable_rethrow} from 'next/dist/client/components/unstable-rethrow.browser';`);
await writeFile(join(scratch,'entry.js'),compile(`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {MarketingMemoryEditor} from './marketing';import {AddGuestContactForm} from './contact';import {AddProspectForm} from './prospect';import {hasUnsavedWork} from './unsaved';
window.calls=[];window.navs=0;window.confirmAnswer=false;window.confirms=[];window.guarded=hasUnsavedWork;window.confirm=message=>{window.confirms.push(message);return window.confirmAnswer;};
function Fixture(){const [version,setVersion]=useState(0);window.revalidate=()=>setVersion(v=>v+1);const mode=new URLSearchParams(location.search).get('mode');return <><a href="/away" onClick={e=>{e.preventDefault();window.navs++;}}>Leave page</a><section id={mode}>
{mode==='marketing'&&<MarketingMemoryEditor homes={[{id:'one',name:'Synthetic One'},{id:'two',name:'Synthetic Two'}]} rows={[{property_id:'one',tagline:version?'Server refreshed':'Initial tagline',primary_selling_point:null,selling_points:['Dock'],on_water:true,bedrooms:0,sleeps:6,best_for:null,notes:null}]}/>}
{mode==='contact'&&<AddGuestContactForm/>}{mode==='prospect'&&<AddProspectForm/>}</section></>;}createRoot(document.getElementById('root')).render(<Fixture/>);
`));
const alias={'../actions':'actions','./actions':'actions','@/lib/use-draft-navigation-guard':'guard','@/lib/use-recoverable-action':'recover','./unsaved-work':'unsaved','next/navigation':'router'};
await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},resolve:{modules:[join(root,'node_modules')],alias:Object.fromEntries(Object.entries(alias).map(([k,v])=>[k,join(scratch,v+'.js')]))},performance:{hints:false}});compiler.run((err,stats)=>compiler.close(()=>err||stats?.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));});
if(process.argv.includes('--compile-only')){console.log('Marketing/quick-add fixture compiled.');await rm(scratch,{recursive:true,force:true});process.exit(0);}
const server=createServer(async(req,res)=>{if(req.method!=='GET'){res.writeHead(405).end();return;}res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' https://synthetic.test data:");if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(await readFile(join(scratch,'bundle.js')));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>Synthetic campaign and delete recovery</title><style>body{font:14px system-ui;--ink:#222;--paper:#fff;--rule:#ccc}section{margin:20px}button{margin:4px}input,textarea,select{margin:4px}</style><div id="root"></div><script src="/bundle.js"></script>');}});
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





const openAll=()=>page.$$eval('details',ds=>ds.forEach(d=>d.open=true));
const form=n=>'#marketing details:nth-child('+n+')';
const field=(n,name)=>form(n)+' [name="'+name+'"]';
await reset('marketing');await openAll();assert.equal(await guard(),false);assert.equal(await value(field(1,'bedrooms')),'0');assert.equal(await value(field(2,'tagline')),'');pass('saved zero and truly empty home initialize correctly');
await edit(field(1,'tagline'),'First draft');await edit(field(1,'selling_points'),'Dock\nBeach');await edit(field(1,'sleeps'),'8');await page.click(field(1,'on_water'));await edit(field(2,'notes'),'Neighbor draft');assert.equal(await guard(),true);await leave();assert.equal(await nav(),0);assert.equal(await page.evaluate(()=>window.confirms.length),1);pass('multiple dirty homes share one leave prompt');
await click(form(1),'Save',true);await waitCalls(1);assert.deepEqual((await calls())[0].args,{property_id:'one',tagline:'First draft',primary_selling_point:'',selling_points:'Dock\nBeach',sleeps:'8',bedrooms:'0',best_for:'',notes:''});assert.equal(await page.$$eval('#marketing input:not([type="hidden"]),#marketing textarea,#marketing button',es=>es.every(e=>e.disabled)),true);await submit(form(2),true);assert.equal((await calls()).length,1);pass('marketing captures exact checkbox/number/text values and blocks overlapping saves');
await leave();assert.equal(await nav(),0);await finish(0,null,true);await waitText('Could not confirm this save');await ready(field(1,'tagline'));assert.equal(await value(field(1,'tagline')),'First draft');assert.equal(await value(field(1,'selling_points')),'Dock\nBeach');assert.equal(await value(field(1,'sleeps')),'8');assert.equal(await page.$eval(field(1,'on_water'),e=>e.checked),false);assert.equal(await value(field(2,'notes')),'Neighbor draft');pass('failed save retains every field and neighboring draft');
await click(form(1),'Save');await waitCalls(2);await finish(1);await waitText('Saved');await ready(field(1,'tagline'));assert.equal(await guard(),true);assert.equal(await page.$eval(form(1)+' summary',e=>e.textContent.includes('First draft')),true);assert.equal(await page.$$eval(form(1)+' [role="alert"]',es=>es.length),0);pass('successful retry updates saved summary but leaves other home protected');
await page.evaluate(()=>window.revalidate());assert.equal(await value(field(1,'tagline')),'First draft');assert.equal(await value(field(2,'notes')),'Neighbor draft');pass('server revalidation cannot overwrite local drafts');
await click(form(2),'Save');await waitCalls(3);assert.equal((await calls())[2].args.property_id,'two');assert.equal((await calls())[2].args.notes,'Neighbor draft');await finish(2);await clean();assert.equal(await page.$$eval('[role="status"]',es=>es.length),2);pass('each home receives its own saved confirmation and clears only its own draft');
await page.click(field(2,'on_water'));assert.equal(await guard(),true);await page.click(field(2,'on_water'));await clean();await edit(field(2,'bedrooms'),'3');assert.equal(await guard(),true);pass('checkbox-only and numeric-only changes are guarded');

await reset('contact');await openAll();await click('#contact','Add');assert.equal((await calls()).length,0);await edit('[name="email"]','not-an-email');await click('#contact','Add');assert.equal((await calls()).length,0);pass('contact browser validation still blocks empty and malformed emails');
await edit('[name="email"]','person@example.test');await edit('[name="first_name"]','Synthetic');await edit('[name="last_name"]','Guest');await edit('[name="tags"]','test, local');await leave();assert.equal(await nav(),0);pass('contact text is protected before submission');
await click('#contact','Add',true);await waitCalls(1);assert.deepEqual((await calls())[0],{kind:'contact',args:{email:'person@example.test',first_name:'Synthetic',last_name:'Guest',tags:'test, local'}});assert.equal(await page.$$eval('#contact input,#contact button',es=>es.every(e=>e.disabled)),true);pass('contact submission is serialized with exact original inputs');
await finish(0,null,true);await waitText('Could not confirm the contact');await ready('[name="email"]');assert.equal(await value('[name="email"]'),'person@example.test');assert.equal(await value('[name="tags"]'),'test, local');assert.equal(await guard(),true);pass('contact failure retains details and provides explicit check-before-retry');
await click('#contact','Add');await waitCalls(2);await finish(1);await waitText('Contact added');await clean();assert.equal(await value('[name="email"]'),'');assert.equal(await value('[name="tags"]'),'');assert.equal(await page.$$eval('[role="alert"]',es=>es.length),0);pass('confirmed contact addition clears inputs and displays success');
await edit('[name="first_name"]','Another');assert.equal(await page.$$eval('[role="status"]',es=>es.length),0);assert.equal(await guard(),true);pass('a new contact draft clears the prior saved status');

await reset('prospect');await openAll();await click('#prospect','Add prospect');assert.equal((await calls()).length,0);await edit('[name="name"]','Synthetic Home');await edit('[name="address"]','123 Test Road');await edit('[name="city"]','Rockport');await leave();assert.equal(await nav(),0);pass('prospect required fields and unsaved navigation protection work');
await click('#prospect','Add prospect',true);await waitCalls(1);assert.deepEqual((await calls())[0],{kind:'prospect',args:{name:'Synthetic Home',address:'123 Test Road',city:'Rockport'}});assert.equal(await page.$$eval('#prospect input,#prospect button',es=>es.every(e=>e.disabled)),true);await finish(0,{error:'Please correct this address.'});await waitText('Please correct this address.');await ready('[name="address"]');assert.equal(await value('[name="address"]'),'123 Test Road');assert.equal(await value('[name="city"]'),'Rockport');pass('prospect returned errors remain inline without losing details');
await click('#prospect','Add prospect');await waitCalls(2);await finish(1,null,true);await waitText('Could not confirm creation');await ready('[name="name"]');assert.equal(await value('[name="name"]'),'Synthetic Home');assert.equal(await guard(),true);pass('prospect transport failures preserve draft and warn to check before retry');
await edit('[name="address"]','456 Corrected Road');await edit('[name="city"]','');await click('#prospect','Add prospect');await waitCalls(3);assert.equal((await calls())[2].args.address,'456 Corrected Road');assert.equal((await calls())[2].args.city,'');await finish(2,{error:'Synthetic rejection'});await ready('[name="address"]');pass('prospect retry uses corrected inputs and preserves optional town behavior');
assert.deepEqual(errors,[]);console.log('Marketing/quick-add recovery: '+checks+' checks passed.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(scratch,{recursive:true,force:true});}
