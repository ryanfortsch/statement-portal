'use client';
import {Button} from '@/components/Button';
import type {PricingPolicy} from '@/lib/dynamic-pricing';
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const inputClass='mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
export function NumberField({label,value,onChange,step=1,currency=false,placeholder}:{placeholder?:string;label:string;value:number;onChange:(n:number)=>void;step?:number;currency?:boolean}) {
  return <label className="block text-sm text-slate-700">{label}<span className={currency?'pricing-money-input':undefined}>{currency&&<span aria-hidden="true">$</span>}<input aria-label={currency?`${label} in USD`:undefined} type="number" placeholder={placeholder} step={step} value={Number.isFinite(value)?value:''}
    onChange={e=>onChange(e.target.value===''?NaN:Number(e.target.value))} className={inputClass}/></span></label>;
}
export default function PricingPolicyFields({policy,modify,ruleSection,today}:{policy:PricingPolicy;modify:<K extends keyof PricingPolicy>(key:K,value:PricingPolicy[K])=>void;ruleSection:string;today:string}) {return <><section hidden={ruleSection!=='strategy'}><h3>Strategy</h3>
      <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm">Seasonality<select className={inputClass} value={policy.priceShape} onChange={e=>modify('priceShape',e.target.value as PricingPolicy['priceShape'])}>
        <option value="manual">Custom factors</option><option value="history">Historical rates</option><option value="market">Market rates</option></select></label>
        <label className="flex items-center gap-2 text-sm" title="Adjust for market occupancy and seven-day pickup"><input type="checkbox" checked={policy.marketPacingEnabled} onChange={e=>modify('marketPacingEnabled',e.target.checked)}/>Follow market pace</label></div>
      {policy.priceShape==='market'&&<p className="mt-2 text-xs text-slate-500">Requires 180 priced dates updated within 36 hours.</p>}
      <details className="mt-6 border-t pt-4"><summary className="cursor-pointer font-medium">Monthly and weekday factors</summary>
        <p className="my-3 text-sm text-slate-500">1.00 keeps the base price; 1.20 adds 20%. Used with manual seasonal pricing.</p>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">{months.map((label,i)=><NumberField key={label} label={label} step={0.05} value={policy.monthlyFactors[i]}
          onChange={n=>modify('monthlyFactors',policy.monthlyFactors.map((v,j)=>j===i?n:v))}/>)}</div>
        <div className="mt-4 grid grid-cols-4 gap-3 sm:grid-cols-7">{weekdays.map((label,i)=><NumberField key={label} label={label} step={0.05} value={policy.weekdayFactors[i]}
          onChange={n=>modify('weekdayFactors',policy.weekdayFactors.map((v,j)=>j===i?n:v))}/>)}</div>
      </details>
      </section><section hidden={ruleSection!=='adjustments'}><h3>Adjustments</h3>
        <div className="my-4 grid gap-4 sm:grid-cols-3">
          <NumberField label="Same-day discount (%)" value={policy.lastMinuteDiscountPct} onChange={n=>modify('lastMinuteDiscountPct',n)}/>
          <NumberField label="Discount fades over (days)" value={policy.lastMinuteDays} onChange={n=>modify('lastMinuteDays',n)}/>
          <NumberField label="Combined discount limit (%)" value={policy.maxCombinedDiscountPct} onChange={n=>modify('maxCombinedDiscountPct',n)}/>
          <NumberField label="Far-out premium starts (days)" value={policy.farOutStart} onChange={n=>modify('farOutStart',n)}/>
          <NumberField label="Full premium at (days)" value={policy.farOutEnd} onChange={n=>modify('farOutEnd',n)}/>
          <NumberField label="Far-out premium (%)" value={policy.farOutPremiumPct} onChange={n=>modify('farOutPremiumPct',n)}/>
          <NumberField label="Maximum change for publishing (%)" value={policy.maxChangePct} onChange={n=>modify('maxChangePct',n)}/>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={policy.occupancyEnabled} onChange={e=>modify('occupancyEnabled',e.target.checked)}/>Adjust for booked occupancy versus my targets</label>
        <div hidden={!policy.occupancyEnabled}><p className="my-2 text-sm text-slate-500">Uses booked occupancy, excluding blocks. Each point off target adjusts price by 0.5%, up to your limit.</p>
        <div className="my-4 grid gap-4 sm:grid-cols-4">{['Next 15 nights target (%)','Nights 16–30 target (%)','Nights 31–60 target (%)'].map((label,i)=><NumberField key={label} label={label} value={policy.occupancyTargets[i]}
          onChange={n=>modify('occupancyTargets',policy.occupancyTargets.map((v,j)=>j===i?n:v))}/>)}
          <NumberField label="Occupancy adjustment limit (%)" value={policy.occupancyMaxAdjustmentPct} onChange={n=>modify('occupancyMaxAdjustmentPct',n)}/></div>
        </div><label className="flex items-center gap-2 text-sm" title="Requires a verified booking timestamp"><input type="checkbox" checked={policy.recencyEnabled} onChange={e=>modify('recencyEnabled',e.target.checked)}/>Booking recency discount</label>
        <details className="pricing-rule-details"><summary>Historical price floor</summary>        <label className="my-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={policy.safetyFloorEnabled} onChange={e=>modify('safetyFloorEnabled',e.target.checked)}/>Safety floor at 110% of matched last-year accommodation ADR</label>
        <NumberField label="Safety floor beyond (days)" value={policy.safetyFloorAfterDays} onChange={n=>modify('safetyFloorAfterDays',n)}/>
        <p className="my-2 text-xs text-slate-500">Needs at least two booked samples matching the weekday around 52 weeks earlier. Explicit events are excluded; your maximum price still wins.</p>
</details>
      </section>
      <section hidden={ruleSection!=='stays'}><h3>Minimum stays</h3>
        <div className="my-4 grid gap-4 sm:grid-cols-4">
          <NumberField label="Weekday minimum nights" value={policy.weekdayMinNights} onChange={n=>modify('weekdayMinNights',n)}/>
          <NumberField label="Weekend minimum nights" value={policy.weekendMinNights} onChange={n=>modify('weekendMinNights',n)}/>
          <NumberField label="Fill gaps up to (nights; 0 disables)" value={policy.orphanMaxNights} onChange={n=>modify('orphanMaxNights',n)}/>
          <NumberField label="Gap discount (%)" value={policy.orphanDiscountPct} onChange={n=>modify('orphanDiscountPct',n)}/>
        </div>
        <details className="pricing-rule-details"><summary>Advanced stay rules</summary><div className="my-4 grid gap-4 sm:grid-cols-3">
          <NumberField label="Lowest permitted minimum nights" value={policy.lowestMinNights} onChange={n=>modify('lowestMinNights',n)}/>
          <NumberField label="Minimum booking value ($; 0 disables)" value={policy.minimumBookingCents/100} onChange={n=>modify('minimumBookingCents',Math.round(n*100))}/>
          <NumberField label="Minimum after booked/block night (0 disables)" value={policy.adjacentMinNights} onChange={n=>modify('adjacentMinNights',n)}/>
        </div>
        <p className="my-2 text-xs text-slate-500">Booking-value rules set a minimum stay, not a guaranteed booking total.</p>
        <label className="my-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={policy.orphanPreservesEvents} onChange={e=>modify('orphanPreservesEvents',e.target.checked)}/>Preserve event minimums even inside short gaps</label>
        {policy.lastMinStays.map((r,i)=><div key={i} className="my-3 grid grid-cols-4 gap-3"><NumberField label={`Last minute ${i+1}: within days`} value={r.withinDays} onChange={n=>modify('lastMinStays',policy.lastMinStays.map((v,j)=>j===i?{...v,withinDays:n}:v))}/><NumberField label={`Last minute ${i+1}: weekdays`} value={r.weekday} onChange={n=>modify('lastMinStays',policy.lastMinStays.map((v,j)=>j===i?{...v,weekday:n}:v))}/><NumberField label={`Last minute ${i+1}: Weekend`} value={r.weekend} onChange={n=>modify('lastMinStays',policy.lastMinStays.map((v,j)=>j===i?{...v,weekend:n}:v))}/><Button onClick={()=>modify('lastMinStays',policy.lastMinStays.filter((_,j)=>i!==j))}>Remove</Button></div>)}
        <Button disabled={policy.lastMinStays.length>=8} onClick={()=>modify('lastMinStays',[...policy.lastMinStays,{withinDays:7+policy.lastMinStays.length*7,weekday:1,weekend:2}])}>Add last-minute stay rule</Button>
        {policy.farMinStays.map((r,i)=><div key={i} className="my-3 grid grid-cols-4 gap-3">
          <NumberField label={`Rule ${i+1}: beyond days`} value={r.afterDays} onChange={n=>modify('farMinStays',policy.farMinStays.map((v,j)=>j===i?{...v,afterDays:n}:v))}/>
          <NumberField label={`Rule ${i+1}: weekdays`} value={r.weekday} onChange={n=>modify('farMinStays',policy.farMinStays.map((v,j)=>j===i?{...v,weekday:n}:v))}/>
          <NumberField label={`Rule ${i+1}: Weekend`} value={r.weekend} onChange={n=>modify('farMinStays',policy.farMinStays.map((v,j)=>j===i?{...v,weekend:n}:v))}/>
          <Button onClick={()=>modify('farMinStays',policy.farMinStays.filter((_,j)=>j!==i))}>Remove</Button>
        </div>)}
        <Button disabled={policy.farMinStays.length>=5} onClick={()=>modify('farMinStays',[...policy.farMinStays,{afterDays:[15,30,60,90,180].find(d=>!policy.farMinStays.some(r=>r.afterDays===d))??365,weekday:2,weekend:3}])}>Add far-out stay rule</Button>
        </details>
      </section>
      <section hidden={ruleSection!=='events'}><h3>Events</h3>
        <p className="my-3 text-sm text-slate-500">Add dates, a price adjustment and an optional minimum stay.</p>
        {policy.events.map((e,i)=><div key={i} className="my-3 grid items-end gap-3 rounded-lg border p-3 sm:grid-cols-3">
          <label className="text-sm">Event name<input aria-label={`Event ${i+1} name`} className={inputClass} value={e.label} onChange={a=>modify('events',policy.events.map((v,j)=>j===i?{...v,label:a.target.value}:v))}/></label>
          {(['start','end'] as const).map(key=><label key={key} className="text-sm">{key==='start'?'First night':'Last night'}<input aria-label={`Event ${i+1} ${key}`} type="date" className={inputClass} value={e[key]} onChange={a=>modify('events',policy.events.map((v,j)=>j===i?{...v,[key]:a.target.value}:v))}/></label>)}
          <NumberField label={`Event ${i+1} adjustment (%)`} value={e.adjustmentPct} onChange={n=>modify('events',policy.events.map((v,j)=>j===i?{...v,adjustmentPct:n}:v))}/>
          <NumberField label={`Event ${i+1} minimum nights (0 uses policy)`} value={e.minNights??0} onChange={n=>modify('events',policy.events.map((v,j)=>j===i?{...v,minNights:n===0?null:n}:v))}/>
          <Button onClick={()=>modify('events',policy.events.filter((_,j)=>j!==i))}>Remove event</Button>
        </div>)}
        <Button disabled={policy.events.length>=40} onClick={()=>modify('events',[...policy.events,{start:today,end:today,label:'New event',adjustmentPct:0,minNights:null}])}>Add event</Button>
      </section>
</>;}
