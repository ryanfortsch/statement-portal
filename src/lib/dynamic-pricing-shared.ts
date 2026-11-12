import {z} from 'zod';
import {PRICING_DRAFT_STORAGE,emptyPricingDrafts,pricingDraftsSchema,pricingSeasonConflicts,resolvePricingDraft,type PricingDrafts} from './dynamic-pricing-drafts.ts';

export const PRICING_SHARED_BASE_STORAGE='helm-pricing-shared-base-v1';
export const PRICING_DRAFT_BACKUP_STORAGE='helm-pricing-backups-v1';
export const MAX_PRICING_SETTINGS_BYTES=512000;
export const pricingSharedRecordSchema=z.object({
  revision:z.number().int().min(0),settings:pricingDraftsSchema,
  updated_at:z.string().nullable(),updated_by:z.string().nullable(),
}).strict();
export type PricingSharedRecord=z.infer<typeof pricingSharedRecordSchema>;
export const emptyPricingSharedRecord=():PricingSharedRecord=>({revision:0,settings:emptyPricingDrafts(),updated_at:null,updated_by:null});
export const pricingSharedSaveSchema=z.object({expectedRevision:z.number().int().min(0),requestId:z.uuid(),settings:pricingDraftsSchema}).strict();
export type PricingSharedSave=z.infer<typeof pricingSharedSaveSchema>;
export type PricingSharedResult={ok:true;value:PricingSharedRecord}|{ok:false;error:string;conflict?:boolean;retryable?:boolean};
export type PricingSharedServices={read:()=>Promise<PricingSharedResult>;save:(input:PricingSharedSave)=>Promise<PricingSharedResult>};

/** JSONB reorders object keys; arrays (including rule precedence) stay ordered. */
export function pricingSettingsKey(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(pricingSettingsKey).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).filter(k=>(value as Record<string,unknown>)[k]!==undefined).sort().map(k=>`${JSON.stringify(k)}:${pricingSettingsKey((value as Record<string,unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value)??'null';
}
export const samePricingSettings=(a:PricingDrafts,b:PricingDrafts)=>pricingSettingsKey(a)===pricingSettingsKey(b);
export function pricingSharedChoice(local:PricingDrafts,remote:PricingSharedRecord,base:PricingSharedRecord|null):'same'|'load'|'local'|'conflict' {
  if(base&&remote.revision<base.revision)return 'conflict';
  if(samePricingSettings(local,remote.settings))return 'same';
  if(base&&samePricingSettings(local,base.settings))return 'load';
  if(base&&samePricingSettings(remote.settings,base.settings))return 'local';
  if(!base&&samePricingSettings(local,emptyPricingDrafts()))return 'load';
  if(remote.revision===0)return 'local';
  return 'conflict';
}
export function validateSharedPricingSettings(raw:unknown,knownIds:ReadonlySet<string>):PricingDrafts {
  if(new TextEncoder().encode(JSON.stringify(raw)).length>MAX_PRICING_SETTINGS_BYTES)throw Error('Pricing settings exceed 500 KB.');
  const settings=pricingDraftsSchema.parse(raw);
  const ids=[...new Set([...Object.keys(settings.homes),...Object.keys(settings.assignments??{})])];
  if(ids.length>200)throw Error('At most 200 listings can be saved.');
  if(ids.some(id=>!knownIds.has(id)))throw Error('Settings contain an unknown property.');
  for(const id of Object.keys(settings.homes))resolvePricingDraft(settings,id);
  if(pricingSeasonConflicts(settings).length)throw Error('Resolve conflicting seasonal prices before saving.');
  return settings;
}
export function pricingSettingsDiff(local:PricingDrafts,remote:PricingDrafts) {
  const homes=[...new Set([...Object.keys(local.homes),...Object.keys(remote.homes),...Object.keys(local.assignments??{}),...Object.keys(remote.assignments??{})])]
    .filter(id=>pricingSettingsKey([local.homes[id]??null,local.assignments?.[id]??null])!==pricingSettingsKey([remote.homes[id]??null,remote.assignments?.[id]??null]));
  const groups=[...new Set([...local.groups,...remote.groups].map(g=>g.id))].filter(id=>pricingSettingsKey(local.groups.find(g=>g.id===id)??null)!==pricingSettingsKey(remote.groups.find(g=>g.id===id)??null));
  return {homes,groups,account:pricingSettingsKey(local.account??null)!==pricingSettingsKey(remote.account??null)};
}

export const pricingRecoverySchema=z.array(z.object({at:z.iso.datetime(),settings:pricingDraftsSchema}).strict()).max(5);
export type PricingRecovery=z.infer<typeof pricingRecoverySchema>;
type BrowserStore=Pick<Storage,'getItem'|'setItem'>;
export function assertPricingBrowserUnchanged(storage:BrowserStore,current:PricingDrafts) {
  const raw=storage.getItem(PRICING_DRAFT_STORAGE);
  const disk=raw?pricingDraftsSchema.parse(JSON.parse(raw)):emptyPricingDrafts();
  if(!samePricingSettings(disk,current))throw Error('Drafts changed in another tab. Reload before saving.');
}
export function replacePricingBrowserSettings(storage:BrowserStore,current:PricingDrafts,next:PricingDrafts,at=new Date().toISOString()):PricingDrafts {
  const parsed=pricingDraftsSchema.parse(next);
  assertPricingBrowserUnchanged(storage,current);
  const raw=storage.getItem(PRICING_DRAFT_BACKUP_STORAGE);
  const backups=raw?pricingRecoverySchema.parse(JSON.parse(raw)):[];
  storage.setItem(PRICING_DRAFT_BACKUP_STORAGE,JSON.stringify([{at,settings:current},...backups].slice(0,5)));
  storage.setItem(PRICING_DRAFT_STORAGE,JSON.stringify(parsed));
  return parsed;
}

/** Leaf-level comparisons make rule changes reviewable without exposing JSON. */
export function pricingSettingChanges(browser:unknown,helm:unknown):{field:string;browser:string;helm:string}[] {
  const rows:{field:string;browser:string;helm:string}[]=[];
  function label(path:string[]) {
    return path.map((part,i)=>{
      if(/^\d+$/.test(part)) {
        if(path[i-1]==='monthlyFactors')return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(part)]??part;
        if(path[i-1]==='weekdayFactors')return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][Number(part)]??part;
        return String(Number(part)+1);
      }
      return ({baseCents:'Base price',floorCents:'Minimum price',ceilingCents:'Maximum price',minNights:'Minimum nights',groupId:'Group',inheritRules:'Inherit group rules',ruleCategories:'Listing rule overrides',importSource:'PriceLabs source',policy:'Prices and rules',updatedAt:'Updated'} as Record<string,string>)[part]??part.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ');
    }).join(' / ');
  }
  function format(value:unknown,path:string[]) {
    if(value===null||value===undefined)return '—';
    if(typeof value==='boolean')return value?'Yes':'No';
    if(typeof value==='number'&&/Cents$/.test(path.at(-1)??''))return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:2}).format(value/100);
    return String(value);
  }
  function walk(a:unknown,b:unknown,path:string[]) {
    if(pricingSettingsKey(a)===pricingSettingsKey(b))return;
    if((a&&typeof a==='object')||(b&&typeof b==='object')) {
      const x=(a&&typeof a==='object'?a:{}) as Record<string,unknown>,y=(b&&typeof b==='object'?b:{}) as Record<string,unknown>;
      for(const key of new Set([...Object.keys(x),...Object.keys(y)]))walk(x[key],y[key],[...path,key]);
    } else rows.push({field:label(path),browser:format(a,path),helm:format(b,path)});
  }
  walk(browser,helm,[]);return rows;
}
