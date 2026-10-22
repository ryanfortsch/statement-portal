/** Reviewed, immutable single-unit staging destination. No production host or enable flag. */
import { z } from 'zod';
import type { BookingInventoryState } from './booking-inventory-consumer.ts';

export const stagingPropertyMappingSchema = z.object({
  propertyId: z.string().uuid(), roomTypeId: z.string().uuid(), ratePlanId: z.string().uuid(),
  propertyTitle: z.string().min(1).max(200).endsWith('Isolated Staging'),
  ratePlanTitle: z.string().min(1).max(200).startsWith('TEST ONLY - '),
  adults: z.number().int().min(1).max(50), children: z.number().int().min(0).max(50), infants: z.number().int().min(0).max(50),
}).strict();
export type StagingPropertyMapping = z.infer<typeof stagingPropertyMappingSchema>;
export const stagingInventoryRouteSchema = stagingPropertyMappingSchema.extend({
  environment: z.literal('staging'), helmProperty: z.string().regex(/^HELMTEST-[a-z0-9-]{1,100}$/),
  connection: z.string().min(1).max(160), generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reviewedAt: z.string().datetime({ offset: true }),
}).strict();
export type StagingInventoryRoute = z.infer<typeof stagingInventoryRouteSchema>;
export function bindInventoryRoute(raw: unknown, state: BookingInventoryState): Readonly<StagingInventoryRoute> {
  const r = stagingInventoryRouteSchema.parse(raw), c = state.configuration;
  if (r.helmProperty !== state.property || r.connection !== c.connection || r.generation !== c.generation || r.roomTypeId !== c.listing) {
    throw Error('Reviewed staging mapping does not match inventory configuration');
  }
  return Object.freeze(r);
}
export function propertyMapping(route: StagingInventoryRoute): StagingPropertyMapping {
  const { propertyId, roomTypeId, ratePlanId, propertyTitle, ratePlanTitle, adults, children, infants } = route;
  return { propertyId, roomTypeId, ratePlanId, propertyTitle, ratePlanTitle, adults, children, infants };
}
