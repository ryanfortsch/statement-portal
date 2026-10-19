/** The turnover board's row (BoardLine): the real component and the real
 *  row model (lib/turnover-board.ts), synthetic homes and guests, every
 *  server action captured instead of sent. Desktop and phone. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import {composeBoard} from '../src/lib/turnover-board.ts';
const require=createRequire(import.meta.url),{webpack}=require('next/dist/compiled/webpack/webpack');
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-turnover-board-'));
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;

// ── the board, composed by the real model on a fixed clock ──
const TODAY='2026-10-18',NOW=Date.parse('2026-10-18T13:00:00Z');
const turnover=o=>({reservationId:`res-${o.propertyId}`,propertyName:o.propertyId.replace(/_/g,' '),propertyTitle:null,guestName:'Arriving Synthetic',channel:'airbnb',checkOut:'2026-10-25',nights:3,status:'confirmed',isSameDayTurnover:false,previousCheckout:null,previousGuestName:'Leaving Synthetic',previousStayCheckIn:null,checkInTime:'16:00',inspection:null,inspectionStatus:'not_started',inspectionInProgress:false,inspectionStartedAt:null,inspectionViaLock:false,plan:null,cleaning:null,cleaningSession:null,openWorkSlipsCount:0,prepSlips:[],lockBattery:null,lockMonitored:false,manuallyCompleted:false,completedAt:null,completedByEmail:null,...o});
const item=o=>({propertyName:o.propertyId.replace(/_/g,' '),guestName:'Leaving Synthetic',checkIn:'2026-10-14',cleaningTime:'11:00',checkoutTime:'10:00',sameDayTurnover:false,nextCheckinTime:null,status:'agree',...o});
const board=composeBoard({today:TODAY,rangeEnd:'2026-10-19',nowMs:NOW,departureSignals:{},nameFor:()=>'Delaney',
 turnovers:[
  turnover({propertyId:'same_day_home',checkIn:TODAY,previousCheckout:TODAY,isSameDayTurnover:true,prepSlips:[{id:'slip-1',title:'Pack-n-play',actionSummary:'Set up the pack-n-play'}]}),
  turnover({propertyId:'lock_home',checkIn:TODAY,previousCheckout:'2026-10-17',lockMonitored:true,cleaningSession:{enteredAt:'2026-10-18T12:30:00Z',finishedAt:null,entrySource:'seam_lock',finishSource:null,finishEstimated:false}}),
  turnover({propertyId:'later_home',checkIn:'2026-10-22',previousCheckout:TODAY}),
  turnover({propertyId:'field_home',checkIn:'2026-10-19',previousCheckout:'2026-10-17',cleaning:{completedAt:'2026-10-17T18:00:00Z',source:'quo',sourcePhone:null},fieldPacket:{packetId:'packet-1',status:'claimed',contractorName:'Alex Synthetic'}}),
  turnover({propertyId:'walked_home',checkIn:TODAY,previousCheckout:'2026-10-17',inspectionStatus:'complete',inspection:{id:'insp-1',property_id:'walked_home',started_at:'2026-10-18T12:00:00Z',completed_at:'2026-10-18T12:40:00Z'}}),
 ],
 cleaningDays:[{date:TODAY,announced:true,booked:2,checkouts:3,attention:1,skipped:[],items:[
  item({propertyId:'same_day_home',cleaningTime:'10:30',sameDayTurnover:true}),
  item({propertyId:'later_home',checkoutTime:'11:00'}),
  item({propertyId:'vacant_home',status:'no_appointment',cleaningTime:null}),
 ]}]});
const rows=[...board.days.flatMap(d=>d.rows),...board.done];
const byHome=Object.fromEntries(rows.map(r=>[r.propertyId,r]));
assert.equal(rows.length,6,'five turnovers and one checkout with nobody behind it');

// ── the fixture page ──
for(const [name,path] of [
 ['line','src/app/turnovers/BoardLine.tsx'],['rail','src/app/turnovers/TurnoverRail.tsx'],['plan','src/app/turnovers/PlanButton.tsx'],
 ['mark','src/app/turnovers/MarkCleaned.tsx'],['format','src/app/turnovers/turnover-format.ts'],['submit','src/components/SubmitButton.tsx'],
 ['confirm','src/components/ConfirmDialog.tsx'],['confirmq','src/lib/confirm-question.ts'],
 ['unsaved','src/lib/unsaved-work.ts'],['opdate','src/lib/operating-date.ts'],
])await writeFile(join(scratch,name+'.js'),compile(await readFile(join(root,path),'utf8')));
await writeFile(join(scratch,'actions.js'),`
export const save=(kind,args)=>new Promise((resolve,reject)=>window.calls.push({kind,args,resolve,reject}));
export const startInspection=fd=>save('start',Object.fromEntries(fd.entries()));
export const markTurnoverComplete=fd=>save('ready',Object.fromEntries(fd.entries()));
export const unmarkTurnoverComplete=fd=>save('unready',Object.fromEntries(fd.entries()));
export const confirmCleaningDoneAction=(propertyId,checkoutDate)=>save('cleaned',{propertyId,checkoutDate});
export const setInspectionPlan=a=>save('planSave',a),deleteInspectionPlan=id=>save('planDelete',id);
`);
await writeFile(join(scratch,'skew.js'),'export const reloadedForNewDeployment=()=>Promise.resolve(false);');
await writeFile(join(scratch,'refresh.js'),'export const useSoftRefresh=()=>()=>window.refreshes++;');
await writeFile(join(scratch,'team.js'),'export const displayNameForEmail=e=>e;');
await writeFile(join(scratch,'link.js'),compile(`import React from 'react';export default function Link({href,children,prefetch,...props}){return <a {...props} href={href} onClick={e=>e.preventDefault()}>{children}</a>}`));
await writeFile(join(scratch,'picker.js'),compile(`import React from 'react';export function TeamPicker({value,onChange}){return <select aria-label="Inspector" value={value??''} onChange={e=>onChange(e.target.value||null)}><option value="">Anyone</option></select>}`));
await writeFile(join(scratch,'rows.js'),'export const rows='+JSON.stringify(rows)+';export const today='+JSON.stringify(TODAY)+';');
await writeFile(join(scratch,'entry.js'),compile(`
import React from 'react';import {createRoot} from 'react-dom/client';
import {BoardLine} from './line.js';import {rows,today} from './rows.js';
window.calls=[];window.refreshes=0;window.confirm=()=>true;
createRoot(document.getElementById('root')).render(<section id="board">{rows.map(r=><BoardLine key={r.id} row={r} today={today} myEmail="staff@example.test"/>)}</section>);
`));
const alias={'./BoardLine':'line','./TurnoverRail':'rail','./PlanButton':'plan','./MarkCleaned':'mark','./turnover-format':'format','@/components/SubmitButton':'submit','@/components/ConfirmDialog':'confirm','@/lib/confirm-question':'confirmq','@/lib/unsaved-work':'unsaved','./unsaved-work':'unsaved','@/lib/operating-date':'opdate','@/lib/version-skew':'skew','@/lib/use-soft-refresh':'refresh','@/lib/team':'team','@/components/TeamPicker':'picker','../inspections/actions':'actions','./turnover-actions':'actions','./cleaning-actions':'actions','./plan-actions':'actions','next/link':'link'};
await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},resolve:{modules:[join(root,'node_modules')],alias:Object.fromEntries(Object.entries(alias).map(([k,v])=>[k,join(scratch,v+'.js')]))},performance:{hints:false}});compiler.run((err,stats)=>compiler.close(()=>err||stats?.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));});
if(process.argv.includes('--compile-only')){console.log('Turnover board fixture compiled.');await rm(scratch,{recursive:true,force:true});process.exit(0);}

// The board's own rules from globals.css, so the layout under test is the real one.
const css=await readFile(join(root,'src/app/globals.css'),'utf8');
const boardCss=css.slice(css.indexOf('/* ─── Turnovers: the board (BoardLine)'),css.indexOf('/* ─── Responsive (mobile first pass)'));
assert.ok(boardCss.includes('.rt-tb-row'),'the board rules were found in globals.css');
const html='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic turnover board</title><style>:root{--ink:#0b2545;--ink-2:#18375c;--ink-3:#51677d;--ink-4:#8ba0b4;--paper:#f5efe2;--rule:#ddcfb2;--rule-soft:#ece2cc;--tide:#4e7c9e;--tide-deep:#1c4a6b;--signal:#946d2e;--positive:#3a6b4a;--negative:#8a3a2e}*{box-sizing:border-box}body{margin:0;font:14px system-ui;background:var(--paper);color:var(--ink)}#board{max-width:1020px;margin:0 auto;padding:0 16px}'+boardCss+'</style><div id="root"></div><script src="/bundle.js"></script>';
const server=createServer(async(req,res)=>{if(req.method!=='GET'){res.writeHead(405).end();return;}res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'");if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(await readFile(join(scratch,'bundle.js')));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;let browser,page,checks=0;const errors=[];
try{
browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':await chromium.executablePath()),headless:true,args:process.platform==='darwin'?['--no-sandbox']:chromium.args});
page=await browser.newPage();page.setDefaultTimeout(10000);
page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin+'/')?r.continue():r.abort());
const load=async(width,height=900)=>{await page.setViewport({width,height});await page.goto(origin+'/');await page.waitForSelector('.rt-tb-row');};
const sel=home=>'#'+byHome[home].id;
// textContent, not innerText: the CSS uppercases a few words (Same day, Start walk).
const text=s=>page.$eval(s,e=>e.textContent);
const calls=()=>page.evaluate(()=>window.calls.map(({kind,args})=>({kind,args})));
const waitCalls=n=>page.waitForFunction(n=>window.calls.length===n,{},n);
const finish=(i,result)=>page.evaluate((i,result)=>window.calls[i].resolve(result),i,result);
const clickText=(scope,label)=>page.$$eval(scope+' button, '+scope+' a',(es,label)=>{const e=es.find(e=>e.textContent.trim()===label);if(!e)throw Error('Missing '+label);e.click();},label);
const toggle=home=>page.$eval(sel(home)+' .rt-tb-toggle',e=>e.click());
const expanded=home=>page.$eval(sel(home)+' .rt-tb-toggle',e=>e.getAttribute('aria-expanded'));
const pass=m=>{checks++;console.log('PASS '+m);};

// ── desktop ──
await load(1250);
assert.equal(await page.$$eval('#board [role="button"]',es=>es.length),0,'no element pretends to be a button');
const geo=await page.$$eval('.rt-tb-row',rs=>rs.map(r=>{const top=s=>{const e=r.querySelector(s);return e?Math.round(e.getBoundingClientRect().top+e.getBoundingClientRect().height/2):null;};const left=s=>{const e=r.querySelector(s);return e?Math.round(e.getBoundingClientRect().left):null;};return {house:top('.rt-tb-toggle'),pair:top('.rt-tb-pair'),cleaner:top('.rt-tb-cleaner'),verb:top('.rt-tb-verb'),pairX:left('.rt-tb-pair'),cleanerX:left('.rt-tb-cleaner'),verbRight:Math.round(r.querySelector('.rt-tb-verb').getBoundingClientRect().right)};}));
for(const g of geo){for(const k of ['pair','cleaner','verb'])if(g[k]!==null)assert.ok(Math.abs(g[k]-g.house)<=3,`${k} sits on the house's line`);}
assert.equal(new Set(geo.map(g=>g.pairX)).size,1,'the pair column lines up down the board');
assert.equal(new Set(geo.filter(g=>g.cleanerX!==null).map(g=>g.cleanerX)).size,1,'the cleaner column lines up down the board');
pass('desktop: one line per house, columns aligned, no role="button" wrapper');

const sameDay=await text(sel('same_day_home'));
for(const words of ['Same day','Out 10:00 · In 4:00','Cleaner booked 10:30','Not walked','Start walk','Prep'])assert.ok(sameDay.includes(words),`the same-day line says "${words}"`);
assert.ok((await text(sel('lock_home'))).includes('Cleaning now'));
assert.ok((await text(sel('later_home'))).includes('Out 11:00 · In Thu 4:00'));
assert.ok((await text(sel('later_home'))).includes('Plan walk'));
const vacant=await text(sel('vacant_home'));
assert.ok(vacant.includes('Out 10:00 · Vacant')&&vacant.includes('No cleaner booked'));
assert.equal(await page.$$eval(sel('vacant_home')+' .rt-tb-verb *',es=>es.length),0,'a checkout with nobody behind it has no verb');
assert.ok((await text(sel('walked_home'))).includes('Summary'));
assert.equal(await page.$eval(sel('field_home')+' .rt-tb-walk a',a=>a.textContent+' '+a.getAttribute('href')),'Field · Alex Synthetic /fieldwork/packets/packet-1','a Field walk names who has it and links the packet');
assert.equal(await page.$$eval(sel('field_home')+' .rt-tb-verb *',es=>es.length),0,'a live packet holds back Start');
assert.ok(await page.$('#out-same_day_home-'+TODAY),'the schedule anchor exists on the paired row');
assert.equal((await text(sel('same_day_home'))).includes('Arriving Synthetic'),false,'names wait for the opened row');
pass('each line prints the pair, the cleaner, the walk and one verb in the model\'s words');

await clickText(sel('same_day_home')+' .rt-tb-verb','Start walk');await waitCalls(1);
assert.deepEqual((await calls())[0],{kind:'start',args:{property_id:'same_day_home'}});
assert.equal(await expanded('same_day_home'),'false','the verb is a sibling: it does not toggle the row');
await finish(0,undefined);
pass('Start walk posts the house and leaves the row closed');

await toggle('same_day_home');
assert.equal(await expanded('same_day_home'),'true');
const controls=await page.$eval(sel('same_day_home')+' .rt-tb-toggle',e=>e.getAttribute('aria-controls'));
assert.ok(controls&&await page.$('#'+controls),'aria-controls names the opened region');
const opened=await text('#'+controls);
for(const words of ['Leaving','Leaving Synthetic','Arriving','Arriving Synthetic','Out','Cleaned','Walked','Mark ready','Set up the pack-n-play','Checkout schedule'])assert.ok(opened.includes(words),`the opened row says "${words}"`);
assert.equal(await page.$eval('#'+controls+' a[href^="/turnovers/schedule"]',a=>a.getAttribute('href')),'/turnovers/schedule#stay-same_day_home-2026-10-14','the opened row links to its checkout on the schedule');
assert.doesNotMatch(opened,/smart lock|Cleaner in|Guest-ready/,'a lockless home shows three steps and no apology');
pass('a lockless home opens to Out · Cleaned · Walked with who leaves and who arrives');

await clickText('#'+controls,'Mark cleaned');await clickText('#'+controls,'Confirm');await waitCalls(2);
assert.deepEqual((await calls())[1],{kind:'cleaned',args:{propertyId:'same_day_home',checkoutDate:TODAY}});
await finish(1,{ok:false,message:'Synthetic refusal'});await page.waitForFunction(()=>document.body.innerText.includes('Synthetic refusal'));
await clickText('#'+controls,'Retry');await waitCalls(3);await finish(2,{ok:true});
await page.waitForFunction(c=>[...document.querySelectorAll('#'+c+' button')].some(b=>b.textContent.trim()==='Mark cleaned'),{},controls);
pass('Mark cleaned takes two taps, prints a refusal, and retries the same clean');

await toggle('lock_home');
const rail=await text(sel('lock_home')+' .rt-tb-exp');
for(const words of ['Checked out','Cleaner in','Cleaning','Cleaned','Walked','Guest-ready'])assert.ok(rail.includes(words),`the lock home's rail has "${words}"`);
pass('a lock-monitored home opens to the six-stage rail');

await page.focus(sel('vacant_home')+' .rt-tb-toggle');await page.keyboard.press('Enter');
assert.equal(await expanded('vacant_home'),'true','Enter opens');
const steps=await page.$$eval(sel('vacant_home')+' .rt-tb-steps li .rt-tb-steplabel',es=>es.map(e=>e.textContent));
assert.deepEqual(steps,['Out','Cleaned'],'no walk without an arrival');
await page.keyboard.press('Space');assert.equal(await expanded('vacant_home'),'false','Space closes');
pass('the toggle is a keyboard button; a vacant checkout opens to Out and Cleaned only');

await clickText(sel('later_home')+' .rt-tb-verb','Plan walk');await page.waitForSelector('[role="dialog"]');
pass('Plan walk opens the walk planner');

// ── phone ──
await load(375,812);
const phone=await page.$$eval('.rt-tb-row',rs=>rs.map(r=>{const b=s=>{const e=r.querySelector(s);return e?e.getBoundingClientRect():null;};const t=b('.rt-tb-toggle'),f=b('.rt-tb-pair'),v=r.querySelector('.rt-tb-verb button, .rt-tb-verb a'),l=r.querySelector('.rt-tb-facts a');return {toggleBottom:t.bottom,toggleH:t.height,factsTop:f.top,verbH:v?v.getBoundingClientRect().height:null,linkH:l?l.getBoundingClientRect().height:null};}));
for(const p of phone){
 assert.ok(p.factsTop>=p.toggleBottom-1,'the facts wrap to a second line under the house');
 assert.ok(p.toggleH>=44,'the toggle is a 44px target');
 if(p.verbH!==null)assert.ok(p.verbH>=44,'the verb is a 44px target');
 if(p.linkH!==null)assert.ok(p.linkH>=44,'a link in the facts line is a 44px target');
}
assert.ok(phone.some(p=>p.linkH!==null),'the fixture has a Field link to measure');
assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no sideways scroll on a phone');
await toggle('lock_home');
assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'the opened rail fits a phone');
pass('phone: two lines per row, 44px targets, no sideways scroll, open or closed');

assert.deepEqual(errors,[]);console.log('All '+checks+' turnover board browser checks passed.');
}catch(error){if(page)console.error('Synthetic board state:',await page.evaluate(()=>({body:document.body.innerText,calls:window.calls?.map(({kind,args})=>({kind,args}))})),'page errors:',errors);throw error;}
finally{await browser?.close();await new Promise(r=>server.close(r));await rm(scratch,{recursive:true,force:true});}
