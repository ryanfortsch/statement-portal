/** Bedroom photos, onboarding invitations and feed recovery; synthetic records and controlled I/O only. */
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
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-photos-feed-'));
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;

for(const [name,path] of [
 ['bedrooms','src/app/properties/bedroom-photos/BedroomPhotosClient.tsx'],['owner','src/app/properties/[id]/PropertyOnboardingLink.tsx'],['feed','src/components/FeedClearButton.tsx'],['photos','src/components/PhotoUploader.tsx'],['invite','src/lib/onboarding-invite-email.ts'],
 ['recover','src/lib/use-recoverable-action.ts'],['unsaved','src/lib/unsaved-work.ts'],['guard','src/lib/use-draft-navigation-guard.ts'],
])await writeFile(join(scratch,name+'.js'),compile(await readFile(join(root,path),'utf8')));
await writeFile(join(scratch,'actions.js'),`
export const save=(kind,args)=>new Promise((resolve,reject)=>window.calls.push({kind,args,resolve,reject}));
export const publishBedroomPhotos=(id,name,arrangements)=>save('publish',{id,name,arrangements});
export const ensurePropertyOnboardingToken=id=>save('token',{id});
export const dismissFeedItem=(type,id)=>save('clear',{type,id});
`);
await writeFile(join(scratch,'router.js'),`export {unstable_rethrow} from 'next/dist/client/components/unstable-rethrow.browser';`);
await writeFile(join(scratch,'compress.js'),`export const compressImage=async file=>file;`);
await writeFile(join(scratch,'properties.js'),`export const ALWAYS_CC=['team@example.test'];export const SEND_FROM={name:'Synthetic Team',email:'team@example.test'};`);
await writeFile(join(scratch,'image.js'),compile(`import React from 'react';export default function Image({fill,unoptimized,...props}){return <img {...props}/>;}`));
await writeFile(join(scratch,'entry.js'),compile(`
import React from 'react';import {createRoot} from 'react-dom/client';import {BedroomPhotosClient} from './bedrooms';import {PropertyOnboardingLink} from './owner';import {FeedClearButton} from './feed';import {hasUnsavedWork} from './unsaved';import {save} from './actions';
window.calls=[];window.navs=0;window.guarded=hasUnsavedWork;window.confirmAnswer=false;window.confirms=0;window.confirm=()=>{window.confirms++;return window.confirmAnswer;};
window.fetch=async(url,options)=>{const upload=options.body instanceof FormData;const result=await save(upload?'upload':'draft',upload?{url,file:options.body.get('file').name}:{url,...JSON.parse(options.body)});return {ok:result.ok,status:result.ok?200:500,json:async()=>result};};
const listing=id=>({guestyListingId:id,internalName:id,publicName:'Synthetic home',slug:id,bedrooms:2,arrangements:[{name:'Primary',beds:'King',photo:['https://synthetic.test/original.jpg']},{name:'Guest',beds:'Twin',photo:[]}],legacyPhotoUrls:[]});
const mode=new URLSearchParams(location.search).get('mode');
createRoot(document.getElementById('root')).render(<><a href="/away" onClick={e=>{if(!e.defaultPrevented){e.preventDefault();window.navs++;}}}>Leave page</a><main id={mode}>
{mode==='bedrooms'&&<BedroomPhotosClient listings={[listing('home-a'),listing('home-b')]} initialListingId="home-a"/>}
{mode==='owner'&&<PropertyOnboardingLink propertyId="home-a" initialToken={null} submittedAt={null} ownerEmails={['owner@example.test']} ownerGreeting="Synthetic Owner" propertyName="Synthetic home"/>}
{mode==='feed'&&<FeedClearButton itemType="slip" itemId="slip-a"/>}</main></>);
`));
const alias={'./actions':'actions','@/app/projections/actions':'actions','@/app/feed-actions':'actions','@/lib/properties':'properties','@/lib/onboarding-invite-email':'invite','next/image':'image','@/components/PhotoUploader':'photos','@/lib/image-compress':'compress','@/lib/use-recoverable-action':'recover','@/lib/unsaved-work':'unsaved','./unsaved-work':'unsaved','@/lib/use-draft-navigation-guard':'guard','next/navigation':'router'};
await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},resolve:{modules:[join(root,'node_modules')],alias:Object.fromEntries(Object.entries(alias).map(([k,v])=>[k,join(scratch,v+'.js')]))},performance:{hints:false}});compiler.run((err,stats)=>compiler.close(()=>err||stats?.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));});
if(process.argv.includes('--compile-only')){console.log('Photos, onboarding and feed fixture compiled.');await rm(scratch,{recursive:true,force:true});process.exit(0);}
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



const enabled=label=>page.waitForFunction(label=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===label&&!b.disabled),{},label);
const upload=async(index=0)=>page.$$eval('input[type="file"]:not([capture])',(els,index)=>{const e=els[index],d=new DataTransfer();d.items.add(new File(['synthetic'],'bedroom.jpg',{type:'image/jpeg'}));e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));},index);
await reset('bedrooms');const name='#bedrooms input[placeholder^="Name"]',beds='#bedrooms input[placeholder^="Beds"]',publish='Publish to Stay Cape Ann';
await edit(name,'Edited primary');await edit(beds,'Two twins');await leave();assert.equal(await nav(),0);assert.equal(await guard(),true);pass('bedroom edits guard navigation and deployment refresh');
await click('#bedrooms',publish,true);await waitCalls(1);assert.equal(await page.$eval(name,e=>e.disabled),true);assert.equal(await page.$eval(beds,e=>e.disabled),true);await page.$$eval('#bedrooms aside button',bs=>bs[1].click());await leave();assert.equal(await nav(),0);assert.equal(await value(name),'Edited primary');pass('publication is single-flight and holds the exact room text and property selection');
await finish(0,null,true);await waitText('Could not confirm publishing');assert.equal(await value(name),'Edited primary');assert.equal(await value(beds),'Two twins');await enabled(publish);assert.equal(await guard(),true);await click('#bedrooms',publish);await waitCalls(2);await finish(1,{ok:false,error:'Synthetic registry failure'});await waitText('Synthetic registry failure');assert.equal(await value(name),'Edited primary');pass('transport and returned publication errors retain bedroom details and permit retry');
await click('#bedrooms',publish);await waitCalls(3);const saved=(await calls())[2].args;assert.equal(saved.id,'home-a');assert.equal(saved.arrangements[0].name,'Edited primary');assert.equal(saved.arrangements[0].beds,'Two twins');assert.equal('editorId' in saved.arrangements[0],false);await finish(2,{ok:true,published:true,prUrl:'https://synthetic.test/pr',prNumber:1,liveUrl:'https://synthetic.test/home'});await waitText('Published');await clean();pass('confirmed publication acknowledges only the submitted content and excludes editor-only identities');
await upload(1);await waitCalls(4);assert.equal((await calls())[3].args.url,'/api/upload');await leave();assert.equal(await nav(),0);await finish(3,{ok:false,error:'Photo upload unavailable'});await waitText('Retry or remove failed uploads');assert.equal(await guard(),true);assert.equal(await page.$$eval('button',bs=>bs.find(b=>b.textContent.trim()==='Publish to Stay Cape Ann').disabled),true);pass('failed bedroom files block publication and remain protected as unsaved work');
// Removing an earlier bedroom must not throw away a later room's failed upload.
await click('#bedrooms','Remove');await waitText('Bedroom 1');assert.equal(await value(name),'Guest');assert.equal((await text()).includes('Photo upload unavailable'),true);assert.equal(await page.$$eval('input[type="file"]:not([capture])',els=>els.length),1);pass('stable bedroom identities retain a failed upload when an earlier room is removed');
await click('#bedrooms','Retry');await waitCalls(5);await finish(4,{ok:true,url:'https://synthetic.test/retry.jpg'});await enabled(publish);await click('#bedrooms',publish);await waitCalls(6);assert.deepEqual((await calls())[5].args.arrangements[0].photo,['https://synthetic.test/retry.jpg']);await finish(5,{ok:true,published:false,prUrl:'https://synthetic.test/pr2',prNumber:2,liveUrl:'https://synthetic.test/home'});await waitText('PR opened but not auto-merged.');await clean();pass('photo retry publishes the recovered room and preserves the explicit pending-PR result');
await upload();await waitCalls(7);await finish(6,{ok:false,error:'Second failed photo'});await waitText('Retry or remove failed uploads');await click('#bedrooms','Remove');assert.equal(await page.$$eval('input[type="file"]:not([capture])',els=>els.length),1);await page.evaluate(()=>window.confirmAnswer=true);await click('#bedrooms','Remove');assert.equal(await page.$$eval('input[type="file"]:not([capture])',els=>els.length),0);await enabled(publish);pass('removing a bedroom with failed files requires explicit discard confirmation');
await page.$$eval('#bedrooms aside button',bs=>bs[1].click());await clean();assert.equal(await value(name),'Primary');pass('confirmed property switch clears the old property draft and upload failures');

await reset('owner');await click('#owner','Generate onboarding link',true);await waitCalls(1);await leave();assert.equal(await nav(),0);assert.equal(await guard(),true);await finish(0,null,true);await waitText('Synthetic lost response');await clean();await click('#owner','✉ Draft email to owner',true);await waitCalls(2);await finish(1,'confirmed-token');await waitText('Email preview');assert.equal(await page.$eval('#onboarding-url-home-a',e=>e.value),'/onboarding/confirmed-token');pass('token generation prevents repeats, blocks navigation while pending and recovers failed creation');
await click('#owner','✉ Create Gmail draft',true);await waitCalls(3);assert.equal((await calls())[2].args.url,'/api/draft-onboarding-email');assert.equal((await calls())[2].args.property_id,'home-a');await click('#owner','Cancel');await page.keyboard.press('Escape');await page.$eval('[role="dialog"]',e=>e.click());await leave();assert.equal(await nav(),0);assert.equal((await text()).includes('Email preview'),true);assert.equal(await guard(),true);pass('email draft creation is single-flight and cannot be hidden with Cancel, Escape or navigation');
await finish(2,{ok:false,error:'Synthetic Gmail failure'});await waitText('Synthetic Gmail failure');await clean();await click('#owner','✉ Create Gmail draft');await waitCalls(4);await finish(3,null,true);await waitText('Synthetic lost response');await clean();pass('draft failures keep the preview available and release the pending guard');
await click('#owner','✉ Create Gmail draft');await waitCalls(5);await finish(4,{ok:true});await waitText('Could not confirm the draft');assert.equal((await text()).includes('Draft created in Gmail.'),false);pass('missing draft URL cannot be reported as confirmed success');
await click('#owner','✉ Create Gmail draft');await waitCalls(6);await finish(5,{ok:true,draft_url:'https://mail.google.com/mail/u/0/#drafts/synthetic'});await waitText('Draft created in Gmail.');await clean();await click('#owner','Close');await click('#owner','✉ Draft email to owner');await waitText('Draft created in Gmail.');assert.equal((await calls()).length,6);assert.equal(await page.$eval('a[href^="https://mail.google.com"]',e=>e.href),'https://mail.google.com/mail/u/0/#drafts/synthetic');assert.equal(await page.$$eval('button',bs=>bs.some(b=>b.textContent.trim()==='✉ Create Gmail draft')),false);pass('closing and reopening retains the confirmed Gmail draft link and prevents a second draft');

await reset('feed');await click('#feed','Clear from feed',true);await waitCalls(1);assert.deepEqual((await calls())[0].args,{type:'slip',id:'slip-a'});assert.equal(await page.$eval('#feed button',e=>e.disabled),true);await finish(0,{ok:false,error:'Synthetic clear failed'});await waitText('Synthetic clear failed');await click('#feed','Retry clearing from feed',true);await waitCalls(2);await finish(1,null,true);await waitText('Could not confirm the clear');pass('feed clear prevents repeats and displays returned or transport errors with a retry');
await click('#feed','Retry clearing from feed');await waitCalls(3);await finish(2,{ok:true});await enabled('×');assert.equal(await page.$$eval('#feed [role="alert"]',els=>els.length),0);pass('confirmed feed retry clears the error without changing the target');
assert.deepEqual(errors,[]);console.log('PASS '+checks+' photos, onboarding and feed browser checks; synthetic data only.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(scratch,{recursive:true,force:true});}
