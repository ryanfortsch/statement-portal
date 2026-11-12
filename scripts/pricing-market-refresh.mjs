/** Explicit operator-run import. Dry-run by default; never updates live rates or vendor settings. */
import {readFile,writeFile,rename,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {supabaseAdmin} from '../src/lib/supabase-admin.ts';
import {readPricingLiveHomes} from '../src/lib/dynamic-pricing-live.server.ts';
import {readPricingResearch,savePricingResearch} from '../src/lib/dynamic-pricing-research.server.ts';
import {dateInZone} from '../src/lib/dynamic-pricing-inputs.ts';
import {validatePricingResearch} from '../src/lib/dynamic-pricing-research.ts';
import {importPriceLabsMcpMarket,matchPriceLabsMarketHomes,PriceLabsMarketUnavailable} from '../src/lib/dynamic-pricing-pricelabs-market.ts';
import {createPriceLabsMarketClient} from '../src/lib/pricelabs-market-client.server.ts';

const args=process.argv.slice(2),write=args.includes('--write');
if(args.some((v,i)=>v!=='--write'&&v!=='--credentials'&&args[i-1]!=='--credentials'))throw Error('Usage: --credentials PRIVATE_DIRECTORY [--write]');
const credentialArg=args[args.indexOf('--credentials')+1];
if(!args.includes('--credentials')||!credentialArg||credentialArg.startsWith('--'))throw Error('A private credential directory is required');
const directory=resolve(credentialArg),root=await lstat(directory);
if(!root.isDirectory()||root.isSymbolicLink()||(root.mode&0o077))throw Error('Credential directory must be private (0700)');
if(await lstat(join(directory,'server-managed.json')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}))throw Error('This connection is server-managed. Do not refresh its local token copy.');
const server=await supabaseAdmin.from('helm_pricing_market_connection').select('enabled').eq('id',true).maybeSingle();
// The older manual deployment may not have this migration yet. Other errors
// fail closed: never race a server refresh when its status cannot be checked.
if(server.error&&!['PGRST205','42P01'].includes(server.error.code))throw Error('Server connection status is unavailable');
if(server.data?.enabled)throw Error('Automatic refresh owns this connection; use its server status instead');
async function privateJson(name){const path=join(directory,name),stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077))throw Error('Credential files must be private (0600)');return JSON.parse(await readFile(path,'utf8'));}
let token=await privateJson('token.json');
if(token.scope!=='read')throw Error('Only read-only PriceLabs credentials are accepted');
const obtained=Date.parse(token.obtained_at),lifetime=Number(token.expires_in);
if(!Number.isFinite(obtained)||!Number.isFinite(lifetime)||lifetime<=0)throw Error('Invalid token expiry');
if(obtained+lifetime*1000<Date.now()+60000){
  const fields=await privateJson('credential-fields.json'),clientId=fields.find(f=>f.id==='credentials-client-id')?.value,clientSecret=fields.find(f=>f.id==='credentials-client-secret')?.value;
  if(!token.refresh_token||!clientId||!clientSecret)throw Error('Reconnect the PriceLabs read-only client');
  const response=await fetch('https://pricelabs.co/oauth/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:token.refresh_token,client_id:clientId,client_secret:clientSecret})});
  if(!response.ok)throw Error(`PriceLabs authorization refresh failed (${response.status})`);
  const renewed=await response.json();if(!renewed.access_token||renewed.scope!=='read')throw Error('Refreshed token is not read-only');
  token={...renewed,refresh_token:renewed.refresh_token??token.refresh_token,obtained_at:new Date().toISOString()};
  const temporary=join(directory,`token-${randomUUID()}.json`);await writeFile(temporary,JSON.stringify(token),{mode:0o600,flag:'wx'});await rename(temporary,join(directory,'token.json'));
}
// Prevent this operator script from being repurposed to read or modify other database resources.
const allowedReads=new Set(['properties','helm_pricing_research']);
const db={from(table){if(!allowedReads.has(table))throw Error('Database table is not allowed');return supabaseAdmin.from(table);},rpc(name,params){if(!write||name!=='helm_save_pricing_research')throw Error('Database write is not allowed');return supabaseAdmin.rpc(name,params);}};
const client=await createPriceLabsMarketClient(token),homes=await readPricingLiveHomes(db),matches=matchPriceLabsMarketHomes(await client.listings(),homes);
const report={mode:write?'write':'dry-run',catalog:matches.length,homes:homes.length,matched:matches.filter(m=>m.home).length,unmatched:matches.filter(m=>!m.home).length,validated:0,saved:0,unavailable:0,failed:0,nights:0,failures:[]};
console.log(JSON.stringify({mode:report.mode,catalog:report.catalog,matched:report.matched,unmatched:report.unmatched}));
const receipts=[],receiptPath=join(directory,`import-${randomUUID()}.json`);
for(const match of matches){
  if(!match.home)continue;
  try{
    const previous=await readPricingResearch(db,match.home.id);if(!previous.ok)throw Error('Prior research could not be read');
    const observedAt=new Date().toISOString(),payload=await client.market(match.listing_id,match.pms_name);
    const data=importPriceLabsMcpMarket(payload,{listingId:match.listing_id,pms:match.pms_name,observedAt,today:dateInZone(new Date(observedAt),match.home.timezone)},match.home.id,previous.value?.data);
    const input=validatePricingResearch({propertyId:match.home.id,version:previous.value?.version??0,requestId:randomUUID(),data});
    report.validated++;report.nights+=data.market.length;
    if(write){
      // Keep an exact private retry receipt before each write. RPC uses optimistic versioning.
      const receipt={input,actor:'PriceLabs read-only market importer',status:'pending'};receipts.push(receipt);
      await writeFile(receiptPath,JSON.stringify(receipts),{mode:0o600});
      const saved=await savePricingResearch(db,input,receipt.actor);if(!saved.ok)throw Error(saved.conflict?'Research changed during import':'Save was not confirmed');
      receipt.status='saved';report.saved++;
      await writeFile(receiptPath,JSON.stringify(receipts),{mode:0o600});
    }
  }catch(error){if(error instanceof PriceLabsMarketUnavailable)report.unavailable++;else report.failed++;report.failures.push({index:matches.indexOf(match),reason:error instanceof Error&&error.name!=='ZodError'?error.message:'Provider data failed validation'});}
  if((report.validated+report.failed+report.unavailable)%4===0)console.log(JSON.stringify({validated:report.validated,saved:report.saved,unavailable:report.unavailable,failed:report.failed}));
}
console.log(JSON.stringify(report,null,2));
if(report.failed)process.exitCode=1;
