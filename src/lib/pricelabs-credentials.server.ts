import 'server-only';
import {createCipheriv,createDecipheriv,hkdfSync,randomBytes} from 'node:crypto';
import {z} from 'zod';

const secret=z.string().min(1).max(16384);
const credentialsSchema=z.object({
  clientId:secret,clientSecret:secret,
  token:z.object({access_token:secret,refresh_token:secret,scope:z.literal('read'),
    expires_in:z.number().positive().finite().max(366*86400),obtained_at:z.iso.datetime()}),
});
export type PriceLabsCredentials=z.infer<typeof credentialsSchema>;
const purpose='helm/pricelabs/read-only-credentials/v1';
function key(material:string){
  if(material.length<32)throw Error('PriceLabs encryption key is unavailable');
  // Purpose-separated from W-9 and every other service-role-key use. The key is
  // never stored beside the ciphertext; rotating it requires re-enrollment.
  return Buffer.from(hkdfSync('sha256',material,'helm-market-credentials',purpose,32));
}
export function sealPriceLabsCredentials(input:unknown,material:string):string {
  const value=credentialsSchema.parse(input),iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key(material),iv);cipher.setAAD(Buffer.from(purpose));
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),ciphertext.toString('base64url')].join('.');
}
export function openPriceLabsCredentials(payload:string,material:string):PriceLabsCredentials {
  try {
    if(payload.length>131072||!/^v1\.[\w-]{16}\.[\w-]{22}\.[\w-]+$/.test(payload))throw Error();
    const [,iv,tag,ciphertext]=payload.split('.'),decipher=createDecipheriv('aes-256-gcm',key(material),Buffer.from(iv,'base64url'));
    decipher.setAAD(Buffer.from(purpose));decipher.setAuthTag(Buffer.from(tag,'base64url'));
    return credentialsSchema.parse(JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext,'base64url')),decipher.final()]).toString('utf8')));
  }catch{throw Error('PriceLabs credentials could not be opened');}
}
export async function renewPriceLabsCredentials(input:PriceLabsCredentials,fetcher:typeof fetch=fetch,now=new Date()):Promise<PriceLabsCredentials> {
  const value=credentialsSchema.parse(input),obtained=Date.parse(value.token.obtained_at);
  if(obtained>now.getTime()+60000)throw Error('PriceLabs token time is invalid');
  if(obtained+value.token.expires_in*1000>now.getTime()+300000)return value;
  const response=await fetcher('https://pricelabs.co/oauth/token',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'refresh_token',refresh_token:value.token.refresh_token,client_id:value.clientId,client_secret:value.clientSecret}),
  });
  if(!response.ok)throw Error('PriceLabs authorization needs attention');
  // Never include a provider error body or OAuth response in diagnostics.
  const raw=await response.text();if(raw.length>100000)throw Error('PriceLabs token response is invalid');
  try {
    const renewed=JSON.parse(raw);
    return credentialsSchema.parse({...value,token:{...renewed,refresh_token:renewed.refresh_token??value.token.refresh_token,obtained_at:now.toISOString()}});
  }catch{throw Error('PriceLabs token response is not read-only or valid');}
}
