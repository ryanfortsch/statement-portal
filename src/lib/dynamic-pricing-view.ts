import type {PriceRecommendation, PricingDay, PricingPreview, PricingSnapshot} from './dynamic-pricing.ts';

export type PricingNightStatus = 'ready' | 'review' | 'manual' | 'booked' | 'blocked' | 'unknown';
export function pricingNightStatus(day: PricingDay, recommendation?: PriceRecommendation): PricingNightStatus {
  if (day.state !== 'open') return day.state;
  if (day.protected) return 'manual';
  return recommendation?.eligible ? 'ready' : 'review';
}
export const needsPricingAttention = (status: PricingNightStatus) => status === 'review' || status === 'unknown';

/** Pad the actual month, including dates outside the forecast. Never invent open inventory. */
export function pricingCalendarMonth(month: string, snapshot: PricingSnapshot, preview: PricingPreview | null, currentOnly=false) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('Invalid month');
  const [year, number] = month.split('-').map(Number);
  const first = new Date(`${month}-01T12:00:00Z`).getUTCDay();
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const source = new Map(snapshot.days.map(d => [d.date, d]));
  const recommendations = new Map(preview?.days.map(d => [d.date, d]));
  return Array.from({length: Math.ceil((first + count) / 7) * 7}, (_, index) => {
    const dayNumber = index - first + 1;
    if (dayNumber < 1 || dayNumber > count) return null;
    const date = `${month}-${String(dayNumber).padStart(2, '0')}`;
    const day = source.get(date), recommendation = recommendations.get(date);
    return {date, dayNumber, day, recommendation, status: day ? (currentOnly&&day.state==='open'?'ready' as const:pricingNightStatus(day, recommendation)) : null};
  });
}
