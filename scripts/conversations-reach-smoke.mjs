/**
 * The Conversations list reaches past its first 60 days, driven in a real
 * browser: the real browser component with synthetic rows, the window loader
 * replaced by a recorder, every remote request blocked. Proves Show earlier
 * stays steps back and search finds what it brought in, Dates replaces the
 * list with the window asked for, and past the floor the list says older
 * conversations are in Guesty instead of ending.
 *
 * Run: node scripts/conversations-reach-smoke.mjs   (--compile-only to just bundle)
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
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-conversations-reach-'));

await writeFile(join(scratch,'ts-loader.cjs'),`const ts=require(${JSON.stringify(require.resolve('typescript'))});
module.exports=function(src){return ts.transpileModule(src,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
await writeFile(join(scratch,'actions.js'),`export const loadConversationWindow=(from,to)=>new Promise(resolve=>window.calls.push({from,to,resolve}));`);
await writeFile(join(scratch,'thread.js'),`import React from 'react';export function ThreadPanel(){return React.createElement('div',null,'Synthetic thread');}`);
await writeFile(join(scratch,'entry.tsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import {ConversationsBrowser} from '@/app/messaging/Conversations';
window.calls=[];
const row=(id,name,ci,co,status)=>({conversation_id:id,reservation_id:'r-'+id,listing_id:'home_a',property_name:'Synthetic Cottage',guest_full:name,guest_first:name.split(' ')[0],check_in:ci,check_out:co,stay_status:status,module:'airbnb2',channel:'Airbnb',last_activity_at:'',last_who:'',last_preview:'',pending_count:0,review_count:0});
const rows=[row('c1','Nora Now','2026-10-16','2026-10-20','in_house'),row('c2','Una Upcoming','2026-11-02','2026-11-05','upcoming')];
const floor=new URLSearchParams(location.search).get('floor');
const win=floor?{from:'2024-09-01',to:'2024-12-29'}:{from:'2026-08-19',to:'2026-12-17'};
window.older=[row('c9','Augusta Earlier','2026-08-02','2026-08-06','checked_out')];
createRoot(document.getElementById('root')).render(<main><ConversationsBrowser initialConversations={rows} initialError={null} initialWindow={win}/></main>);
`);
// Section's empty line (EmptyState) imports next/link, which only runs inside Next.
await writeFile(join(scratch,'link.js'),`import React from 'react';export default function Link({href,children,prefetch,...p}){return React.createElement('a',{href,...p},children);}`);
const alias={'next/link':join(scratch,'link.js'),'./conversation-actions':join(scratch,'actions.js'),'./Thread':join(scratch,'thread.js'),'@':join(root,'src')};
await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.tsx'),output:{path:scratch,filename:'bundle.js'},
 resolve:{extensions:['.tsx','.ts','.js'],modules:[join(root,'node_modules')],alias},module:{rules:[{test:/\.tsx?$/,use:join(scratch,'ts-loader.cjs')}]},performance:{hints:false}});
 compiler.run((err,stats)=>compiler.close(()=>err||stats?.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));});
if(process.argv.includes('--compile-only')){console.log('Conversations reach fixture compiled.');await rm(scratch,{recursive:true,force:true});process.exit(0);}

const css=`*{box-sizing:border-box}body{margin:0;background:#f5f0e4;color:#102b46;font:14px Arial,sans-serif}main{max-width:1100px;margin:20px auto}`+(await readFile(join(root,'src/app/globals.css'),'utf8'));
const server=createServer(async(req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(join(scratch,'bundle.js')));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conversations, synthetic</title><style>'+css+'</style><div id="root"></div><script src="/bundle.js"></script>');}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;let browser,checks=0;
const pass=m=>{checks++;console.log('PASS '+m);};
try{
 browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':await chromium.executablePath()),headless:true,args:process.platform==='darwin'?['--no-sandbox']:chromium.args});
 const page=await browser.newPage();page.setDefaultTimeout(10000);await page.setViewport({width:1280,height:1000});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin+'/')?r.continue():r.abort());
 const text=()=>page.$eval('#conversations',e=>e.textContent.replace(/\s+/g,' '));
 const click=label=>page.$$eval('#conversations button',(bs,label)=>{const b=bs.find(b=>b.textContent.trim().startsWith(label));if(!b)throw Error('Missing '+label);b.click();},label);
 const type=(sel,v)=>page.$eval(sel,(e,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));},v);
 await page.goto(origin);await page.waitForSelector('#conversations');
 assert.match(await text(),/Check-ins Aug 19 to Dec 17, 2026\./);assert.ok(!(await text()).includes('Older conversations are in Guesty'),'nothing to hand off yet');
 await type('input[type=search]','Augusta');assert.match(await text(),/No conversations match in check-ins Aug 19 to Dec 17, 2026/);
 await click('Show earlier stays (before Aug 19)');await page.waitForFunction(()=>window.calls.length===1);
 assert.deepEqual(await page.evaluate(()=>({from:window.calls[0].from,to:window.calls[0].to})),{from:'2026-04-21',to:'2026-08-18'});
 await page.evaluate(()=>window.calls[0].resolve({ok:true,rows:window.older,from:'2026-04-21',to:'2026-08-18',truncated:false}));
 await page.waitForFunction(()=>document.body.textContent.includes('Augusta Earlier'));
 assert.match(await text(),/Check-ins Apr 21 to Dec 17, 2026\./);
 pass('Show earlier stays steps back 120 days and search finds the guest it brought in');
 await type('input[type=search]','');await click('Dates');
 await page.$eval('input[aria-label="Check-ins from"]',e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'2026-01-01');e.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.$eval('input[aria-label="Check-ins to"]',e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'2026-09-01');e.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.match(await text(),/Pick 120 days or fewer at a time\./);
 await page.$eval('input[aria-label="Check-ins to"]',e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'2026-03-31');e.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.$eval('form[aria-label="Check-in dates"]',f=>f.requestSubmit());await page.waitForFunction(()=>window.calls.length===2);
 await page.evaluate(()=>window.calls[1].resolve({ok:true,rows:[],from:'2026-01-01',to:'2026-03-31',truncated:true}));
 await page.waitForFunction(()=>document.body.textContent.includes('Back to recent stays'));
 const picked=await text();assert.match(picked,/No conversations match in check-ins Jan 1 to Mar 31, 2026/);assert.match(picked,/held more stays than Helm lists at once\. Older conversations are in Guesty/);
 assert.equal(await page.$eval('#conversations a[href="https://app.guesty.com/"]',a=>a.textContent.trim()),'open Guesty ↗');
 await click('Back to recent stays');await page.waitForFunction(()=>document.body.textContent.includes('Nora Now'));
 pass('Dates replaces the list with the window asked for; a full window points to Guesty; Back to recent restores it');
 await page.goto(origin+'/?floor=1');await page.waitForSelector('#conversations');
 const floorText=await text();assert.ok(!floorText.includes('Show earlier stays'),'no step back past the floor');assert.match(floorText,/Older conversations are in Guesty/);
 pass('past two years the list hands off to Guesty instead of ending');
 await page.setViewport({width:390,height:844});await page.goto(origin);await page.waitForSelector('#conversations');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);pass('fits a phone');
 assert.deepEqual(errors,[]);console.log(checks+' checks passed');
}finally{await browser?.close();server.close();await rm(scratch,{recursive:true,force:true});}
