/** PriceLabs exports -> local, reviewable drafts. No network or channel writes. */
import Papa from 'papaparse';
import {pricingPolicySchema,type PricingPolicy} from './dynamic-pricing.ts';
import {emptyPricingDrafts,neutralPricingDraft,pricingDraftsSchema,pricingRuleCategories,type PricingDrafts,type PricingRuleCategory,type PricingOverride} from './dynamic-pricing-drafts.ts';
import {IMPORT_PRICE_MIN,IMPORT_PRICE_MAX,pricingImportSourceSchema} from './dynamic-pricing-import-source.ts';
type Row=Record<string,string>;
type Home={id:string;name:string;guestyListingId?:string|null};
export type PriceLabsExports={listings:string;groups:string;rules:string;overrides:string};
export type PriceLabsSettingsImport={drafts:PricingDrafts;rows:{id:string;name:string;sourceId:string;replaces:boolean;warnings:string[]}[];skipped:{name:string;reason:string}[]};
function records(csv:string,required:string[]){
  if(csv.length>2000000)throw Error('Choose exports smaller than 2 MB each.');
  const parsed=Papa.parse<Row>(csv,{header:true,skipEmptyLines:'greedy',transformHeader:h=>h.replace(/^\uFEFF/,'').trim(),transform:v=>v.trim()});
  if(parsed.errors.length||!required.every(h=>parsed.meta.fields?.includes(h)))throw Error(`Invalid export. Required columns: ${required.join(', ')}.`);
  if(parsed.data.length>1000)throw Error('At most 1,000 listings per import.');
  return parsed.data;
}
const clean=(s:string|undefined)=>(s??'').replace(/\s+/g,' ').trim();
const inherited=(s:string|undefined)=>/^Group Level\s*:/i.test(clean(s));
const setting=(s:string|undefined)=>clean(s).replace(/^Group Level\s*:\s*/i,'');
const absent=(s:string)=>!s||/^(None|Default|No Discount)$/i.test(s);
function unique(rows:Row[],key:string){const result=new Map<string,Row>();for(const r of rows){const id=r[key];if(!id||result.has(id))throw Error(`Missing or duplicate ${key}.`);result.set(id,r);}return result;}
function money(value:string){if(!value)return null;if(!/^\d+(\.\d{1,2})?$/.test(value))throw Error('Invalid price; use plain USD amounts.');const n=Math.round(Number(value)*100);if(n<IMPORT_PRICE_MIN||n>IMPORT_PRICE_MAX)throw Error('Price is outside Helm’s supported $1–$100,000 range.');return n;}

/** Parse the whole supported grammar; never silently drop an unfamiliar stay tier. */
export function parsePriceLabsMinimumStay(raw:string){
  let text=setting(raw),profile:string|null=null;
  const name=text.match(/^ACTIVE MINSTAY PROFILE\s*:\s*(.*?)\s+(Default\s*:.*)$/i);
  if(name){profile=name[1];text=name[2];}
  const base=text.match(/^Default\s*:\s*Fixed Weekday:\s*(\d+) nights?\s*\|\s*Weekend:\s*(\d+) nights?/i);
  if(!base)throw Error('Minimum-stay format needs manual review.');
  text=text.slice(base[0].length).trim();
  const values:Pick<PricingPolicy,'weekdayMinNights'|'weekendMinNights'|'lastMinStays'|'farMinStays'|'orphanMaxNights'|'orphanDiscountPct'|'lowestMinNights'|'adjacentMinNights'|'minimumBookingCents'|'orphanPreservesEvents'>={weekdayMinNights:Number(base[1]),weekendMinNights:Number(base[2]),lastMinStays:[],farMinStays:[],orphanMaxNights:0,orphanDiscountPct:0,lowestMinNights:1,adjacentMinNights:0,minimumBookingCents:0,orphanPreservesEvents:true};
  let section='';
  while(text){
    const header=text.match(/^(Last Minute|Far Out|Orphan Gaps)\s*:\s*/i);
    if(header){section=header[1].toLowerCase();text=text.slice(header[0].length).trim();continue;}
    const rule=text.match(/^Weekday:\s*(\d+) nights?\s*\|\s*Weekend:\s*(\d+) nights? (within|beyond) (\d+) nights?/i);
    if(rule&&((section==='last minute'&&rule[3]==='within')||(section==='far out'&&rule[3]==='beyond'))){
      const pair={weekday:Number(rule[1]),weekend:Number(rule[2])};
      if(section==='last minute')values.lastMinStays.push({...pair,withinDays:Number(rule[4])});else values.farMinStays.push({...pair,afterDays:Number(rule[4])});
      text=text.slice(rule[0].length).trim();continue;
    }
    const gap=text.match(/^Weekday: Gap Length nights?\s*\|\s*Weekend: Gap Length nights? for gaps between 1 and (\d+) nights?/i);
    if(section==='orphan gaps'&&gap){values.orphanMaxNights=Number(gap[1]);text=text.slice(gap[0].length).trim();continue;}
    throw Error('Minimum-stay rule is not yet supported; source retained for review.');
  }
  // Validate tier counts, thresholds, duplicate windows and supported night counts.
  pricingPolicySchema.parse({...neutralPricingDraft(100,100,100),...values});
  return {profile,values};
}

function convertRules(row:Row,base:number,min:number,max:number,isGroup=false){
  let policy=neutralPricingDraft(base,min,max);policy.maxCombinedDiscountPct=80;
  const categories=new Set<PricingRuleCategory>(),warnings:string[]=[];
  const own=(key:string)=>isGroup||!inherited(row[key]);
  const apply=(category:PricingRuleCategory,key:string,fn:(value:string)=>void)=>{const value=setting(row[key]);if(!value)return;fn(value);if(own(key))categories.add(category);};
  apply('lastMinute','Last Minute Prices',v=>{const m=v.match(/^(\d+(?:\.\d+)?)% discount within (\d+) days \((Gradual|Flat)\)$/);if(m){policy.lastMinuteDiscountPct=Number(m[1]);policy.lastMinuteDays=Number(m[2]);}else if(!/^No (Last Minute Prices|Discount)$/i.test(v))warnings.push('Market-driven last-minute pricing is retained for reference, not reproduced.');});
  apply('farOut','Far Out Prices',v=>{const m=v.match(/^After (\d+) days, gradual premium of (\d+(?:\.\d+)?)% over (\d+) days$/);if(m){policy.farOutStart=Number(m[1]);policy.farOutEnd=Number(m[1])+Number(m[3]);policy.farOutPremiumPct=Number(m[2]);}else if(!/^No Far Out Prices$/i.test(v))warnings.push('Market-driven far-out pricing is retained for reference, not reproduced.');});
  let profile:string|null=null;
  apply('minimumStay','Min Stay',v=>{const parsed=parsePriceLabsMinimumStay(v);policy={...policy,...parsed.values};profile=parsed.profile;});
  if(!setting(row['Min Stay']))warnings.push('Minimum-stay configuration was not included in this export.');
  apply('occupancy','Occupancy Based Adjustments',v=>{if(v!=='No occupancy based adjustment')warnings.push('PriceLabs occupancy model is retained for reference, not reproduced.');});
  apply('recency','Booking Recency Factor',v=>{if(v==='No Booking Recency Factor')policy.recencyEnabled=false;else if(/^Default: Gradual discount from 5% \(no bookings in the last 15 days\) up to 15% \(no bookings in the last 45 days\), affecting prices for the next 30 days\.$/.test(v))policy.recencyEnabled=true;else warnings.push('Booking-recency rule needs review.');});
  if(!row['Booking Recency Factor'])warnings.push('Booking-recency settings are missing from this export.');
  apply('limits','Safety Minimum Price',v=>{if(v==='Set Safety Minimum Price to 110% of last-year-same-day ADR for nights beyond 180 days from today.'){policy.safetyFloorEnabled=true;policy.safetyFloorAfterDays=180;warnings.push('Safety minimum requires historical ADR; Helm’s calculation has not been validated against PriceLabs.');}else if(!/^No Safety Minimum Price$/i.test(v))warnings.push('Safety minimum needs review.');});
  if(!isGroup&&!row['Safety Minimum Price'])warnings.push('Safety-minimum settings are missing from this export.');
  // Local review safeguards remain explicit and cannot silently truncate imported 50–60% discounts.
  categories.add('limits');
  const orphan=setting(row['Orphan Day Prices']);if(orphan&&!absent(orphan))warnings.push('Orphan-day price adjustment needs review; minimum-stay gaps are imported separately.');
  const days=setting(row['Weekend Days']),names=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const weekendDays=days?days.split(',').map(s=>names.indexOf(s.trim())):[5,6];
  if(weekendDays.some(n=>n<0)||new Set(weekendDays).size!==weekendDays.length)throw Error('Unrecognized weekend days.');
  const lengthOfStay:{nights:number;adjustmentPct:number}[]=[];
  for(const [key,nights] of [['Weekly Discounts',7],['Monthly Discounts',28]] as const){const v=setting(row[key]);if(!v)continue;const m=v.match(new RegExp(`^${key}: (\\d+(?:\\.\\d+)?)%$`));if(!m)warnings.push(`${key} need review.`);else lengthOfStay.push({nights,adjustmentPct:-Number(m[1])});}
  for(const key of ['Custom Seasonal Profile','Seasonality','Demand Factor Sensitivity','Portfolio Occupancy Based Adjustments','Check In - Check Out','Adjacent Factor','Day Of Week Pricing','Los Pricing','Extra Person Fee','Minimum Far Out Pricing','Min Weekend Pricing','Nhood Profile','Pricing Offset','Rounding','Smoothing','No Price Updates for Unavailable Nights']){
    const v=setting(row[key]);if(v&&!absent(v)&&v!=='No Demand Factor')warnings.push(`${key}: retained for reference; requires review.`);
  }
  const leadTimeModes={lastMinute:setting(row['Last Minute Prices']).endsWith('(Flat)')?'flat' as const:'gradual' as const,farOut:'gradual' as const};
  return {policy:pricingPolicySchema.parse(policy),ruleCategories:[...categories],warnings,profile,weekendDays,lengthOfStay,leadTimeModes};
}

function dateOverrides(rows:Row[],id:string){
  const warnings:string[]=[],overrides:PricingOverride[]=[];
  for(const [i,r] of rows.entries()){
    if(r['Listing Id']!==id)continue;
    if(r['PMS Name'].toLowerCase()!=='guesty')throw Error('Override PMS does not match Guesty.');
    if(r.Currency&&r.Currency!=='USD')throw Error('Only USD exports are supported.');
    if(r['Minimum Price']||r['Maximum Price']||r['Check In Check Out Enabled']==='1') {throw Error(`Date override ${r['Start Date']} contains unsupported bounds or arrival/departure rules; import stopped.`);}
    const minNights=r['Minimum Stay']?Number(r['Minimum Stay']):null,kind=r.Price?(r['Price Type']==='fixed'?'fixed':r['Price Type']==='percent'?'percent':null):'stay';
    if(!kind)throw Error(`Date override ${r['Start Date']} uses an unsupported price type; import stopped.`);
    overrides.push({id:`pl-date-${i}`,label:'PriceLabs date override',start:r['Start Date'],end:r['End Date'],kind,value:kind==='fixed'?money(r.Price)!:kind==='percent'?Number(r.Price):0,minNights,weekdays:[0,1,2,3,4,5,6]});
  }
  return {overrides,warnings};
}

export function importPriceLabsSettings(files:PriceLabsExports,homes:Home[],existing:PricingDrafts=emptyPricingDrafts(),at=new Date()):PriceLabsSettingsImport {
  if(new Set(homes.map(h=>h.id)).size!==homes.length)throw Error('Duplicate Helm property ID.');
  const listingRows=records(files.listings,['Listing ID','Listing Name','PMS Name','Min Price','Base Price','Max Price','Customization Group']);
  unique(listingRows,'Listing ID');
  const ruleRows=unique(records(files.rules,['Listing ID','Min Stay','Last Minute Prices','Far Out Prices']),'Listing ID');
  const groupRows=unique(records(files.groups,['Group Name','Min Stay']),'Group Name');
  const overrideRows=files.overrides.trim()?records(files.overrides,['Listing Id','PMS Name','Start Date','End Date','Minimum Stay']):[];
  const drafts:PricingDrafts=structuredClone(existing),rows:PriceLabsSettingsImport['rows']=[],skipped:PriceLabsSettingsImport['skipped']=[];
  const groupIds=new Map<string,string>();
  for(const [name,r] of groupRows){
    const id=`pricelabs:${name}`;const collision=drafts.groups.find(g=>g.name.toLowerCase()===name.toLowerCase()&&g.id!==id);
    if(collision)throw Error(`A local group named “${name}” already exists. Rename it before importing.`);
    const converted=convertRules(r,100,100,100,true);
    const group={id,name,parentId:null,policy:converted.policy,ruleCategories:converted.ruleCategories,overrides:[],weekendDays:converted.weekendDays,lengthOfStay:converted.lengthOfStay,leadTimeModes:converted.leadTimeModes};
    const index=drafts.groups.findIndex(g=>g.id===id);if(index<0)drafts.groups.push(group);else drafts.groups[index]=group;
    groupIds.set(name,id);
  }
  for(const r of listingRows){
    const id=r['Listing ID'],name=r['Listing Name'];
    if(r['PMS Name'].toLowerCase()!=='guesty'){skipped.push({name,reason:'Unsupported PMS; no name matching used.'});continue;}
    const matches=homes.filter(h=>h.guestyListingId===id);
    if(matches.length!==1){skipped.push({name,reason:matches.length?'Ambiguous Guesty ID.':'No matching active Helm property.'});continue;}
    const base=money(r['Base Price']),min=money(r['Min Price']),max=money(r['Max Price']);
    if(base===null){skipped.push({name:matches[0].name,reason:'No base price configured in PriceLabs.'});continue;}
    const rules=ruleRows.get(id);if(!rules)throw Error('A matched listing is missing its customization export.');
    if(!setting(rules['Min Stay']))throw Error('A matched listing has no exported minimum-stay settings.');
    const groupName=r['Customization Group'],groupId=groupName?groupIds.get(groupName):null;
    if(groupName&&!groupId)throw Error('A listing’s customization group is missing from the group export.');
    if(r['Customization Sub Group'])throw Error('Subgroup export is required before importing this listing.');
    if(!groupId&&Object.values(rules).some(inherited))throw Error('Inherited rules have no matching group.');
    if(groupId){const parent=groupRows.get(groupName)!;for(const [key,value] of Object.entries(rules)){if(inherited(value)&&parent[key]&&setting(value)!==setting(parent[key]))throw Error('Group and listing exports disagree. Download them again together.');}}
    const c=convertRules(rules,base,min??IMPORT_PRICE_MIN,max??IMPORT_PRICE_MAX),dates=dateOverrides(overrideRows,id),homeId=matches[0].id;
    const warnings=[...c.warnings,...dates.warnings];
    if(!files.overrides.trim())warnings.push('Date-specific overrides were not supplied.');
    const importSource=pricingImportSourceSchema.parse({vendor:'PriceLabs',importedAt:at.toISOString(),listingId:id,baseCents:base,minCents:min,maxCents:max,groupName,minimumStayProfile:c.profile,
      settings:Object.fromEntries(Object.entries(rules).filter(([k,v])=>v&&!['Listing ID','Listing Name','Notes'].includes(k))),warnings});
    // A source snapshot replaces only matched homes, with explicit review in the import dialog.
    drafts.homes[homeId]={policy:c.policy,version:(existing.homes[homeId]?.version??0)+1,groupId:groupId??null,inheritRules:false,ruleCategories:groupId?c.ruleCategories:pricingRuleCategories,
      overrides:dates.overrides,importSource,
      ...(inherited(rules['Weekend Days'])?{}:{weekendDays:c.weekendDays}),
      ...((inherited(rules['Weekly Discounts'])&&inherited(rules['Monthly Discounts']))?{}:{lengthOfStay:c.lengthOfStay}),leadTimeModes:c.leadTimeModes};
    if(drafts.assignments)delete drafts.assignments[homeId];
    rows.push({id:homeId,name:matches[0].name,sourceId:id,replaces:!!existing.homes[homeId],warnings});
  }
  for(const previous of existing.groups){const updated=drafts.groups.find(g=>g.id===previous.id);if(updated&&JSON.stringify(previous)!==JSON.stringify(updated)&&Object.entries(existing.homes).some(([id,h])=>h.groupId===previous.id&&!rows.some(r=>r.id===id)))throw Error('A group update would affect drafts outside this import. Include those listings before replacing the group.');}
  if(!rows.length)throw Error('No configured listings matched Helm’s Guesty IDs. No drafts changed.');
  return {drafts:pricingDraftsSchema.parse(drafts),rows,skipped};
}
