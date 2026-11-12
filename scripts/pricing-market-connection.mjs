/** Operator-only enrollment/status. Never prints ciphertext or credential values. */
import {readFile,lstat,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {sealPriceLabsCredentials} from '../src/lib/pricelabs-credentials.server.ts';
import {marketDatabase} from '../src/lib/pricelabs-market-refresh.server.ts';

async function main(){
  const args=process.argv.slice(2),action=args[0];
  if(!['--status','--enroll','--disable','--enable'].includes(action)||
    (action==='--enroll'?(args.length!==3||args[1]!=='--credentials'):args.length!==1))throw Error('Usage: --status | --disable | --enable | --enroll --credentials PRIVATE_DIRECTORY');
  const db=marketDatabase();
  if(action==='--status'){
    const {data,error}=await db.from('helm_pricing_market_connection').select('enabled,updated_at,lease_until,last_started_at,last_finished_at,last_report').eq('id',true).maybeSingle();
    if(error)throw Error('Connection status could not be read');
    console.log(JSON.stringify(data??{enabled:false,enrolled:false},null,2));return;
  }
  let ciphertext=null;
  if(action==='--enroll'){
    const directory=resolve(args[2]),root=await lstat(directory);
    if(!root.isDirectory()||root.isSymbolicLink()||(root.mode&0o077))throw Error('Credential directory must be private (0700)');
    async function privateJson(name){const path=join(directory,name),stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077))throw Error('Credential files must be private (0600)');return JSON.parse(await readFile(path,'utf8'));}
    const fields=await privateJson('credential-fields.json'),token=await privateJson('token.json');
    ciphertext=sealPriceLabsCredentials({clientId:fields.find(f=>f.id==='credentials-client-id')?.value,clientSecret:fields.find(f=>f.id==='credentials-client-secret')?.value,token},process.env.SUPABASE_SERVICE_ROLE_KEY??'');
    // Mark before sending so a lost enrollment response cannot allow the local
    // importer to consume the same rotating refresh token as the server.
    await writeFile(join(directory,'server-managed.json'),JSON.stringify({managed:true,requested_at:new Date().toISOString()}),{mode:0o600,flag:'wx'});
  }
  const {error}=await db.rpc('helm_configure_pricing_market',{p_ciphertext:ciphertext,p_enabled:action!=='--disable'});
  if(error)throw Error('Connection update not confirmed. Check --status before retrying; an active lease may need to expire.');
  console.log(action==='--disable'?'Automatic market refresh disabled.':'Server connection enabled. Verify --status after the next refresh.');
}
try{await main();}catch(error){
  // Schema errors can contain input values. Never log raw exceptions.
  console.error(error instanceof Error&&error.name==='Error'?error.message:'Connection operation failed validation');process.exitCode=1;
}
