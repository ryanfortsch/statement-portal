/** Provenance for device-local settings imports, never an authorization to sync. */
import {z} from 'zod';
export const pricingImportSourceSchema=z.object({
  vendor:z.literal('PriceLabs'),importedAt:z.string().datetime(),listingId:z.string().min(1).max(100),
  baseCents:z.number().int().positive(),minCents:z.number().int().positive().nullable(),maxCents:z.number().int().positive().nullable(),
  groupName:z.string().max(100),minimumStayProfile:z.string().max(100).nullable(),
  settings:z.record(z.string().max(100),z.string().max(6000)),warnings:z.array(z.string().max(500)).max(60),
}).strict();
export type PricingImportSource=z.infer<typeof pricingImportSourceSchema>;
/** These are Helm's supported numeric range, not invented PriceLabs settings. */
export const IMPORT_PRICE_MIN=100,IMPORT_PRICE_MAX=10000000;
export function importedPricingBound(policy:{floorCents:number;ceilingCents:number},source:PricingImportSource|undefined,key:'min'|'max'){
  const value=key==='min'?policy.floorCents:policy.ceilingCents;
  return source?.[key==='min'?'minCents':'maxCents']===null&&value===(key==='min'?IMPORT_PRICE_MIN:IMPORT_PRICE_MAX)?null:value;
}
