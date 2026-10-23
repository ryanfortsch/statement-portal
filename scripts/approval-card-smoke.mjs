/**
 * The one approval card, driven in a real browser: the real queue components
 * with synthetic cards, every server action replaced by a recorder, and every
 * remote request blocked. Proves each verb calls what it says, Also on
 * approve gates a slip with no property, an open edit is saved before it
 * sends, Mark handled leaves an Undo, the Refresh control says when the
 * feed failed or the browser is offline (and nothing while it is healthy),
 * and the card fits a phone.
 *
 * Run: node scripts/approval-card-smoke.mjs   (--compile-only to just bundle)
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
const require=createRequire(import.meta.url),{webpack}=require('next/dist/compiled/webpack/webpack');
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-approval-card-'));

// TypeScript straight from src, through a loader that only strips types.
await writeFile(join(scratch,'ts-loader.cjs'),`const ts=require(${JSON.stringify(require.resolve('typescript'))});
module.exports=function(src){return ts.transpileModule(src,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
// Every server action becomes a recorder the test resolves by hand.
await writeFile(join(scratch,'actions.js'),`
const rec=kind=>(...args)=>new Promise(resolve=>window.calls.push({kind,args,resolve}));
export const approveContractorDraft=rec('approve'),markContractorHandled=rec('handled'),undoContractorDecision=rec('undo-contractor'),
coachContractorDraft=rec('coach'),editContractorDraft=rec('edit'),redraftContractorDraft=rec('redraft'),
scheduleContractorDraft=rec('schedule'),cancelContractorSchedule=rec('cancel');
export const approveCleanerDraft=rec('approve'),markCleanerHandled=rec('handled'),undoCleanerDecision=rec('undo-cleaner'),
coachCleanerDraft=rec('coach'),editCleanerDraft=rec('edit'),redraftCleanerDraft=rec('redraft'),
scheduleCleanerDraft=rec('schedule'),cancelCleanerSchedule=rec('cancel');
export const approveOwnerDraft=rec('approve'),markOwnerHandled=rec('handled'),undoOwnerDecision=rec('undo'),
coachOwnerDraft=rec('coach'),editOwnerDraft=rec('edit'),redraftOwnerDraft=rec('redraft'),
scheduleOwnerDraft=rec('schedule'),cancelOwnerSchedule=rec('cancel');
export const approveDraft=rec('approve'),markHandled=rec('handled'),undoDecision=rec('undo'),coachDraft=rec('coach'),
editDraft=rec('edit'),redraftDraft=rec('redraft'),scheduleDraft=rec('schedule'),cancelSchedule=rec('cancel'),dismissMaintenanceSlip=rec('dismiss');
export const releaseHeldPitch=rec('release');
export const approveVendorVisitAction=rec('approve-vendor-visit'),editVendorVisitAction=rec('edit-vendor-visit'),
markVendorVisitHandledAction=rec('handled'),undoVendorVisitAction=rec('undo-vendor-visit');`);
await writeFile(join(scratch,'role.js'),`export const useHelmRole=()=>window.role||'owner';`);
// version-skew reads process.env, which only Next defines; the card's Button watchdog imports it.
await writeFile(join(scratch,'skew.js'),'export const reloadedForNewDeployment=()=>Promise.resolve(false);');
await writeFile(join(scratch,'thread.js'),`import React from 'react';export function ThreadPanel(){return React.createElement('div',{id:'thread'},'Synthetic thread');}`);
await writeFile(join(scratch,'navigation.js'),`export const useRouter=()=>({refresh(){window.refreshes=(window.refreshes||0)+1;}});`);
await writeFile(join(scratch,'link.js'),`import React from 'react';export default function Link({href,children,...p}){return React.createElement('a',{href,...p},children);}`);
await writeFile(join(scratch,'entry.tsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import {TeamInboxQueue} from '@/app/messaging/team/TeamInboxQueue';
import {OwnerMessagingQueue} from '@/app/owner-messaging/OwnerMessagingQueue';
import {MessagingQueue} from '@/app/messaging/MessagingQueue';
const mode=new URLSearchParams(location.search).get('mode')||'contractor';
window.calls=[];
const now=new Date().toISOString();
const base={short_id:'syn',channel:'sms_quo',contractor_contact:'+15550100',external_thread_id:'',external_message_id:'',final_response:'',created_at:now,resolved_at:null,send_at:'',outcomes:{work:[],notes:[],error:''}};
const cards=[
 {...base,id:'slip-card',contractor_name:'Sam Field',property_id:'',property_name:'',contractor_text:'Done at the cottage. The dryer vent is loose.',draft:'Thanks Sam, I will get the vent on a slip.',topic:'report',status:'pending',age_minutes:12,proposed_slip:{title:'Dryer vent loose',category:'maintenance',priority:'normal',note:'Vent hood came off the wall.'}},
 {...base,id:'plain-card',contractor_name:'Lee Trade',property_id:'',property_name:'',contractor_text:'Can I come at 9 tomorrow?',draft:'9 works, thank you.',topic:'schedule',status:'pending',age_minutes:300,proposed_slip:null},
 {...base,id:'queued-card',contractor_name:'Pat Paint',property_id:'',property_name:'',contractor_text:'Paint is dry.',draft:'Great, thanks Pat.',topic:'report',status:'scheduled',send_at:new Date(Date.now()+3600e3).toISOString(),age_minutes:40,proposed_slip:null},
];
const cleanerCards=[
 {...base,id:'pt-card',cleaner_name:'Rosa Synthetic',cleaner_contact:'+15550101',property_id:'home-a',property_name:'Synthetic Cottage',cleaner_text:'Acabei a casa, faltam toalhas.',cleaner_text_english:'I finished the house, towels are missing.',inbound_language:'pt',draft:'Obrigada Rosa! Vou levar toalhas amanhã.',draft_english:'Thank you Rosa! I will bring towels tomorrow.',topic:'done',status:'pending',age_minutes:5,proposed_slip:null},
];
const envelope={channel:'email',from_name:'Allie',from_address:'allie@example.test',mailbox:'',to:['owner@example.test'],cc:[],reply_to:'',from_reason:'addressed',preferred_from:'',subject:'Soap dispenser',original_known:true,also_outside:[],also_rising_tide:[]};
const ownerBase={...base,channel:'email_gmail',owner_contact:'owner@example.test',property_id:'home_a',property_name:'Synthetic Cottage',followup_status:{state:'done',enabled:1,error:''},envelope};
const ownerCards=[
 {...ownerBase,id:'owner-card',owner_name:'Olive Owner',owner_text:'The soap dispenser in the downstairs bath is peeling off the wall. Can someone fix it?',draft:'Hi Olive, thanks for flagging it. We will have it fixed this week.',topic:'maintenance',status:'pending',age_minutes:20,
  proposed_actions:[{key:'aaaaaaaaaaaa',kind:'work_slip',title:'Re-mount downstairs soap dispenser',priority:'normal'},{key:'bbbbbbbbbbbb',kind:'guest_message',why:'Tell the guest about the fix',body:'Someone will stop by to fix the soap dispenser.'}]},
 {...ownerBase,id:'reaction-card',owner_name:'Rae Owner',owner_text:'Loved “Thanks, all set”',draft:'',topic:'reaction',status:'pending',age_minutes:3,proposed_actions:[]},
];
const g={...base,conversation_id:'conv-1',listing_id:'home_a',listing_name:'Synthetic Cottage',reservation_id:'r1',guest_received_at:now,module:'airbnb2',channel:'Airbnb',check_in:'2026-10-20',check_out:'2026-10-24',topic:'question',status:'pending',age_minutes:30};
const guestCards=[
 {...g,id:'guest-card',guesty_message_id:'gm1',guest_first:'Gina',guest_text:'Can we bring our dog?',draft:'Hi Gina, yes, the pet fee is $75.',
  addon:{label:'pet fee',amount_usd:75,payment_link_url:'https://pay.example.test/x',link_error:'',sms_body:'Here is the pet fee link: https://pay.example.test/x',guest_phone:'+15550199'},
  handoff:{filed:false,audience:'cleaner',target_name:'Rosa',target_contact:'+15550101',reason:'a dog is coming',preview:'Vai ter um cachorro.',preview_english:'There will be a dog.',urgency:'soon',confidence:'high',create_error:'',preview_token:'tok'}},
 {...g,id:'pre-card',guesty_message_id:'gm2',guest_first:'Paula',guest_text:'Is July 2027 open?',draft:'Thanks Paula, we will confirm July shortly.',topic:'prerelease_request',module:'email',channel:'Email'},
 {...g,id:'manual-card',guesty_message_id:'trash-manual:x',guest_first:'Mo',guest_text:'',draft:'Trash goes out tonight.',topic:'trash_reminder',channel:'Direct'},
 {...g,id:'failed-card',guesty_message_id:'gm5',guest_first:'Fay',guest_text:'Is the hot tub on?',draft:'Yes, it is heated to 102.',send_attempts:5,last_send_error:'quo_error: 402 Payment Required',age_minutes:20},
 {...g,id:'stale-card',guesty_message_id:'gm6',guest_first:'Stu',guest_text:'Where is the beach key?',draft:'It is on the hook by the door.',age_minutes:5*60+10},
 {...g,id:'sms-card',guesty_message_id:'quo_sms:syn1',guest_first:'Sid',guest_text:'Can you text me the gate code?',draft:'Sure, it is on the way.',module:'',channel:'',sms_to:'+19785550134'},
 {...g,id:'relay-card',guesty_message_id:'relay_email:staycontact:syn:joel.arriving.first@example.test',guest_first:'Joel',guest_text:'Booker asked us to send the arrival details to Joel.',draft:'Hi Joel, here are the arrival details.',topic:'guest_relay_request',module:'',channel:'',guest_email:'joel.arriving.first@example.test'},
 {...g,id:'inq-card',guesty_message_id:'gm4',guest_first:'Ivy',guest_text:'Price for 4 nights?',draft:'',topic:'rental_inquiry',
  rental_inquiry:{check_in:'2026-11-01',check_out:'2026-11-05',guests:4,flexible:false,history_checked:true,checked_at:now,needs:[],decision:'Needs a price for 4 nights',homes:[]}},
];
const guestQuotes={'guest-card':{total:2,quotes:[{id:'q1',status:'sent',property_internal_name:'Synthetic Cottage',check_in:'2026-10-20',check_out:'2026-10-24',nights:4,total_cents:184000,leg_due:'',amount_due_cents:0,balance_due_on:'',guest_email:''}]}};
// One feed per audience, as /api/messaging/queue serves them.
window.queues={contractors:cards,cleaners:cleanerCards,owners:ownerCards,guests:guestCards};
window.queue=mode==='cleaner'?cleanerCards:mode==='owner'?ownerCards:mode==='guest'?guestCards:cards;
window.role=new URLSearchParams(location.search).get('role')||'owner';
const held=[{source_id:'abc123def456',held_at:Math.floor(Date.now()/1000)-3600,sender:'seo@example.test',subject:'Rank #1 on Google'}];
// Inside this template literal a regex escape needs its backslash doubled.
window.fetch=async url=>{const u=String(url);const aud=(u.match(/audience=(\\w+)/)||[])[1];
 // The test holds a feed read open (window.feedHold) or fails it (window.feedFails: true, or one audience).
 if(u.includes('/api/messaging/queue')){if(window.feedHold)await new Promise(r=>{window.releaseFeed=r;});
  if(window.feedFails===true||window.feedFails===aud)return new Response('{"error":"synthetic outage"}',{status:502,headers:{'Content-Type':'application/json'}});}
 const approvals=!u.includes('/api/messaging/queue')?null:mode==='vendor'?[]:mode==='team'||aud==='cleaners'||aud==='contractors'?window.queues[aud]:window.queue;
 return new Response(JSON.stringify(approvals?{approvals,context:aud==='guests'?guestQuotes:{}}:{}),{headers:{'Content-Type':'application/json'}});};
const homes=[{id:'home-a',name:'Synthetic Cottage'},{id:'home-b',name:'Synthetic Barn'}];
// Trade vendors' confirmed days (docs/vendor-visit-holds.md), Helm-native cards.
const vplan={holdNights:['2026-10-27'],alreadyHeld:[],guestNights:[],nightBefore:{date:'2026-10-26',offered:false,suggested:false},warnings:[],outsideOffer:false};
const vbase={status:'pending',stuck:false,vendorName:'Tom Synthetic Plumbing',tradeLabel:'Plumbing',tradeCategory:'plumbing',fromPhone:'+15550142',lineLabel:'Owners line',messageAt:now,createdAt:now,ageMinutes:4,
 property:{id:'home-a',name:'Synthetic Cottage',authority:'guesty'},propertyBasis:'offer',endTime:null,askReason:null,candidates:[],checkoutTime:'11:00',checkinTime:'16:00',planError:null,lastError:null,
 offer:{text:'Synthetic Cottage is open Mon 10/26 to Thu 10/29. Which day works?',at:now,windows:[{start:'2026-10-26',end:'2026-10-29'}]}};
const vendorCards=[
 {...vbase,id:'visit-card',messageBody:'Tuesday 10/27 at 1 works',start:'2026-10-27',end:'2026-10-27',startTime:'13:00',timeLabel:'at 1 PM',dateBasis:'named in the text',plan:vplan,
  slips:[{id:'slip-1',title:'Upstairs toilets run',lane:'pro',matchesTrade:true,ticked:true,note:null},{id:'slip-2',title:'Shower valve drips',lane:'handyman',matchesTrade:true,ticked:false,note:null}]},
 {...vbase,id:'ask-card',messageBody:'Tuesday works',start:null,end:null,startTime:null,timeLabel:null,dateBasis:null,askReason:'"Tuesday" could be more than one Tuesday you offered',candidates:['2026-10-20','2026-10-27'],plan:null,slips:[]},
 {...vbase,id:'warn-card',vendorName:'Wes Synthetic Electric',tradeLabel:'Electrical',lineLabel:'24/7 line',messageBody:'Wednesday 10/28 at 10 works',start:'2026-10-28',end:'2026-10-28',startTime:'10:00',timeLabel:'at 10 AM',dateBasis:'named in the text',
  plan:{...vplan,holdNights:[],guestNights:['2026-10-28'],warnings:['A guest arrives Wed Oct 28 at 4 PM: Wes Synthetic Electric has to be done before then.']},slips:[]},
];
const teamAudience=new URLSearchParams(location.search).get('audience')||(mode==='cleaner'?'cleaners':mode==='contractor'?'contractors':'all');
createRoot(document.getElementById('root')).render(<main id={mode}>{mode==='owner'?<OwnerMessagingQueue initialPending={ownerCards}/>:mode==='guest'?<MessagingQueue initialPending={guestCards} initialQuotes={guestQuotes} held={held}/>:<TeamInboxQueue initialCleaners={mode==='contractor'||mode==='vendor'?[]:cleanerCards} initialContractors={mode==='cleaner'||mode==='vendor'?[]:cards} contractorContext={{}} properties={homes} audience={teamAudience} vendorVisits={mode==='vendor'?vendorCards:[]}/>}</main>);
`);
const alias={'@/lib/version-skew':join(scratch,'skew.js'),'./inbox-health-actions':join(scratch,'actions.js'),'./vendor-visit-actions':join(scratch,'actions.js'),'@/app/cleaner-messaging/actions':join(scratch,'actions.js'),'@/app/contractor-messaging/actions':join(scratch,'actions.js'),'@/components/useHelmRole':join(scratch,'role.js'),'./Thread':join(scratch,'thread.js'),'@':join(root,'src'),'./actions':join(scratch,'actions.js'),'next/navigation':join(scratch,'navigation.js'),'next/link':join(scratch,'link.js')};
await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.tsx'),output:{path:scratch,filename:'bundle.js'},
 resolve:{extensions:['.tsx','.ts','.js'],modules:[join(root,'node_modules')],alias},
 module:{rules:[{test:/\.tsx?$/,use:join(scratch,'ts-loader.cjs')}]},performance:{hints:false}});
 compiler.run((err,stats)=>compiler.close(()=>err||stats?.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));});
if(process.argv.includes('--compile-only')){console.log('Approval card fixture compiled.');await rm(scratch,{recursive:true,force:true});process.exit(0);}

const css=`*{box-sizing:border-box}body{margin:0;background:#f5f0e4;color:#102b46;font:14px Arial,sans-serif;--paper:#f5f0e4;--paper-2:#efe6cf;--paper-3:#e9dfc4;--ink:#102b46;--ink-1:#102b46;--ink-2:#214263;--ink-3:#59718a;--ink-4:#788ca0;--rule:#d9cda9;--rule-soft:#e3dac4;--signal:#a44e40}.eyebrow{font-size:10px;letter-spacing:.15em;text-transform:uppercase}.font-serif{font-family:Georgia,serif}main{max-width:1100px;margin:20px auto}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}`

 // The real stylesheet: the browser skips the Tailwind at-rules it does not know.
 + (await readFile(join(root,'src/app/globals.css'),'utf8'));
const server=createServer(async(req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(join(scratch,'bundle.js')));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Approval card, synthetic</title><style>'+css+'</style><div id="root"></div><script src="/bundle.js"></script>');}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;let browser,checks=0;
const pass=m=>{checks++;console.log('PASS '+m);};
try{
 browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':await chromium.executablePath()),headless:true,args:process.platform==='darwin'?['--no-sandbox']:chromium.args});
 const page=await browser.newPage();page.setDefaultTimeout(10000);await page.setViewport({width:1280,height:1000});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin+'/')?r.continue():r.abort());
 await page.goto(origin);await page.waitForSelector('#approval-slip-card');
 const card=id=>'#approval-'+id;
 const text=sel=>page.$eval(sel,e=>e.textContent.replace(/\s+/g,' '));
 const click=(sel,label)=>page.$$eval(sel+' button',(bs,label)=>{const b=bs.filter(b=>b.checkVisibility()).find(b=>b.textContent.trim()===label||b.getAttribute('aria-label')===label);if(!b)throw Error('Missing button '+label);b.click();},label);
 const enabled=(sel,label)=>page.$$eval(sel+' button',(bs,label)=>{const b=bs.find(b=>b.textContent.trim()===label);return !!b&&!b.disabled;},label);
 const calls=()=>page.evaluate(()=>window.calls.map(c=>({kind:c.kind,args:c.args})));
 const finish=(i,result={ok:true})=>page.evaluate((i,result)=>window.calls[i].resolve(result),i,result);
 const waitCalls=n=>page.waitForFunction(n=>window.calls.length===n,{},n);
 const type=(sel,value)=>page.$eval(sel,(e,value)=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));},value);

 assert.match(await text('#needs-review h2'),/Needs review \(2\)/);
 for(const verb of ['Approve & send','Edit','Coach the AI','Redraft','Mark handled'])assert.ok((await text(card('plain-card'))).includes(verb),verb);
 pass('every verb on the card: Approve & send, Edit, Coach the AI, Redraft, Mark handled');

 const slipText=await text(card('slip-card'));
 assert.match(slipText,/Also on approve/);assert.match(slipText,/Files work slip “Dryer vent loose”/);assert.match(slipText,/Select property/);
 assert.match(slipText,/Pick a property for the work slip, or untick it\./);assert.equal(await enabled(card('slip-card'),'Approve & send'),false);
 pass('a slip with no property opens its line and blocks approve');
 await page.select(card('slip-card')+' select','home-b');
 assert.match(await text(card('slip-card')),/Files work slip “Dryer vent loose” at Synthetic Barn/);
 await click(card('slip-card'),'Approve & send');await waitCalls(1);
 assert.deepEqual((await calls())[0],{kind:'approve',args:['slip-card',{fileSlip:true,slipPropertyId:'home-b'}]});
 await finish(0);pass('picking a home names it on the line and approve carries the choice');

 await click(card('plain-card'),'Edit');await page.waitForSelector(card('plain-card')+' textarea');
 assert.match(await text(card('plain-card')),/Edit changes this reply only\.\s*Coach rewrites it and teaches the AI\./);
 await type(card('plain-card')+' textarea','9 works. The side door is open.');
 assert.ok((await text(card('plain-card'))).includes('Save & send'));
 await click(card('plain-card'),'Save & send');await waitCalls(2);
 assert.deepEqual((await calls())[1],{kind:'edit',args:['plain-card','9 works. The side door is open.']});
 await finish(1);await waitCalls(3);assert.deepEqual((await calls())[2],{kind:'approve',args:['plain-card',null]});
 await finish(2,{ok:false,error:'Quo refused the number'});await page.waitForFunction(()=>document.body.innerText.includes('Quo refused the number'));
 assert.match(await text(card('plain-card')),/9 works\. The side door is open\./);
 pass('an open, changed edit is saved and then sent; a failed send keeps the saved words and says why');

 await click(card('plain-card'),'Mark handled');await page.waitForSelector(card('plain-card')+' [aria-label="Mark handled"]');
 for(const r of ['Already answered','They said thanks','Not worth a reply'])assert.ok((await text(card('plain-card'))).includes(r),r);
 await click(card('plain-card'),'Already answered');await waitCalls(4);
 assert.deepEqual((await calls())[3],{kind:'handled',args:['plain-card',{reason:'Already answered'}]});
 await page.evaluate(()=>{window.queues.contractors=window.queues.contractors.filter(c=>c.id!=='plain-card');});
 await finish(3);await page.waitForSelector('.rt-undo-toast');
 assert.match(await text('.rt-undo-toast'),/Handled · Lee Trade/);
 await page.$$eval('.rt-undo-toast button',bs=>bs.find(b=>b.textContent==='Undo').click());await waitCalls(5);
 assert.deepEqual((await calls())[4],{kind:'undo-contractor',args:['plain-card']});await finish(4);
 await page.waitForFunction(()=>document.body.innerText.includes('Back in the queue.'));
 pass('Mark handled is a reason in one tap, then a toast whose Undo calls the audience undo');

 await click(card('queued-card'),'Show ▾');await page.waitForFunction(()=>document.body.textContent.includes('Cancel send to edit or coach'));
 assert.ok((await text(card('queued-card'))).includes('Send now'));pass('a queued card folds to a row and opens to Send now / Cancel send');

 await page.screenshot({path:join(process.env.SMOKE_SHOTS||tmpdir(),'approval-card-desktop.png'),fullPage:true});

 // Cleaners: Portuguese with the English under each side, Edit on the Portuguese.
 await page.evaluate(()=>{window.calls=[];});await page.goto(origin+'/?mode=cleaner');await page.waitForSelector(card('pt-card'));
 const pt=await text(card('pt-card'));
 assert.match(pt,/Proposed reply \(Portuguese\)/);assert.match(pt,/English ?I finished the house, towels are missing\./);assert.match(pt,/English ?Thank you Rosa! I will bring towels tomorrow\./);
 await click(card('pt-card'),'Edit');await page.waitForSelector(card('pt-card')+' textarea');
 assert.match(await text(card('pt-card')),/English, as drafted/);
 await type(card('pt-card')+' textarea','Obrigada Rosa! Levo toalhas hoje.');await click(card('pt-card'),'Save');await waitCalls(1);
 assert.deepEqual((await calls())[0],{kind:'edit',args:['pt-card','Obrigada Rosa! Levo toalhas hoje.']});await finish(0);
 await page.waitForFunction(()=>document.body.textContent.includes('Levo toalhas hoje.'));
 assert.ok(!(await text(card('pt-card'))).includes('I will bring towels tomorrow'),'the English for the old draft is not shown beside the edited words');
 await click(card('pt-card'),'Coach the AI');assert.match(await text(card('pt-card')),/Write the note in English if you like; the reply comes back in Portuguese\./);
 pass('cleaners: English under both sides, Edit on the Portuguese, the language note printed in the coach drawer');
 // Owners: said, then the Envelope, then the reply; follow-up work as Also on approve.
 await page.evaluate(()=>{window.calls=[];});await page.goto(origin+'/?mode=owner');await page.waitForSelector(card('owner-card'));
 const own=await text(card('owner-card'));
 assert.ok(own.indexOf('Owner said')<own.indexOf('owner@example.test')&&own.indexOf('owner@example.test')<own.indexOf('Proposed reply'),'owner said, envelope, reply, in that order');
 assert.match(own,/Also on approve/);assert.match(own,/Work slip ?Re-mount downstairs soap dispenser/);assert.match(own,/Ticked lines are created when you approve or mark handled/);
 assert.equal(await page.$(card('owner-card')+' textarea'),null,'no always-open editor');
 assert.equal((await page.$$(card('owner-card')+' input[type=checkbox]')).length,2,'one tick box per follow-up, not one for the set');
 // Untick only the guest line: the work slip still files, the guest message is skipped by its key.
 await page.$$eval(card('owner-card')+' input[type=checkbox]',els=>els[1].click());
 await click(card('owner-card'),'Approve & send');await waitCalls(1);
 assert.deepEqual((await calls())[0],{kind:'approve',args:['owner-card',null,{fileActions:true,skipActions:['bbbbbbbbbbbb']}]});await finish(0);
 pass('owners: owner said, envelope, reply in order; each follow-up has its own tick box and an untick skips just that one');
 await page.screenshot({path:join(process.env.SMOKE_SHOTS||tmpdir(),'approval-card-owner.png'),fullPage:true});
 assert.match(await text(card('reaction-card')),/Rae reacted/);
 await click(card('reaction-card'),'Mark handled');await waitCalls(2);
 assert.deepEqual((await calls())[1],{kind:'handled',args:['reaction-card',true,{reason:'Reaction, nothing to reply to'}]});
 await finish(1);await page.waitForSelector('.rt-undo-toast');
 pass('owners: a reaction clears in one tap, and the toast offers Undo');
 // Guests: everything approving also does folds into one-line Also on approve.
 await page.evaluate(()=>{window.calls=[];});await page.goto(origin+'/?mode=guest');await page.waitForSelector(card('guest-card'));
 const gc=await text(card('guest-card'));
 assert.match(gc,/Also on approve/);assert.match(gc,/2 quotes on file: sent · Synthetic Cottage/);
 assert.match(gc,/Texts the pet fee payment link \(\$75\) to \+15550199/);assert.match(gc,/Note to Rosa: a dog is coming/);assert.match(gc,/Draft for approval/);
 assert.ok(!gc.includes('Vai ter um cachorro.'),'the handoff words wait behind Details');
 await click(card('guest-card'),'Details');assert.match(await text(card('guest-card')),/Vai ter um cachorro\./);
 await page.$eval(card('guest-card')+' input[name="cleaner-guest-card"][type=radio]:nth-of-type(1)',e=>e);
 await page.$$eval(card('guest-card')+' input[type=checkbox]',bs=>bs[0].click());
 assert.match(await text(card('guest-card')),/Does not text the pet fee payment link/);
 await click(card('guest-card'),'Approve & send');await waitCalls(1);
 assert.deepEqual((await calls())[0],{kind:'approve',args:['guest-card',{sendAddonSms:false,cleanerAction:'draft',previewToken:''}]});await finish(0);
 pass('guests: quote, payment link and Rosa note are one line each; the ticks ride on approve');
 await page.screenshot({path:join(process.env.SMOKE_SHOTS||tmpdir(),'approval-card-guest.png'),fullPage:true});
 const pr=await text(card('pre-card'));
 assert.ok(pr.includes('Send a price')&&pr.includes('Send reply')&&pr.includes('Other options')&&!pr.includes('Coach the AI'),'a 2027 request leads with price and reply');
 await click(card('pre-card'),'Other options');assert.ok((await text(card('pre-card'))).includes('Coach the AI'));
 await click(card('pre-card'),'Send reply');await waitCalls(2);assert.equal((await calls())[1].kind,'approve');await finish(1);
 pass('guests: a 2027 request leads with Send a price and Send reply; Other options opens the rest');
 const mc=await text(card('manual-card'));assert.ok(mc.includes('Copy message')&&mc.includes('Mark sent')&&!mc.includes('Coach the AI'));
 await click(card('manual-card'),'Mark sent');await waitCalls(3);
 assert.deepEqual((await calls())[2],{kind:'handled',args:['manual-card',{sent_text:'Trash goes out tonight.'}]});await finish(2);
 pass('guests: copy-to-send captures the draft as what was sent');
 const ic=await text(card('inq-card'));assert.ok(ic.includes('Needs your decision')&&ic.includes('Set a price')&&ic.includes('Write reply'));
 await click(card('inq-card'),'Write reply');await type(card('inq-card')+' textarea','For 4 nights it is $1,600.');await click(card('inq-card'),'Save');await waitCalls(4);
 await finish(3);await page.waitForFunction(()=>document.body.textContent.includes('For 4 nights it is $1,600.')&&[...document.querySelectorAll('#approval-inq-card button')].some(b=>b.textContent.trim()==='Approve & send'));
 pass('guests: an inquiry with no draft offers price, retry and write; a written reply gets the send button at once');
 await page.goto(origin+'/?mode=guest&role=staff');await page.waitForSelector(card('pre-card'));
 const st=await text(card('pre-card'));assert.ok(st.includes('Ask Ryan to price this')&&!st.includes('Send a price'),'staff are told who prices');
 assert.equal(await page.$('#approval-guest-card a[href^="/guests/quotes/"]'),null,'no quote links for staff');
 pass('guests: staff see who prices, never a link that bounces');
 // Why each waiting card waits, in one line.
 await page.goto(origin+'/?mode=guest');await page.waitForSelector(card('failed-card'));
 assert.match(await text(card('failed-card')),/Not sent: the texting account is out of credit\./);
 assert.ok(!/check whether|Guesty/.test(await text(card('stale-card'))),'an old draft adds no wait line');
 assert.ok(!(await text(card('guest-card'))).includes('Drafted'),'a fresh card says nothing');
 const heldRow=await text('[aria-label="Held as pitches"]');assert.match(heldRow,/Held as a pitch: seo@example\.test · Rank #1 on Google/);
 await page.$$eval('[aria-label="Held as pitches"] button',bs=>bs[0].click());await page.waitForFunction(()=>window.calls.some(c=>c.kind==='release'));
 pass('guests: a failed send says why it waits, an old draft says nothing more; a held pitch waits on the queue with Release');
 // A card that leaves the platform thread says where it sends; a thread reply says nothing.
 assert.match(await text(card('sms-card')),/Texts \(978\) 555-0134/);assert.match(await text(card('relay-card')),/Emails joel\.arriving\.first@example\.test/);
 assert.ok(!/Texts \(|Emails /.test(await text(card('stale-card')+' header')),'a thread reply names no destination');
 await page.setViewport({width:390,height:844});await page.reload();await page.waitForSelector(card('relay-card'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.setViewport({width:1280,height:1000});
 pass('guests: a text or relay card says where approving sends, and fits a phone');
 // Team: cleaners and contractors in one list, each card saying whose.
 await page.evaluate(()=>{window.calls=[];});await page.goto(origin+'/?mode=team');await page.waitForSelector(card('pt-card'));
 assert.ok(await page.$(card('slip-card')),'contractor cards share the list');
 const filter=await text('nav[aria-label="Whose messages"]');assert.match(filter,/All · 3/);assert.match(filter,/Cleaners · 1/);assert.match(filter,/Contractors · 2/);
 assert.match(await text(card('pt-card')),/^Rosa Synthetic ?Cleaner/);assert.match(await text(card('slip-card')),/^Sam Field ?Contractor/);
 await click(card('pt-card'),'Mark handled');await click(card('pt-card'),'Already answered');await waitCalls(1);
 assert.deepEqual((await calls())[0],{kind:'handled',args:['pt-card',{reason:'Already answered'}]});await finish(0);
 await page.waitForSelector('.rt-undo-toast');await page.$$eval('.rt-undo-toast button',bs=>bs.find(b=>b.textContent==='Undo').click());await waitCalls(2);
 assert.deepEqual((await calls())[1],{kind:'undo-cleaner',args:['pt-card']});await finish(1);
 pass('team: one list, an audience chip on every card, counts on the filter, and Undo goes to the card\'s own audience');
 await page.goto(origin+'/?mode=team&audience=contractors');await page.waitForSelector(card('slip-card'));
 assert.equal(await page.$(card('pt-card')),null,'the Contractors filter hides cleaner cards');pass('team: the filter narrows the list');
 // Vendor visits: a trade vendor's confirmed day, on the one card, with no reply to send.
 await page.evaluate(()=>{window.calls=[];});await page.goto(origin+'/?mode=vendor&audience=contractors');await page.waitForSelector(card('visit-card'));
 assert.match(await text('nav[aria-label="Whose messages"]'),/Contractors · 3/);
 const visit=await text(card('visit-card'));
 assert.match(visit,/^Tom Synthetic Plumbing ?Vendor/);assert.match(visit,/Reads as ?Tue Oct 27, at 1 PM at Synthetic Cottage/);
 assert.match(visit,/Holds Synthetic Cottage the night of Tue Oct 27 in Guesty, so Airbnb, VRBO and Booking.com stop selling it/);
 assert.match(visit,/Schedules 1 slip for Tom Synthetic Plumbing on Tue Oct 27/);
 for(const absent of ['Approve & send','Coach the AI','Redraft'])assert.ok(!visit.includes(absent),absent);
 pass('vendor visit: who wrote, what it reads as, the hold and the slips, and no reply to send');
 await click(card('visit-card'),'Details');await page.$$eval(card('visit-card')+' input[type=checkbox]',bs=>bs[1].click());
 assert.match(await text(card('visit-card')),/Schedules 2 slips/);
 await click(card('visit-card'),'Approve hold');await waitCalls(1);
 assert.deepEqual((await calls())[0],{kind:'approve-vendor-visit',args:['visit-card',{propertyId:'home-a',start:'2026-10-27',end:'2026-10-27',startTime:'13:00',endTime:null,slipIds:['slip-1','slip-2'],holdNightBefore:false}]});
 await finish(0,{ok:true,warning:'Held Synthetic Cottage the night of Tue Oct 27. 2 slips scheduled.'});
 await page.waitForFunction(()=>document.body.innerText.includes('Held Synthetic Cottage the night of Tue Oct 27.'));
 pass('vendor visit: the ticks ride on approve, and what was held comes back in one line');
 const ask=await text(card('ask-card'));assert.match(ask,/Which day\? "Tuesday" could be more than one Tuesday you offered\./);assert.match(ask,/Pick the day/);
 assert.equal(await enabled(card('ask-card'),'Approve visit'),false);
 await click(card('ask-card'),'Tue Oct 20');await waitCalls(2);
 assert.deepEqual((await calls())[1],{kind:'edit-vendor-visit',args:['ask-card',{propertyId:null,start:'2026-10-20',end:'2026-10-20',startTime:null,endTime:null}]});await finish(1);
 pass('vendor visit: an unclear day asks, blocks approve, and a day is one tap');
 const warn=await text(card('warn-card'));assert.match(warn,/A guest arrives Wed Oct 28 at 4 PM/);assert.match(warn,/Read first/);assert.match(warn,/Nothing to hold at Synthetic Cottage/);
 await page.screenshot({path:join(process.env.SMOKE_SHOTS||tmpdir(),'approval-card-vendor.png'),fullPage:true});
 await click(card('warn-card'),'Mark handled');await click(card('warn-card'),'Not a visit');await waitCalls(3);
 assert.deepEqual((await calls())[2],{kind:'handled',args:['warn-card','Not a visit']});await finish(2);
 await page.waitForSelector('.rt-undo-toast');await page.$$eval('.rt-undo-toast button',bs=>bs.find(b=>b.textContent==='Undo').click());await waitCalls(4);
 assert.deepEqual((await calls())[3],{kind:'undo-vendor-visit',args:['warn-card']});await finish(3);
 pass('vendor visit: the calendar warning is read first; Mark handled has its own reasons and Undo');
 await page.setViewport({width:390,height:844});await page.goto(origin+'/?mode=vendor&audience=contractors');await page.waitForSelector(card('ask-card'));
 assert.match(await text('#needs-review'),/Review hold/);
 await page.$$eval('.rt-inbox-review-toggle',bs=>bs[1].click());await page.waitForSelector(card('ask-card')+' input[type=date]',{visible:true});
 await page.screenshot({path:join(process.env.SMOKE_SHOTS||tmpdir(),'approval-card-vendor-mobile.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);pass('vendor visit: the day editor fits a phone');
 await page.setViewport({width:1280,height:1000});
 // The Refresh control: quiet while the feed is healthy, loud only when it is not.
 const head=()=>text('#needs-review .rt-section-actions');
 // Spacing between the status and the button is CSS, so compare without whitespace.
 const headSays=t=>page.waitForFunction(t=>document.querySelector('#needs-review .rt-section-actions').textContent.replace(/\s+/g,'')===t.replace(/\s+/g,''),{},t);
 const clickHead=()=>page.$eval('#needs-review .rt-section-actions button',b=>b.click());
 await page.goto(origin+'/?mode=guest');await page.waitForSelector(card('stale-card'));
 assert.equal((await head()).trim(),'Refresh','nothing beside Refresh while healthy');
 await click(card('stale-card'),'Edit');await page.waitForSelector(card('stale-card')+' textarea');
 await type(card('stale-card')+' textarea','Half-typed words');
 await page.evaluate(()=>{window.feedHold=true;});await clickHead();
 await page.waitForSelector('#needs-review .rt-section-actions button[aria-busy="true"]');
 assert.match(await head(),/Refreshing/);
 await page.evaluate(()=>{window.feedHold=false;window.feedFails=true;window.releaseFeed();});
 await headSays('Refresh failed · Retry');
 await page.screenshot({path:join(process.env.SMOKE_SHOTS||tmpdir(),'approval-card-refresh-failed.png'),clip:await page.$eval('#needs-review',e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:Math.min(260,r.height)};})});
 assert.equal(await page.$eval('#needs-review [role="status"]',e=>e.textContent.replace(/\s+/g,' ').trim()),'Refresh failed ·');
 for(const id of ['guest-card','stale-card','failed-card'])assert.ok(await page.$(card(id)),id+' stays on a failed refresh');
 assert.equal(await page.$eval(card('stale-card')+' textarea',e=>e.value),'Half-typed words','a failed refresh keeps a half-typed edit');
 await page.evaluate(()=>{window.feedFails=false;});await clickHead();await headSays('Refresh');
 assert.equal(await page.$eval(card('stale-card')+' textarea',e=>e.value),'Half-typed words');
 pass('Refresh shows its pending state; a failed read says Refresh failed · Retry and keeps the cards and a half-typed edit; Retry recovers');
 await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});window.dispatchEvent(new Event('offline'));});
 await headSays('Offline');assert.equal(await page.$('#needs-review .rt-section-actions button'),null,'no Refresh to press while offline');
 await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});window.dispatchEvent(new Event('online'));});
 await headSays('Refresh');pass('offline says Offline, and the reconnect reads again');
 await page.goto(origin+'/?mode=team');await page.waitForSelector(card('pt-card'));
 await page.evaluate(()=>{window.feedFails='contractors';});await clickHead();await headSays('Refresh failed · Retry');
 assert.ok(await page.$(card('slip-card')),'the contractor cards stay');
 await page.evaluate(()=>{window.feedFails=false;});await clickHead();await headSays('Refresh');
 pass('team: either feed failing is a failure on the one Refresh');
 await page.goto(origin+'/?mode=contractor');await page.waitForSelector('#approval-slip-card');
 await page.setViewport({width:390,height:844});await page.reload();await page.waitForSelector('.rt-inbox-review-toggle');
 await page.$$eval('.rt-inbox-review-toggle',bs=>bs[0].click());
 await page.screenshot({path:join(process.env.SMOKE_SHOTS||tmpdir(),'approval-card-mobile.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);pass('fits a phone with no sideways scroll');
 assert.deepEqual(errors,[]);console.log(checks+' checks passed');
}finally{await browser?.close();server.close();await rm(scratch,{recursive:true,force:true});}
