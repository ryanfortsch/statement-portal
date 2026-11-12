// Isolated browser fixture: synthetic calendar, in-memory actions, no credentials
// or network API. Open the printed localhost URL with the browser testing tool.
import { createRequire } from 'node:module';
import { mkdtemp,readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
const require=createRequire(import.meta.url),webpack=require('next/dist/compiled/webpack/webpack').webpack;
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-pricing-ui-'));
await writeFile(join(scratch,'link.tsx'),`import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>;}`);
await writeFile(join(scratch,'loader.cjs'),`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(s){return ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
await writeFile(join(scratch,'css-loader.cjs'),`module.exports=function(){return ''};`);
await writeFile(join(scratch,'actions.ts'),`
import {previewPricing} from '${root}/src/lib/dynamic-pricing.ts';
let profile=null;let runs=[];let evidenceVersion=0;let tracking={enabled:false,version:0};let observations=[];
const fixture=()=>globalThis.pricingFixture;
export async function savePricingAction(i){profile={property_id:i.propertyId,policy:i.policy,mode:i.mode,version:i.version+1};return {ok:true,value:profile};}
export async function reviewPricingAction(){return {ok:true,value:{id:'review-fixture',createdAt:new Date().toISOString(),profile,snapshot:fixture().snapshot,preview:previewPricing(profile.policy,fixture().snapshot)}};}
export async function refreshPricingAction(){return {ok:true,value:{profile,policy:profile?.policy??fixture().policy,snapshot:fixture().snapshot,runs,evidenceVersion,tracking,observations,scheduledCaptureEnabled:false}};}
export async function capturePricingObservationAction(){return {ok:true,value:{tracking,observations,scheduledCaptureEnabled:false}};}
export async function setPricingTrackingAction(i){tracking={enabled:i.enabled,version:i.version+1};return {ok:true,value:{tracking,observations,scheduledCaptureEnabled:false}};}
export async function savePricingEvidenceAction(i){fixture().snapshot={...fixture().snapshot,evidence:i.data};evidenceVersion++;return {ok:true,value:{snapshot:fixture().snapshot,evidenceVersion}};}
export async function publishPricingAction(){if(new URLSearchParams(location.search).has('reject'))return {ok:false,error:'Calendar changed; refresh the review'};runs=[{id:'run-fixture',status:'applied',created_at:new Date().toISOString(),applied_at:new Date().toISOString()}];return {ok:true,value:previewPricing(profile.policy,fixture().snapshot).days.filter(d=>d.eligible).length};}
export async function undoPricingAction(){runs=[];return {ok:true,value:10};}
`);
await writeFile(join(scratch,'entry.tsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import * as actions from './actions';
const services={save:actions.savePricingAction,refresh:actions.refreshPricingAction,review:actions.reviewPricingAction,publish:actions.publishPricingAction,undo:actions.undoPricingAction,evidence:actions.savePricingEvidenceAction,observe:actions.capturePricingObservationAction,tracking:actions.setPricingTrackingAction};
import PricingWorkbench from '${root}/src/app/channels/pricing/PricingWorkbench.tsx';
import {ConfirmProvider} from '${root}/src/components/ConfirmDialog.tsx';
import {createPricingDemo,createPricingPortfolioDemo} from '${root}/src/lib/dynamic-pricing-demo.ts';
import PricingLiveWorkspace from '${root}/src/app/channels/pricing/PricingLiveWorkspace.tsx';
import {pricingLiveRow,currentPricingSnapshot} from '${root}/src/lib/dynamic-pricing-live.ts';
import PricingDemo from '${root}/src/app/channels/pricing/demo/PricingDemo.tsx';
import {pricingBookingActivity} from '${root}/src/lib/dynamic-pricing-activity.ts';
const {policy,snapshot}=createPricingDemo();snapshot.evidence.propertyId='test_home';
globalThis.pricingFixture={policy,snapshot};
const liveHomes=createPricingPortfolioDemo().map(({home,fixture})=>({home:{...home,timezone:'America/New_York'},snapshot:currentPricingSnapshot(fixture.snapshot,new Date()),source:'Synthetic mirror',sourceObservedAt:fixture.snapshot.observedAt}));
liveHomes.forEach((c,i)=>{const b={id:'synthetic-booking-'+i,status:'confirmed',duplicate_of:null,source:'direct_booking',external_confirmation_code:null,check_in:c.snapshot.days[5].date,check_out:c.snapshot.days[8+i%5].date,booked_at:new Date().toISOString()};c.activity=pricingBookingActivity(i%4===0?[]:[b],[],'America/New_York',new Date());if(i%5===0)c.activity.undatedStays=2;});
const livePortfolio={readAt:new Date().toISOString(),rows:liveHomes.map(c=>({...pricingLiveRow(c.home,c.snapshot,new Date(),c.snapshot.today),activity:c.activity}))};
createRoot(document.getElementById('root')).render(<ConfirmProvider><main className="pricing-preview-shell"><header className="pricing-preview-toolbar"><h1><b>Helm</b><span>/</span>Pricing</h1><span title="Synthetic data. Changes stay in this browser and reset on reload.">Demo · simulated data</span></header>{new URLSearchParams(location.search).has('live')?<PricingLiveWorkspace initialPortfolio={livePortfolio} refreshAction={async()=>({ok:true,value:livePortfolio})} calendarAction={async id=>({ok:true,value:liveHomes.find(c=>c.home.id===id)})}/>:new URLSearchParams(location.search).has('demo')?<PricingDemo fixtures={createPricingPortfolioDemo()}/>:<PricingWorkbench services={services} propertyId="test_home" name="Synthetic harbor home" authority={new URLSearchParams(location.search).has('guesty')?'guesty':'helm'} initialPolicy={policy} initialSnapshot={snapshot} initialProfile={null} initialRuns={[]}/>}</main></ConfirmProvider>);
`);
await new Promise((resolve,reject)=>{const c=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.tsx'),output:{path:scratch,filename:'bundle.js'},
  resolve:{extensions:['.ts','.tsx','.js'],modules:[join(root,'node_modules')],alias:{'@':join(root,'src'),'./actions$':join(scratch,'actions.ts'),'next/link$':join(scratch,'link.tsx')}},
  module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:join(scratch,'loader.cjs')},{test:/\.css$/,use:join(scratch,'css-loader.cjs')}]},performance:{hints:false}});
  c.run((e,s)=>c.close(()=>e||s?.hasErrors()?reject(e||Error(s.toString({all:false,errors:true}))):resolve()));});
const postcss=require('postcss'),tailwind=require('@tailwindcss/postcss');
const css=await postcss([tailwind({base:root})]).process(await readFile(join(root,'src/app/globals.css'),'utf8'),{from:join(root,'src/app/globals.css')});
const fixtureCss='html,body{background:#f6f7f8}.pricing-preview-shell{max-width:1440px;margin:0 auto;padding:0 32px 40px;background:#f6f7f8;min-height:100vh}.pricing-preview-toolbar{display:flex;align-items:center;justify-content:space-between;height:62px;border-bottom:1px solid #e7e9ee;font-size:11px;color:#9aa2ad}.pricing-preview-toolbar h1{display:flex;align-items:center;gap:14px;font-size:13px;font-weight:450;color:#8e97a4}.pricing-preview-toolbar h1 b{font-size:16px;letter-spacing:-.5px;color:#344055;font-weight:650}.pricing-preview-toolbar h1 span{color:#d3d7dd}.pricing-preview-toolbar>span{border:1px solid #e7e9ee;border-radius:5px;padding:3px 7px;font-size:10px}@media(max-width:480px){.pricing-preview-shell{padding:0 16px 24px}.pricing-preview-toolbar{height:52px}}';
const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Helm pricing · synthetic preview</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const phoneHtml='<!doctype html><html><head><meta charset="utf-8"><title>Pricing · 390px check</title></head><body style="margin:0;background:#eee"><iframe title="Pricing on a phone" src="/?demo=1" style="display:block;width:390px;height:844px;border:0;margin:0 auto"></iframe></body></html>';
const server=createServer(async(req,res)=>{if(req.method!=='GET'){res.writeHead(405).end();return;}
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; font-src 'self'");
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(await readFile(join(scratch,'bundle.js')));}
  else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css.css+await readFile(join(root,'src/app/channels/pricing/pricing.css'),'utf8')+fixtureCss);}
  else if(req.url==='/phone'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(phoneHtml);}
  else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);}});
server.listen(Number(process.env.PRICING_PREVIEW_PORT||0),'127.0.0.1',()=>console.log('Synthetic pricing UI: http://127.0.0.1:'+server.address().port));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
