/** Imported research is separate from saved rules and never writes live prices. */
import {z} from 'zod';
import {pricingEvidenceSchema} from './dynamic-pricing-evidence.ts';
export const pricingResearchRecordSchema=z.object({version:z.number().int().positive(),data:pricingEvidenceSchema,updated_at:z.string().datetime({offset:true})}).strict();
export type PricingResearchRecord=z.infer<typeof pricingResearchRecordSchema>;
export const pricingResearchSaveSchema=z.object({propertyId:z.string().min(1).max(100),version:z.number().int().nonnegative(),requestId:z.uuid(),data:pricingEvidenceSchema}).strict();
export type PricingResearchSave=z.infer<typeof pricingResearchSaveSchema>;
export type PricingResearchResult={ok:true;value:PricingResearchRecord}|{ok:false;error:string;conflict?:boolean};
export type PricingResearchSaveAction=(input:PricingResearchSave)=>Promise<PricingResearchResult>;
export function validatePricingResearch(input:unknown,now=new Date()):PricingResearchSave {
  if(new TextEncoder().encode(JSON.stringify(input)).length>900000)throw Error('Research file is too large.');
  const parsed=pricingResearchSaveSchema.parse(input),data=parsed.data;
  if(data.propertyId!==parsed.propertyId)throw Error('Research belongs to another listing.');
  if(!data.market.length&&!data.history.length)throw Error('Choose an export with daily rows.');
  if([data.marketObservedAt,data.historyObservedAt].some(t=>t&&Date.parse(t)>now.getTime()))throw Error('Observation time cannot be in the future.');
  return parsed;
}
