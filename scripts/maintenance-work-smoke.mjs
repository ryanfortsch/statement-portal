/** Real maintenance controls and outcome components; synthetic data only. */
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
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-message-outcomes-'));
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
for(const [name,path] of [['MessageOutcomes','src/components/MessageOutcomes.tsx'],['MaintenanceWorkPanel','src/components/MaintenanceWorkPanel.tsx'],['core','src/lib/message-outcomes.ts']]) await writeFile(join(scratch,name+'.js'),compile(await readFile(join(root,path),'utf8')));
await writeFile(join(scratch,'link.js'),compile(`import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`));
await writeFile(join(scratch,'entry.js'),compile(`
import React from 'react';import {createRoot} from 'react-dom/client';
import {MaintenanceWorkPanel} from './MaintenanceWorkPanel.js';import {MessageOutcomes} from './MessageOutcomes.js';
import {assembleOutcomes,splitMaintenanceOutcomes} from './core.js';
const initial={id:'synthetic-card',guesty_message_id:'msg',listing_id:'home',maintenance_work:{status:'detect',slip_id:'',title:'Checking reported maintenance issue',error:'Maintenance evidence needs review; retrying'}};
function Preview(){
 const [source,setSource]=React.useState(initial);const [create,setCreate]=React.useState(true);const [rows,setRows]=React.useState([]);
 window.update=(next,work=[])=>{setSource(next);setRows(work)};window.initial=initial;
 const outcomes=splitMaintenanceOutcomes({...source,outcomes:assembleOutcomes(source,rows)});
 return <article id="maintenance-card"><h2>Guest · Example home</h2><p>The kitchen door will not lock and its handle came off.</p>
 <MaintenanceWorkPanel id={source.id} work={source.maintenance_work} outcome={outcomes.maintenance} create={create} onCreateChange={setCreate} busy={false} dismissing={false} onDismiss={()=>{window.dismissed=true}}/>
 <button id="approve">Approve &amp; send</button><MessageOutcomes value={outcomes.remaining}/></article>;
}
createRoot(document.getElementById('root')).render(<><header><b>Helm</b><span>MESSAGING</span></header><main><div className="eyebrow">GUESTS · INBOX · SYNTHETIC PREVIEW</div><Preview/></main></>);
`));
await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},resolve:{modules:[join(root,'node_modules')],alias:{'@/lib/message-outcomes':join(scratch,'core.js'),'next/link':join(scratch,'link.js')}},performance:{hints:false}});compiler.run((err,stats)=>compiler.close(()=>err||stats?.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));});
const css=`*{box-sizing:border-box}body{margin:0;background:#f5f0e4;color:#102b46;font:14px Arial,sans-serif;--paper:#f5f0e4;--paper-2:#efe6cf;--ink-1:#102b46;--ink-2:#214263;--ink-3:#59718a;--ink-4:#788ca0;--rule:#d9cda9;--rule-soft:#e3dac4;--signal:#a44e40;--success:#426d66}header{display:flex;gap:35px;align-items:center;padding:26px 6%;border-bottom:1px solid #102b46}header b{font:28px Georgia}header span,.eyebrow{font-size:10px;letter-spacing:.15em;text-transform:uppercase}main{max-width:1100px;margin:30px auto;padding:0 24px}.font-serif{font-family:Georgia,serif}a{color:inherit}button{font:inherit;cursor:pointer}h2{font-weight:500}p{line-height:1.6}`;
const server=createServer(async(req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(join(scratch,'bundle.js')));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Helm message outcomes · synthetic preview</title><style>'+css+'</style><div id="root"></div><script src="/bundle.js"></script>');}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;let browser;
try{
 browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':await chromium.executablePath()),headless:true,args:process.platform==='darwin'?['--no-sandbox']:chromium.args});
 const page=await browser.newPage();page.setDefaultTimeout(10000);await page.setViewport({width:1280,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin+'/')?r.continue():r.abort());
 await page.goto(origin);await page.waitForSelector('[aria-label="Property work slip"]');
 assert.equal(await page.$('[aria-label="Work and notes"]'),null);
 assert.equal(await page.$eval('input[type="radio"]',e=>e.checked),true);
 assert.match(await page.$eval('body',e=>e.innerText),/Work slip isn’t ready yet. Helm is retrying./);
 assert.equal(await page.$('a[href^="/work/"]'),null);
 await page.$$eval('input[type="radio"]',inputs=>inputs[1].click());
 assert.equal(await page.$$eval('input[type="radio"]',inputs=>inputs[1].checked),true);
 await page.evaluate(()=>window.update({...window.initial,maintenance_work:{status:'proposed',slip_id:'',title:'Maintenance professional: investigate guest-reported issue',error:''}}));
 await page.waitForFunction(()=>!document.body.innerText.includes('retrying'));
 assert.equal(await page.$('[aria-label="Work and notes"]'),null);
 await page.evaluate(()=>window.update({...window.initial,maintenance_work:{status:'filed',slip_id:'synthetic-slip',title:'Old title',error:''}},[{id:'synthetic-slip',title:'Repair kitchen door lock and handle',status:'open',assigned_to_type:'unassigned',assigned_to_label:null,assigned_to_email:null,scheduled_date:null,completed_at:null,from_guest_request_key:'guest-maintenance:msg:home',from_quo_message_id:null,from_gmail_message_id:null}]));
 await page.waitForSelector('a[href="/work/synthetic-slip"]');
 assert.match(await page.$eval('body',e=>e.innerText),/Unassigned/);
 assert.equal((await page.$$('a[href="/work/synthetic-slip"]')).length,1);
 assert.equal(await page.$('[aria-label="Work and notes"]'),null);
 assert.equal(await page.$('input[type="radio"]'),null);
 await page.screenshot({path:'/private/tmp/helm-maintenance-desktop.png',fullPage:true});
 await page.setViewport({width:390,height:844});await page.screenshot({path:'/private/tmp/helm-maintenance-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.$$eval('button',bs=>bs.find(b=>b.textContent==='Dismiss slip').click());
 assert.equal(await page.evaluate(()=>window.dismissed),true);
 assert.deepEqual(errors,[]);console.log('PASS: one work panel, default Create/Skip, retry explanation, proposed work, confirmed link and assignee, dismiss, mobile width');
}finally{await browser?.close();server.close();await rm(scratch,{recursive:true,force:true});}
