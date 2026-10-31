/** The week grid on Turnovers (VisitGrid): the real component and the real
 *  model (lib/visit-grid.ts), synthetic homes and guests, every server
 *  action captured instead of sent. Desktop and phone. Pass --shots <dir>
 *  to keep screenshots. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import {gridDays,GRID_DAYS} from '../src/lib/visit-grid.ts';
const require=createRequire(import.meta.url),{webpack}=require('next/dist/compiled/webpack/webpack');
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-visit-grid-'));
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,verbatimModuleSyntax:false}}).outputText;
const shotsDir=process.argv.includes('--shots')?process.argv[process.argv.indexOf('--shots')+1]:null;

// ── the week, on a fixed clock: Sunday 2026-10-18 ──
const TODAY='2026-10-18',DAYS=gridDays(TODAY,GRID_DAYS);
const ME='delaney@risingtidestr.com',DOTTI='dotti@risingtidestr.com';
const home=(id,name,occ)=>({id,name,cells:gridDays('2026-10-10',30).map(date=>{const pm=occ.find(o=>o.in<=date&&date<o.out)??null,am=occ.find(o=>o.in<date&&date<=o.out)??null,to=o=>o?{stayId:o.id,kind:o.kind??'guest'}:null;return {date,am:to(am),pm:to(pm)};})});
const stay=o=>({checkOut:'2026-11-01',guest:'Synthetic Guest',channel:null,plan:null,walk:'open',walkedOn:null,walkedBy:null,field:null,...o});
const homes=[
 home('21_horton','21 Horton',[{id:'A',in:'2026-10-16',out:'2026-10-19'},{id:'B',in:'2026-10-21',out:'2026-10-24'},{id:'blk',in:'2026-10-26',out:'2026-10-28',kind:'block'}]),
 home('3_south','3 South',[{id:'C',in:'2026-10-20',out:'2026-10-23'}]),
 home('20_enon','20 Enon',[{id:'D',in:'2026-10-19',out:'2026-10-22'}]),
 home('30_woodward','30 Woodward',[{id:'E',in:'2026-10-19',out:'2026-10-25'}]),
 home('19_rackliffe','19 Rackliffe',[{id:'F',in:'2026-10-20',out:'2026-10-27'}]),
 home('53_rocky_neck_2','53 Rocky Neck, Downstairs',[{id:'G',in:'2026-10-18',out:'2026-10-18'},{id:'G2',in:'2026-10-18',out:'2026-10-21'}]),
 home('73_rocky_neck','73 Rocky Neck',[{id:'H',in:'2026-10-15',out:'2026-10-19'}]),
 home('17_beach','17 Beach',[]),
];
const stays=[
 stay({reservationId:'B',propertyId:'21_horton',checkIn:'2026-10-21',checkOut:'2026-10-24',channel:'airbnb',plan:{id:'p1',date:'2026-10-20',assignee:ME,plannedBy:DOTTI,hasNotes:false}}),
 stay({reservationId:'C',propertyId:'3_south',checkIn:'2026-10-20',checkOut:'2026-10-23',channel:'vrbo'}),
 stay({reservationId:'D',propertyId:'20_enon',checkIn:'2026-10-19',checkOut:'2026-10-22',channel:'booking_com',field:{status:'claimed',contractor:'James Liddell',visitDate:'2026-10-18'}}),
 stay({reservationId:'E',propertyId:'30_woodward',checkIn:'2026-10-19',checkOut:'2026-10-25',channel:'airbnb',walk:'done',walkedOn:'2026-10-18',walkedBy:DOTTI}),
 stay({reservationId:'F',propertyId:'19_rackliffe',checkIn:'2026-10-20',checkOut:'2026-10-27',channel:'manual',plan:{id:'p2',date:'2026-10-16',assignee:DOTTI,plannedBy:DOTTI,hasNotes:false}}),
 stay({reservationId:'G2',propertyId:'53_rocky_neck_2',checkIn:'2026-10-18',checkOut:'2026-10-21',channel:'direct'}),
];

// ── the fixture page ──
for(const [name,path] of [
 ['grid','src/app/turnovers/VisitGrid.tsx'],['model','src/lib/visit-grid.ts'],['team','src/lib/team.ts'],['channel-style','src/lib/channel-style.ts'],
 ['confirm','src/components/ConfirmDialog.tsx'],['confirmq','src/lib/confirm-question.ts'],['button-class','src/lib/button-class.ts'],
])await writeFile(join(scratch,name+'.js'),compile(await readFile(join(root,path),'utf8')));
await writeFile(join(scratch,'actions.js'),`
export const save=(kind,args)=>new Promise((resolve,reject)=>window.calls.push({kind,args,resolve,reject}));
export const claimWalk=a=>save('claim',a),releaseWalk=(id,opts)=>save('release',{id,opts});
`);
await writeFile(join(scratch,'refresh.js'),'export const useSoftRefresh=()=>()=>{window.refreshes++;};');
// GridPlan carries hasNotes; the fixture's plans have none.
await writeFile(join(scratch,'data.js'),'export const homes='+JSON.stringify(homes)+';export const stays='+JSON.stringify(stays)+';export const today='+JSON.stringify(TODAY)+';export const days='+JSON.stringify(DAYS)+';');
await writeFile(join(scratch,'entry.js'),compile(`
import React from 'react';import {createRoot} from 'react-dom/client';
import {VisitGrid} from './grid.js';import {homes,stays,today,days} from './data.js';
window.calls=[];window.refreshes=0;window.confirm=()=>true;
const as=new URLSearchParams(location.search).get('as')==='dotti';
createRoot(document.getElementById('root')).render(<section id="board"><VisitGrid today={today} days={days} homes={homes} stays={stays} myEmail={as?${JSON.stringify(DOTTI)}:${JSON.stringify(ME)}} dispatcher={as}/></section>);
`));
const alias={'./plan-actions':'actions','@/lib/use-soft-refresh':'refresh','@/lib/team':'team','@/lib/visit-grid':'model','@/lib/channel-style':'channel-style','@/components/ConfirmDialog':'confirm','@/lib/confirm-question':'confirmq','@/lib/button-class':'button-class'};
await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},resolve:{modules:[join(root,'node_modules')],alias:Object.fromEntries(Object.entries(alias).map(([k,v])=>[k,join(scratch,v+'.js')]))},performance:{hints:false}});compiler.run((err,stats)=>compiler.close(()=>err||stats?.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));});
if(process.argv.includes('--compile-only')){console.log('Week grid fixture compiled.');await rm(scratch,{recursive:true,force:true});process.exit(0);}

// The grid's own rules from globals.css, so the layout under test is the real one.
const css=await readFile(join(root,'src/app/globals.css'),'utf8');
const gridCss=css.slice(css.indexOf('/* ─── The week grid on Turnovers (VisitGrid)'));
assert.ok(gridCss.includes('.rt-vg-cell'),'the grid rules were found in globals.css');
const html='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic week grid</title><style>:root{--ink:#0b2545;--ink-2:#18375c;--ink-3:#51677d;--ink-4:#8ba0b4;--paper:#f5efe2;--paper-2:#efe6d2;--rule:#ddcfb2;--rule-soft:#ece2cc;--tide:#4e7c9e;--tide-deep:#1c4a6b;--signal:#946d2e;--positive:#3a6b4a;--negative:#8a3a2e}*{box-sizing:border-box}body{margin:0;font:14px system-ui;background:var(--paper);color:var(--ink)}#board{max-width:1020px;margin:0 auto;padding:16px}@media (max-width:640px){#board{padding:16px}}'+gridCss+'</style><div id="root"></div><script src="/bundle.js"></script>';
const server=createServer(async(req,res)=>{if(req.method!=='GET'){res.writeHead(405).end();return;}res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'");if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(await readFile(join(scratch,'bundle.js')));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;let browser,page,checks=0;const errors=[];
try{
browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':await chromium.executablePath()),headless:true,args:process.platform==='darwin'?['--no-sandbox']:chromium.args});
page=await browser.newPage();page.setDefaultTimeout(10000);
page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin+'/')?r.continue():r.abort());
const load=async(width,height=900,path='/')=>{await page.setViewport({width,height,deviceScaleFactor:2});await page.goto(origin+path);await page.waitForSelector('.rt-vg-cell');};
const shot=async name=>{if(!shotsDir)return;await mkdir(shotsDir,{recursive:true});await page.screenshot({path:join(shotsDir,name+'.png'),fullPage:true});};
const calls=()=>page.evaluate(()=>window.calls.map(({kind,args})=>({kind,args})));
const waitCalls=n=>page.waitForFunction(n=>window.calls.length===n,{},n);
const finish=(i,result)=>page.evaluate((i,result)=>window.calls[i].resolve(result),i,result);
const pass=m=>{checks++;console.log('PASS '+m);};
/** The cell button for a home on a day, by its accessible sentence. */
const cellSel=(name,day)=>`.rt-vg-cell[aria-label^="${name} · ${day}"]`;
const marks=(name,day)=>page.$$eval(cellSel(name,day)+' .rt-vg-mark',es=>es.map(e=>e.textContent+':'+e.dataset.kind+(e.dataset.mine!=null?':mine':'')+(e.dataset.late!=null?':late':'')));
const has=(name,day,a)=>page.$eval(cellSel(name,day),(e,a)=>e.hasAttribute(a),a);

// ── desktop ──
await load(1250);
assert.equal(await page.$$eval('.rt-vg-head',es=>es.length),14,'fourteen day columns');
// innerText, not textContent: the today column carries both words and the CSS shows one.
assert.equal(await page.$eval('.rt-vg-head .rt-vg-dow',e=>e.innerText),'TODAY','the wide column says Today');
const names=await page.$$eval('.rt-vg-name .rt-vg-nm',es=>es.map(e=>e.textContent));
assert.deepEqual(names,['53 Rocky Neck, Downstairs','20 Enon','30 Woodward','19 Rackliffe','3 South','21 Horton'],'the week in the order it happens; 17 Beach has nothing on, 73 Rocky Neck only a checkout');
assert.deepEqual(await marks('21 Horton','Tue, Oct 20'),['DJ:plan:mine'],'my planned walk wears my initials');
assert.deepEqual(await marks('20 Enon','Sun, Oct 18'),['JL:field'],'a Field packet wears the contractor');
assert.deepEqual(await marks('30 Woodward','Sun, Oct 18'),['DM:walked'],'a walked house wears the walker');
assert.deepEqual(await marks('19 Rackliffe','Sun, Oct 18'),['DM:plan:late'],'a missed day carries to today, late');
assert.equal(await has('3 South','Mon, Oct 19','data-needs'),true,'an open day before an unplanned arrival is green');
assert.equal(await has('21 Horton','Sun, Oct 18','disabled'),true,'a full house cannot be tapped');
assert.equal(await has('21 Horton','Tue, Oct 27','disabled'),true,"an owner's hold cannot be tapped");
assert.equal(await page.$$eval('.rt-vg-cell[data-needs]',es=>es.length),7,'seven open days need someone (3 South x3, 19 Rackliffe x3, the same-day flip at 53 Rocky Neck)');
assert.deepEqual(await page.$$eval('.rt-vg-ch',es=>es.map(e=>e.dataset.channel).sort()),['airbnb','airbnb','booking_com','direct','manual','vrbo'],'one channel dot per arrival, on its arrival day');
assert.match(await page.$eval(cellSel('3 South','Tue, Oct 20'),e=>e.getAttribute('aria-label')),/VRBO guest arrives/,'the arrival day names the channel');
await shot('desktop');
pass('desktop: fourteen days, the right homes in the right order, every mark in the model\'s words');

// A tap claims the day, and the mark shows before the server answers.
await page.click(cellSel('3 South','Mon, Oct 19'));await waitCalls(1);
assert.deepEqual((await calls())[0],{kind:'claim',args:{reservationId:'C',propertyId:'3_south',checkIn:'2026-10-20',checkOut:'2026-10-23',date:'2026-10-19'}});
assert.deepEqual(await marks('3 South','Mon, Oct 19'),['DJ:plan:mine'],'the mark is there at once');
assert.equal(await has('3 South','Mon, Oct 19','data-pending'),true,'and reads as not yet confirmed');
assert.equal(await has('3 South','Sun, Oct 18','data-needs'),false,'the other open days stop asking');
await finish(0,{ok:true,id:'new-1'});
await page.waitForFunction(s=>!document.querySelector(s).hasAttribute('data-pending'),{},cellSel('3 South','Mon, Oct 19'));
assert.equal(await page.evaluate(()=>window.refreshes),0,'the action\'s own revalidation is the refresh; no second render');
pass('a tap on an open day plans the walk for me, at once');

// A second tap on my mark lets it go.
await page.click(cellSel('3 South','Mon, Oct 19'));await waitCalls(2);
assert.deepEqual((await calls())[1],{kind:'release',args:{id:'new-1'}});
assert.deepEqual(await marks('3 South','Mon, Oct 19'),[],'my own tap undone: the mark is gone at once');
await finish(1,{ok:true,kept:false});
pass('a tap on my own mark releases the walk');

// A tap on another day moves my plan there.
await page.click(cellSel('21 Horton','Mon, Oct 19'));await waitCalls(3);
assert.equal((await calls())[2].args.date,'2026-10-19');
assert.deepEqual(await marks('21 Horton','Mon, Oct 19'),['DJ:plan:mine']);
assert.deepEqual(await marks('21 Horton','Tue, Oct 20'),[],'the mark moved');
await finish(2,{ok:true,id:'p1'});
pass('a tap on another open day moves my walk');

// Someone else's mark asks first (the fixture answers the first choice: take it).
await page.click(cellSel('19 Rackliffe','Sun, Oct 18'));await waitCalls(4);
assert.deepEqual((await calls())[3].args,{reservationId:'F',propertyId:'19_rackliffe',checkIn:'2026-10-20',checkOut:'2026-10-27',date:'2026-10-18'});
assert.deepEqual(await marks('19 Rackliffe','Sun, Oct 18'),['DJ:plan:mine'],'taken over');
await finish(3,{ok:true,id:'p2'});
pass("someone else's walk asks, then changes hands");

// A refused write puts the mark back and says why.
await page.click(cellSel('3 South','Tue, Oct 20'));await waitCalls(5);
await finish(4,{ok:false,error:'Synthetic refusal'});
await page.waitForSelector('[role="alert"]');
assert.ok((await page.$eval('[role="alert"]',e=>e.textContent)).includes('Synthetic refusal'));
assert.deepEqual(await marks('3 South','Tue, Oct 20'),[],'the mark is withdrawn');
pass('a refused tap withdraws the mark and shows the reason');

// ── the dispatcher: a row above the grid says whom a tap plans for ──
assert.equal(await page.$('.rt-vg-for'),null,'nobody else sees the Planning for row');
await load(1250,900,'/?as=dotti');
assert.deepEqual(await page.$$eval('.rt-vg-for-pick',es=>es.map(e=>e.textContent)),['DMMe','RFRyan','AOAllie','DJDelaney'],'me first, then the roster');
assert.deepEqual(await marks('19 Rackliffe','Sun, Oct 18'),['DM:plan:mine:late'],'planning for myself, my late walk is mine');
await (await page.$$('.rt-vg-for-pick'))[3].click();
assert.equal(await page.$eval('.rt-vg-for-pick[data-on]',e=>e.textContent),'DJDelaney');
assert.deepEqual(await marks('21 Horton','Tue, Oct 20'),['DJ:plan:mine'],"planning for Delaney, her walk reads as the active one");
await page.click(cellSel('3 South','Mon, Oct 19'));await waitCalls(1);
assert.deepEqual((await calls())[0],{kind:'claim',args:{reservationId:'C',propertyId:'3_south',checkIn:'2026-10-20',checkOut:'2026-10-23',date:'2026-10-19',forEmail:ME}},'the tap names Delaney');
assert.deepEqual(await marks('3 South','Mon, Oct 19'),['DJ:plan:mine'],'and her mark shows at once');
await finish(0,{ok:true,id:'new-2'});
await shot('dispatcher');
pass('the dispatcher picks a teammate and a tap plans the walk for her');

// ── phone ──
await load(390,844);
const fit=await page.evaluate(()=>{const scroll=document.querySelector('.rt-vg-scroll');const heads=[...document.querySelectorAll('.rt-vg-head')];const r=i=>heads[i].getBoundingClientRect();return {viewport:scroll.clientWidth,seventhRight:Math.round(r(6).right-scroll.getBoundingClientRect().left),eighthRight:Math.round(r(7).right-scroll.getBoundingClientRect().left),cell:Math.round(r(0).width),rowH:Math.round(document.querySelector('.rt-vg-cell').getBoundingClientRect().height)};});
assert.ok(fit.seventhRight<=fit.viewport,`a week fits without scrolling (${fit.seventhRight} <= ${fit.viewport})`);
assert.ok(fit.eighthRight>fit.viewport,'the second week is a swipe away');
assert.ok(fit.rowH>=44,`rows are thumb height (${fit.rowH})`);
assert.equal(await page.$eval('.rt-vg-head[data-today] .rt-vg-dow',e=>e.innerText),'SUN','the narrow column shows the weekday in the today accent');
await page.evaluate(()=>{document.querySelector('.rt-vg-scroll').scrollLeft=200;});
const stuck=await page.evaluate(()=>{const s=document.querySelector('.rt-vg-scroll').getBoundingClientRect();const n=document.querySelector('.rt-vg-name').getBoundingClientRect();return Math.round(n.left-s.left);});
assert.ok(stuck<=1,'the home names stay put while the days scroll');
await page.evaluate(()=>{document.querySelector('.rt-vg-scroll').scrollLeft=0;});
await shot('phone');
pass(`phone: a week on one screen (${fit.cell}px days), names pinned, second week a swipe away`);

assert.deepEqual(errors,[],'no page errors');
console.log(`Week grid smoke: ${checks} checks passed.`);
}finally{await browser?.close();server.close();await rm(scratch,{recursive:true,force:true});}
