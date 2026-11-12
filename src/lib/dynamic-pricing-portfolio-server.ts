import 'server-only';
import type {FleetProperty} from './fleet';
import {readPricingWorkspace} from './dynamic-pricing-store';
import {dateInZone} from './dynamic-pricing-inputs';
import {pricingPortfolioRow,type PricingPortfolioRow} from './dynamic-pricing-portfolio';

/** Owner-gated caller. Bounded reads; return summaries, never the entire fleet's calendars/history. */
export async function readPricingPortfolio(fleet:FleetProperty[],now=new Date()):Promise<PricingPortfolioRow[]> {
  const rows:PricingPortfolioRow[]=new Array(fleet.length);
  let next=0;
  await Promise.all(Array.from({length:Math.min(4,fleet.length)},async()=>{
    while(next<fleet.length) {
      const index=next++,property=fleet[index],start=dateInZone(now,property.timezone);
      const home={id:property.id,name:property.name,city:property.city,bedrooms:property.bedrooms,authority:property.calendar_authority};
      try {rows[index]=pricingPortfolioRow(home,await readPricingWorkspace(home.id,now),start,now);}
      catch {rows[index]=pricingPortfolioRow(home,null,start,now);}
    }
  }));
  return rows;
}
