import {houseDay} from './house-date.ts';

/** Display rounding only. Calculations, sorting and published rates keep their cents. */
export function pricingMoney(cents:number|null|undefined, exact=false):string {
  if(cents==null||!Number.isFinite(cents))return '–';
  return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:exact&&cents%100!==0?2:0,maximumFractionDigits:exact?2:0}).format(cents/100);
}
export function pricingPercent(value:number|null|undefined):string {
  return value==null||!Number.isFinite(value)?'–':`${Math.round(value)}%`;
}

/** Inclusive stay dates, using calendar days rather than the viewer's time zone. */
export function pricingDateRange(start:string,end:string):string {
  const day=(date:string)=>houseDay(date).split(', ')[1];
  const from=day(start),to=day(end);
  if(!from||!to)return 'Dates unavailable';
  if(start===end)return `${from}, ${start.slice(0,4)}`;
  return start.slice(0,4)===end.slice(0,4)?`${from} – ${to}, ${end.slice(0,4)}`:
    `${from}, ${start.slice(0,4)} – ${to}, ${end.slice(0,4)}`;
}

export function pricingPeriodDates(windows:{start:string;end:string}[]):string {
  if(!windows.length)return 'Dates unavailable';
  const first=windows[0];
  return windows.every(w=>w.start===first.start&&w.end===first.end)?pricingDateRange(first.start,first.end):'Local dates vary by property';
}
