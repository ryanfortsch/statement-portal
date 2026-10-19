/** ConfirmDialog (the app's one confirm modal) and SubmitButton's `confirm`,
 *  the real components in Chromium with synthetic actions: focus stays in the
 *  dialog, Escape and the backdrop cancel and hand focus back, a yes resubmits
 *  with the clicked button, the typed-word gate holds, askText needs an
 *  answer, and nothing falls through to the browser's own confirm(). */
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
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-confirm-dialog-'));
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;

for(const [name,path] of [
 ['confirm','src/components/ConfirmDialog.tsx'],['confirmq','src/lib/confirm-question.ts'],['submit','src/components/SubmitButton.tsx'],
])await writeFile(join(scratch,name+'.js'),compile(await readFile(join(root,path),'utf8')));
await writeFile(join(scratch,'skew.js'),'export const reloadedForNewDeployment=()=>Promise.resolve(false);');
await writeFile(join(scratch,'entry.js'),compile(`
import React from 'react';import {createRoot} from 'react-dom/client';
import {ConfirmProvider,useConfirm} from './confirm.js';import {SubmitButton} from './submit.js';
window.calls=[];
for(const k of ['confirm','prompt','alert'])window[k]=()=>{window.native=(window.native||0)+1;throw Error('native '+k);};
function Fixture(){
  const {ask,askText,notify}=useConfirm();
  const [inFlight,startTransition]=React.useTransition();
  const act=async fd=>{window.calls.push({action:'act',...Object.fromEntries(fd.entries())});};
  const wipe=async fd=>{window.calls.push({action:'wipe',...Object.fromEntries(fd.entries())});};
  return <main style={{padding:24}}>
    <button type="button" id="before">Before</button>
    <form action={act}>
      <input name="home" defaultValue="synthetic_home"/>
      <SubmitButton label="Retire" busyLabel="Retiring" name="mode" value="retire" confirm="Retire Pat Synthetic? Their portal link stops working."/>
      <SubmitButton label="Wipe" busyLabel="Wiping" formAction={wipe} confirm={{title:'Wipe the test data?',body:'Deletes every synthetic packet.',tone:'danger',irreversible:true,typeToConfirm:'wipe'}}/>
      <SubmitButton label="Save" busyLabel="Saving" name="mode" value="plain"/>
    </form>
    <button type="button" id="asktext" onClick={async()=>{window.answer=await askText({title:'Pass on this job?',inputLabel:'Reason',confirmLabel:'Pass'});}}>Ask text</button>
    <button type="button" id="intransition" onClick={()=>startTransition(async()=>{window.transitionAnswer=await ask({title:'Publish these changes?',confirmLabel:'Publish'});})}>{inFlight?'Publishing':'Publish in a transition'}</button>
    <button type="button" id="notify" onClick={async()=>{await notify({title:'Download failed',body:'Synthetic.'});window.notified=true;}}>Notify</button>
    <div style={{height:2000}}/>
  </main>;
}
createRoot(document.getElementById('root')).render(<ConfirmProvider><Fixture/></ConfirmProvider>);
`));
const alias={'@/components/ConfirmDialog':'confirm','@/lib/confirm-question':'confirmq','@/components/SubmitButton':'submit','@/lib/version-skew':'skew'};
await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},resolve:{modules:[join(root,'node_modules')],alias:Object.fromEntries(Object.entries(alias).map(([k,v])=>[k,join(scratch,v+'.js')]))},performance:{hints:false}});compiler.run((err,stats)=>compiler.close(()=>err||stats?.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));});
if(process.argv.includes('--compile-only')){console.log('Confirm dialog fixture compiled.');await rm(scratch,{recursive:true,force:true});process.exit(0);}

const html='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic confirm dialog</title><style>:root{--ink:#0b2545;--ink-2:#18375c;--ink-3:#51677d;--ink-4:#8ba0b4;--paper:#f5efe2;--rule:#ddcfb2;--negative:#8a3a2e}*{box-sizing:border-box}body{margin:0;font:14px system-ui;background:var(--paper)}</style><div id="root"></div><script src="/bundle.js"></script>';
const server=createServer(async(req,res)=>{if(req.method!=='GET'){res.writeHead(405).end();return;}res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'");if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(await readFile(join(scratch,'bundle.js')));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;let browser,page,checks=0;const errors=[];
try{
browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':await chromium.executablePath()),headless:true,args:process.platform==='darwin'?['--no-sandbox']:chromium.args});
page=await browser.newPage();page.setDefaultTimeout(10000);
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('native dialog: '+d.message());d.dismiss();});
await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin+'/')?r.continue():r.abort());
const pass=m=>{checks++;console.log('PASS '+m);};
const dlg='[data-helm-confirm]';
// Focus, then click: what a mouse click does to a button in Chrome.
const clickText=label=>page.$$eval('button',(bs,label)=>{const b=bs.find(b=>b.textContent.trim()===label);if(!b)throw Error('Missing '+label);b.focus();b.click();},label);
const dialogButton=label=>page.$$eval(dlg+' button',(bs,label)=>{const b=bs.find(b=>b.textContent.trim()===label);if(!b)throw Error('Missing dialog button '+label);b.click();},label);
const focused=()=>page.evaluate(()=>document.activeElement?.textContent?.trim()||document.activeElement?.tagName);
const calls=()=>page.evaluate(()=>window.calls);
const closed=()=>page.waitForFunction(s=>!document.querySelector(s),{},dlg);
const load=async(width=1100,height=800)=>{await page.setViewport({width,height});await page.goto(origin+'/');await page.waitForSelector('form');};

await load();
await clickText('Retire');await page.waitForSelector(dlg);
assert.equal(await page.$eval(dlg+' h2',e=>e.textContent),'Retire Pat Synthetic?');
assert.equal(await page.$eval('#helm-confirm-body',e=>e.textContent),'Their portal link stops working.');
assert.equal(await page.$eval(dlg,e=>e.getAttribute('role')+' '+e.getAttribute('aria-modal')+' '+e.getAttribute('aria-describedby')),'alertdialog true helm-confirm-body');
assert.equal(await focused(),'Retire','the confirm button, named for the action, takes focus');
assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden','the page behind does not scroll');
assert.deepEqual(await calls(),[],'nothing submits while the question is open');
pass('a SubmitButton confirm opens the modal, split into question and effect, named for the action');

await page.keyboard.press('Tab');assert.equal(await focused(),'Cancel','Tab from the last button wraps to the first');
await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');
assert.equal(await focused(),'Retire','Shift+Tab from the first wraps to the last');
for(let i=0;i<5;i++)await page.keyboard.press('Tab');
assert.equal(await focused(),'Cancel','five Tabs later focus is still inside the dialog');
pass('focus is trapped inside the dialog');

await page.keyboard.press('Escape');await closed();
await page.waitForFunction(()=>document.activeElement?.textContent?.trim()==='Retire');
assert.deepEqual(await calls(),[]);
assert.equal(await page.evaluate(()=>document.body.style.overflow),'','scrolling comes back');
pass('Escape cancels, submits nothing, and hands focus back to the button');

await clickText('Retire');await page.waitForSelector(dlg);
await page.mouse.click(8,8);await closed();
assert.deepEqual(await calls(),[]);
await clickText('Retire');await page.waitForSelector(dlg);
await page.$eval(dlg+' h2',e=>e.click());
assert.ok(await page.$(dlg),'a click inside the dialog is not a cancel');
await dialogButton('Cancel');await closed();
assert.deepEqual(await calls(),[]);
pass('the backdrop and Cancel cancel; a click inside the card does not');

await clickText('Retire');await page.waitForSelector(dlg);await dialogButton('Retire');await closed();
await page.waitForFunction(()=>window.calls.length===1);
assert.deepEqual(await calls(),[{action:'act',home:'synthetic_home',mode:'retire'}],'the yes submits the form with the clicked button as submitter');
pass('a yes resubmits the form with the same button, name and value');

await clickText('Wipe');await page.waitForSelector(dlg);
const wipeText=await page.$eval(dlg,e=>e.textContent);
assert.ok(wipeText.includes('This cannot be undone.')&&wipeText.includes('Type wipe to confirm'));
assert.equal(await focused(),'INPUT','the typed-word field takes focus');
const wipeDisabled=()=>page.$$eval(dlg+' button',bs=>bs.find(b=>b.textContent.trim()==='Wipe').disabled);
assert.equal(await wipeDisabled(),true);
await page.keyboard.type('wip');await page.keyboard.press('Enter');
assert.ok(await page.$(dlg),'Enter with the wrong word does nothing');assert.equal(await wipeDisabled(),true);
await page.keyboard.type('E');assert.equal(await wipeDisabled(),false,'the right word, any case, wakes the button');
await page.keyboard.press('Enter');await closed();
await page.waitForFunction(()=>window.calls.length===2);
assert.deepEqual((await calls())[1],{action:'wipe',home:'synthetic_home'},'the gated button runs its own formAction');
pass('the typed-word gate holds the button until the word is typed');

// The form stays pending (every button locked) until the wipe action settles.
await page.waitForFunction(()=>[...document.querySelectorAll('form button')].every(b=>!b.disabled));
await clickText('Save');await page.waitForFunction(()=>window.calls.length===3);
assert.ok(!(await page.$(dlg)),'a SubmitButton with no confirm submits straight away');
assert.deepEqual((await calls())[2],{action:'act',home:'synthetic_home',mode:'plain'});
pass('a plain SubmitButton is untouched');

// React 19 holds a transition's state updates until its async action ends;
// a question asked from inside one must still open, or the action waits forever.
await page.click('#intransition');await page.waitForSelector(dlg);
assert.equal(await page.$eval(dlg+' h2',e=>e.textContent),'Publish these changes?');
await dialogButton('Publish');await closed();
await page.waitForFunction(()=>window.transitionAnswer===true);
pass('a question asked inside an async transition opens and answers');

await page.click('#asktext');await page.waitForSelector(dlg);
const passDisabled=()=>page.$$eval(dlg+' button',bs=>bs.find(b=>b.textContent.trim()==='Pass').disabled);
assert.equal(await passDisabled(),true,'an empty answer cannot be sent');
await page.keyboard.type('Booked elsewhere');assert.equal(await passDisabled(),false);
await dialogButton('Pass');await closed();
assert.equal(await page.evaluate(()=>window.answer),'Booked elsewhere');
await page.click('#notify');await page.waitForSelector(dlg);
assert.deepEqual(await page.$$eval(dlg+' button',bs=>bs.map(b=>b.textContent.trim())),['OK'],'a notice has one button');
await dialogButton('OK');await closed();assert.equal(await page.evaluate(()=>window.notified),true);
pass('askText needs an answer; notify is one OK');

await load(375,700);
await clickText('Wipe');await page.waitForSelector(dlg);
const box=await page.$eval(dlg,e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,scroll:document.documentElement.scrollWidth};});
assert.ok(box.left>=0&&box.right<=375&&box.scroll<=375,'the dialog fits a phone with no sideways scroll');
const heights=await page.$$eval(dlg+' button',bs=>bs.map(b=>b.getBoundingClientRect().height));
assert.ok(heights.every(h=>h>=40),'dialog buttons are thumb-sized');
await page.keyboard.press('Escape');await closed();
pass('phone: the dialog fits at 375px with thumb-sized buttons');

assert.equal(await page.evaluate(()=>window.native||0),0,'no native dialog was called');
assert.deepEqual(errors,[]);
console.log(`All ${checks} confirm dialog browser checks passed.`);
}finally{await browser?.close();server.close();await rm(scratch,{recursive:true,force:true});}
