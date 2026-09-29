/** Actual intake and trip controls; synthetic records and controlled I/O only. */
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
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-intake-jobs-'));
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
for(const [name,path] of [
 ['apply','src/app/field/apply/ApplyForm.tsx'],['video','src/app/field/apply/ApplyVideo.tsx'],['onboarding','src/app/field/onboarding/OnboardingForm.tsx'],
 ['payment','src/app/field/onboarding/PaymentFields.tsx'],['tin','src/app/field/onboarding/TinInput.tsx'],['phone','src/components/PhoneInput.tsx'],['phone-lib','src/lib/phone.ts'],
 ['sms','src/app/field/SmsToggle.tsx'],['checklist','src/app/properties/[id]/OnboardingItemToggle.tsx'],['handled','src/app/today/MarkHandledButton.tsx'],
 ['attachments','src/app/fieldwork/packets/[id]/StopAttachments.tsx'],['text','src/app/fieldwork/packets/[id]/PacketTextEditor.tsx'],['order','src/app/fieldwork/packets/[id]/StopList.tsx'],
 ['retained','src/lib/use-retained-submission.ts'],['unsaved','src/lib/unsaved-work.ts'],
])await writeFile(join(scratch,name+'.js'),compile(await readFile(join(root,path),'utf8')));
await writeFile(join(scratch,'actions.js'),`
export const save=(kind,args)=>new Promise((resolve,reject)=>window.calls.push({kind,args,resolve,reject}));
export const submitApplication=(prev,data)=>save('apply',[...data.entries()].filter(([k,v])=>typeof v==='string'));
export const completeOnboarding=(prev,data)=>save('onboarding',[...data.entries()]);
export const setSmsOptIn=target=>save('sms',target),setOnboardingItemAction=args=>save('checklist',args),markEmailHandled=id=>save('handled',id);
export const updateStopSlipContent=(packetId,id,text)=>save('job',{packetId,id,text});
export const updateStopSlipNote=(packetId,id,text)=>save('note',{packetId,id,text});
export const setStopInstructions=(packetId,id,text)=>save('stop',{packetId,id,text});
export const setPacketInstructions=(packetId,text)=>save('packet',{packetId,text});
export const attachSlipToStop=(packetId,stopId,id)=>save('attach',{packetId,stopId,id});
export const detachSlipFromStop=(packetId,id)=>save('detach',{packetId,id});
export const reorderPacketStops=(packetId,ids)=>save('order',{packetId,ids});
`);
await writeFile(join(scratch,'blob.js'),`import {save} from './actions.js';export const upload=(path,file,options)=>{window.progress=options.onUploadProgress;return save('upload',{path,name:file.name});};`);
await writeFile(join(scratch,'router.js'),`export {unstable_rethrow} from 'next/dist/client/components/unstable-rethrow.browser';`);
await writeFile(join(scratch,'refresh.js'),'export const useSoftRefresh=()=>()=>window.refreshes++;');
await writeFile(join(scratch,'entry.js'),compile(`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {ApplyForm} from './apply.js';import {OnboardingForm} from './onboarding.js';import {SmsToggle} from './sms.js';
import {OnboardingItemToggle} from './checklist.js';import {MarkHandledButton} from './handled.js';
import {StopAttachments,PacketInstructions} from './attachments.js';import {StopList} from './order.js';
import {hasUnsavedWork} from './unsaved.js';
const params=new URLSearchParams(location.search),mode=params.get('mode');
window.calls=[];window.refreshes=0;window.guarded=hasUnsavedWork;window.redirects=[];window.videos=[];
const create=document.createElement.bind(document);
document.createElement=(tag,...args)=>{const el=create(tag,...args);if(tag==='video')Object.defineProperty(el,'src',{get:()=>'',set:()=>{Object.defineProperty(el,'duration',{get:()=>window.videoDuration??10});window.videos.push(el);}});return el;};
class RedirectBoundary extends React.Component {state={redirected:false};static getDerivedStateFromError(){return {redirected:true};}componentDidCatch(error){if(!String(error.digest).startsWith('NEXT_REDIRECT;'))throw error;window.redirects.push(error.digest);}render(){return this.state.redirected?<div>Redirect received</div>:this.props.children;}}
const slipA={id:'slip-a',title:'Synthetic attached slip',attachmentId:'attachment-a',officeNote:'Existing attached note',completedAt:null,priority:'normal'};
const slipB={id:'slip-b',title:'Synthetic extra slip',priority:'normal',scheduled_date:'2030-10-06'};
function Fixture(){const [mounted,setMounted]=useState(true),[notes,setNotes]=useState(params.has('empty')?'':'Existing packet instructions'),[attached,setAttached]=useState([slipA]),[ids,setIds]=useState(['a','b','c']),[check,setCheck]=useState('todo');
window.unmount=()=>setMounted(false);window.updateNotes=()=>setNotes('Latest server instructions');window.updateOrder=()=>setIds(['c','a','b','d']);window.updateChecklist=()=>setCheck('n_a');
window.confirmAttach=()=>setAttached([slipA,{...slipB,attachmentId:'attachment-b',officeNote:null,completedAt:null}]);window.confirmDetach=()=>setAttached([]);
if(!mounted)return null;return <>
{(mode==='apply'||mode==='all')&&<section id="apply"><RedirectBoundary><ApplyForm source="synthetic-source" trade={params.has('creative')?'creative':'inspection'}/></RedirectBoundary></section>}
{mode==='onboarding'&&<section id="onboarding"><RedirectBoundary><OnboardingForm defaultName="Synthetic Person" defaultPhone="9785550100" taxClassifications={['Individual','LLC']} paymentMethods={['Check','Venmo','Direct deposit (ACH)']} isCreative={params.has('creative')}/></RedirectBoundary></section>}
{(mode==='controls'||mode==='all')&&<section id="controls"><section id="sms"><SmsToggle initial={true}/></section><section id="checklist"><OnboardingItemToggle propertyId="home-a" itemKey="photos" status={check} derived={params.has('derived')}/></section><section id="handled"><MarkHandledButton messageId="email-a"/></section></section>}
{(mode==='text'||mode==='all')&&<section id="text"><section id="packet"><PacketInstructions packetId="packet-a" instructions={notes} editable={!params.has('readonly')}/></section><section id="stop"><StopAttachments packetId="packet-a" stopId="stop-a" stopWorkSlipId="job-a" stopSlip={{id:'job-a',text:'Existing job description'}} attached={attached} attachable={[slipA,slipB]} instructions={params.has('empty')?null:'Existing stop instructions'} editable={!params.has('readonly')} visitDate="2030-10-01"/></section></section>}
{mode==='order'&&<section id="order"><StopList packetId="packet-a" canReorder={!params.has('readonly')} items={ids.map(id=>({id,node:<div data-stop={id} style={{height:60}}>Stop {id}</div>}))}/></section>}
</>;}createRoot(document.getElementById('root')).render(<Fixture/>);
`));
const alias={'./actions':'actions','../actions':'actions','./onboarding-actions':'actions','./ApplyVideo':'video','./PaymentFields':'payment','./TinInput':'tin','./PacketTextEditor':'text','@/components/PhoneInput':'phone','@/lib/phone':'phone-lib','@/lib/use-retained-submission':'retained','./unsaved-work':'unsaved','@/lib/unsaved-work':'unsaved','@/lib/use-soft-refresh':'refresh','@vercel/blob/client':'blob','next/navigation':'router'};
await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},resolve:{modules:[join(root,'node_modules')],alias:Object.fromEntries(Object.entries(alias).map(([k,v])=>[k,join(scratch,v+'.js')]))},performance:{hints:false}});compiler.run((err,stats)=>compiler.close(()=>err||stats?.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));});
if(process.argv.includes('--compile-only')){console.log('Intake and job fixture compiled.');await rm(scratch,{recursive:true,force:true});process.exit(0);}
const server=createServer(async(req,res)=>{if(req.method!=='GET'){res.writeHead(405).end();return;}res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'");if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(await readFile(join(scratch,'bundle.js')));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>Synthetic intake and job controls</title><style>body{font:14px system-ui;--ink:#222;--paper:#fff;--rule:#ccc}section{margin:20px}button{margin:4px}input,textarea,select{margin:4px}</style><div id="root"></div><script src="/bundle.js"></script>');}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;let browser,page,checks=0;
try{
browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':await chromium.executablePath()),headless:true,args:process.platform==='darwin'?['--no-sandbox']:chromium.args});
page=await browser.newPage();page.setDefaultTimeout(10000);await page.setViewport({width:1250,height:1100});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin+'/')?r.continue():r.abort());
const reset=async(mode,extra='')=>{await page.goto(origin+'/?mode='+mode+extra);await page.waitForSelector('#'+(mode==='all'?'apply':mode));};
const click=(scope,label,twice=false)=>page.$$eval(scope+' button',(bs,label,twice)=>{const b=bs.find(b=>b.textContent.trim()===label||b.getAttribute('aria-label')===label);if(!b)throw Error('Missing button '+label);b.click();if(twice)b.click();},label,twice);
const edit=(selector,value)=>page.$eval(selector,(e,value)=>{const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));},value);
const calls=()=>page.evaluate(()=>window.calls.map(({kind,args})=>({kind,args}))),waitCalls=n=>page.waitForFunction(n=>window.calls.length===n,{},n);
const finish=(i,result={ok:true},reject=false)=>page.evaluate((i,result,reject)=>reject?window.calls[i].reject(Error('Synthetic lost response')):window.calls[i].resolve(result),i,result,reject);
const value=s=>page.$eval(s,e=>e.value),ready=s=>page.waitForFunction(s=>document.querySelector(s)&&!document.querySelector(s).matches(':disabled'),{},s);
const text=()=>page.$eval('body',e=>e.innerText),waitText=t=>page.waitForFunction(t=>document.body.textContent.includes(t),{},t);
const guard=()=>page.evaluate(()=>window.guarded()),clean=()=>page.waitForFunction(()=>!window.guarded());
const blur=s=>page.$eval(s,e=>e.dispatchEvent(new FocusEvent('focusout',{bubbles:true})));
const pass=m=>{checks++;console.log('PASS '+m);};
const submit=(scope,twice=false)=>page.$eval(scope+' form',(form,twice)=>{form.requestSubmit();if(twice)form.requestSubmit();},twice);
const redirect=i=>page.evaluate(i=>{const e=Error('NEXT_REDIRECT');e.digest='NEXT_REDIRECT;push;/synthetic-success;303;';window.calls[i].reject(e);},i);
const fillApply=async()=>{for(const [name,v] of Object.entries({full_name:'Synthetic Applicant',email:'applicant@example.test',phone:'9785550100',area:'Gloucester',availability:'Weekends',heard_about:'Synthetic referral',about:'First line\nSecond line'}))await edit('#apply [name="'+name+'"]',v);await page.$eval('#apply [value="yes"]',e=>e.click());};
const upload=async(name='intro.mp4',type='video/mp4')=>page.$eval('#apply input[type="file"]',(e,name,type)=>{const dt=new DataTransfer();dt.items.add(new File(['synthetic'],name,{type}));e.files=dt.files;e.dispatchEvent(new Event('change',{bubbles:true}));},name,type);
const metadata=async(duration=10)=>{await page.waitForFunction(()=>window.videos.length>0);await page.evaluate(duration=>{window.videoDuration=duration;window.videos.shift().onloadedmetadata();},duration);};

for(const creative of [false,true]){
 await reset('apply',creative?'&creative=1':'');await fillApply();await submit('#apply',true);await waitCalls(1);const first=(await calls())[0].args;
 assert.equal(Object.fromEntries(first).trade,creative?'creative':'inspection');assert.equal(Object.fromEntries(first).source,'synthetic-source');assert.equal(await guard(),true);
 assert.equal(await page.$$eval('#apply input,#apply textarea,#apply button',es=>es.every(e=>e.matches(':disabled'))),true);
 await finish(0,{error:'Synthetic validation error'});await ready('#apply [name="full_name"]');await waitText('Synthetic validation error');await submit('#apply');await waitCalls(2);assert.deepEqual((await calls())[1].args,first);
 await finish(1,null,true);await ready('#apply [name="full_name"]');await waitText('Could not confirm your application');assert.equal(await value('#apply [name="about"]'),'First line\nSecond line');
 pass((creative?'creative':'inspection')+' application retains every answer on returned and lost-response failures and blocks double submit');
 await submit('#apply');await waitCalls(3);await redirect(2);await waitText('Redirect received');await clean();assert.equal(await page.evaluate(()=>window.redirects.length),1);
 pass((creative?'creative':'inspection')+' confirmed application preserves the Next redirect and releases the draft guard');
}
await reset('apply');await fillApply();await upload();await waitText('Waiting for video');await submit('#apply');assert.equal((await calls()).length,0);await metadata();await waitCalls(1);assert.equal((await calls())[0].kind,'upload');await submit('#apply');assert.equal((await calls()).length,1);
await page.evaluate(()=>window.progress({percentage:50}));await waitText('50%');await finish(0,{url:'https://synthetic.example/intro.mp4'});await waitText('Video attached');await submit('#apply',true);await waitCalls(2);assert.equal(Object.fromEntries((await calls())[1].args).video_url,'https://synthetic.example/intro.mp4');await finish(1,{error:'Application rejected'});await ready('#apply [name="full_name"]');assert.equal(await value('#apply [name="video_url"]'),'https://synthetic.example/intro.mp4');
pass('application waits for metadata and upload, submits the completed video URL, and retains it after rejection');
await click('#apply','Remove');assert.equal(await value('#apply [name="video_url"]'),'');await upload();await metadata();await waitCalls(3);await finish(2,null,true);await waitText('Synthetic lost response');await ready('#apply button[type="submit"]');assert.equal(await value('#apply [name="video_url"]'),'');
pass('failed video upload unlocks submission and retains the applicant answers without attaching an unconfirmed URL');
await upload('wrong.txt','text/plain');await waitText('Please choose a video');await ready('#apply button[type="submit"]');assert.equal(await value('#apply input[type="file"]'),'');await upload();await metadata(90);await waitText('Please keep it under 30');assert.equal((await calls()).length,3);
pass('invalid files and long clips release the submit block and can be selected again without uploading');
await upload();await metadata();await waitCalls(4);await finish(3,{url:'https://synthetic.example/retry.mp4'});await waitText('Video attached');await submit('#apply');await waitCalls(5);assert.equal(Object.fromEntries((await calls())[4].args).video_url,'https://synthetic.example/retry.mp4');await redirect(4);await waitText('Redirect received');await clean();
pass('explicit video retry submits the replacement URL and still completes normally');

const fillOnboarding=async()=>{for(const [name,v] of Object.entries({full_name:'Synthetic Contractor',phone:'9785550199',w9_legal_name:'Synthetic Legal Name',w9_business_name:'Synthetic LLC',w9_tax_classification:'LLC',w9_address:'1 Test Street',w9_city:'Gloucester',w9_state:'MA',w9_zip:'01930',w9_tin_type:'ein',w9_tin:'000000000',payment_method:'Direct deposit (ACH)',signed_name:'Synthetic Contractor'}))await edit('#onboarding [name="'+name+'"]',v);await edit('#onboarding [placeholder="9 digits"]','000000000');await page.$$eval('#onboarding input:not([name])',es=>{const e=es.find(e=>!e.placeholder);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'000000001');e.dispatchEvent(new Event('input',{bubbles:true}));});await page.$eval('#onboarding [name="agree"]',e=>e.click());await page.$eval('#onboarding [name="sms_opt_in"]',e=>e.click());};
for(const creative of [false,true]){
 await reset('onboarding',creative?'&creative=1':'');await fillOnboarding();await submit('#onboarding',true);await waitCalls(1);const first=(await calls())[0].args;
 assert.equal(Object.fromEntries(first).w9_tin,'00-0000000');assert.equal(Object.fromEntries(first).payment_method,'Direct deposit (ACH)');assert.match(Object.fromEntries(first).payment_details,/000000001/);assert.equal(Object.hasOwn(Object.fromEntries(first),'sms_opt_in'),false);
 assert.equal(await page.$$eval('#onboarding input,#onboarding select,#onboarding button',es=>es.every(e=>e.matches(':disabled'))),true);
 await finish(0,{error:'Synthetic setup rejection'});await ready('#onboarding input');await waitText('Synthetic setup rejection');await submit('#onboarding');await waitCalls(2);assert.deepEqual((await calls())[1].args,first);await finish(1,null,true);await ready('#onboarding input');await waitText('Could not confirm your account setup');assert.equal(await value('#onboarding [name="w9_address"]'),'1 Test Street');assert.equal(await guard(),true);
 pass((creative?'creative':'inspection')+' onboarding retains native and controlled identity, address, payment, consent and signature fields after errors');
 await submit('#onboarding');await waitCalls(3);assert.deepEqual((await calls())[2].args,first);await redirect(2);await waitText('Redirect received');await clean();
 pass((creative?'creative':'inspection')+' onboarding retries the same answers once and preserves successful redirect');
}

await reset('controls');await click('#sms','Text me when new work is posted',true);await waitCalls(1);assert.equal((await calls())[0].args,false);assert.equal(await page.$eval('#sms [role="switch"]',e=>e.getAttribute('aria-checked')),'true');await finish(0,{ok:false,error:'Preference rejected'});await clean();await waitText('Preference rejected');
await click('#sms','Retry turning texts off',true);await waitCalls(2);assert.equal((await calls())[1].args,false);await finish(1,null,true);await clean();await waitText('Could not confirm your text preference');await click('#sms','Retry turning texts off');await waitCalls(3);await finish(2);await clean();assert.equal(await page.$eval('#sms [role="switch"]',e=>e.getAttribute('aria-checked')),'false');
pass('SMS preference shows only confirmed state and retries the original opt-out through returned and thrown failures');
await click('#sms','Text me when new work is posted');await waitCalls(4);await finish(3,{ok:false});await clean();assert.equal(await page.$eval('#sms [role="switch"]',e=>e.getAttribute('aria-checked')),'false');assert.doesNotMatch(await page.$eval('#sms',e=>e.innerText),/Saved/);
pass('a later text preference failure clears stale Saved feedback and preserves the confirmed preference');
await click('#checklist','Done',true);await waitCalls(5);await finish(4,{ok:false,error:'Checklist rejected'});await clean();await waitText('Checklist rejected');assert.equal(await page.$eval('#checklist button',e=>e.getAttribute('aria-pressed')),'false');await click('#checklist','Retry');await waitCalls(6);await finish(5,null,true);await clean();await click('#checklist','Retry');await waitCalls(7);assert.equal((await calls())[6].args.status,'done');await finish(6);await clean();assert.equal(await page.$eval('#checklist button',e=>e.getAttribute('aria-pressed')),'true');
pass('checklist Done failures are visible and retries keep the requested state until confirmed');
await click('#checklist','Done');await waitCalls(8);assert.equal((await calls())[7].args.status,'todo');await finish(7);await clean();await page.evaluate(()=>window.updateChecklist());assert.equal(await page.$$eval('#checklist button',es=>es.find(e=>e.textContent==='N/A').getAttribute('aria-pressed')),'true');
pass('confirmed checklist changes toggle back to todo correctly before refresh and adopt later server changes');
await click('#handled','Mark handled',true);await waitCalls(9);await finish(8,{ok:false,error:'Email rejected'});await clean();await waitText('Email rejected');await click('#handled','Retry');await waitCalls(10);await finish(9,null,true);await clean();await waitText('Could not confirm this email');await click('#handled','Retry');await waitCalls(11);await finish(10);await clean();assert.equal(await page.$('#handled button'),null);assert.equal(await page.$eval('#handled',e=>e.innerText),'Handled');
pass('Handled reports both failure paths, allows retry, and only removes its control after confirmation');
await reset('controls','&derived=1');assert.equal(await page.$('#checklist button'),null);assert.match(await page.$eval('#checklist',e=>e.innerText),/Auto/);pass('automatically derived checklist items stay read-only');

const textarea=label=>'textarea[aria-label="'+label+'"]';
for(const [label,kind,selector] of [['Instructions for the whole packet','packet','#packet'],['The job','job','#stop'],['Instructions for this stop','stop','#stop'],['Note for Synthetic attached slip','note','#stop']]){
 await reset('text');const field=textarea(label);const original=await value(field);await edit(field,'Retained '+kind+'\nSecond line');assert.equal(await guard(),true);await blur(field);await blur(field);await waitCalls(1);assert.equal((await calls())[0].kind,kind);assert.equal((await calls())[0].args.text,'Retained '+kind+'\nSecond line');assert.equal(await page.$eval(field,e=>e.disabled),true);
 await finish(0,{ok:false});await ready(field);await waitText('Could not save this text');assert.equal(await value(field),'Retained '+kind+'\nSecond line');await click(selector,'Retry save',true);await waitCalls(2);await finish(1,null,true);await ready(field);await waitText('Could not confirm this save');await click(selector,'Retry save');await waitCalls(3);await finish(2);await clean();await blur(field);assert.equal((await calls()).length,3);
 pass(kind+' text keeps exact edits and retry target after returned/thrown failures and does not resave a confirmed value on blur');
 await edit(field,'Discard this version');await click(selector,'Discard edit');await clean();assert.equal(await value(field),'Retained '+kind+'\nSecond line');assert.notEqual(await value(field),original);pass(kind+' discard restores the latest confirmed value before refreshed props arrive');
}
await reset('text');await edit(textarea('Instructions for the whole packet'),'Draft during refresh');await page.evaluate(()=>window.updateNotes());assert.equal(await value(textarea('Instructions for the whole packet')),'Draft during refresh');await click('#packet','Discard edit');await clean();assert.equal(await value(textarea('Instructions for the whole packet')),'Latest server instructions');
pass('server props preserve an open instruction draft and explicit discard adopts the latest server value');
await edit(textarea('The job'),'');await blur(textarea('The job'));await waitText('The job needs a description');assert.equal((await calls()).length,0);await click('#stop','Discard edit');await clean();
await edit(textarea('Instructions for this stop'),'');await blur(textarea('Instructions for this stop'));await waitCalls(1);assert.equal((await calls())[0].args.text,'');await finish(0);await clean();
pass('a blank job cannot erase its description while optional trip instructions can be explicitly cleared');
await edit(textarea('Note for Synthetic attached slip'),'Unsaved attached note');assert.equal(await page.$$eval('#stop button',es=>es.find(e=>e.textContent==='remove').disabled),true);assert.equal(await page.$eval('#stop > div > button',e=>e.disabled),true);await click('#stop','Discard edit');await clean();
pass('unsaved attachment notes block removal and panel collapse until saved or discarded');
await reset('text','&readonly=1');assert.equal(await page.$('#text textarea'),null);assert.equal(await page.$('#text button'),null);pass('completed trip instructions and attachments remain read-only');
await reset('text','&empty=1');await click('#packet','+ add a note for the whole trip');await edit(textarea('Instructions for the whole packet'),'New trip note');await blur(textarea('Instructions for the whole packet'));await waitCalls(1);await finish(0);await clean();await click('#stop','+ add instructions for this stop');await edit(textarea('Instructions for this stop'),'New stop note');await blur(textarea('Instructions for this stop'));await waitCalls(2);await finish(1);await clean();
pass('initially empty packet and stop instructions still open, save, and clear their guards');

await reset('text');await page.$eval('#stop details',e=>e.open=true);await waitText('after this visit');await click('#stop','attach',true);await waitCalls(1);assert.deepEqual((await calls())[0].args,{packetId:'packet-a',stopId:'stop-a',id:'slip-b'});await finish(0,{ok:false});await clean();await waitText('Could not confirm attaching');await click('#stop','attach');await waitCalls(2);await finish(1,null,true);await clean();await click('#stop','attach');await waitCalls(3);await finish(2);await clean();await page.evaluate(()=>window.confirmAttach());await waitText('2 attached');assert.equal(await page.$$eval('#stop button',es=>es.filter(e=>e.textContent==='remove').length),2);
pass('attachment failures restore the picker with an explicit error and a confirmed retry reconciles to the real attachment row');
await reset('text');await click('#stop','remove',true);await waitCalls(1);await finish(0,{ok:false});await clean();await waitText('Could not confirm removing');assert.ok(await page.$(textarea('Note for Synthetic attached slip')));await click('#stop','remove');await waitCalls(2);await finish(1,null,true);await clean();await click('#stop','remove');await waitCalls(3);await finish(2);await clean();await page.evaluate(()=>window.confirmDetach());assert.equal(await page.$(textarea('Note for Synthetic attached slip')),null);
pass('attachment removal failures restore the row and only a confirmed retry leaves it removed');

const order=()=>page.$$eval('[data-stop]',es=>es.map(e=>e.dataset.stop));
const grip=async(id,event='pointerdown')=>page.$eval('[data-stop="'+id+'"]', (el,event)=>el.parentElement.querySelector('[title="Drag to reorder"]').dispatchEvent(new PointerEvent(event,{bubbles:true,clientY:el.getBoundingClientRect().top,pointerId:1})),event);
const dragBelow=()=>page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointermove',{clientY:document.querySelector('[data-stop="c"]').getBoundingClientRect().bottom+30,pointerId:1})));
const endDrag=type=>page.evaluate(type=>window.dispatchEvent(new PointerEvent(type,{pointerId:1})),type);
await reset('order');await click('#order','Move down',true);await waitCalls(1);assert.deepEqual(await order(),['b','a','c']);await grip('a');await dragBelow();await endDrag('pointerup');assert.equal((await calls()).length,1);await finish(0,{ok:false,error:'Order rejected'});await clean();await waitText('Order rejected');assert.deepEqual(await order(),['a','b','c']);
await click('#order','Move down');await waitCalls(2);await finish(1,null,true);await clean();await waitText('Could not confirm the visit order');assert.deepEqual(await order(),['a','b','c']);await click('#order','Move down');await waitCalls(3);await finish(2);await clean();assert.deepEqual(await order(),['b','a','c']);
pass('arrow reordering rejects overlapping taps and drags, reports errors, and recovers the confirmed order');
await reset('order');await grip('a');await dragBelow();assert.deepEqual(await order(),['b','c','a']);await endDrag('pointercancel');await clean();assert.deepEqual(await order(),['a','b','c']);assert.equal((await calls()).length,0);
pass('cancelled touch drags restore the previous order without sending a save');
await grip('a');await dragBelow();await endDrag('pointerup');await waitCalls(1);assert.deepEqual((await calls())[0].args.ids,['b','c','a']);await finish(0);await clean();assert.deepEqual(await order(),['b','c','a']);
pass('completed drags save the final pointer position exactly once');
await reset('order');await click('#order','Move down');await waitCalls(1);await page.evaluate(()=>window.updateOrder());await finish(0,null,true);await clean();assert.deepEqual(await order(),['c','a','b','d']);
pass('late reorder failures cannot roll back a newer server list or remove a newly added stop');
await reset('order','&readonly=1');assert.equal(await page.$('#order button'),null);assert.equal(await page.$('#order [title="Drag to reorder"]'),null);pass('locked stop lists retain their read-only behavior');
await reset('order');await grip('a');await dragBelow();await page.evaluate(()=>window.unmount());await clean();await endDrag('pointerup');assert.equal((await calls()).length,0);
pass('unmount removes drag listeners and prevents a late pointer release from saving');

await reset('all');await edit(textarea('Instructions for the whole packet'),'Independent trip draft');await fillApply();await click('#sms','Text me when new work is posted');await waitCalls(1);await finish(0);await ready('#sms button');assert.equal(await guard(),true);await click('#packet','Discard edit');assert.equal(await guard(),true);await page.evaluate(()=>window.unmount());await clean();
pass('independent form and trip drafts hold separate reload guards when another action finishes or is discarded');
assert.deepEqual(errors,[]);console.log('All '+checks+' intake and job browser checks passed.');
}catch(error){if(page)console.error('Synthetic intake/job state:',await page.evaluate(()=>({body:document.body.innerText,calls:window.calls?.map(({kind,args})=>({kind,args})),guarded:window.guarded?.()})));throw error;}
finally{await browser?.close();await new Promise(r=>server.close(r));await rm(scratch,{recursive:true,force:true});}
