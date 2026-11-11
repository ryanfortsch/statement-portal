// Run only after task-specific authorization to read the live property calendars.
// Credentials stay in this process; the browser receives operational projections only.
import {createRequire} from 'node:module';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {readPricingLiveHomes,readPricingLiveCalendar,readPricingLivePortfolio} from '../src/lib/dynamic-pricing-live.server.ts';
import {pricingPreviewRequest} from './lib/pricing-preview-http.mjs';

if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw Error('The authorized database environment is required');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false},
  global:{fetch:(url,init)=>{if((init?.method??'GET').toUpperCase()!=='GET')throw Error('Read-only preview');return fetch(url,init);}}});
const require=createRequire(import.meta.url),webpack=require('next/dist/compiled/webpack/webpack').webpack;
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-pricing-live-ui-'));
await writeFile(join(scratch,'link.tsx'),`import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>;}`);
await writeFile(join(scratch,'loader.cjs'),`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(s){return ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
await writeFile(join(scratch,'css-loader.cjs'),`module.exports=function(){return ''};`);
await writeFile(join(scratch,'entry.tsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import PricingLiveWorkspace from '${root}/src/app/channels/pricing/PricingLiveWorkspace.tsx';
const root=createRoot(document.getElementById('root'));
const get=async(url)=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('Calendar unavailable');return r.json();};
get('/portfolio').then(p=>root.render(<main className="pricing-preview-shell"><header className="pricing-preview-toolbar"><h1><b>Helm</b><span>/</span>Pricing</h1><span>Current data</span></header><PricingLiveWorkspace initialPortfolio={p.value} refreshAction={()=>get('/portfolio')} calendarAction={id=>get('/calendar?property='+encodeURIComponent(id))}/></main>)).catch(()=>root.render(<main>Could not load the portfolio. Refresh to try again.</main>));
`);
await new Promise((resolve,reject)=>{const c=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.tsx'),output:{path:scratch,filename:'bundle.js'},
  resolve:{extensions:['.ts','.tsx','.js'],modules:[join(root,'node_modules')],alias:{'@':join(root,'src'),'next/link$':join(scratch,'link.tsx')}},
  module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:join(scratch,'loader.cjs')},{test:/\.css$/,use:join(scratch,'css-loader.cjs')}]},performance:{hints:false}});
  c.run((e,s)=>c.close(()=>e||s?.hasErrors()?reject(e||Error(s.toString({all:false,errors:true}))):resolve()));});
const css=await require('postcss')([require('@tailwindcss/postcss')({base:root})]).process(await readFile(join(root,'src/app/globals.css'),'utf8'),{from:join(root,'src/app/globals.css')});
const shellCss='html,body{background:#f6f7f8}.pricing-preview-shell{max-width:1440px;margin:0 auto;padding:0 32px 40px;min-height:100vh}.pricing-preview-toolbar{display:flex;align-items:center;justify-content:space-between;height:62px;border-bottom:1px solid #e7e9ee;font-size:11px;color:#66727a}.pricing-preview-toolbar h1{display:flex;align-items:center;gap:14px;font-size:13px;font-weight:450}.pricing-preview-toolbar h1 b{font-size:16px;font-weight:650}.pricing-preview-toolbar h1 span{color:#aeb7b4}@media(max-width:480px){.pricing-preview-shell{padding:0 16px 24px}}';
const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Helm pricing · current portfolio</title><link rel="stylesheet" href="/style.css"></head><body><div id="root">Loading current calendars…</div><script src="/bundle.js"></script></body></html>';
const token=randomBytes(32).toString('hex');
let pending=null;
const portfolio=()=>pending??(pending=readPricingLivePortfolio(db).finally(()=>{pending=null;}));
const calendar=async(id)=>{const home=(await readPricingLiveHomes(db)).find(h=>h.id===id);if(!home)throw Error('Unknown property');return readPricingLiveCalendar(db,home);};
const server=createServer((req,res)=>void pricingPreviewRequest(req,res,{port:server.address().port,token,portfolio,calendar,
  asset:async(path)=>path==='/'?{type:'text/html; charset=utf-8',body:html}:path==='/bundle.js'?{type:'text/javascript; charset=utf-8',body:await readFile(join(scratch,'bundle.js'))}:path==='/style.css'?{type:'text/css',body:css.css+await readFile(join(root,'src/app/channels/pricing/pricing.css'),'utf8')+shellCss}:null}));
server.listen(Number(process.env.PRICING_LIVE_PORT||0),'127.0.0.1',async()=>{
  const accessFile=join(tmpdir(),'helm-pricing-live-access.json');
  await writeFile(accessFile,JSON.stringify({url:`http://127.0.0.1:${server.address().port}/open?key=${token}`}),{mode:0o600});
  console.log(`Read-only pricing preview ready. Private access file: ${accessFile}`);
});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
