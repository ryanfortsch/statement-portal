'use client';
import type {PricingImportSource} from '@/lib/dynamic-pricing-import-source';
import type {PricingPolicy} from '@/lib/dynamic-pricing';
import {etStamp} from '@/lib/stable-time';
export default function PricingImportedSettings({source,policy,weekendDays,onMinimumStay}:{source:PricingImportSource;policy:PricingPolicy;weekendDays:number[];onMinimumStay:()=>void}){
  return <section className="pricing-imported-settings">
    <div className="pricing-stay-heading"><h3>Minimum stay</h3><button type="button" onClick={onMinimumStay}>Edit</button></div>
    {source.minimumStayProfile&&<p className="pricing-stay-profile">{source.minimumStayProfile}</p>}
    <div className="pricing-stay-pair"><span><strong>{policy.weekdayMinNights}</strong> weekday</span><span><strong>{policy.weekendMinNights}</strong> weekend</span></div>
    <p className="pricing-import-subtle">Weekend: {weekendDays.map(n=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][n]).join(', ')||'None'}</p>
    {(policy.lastMinStays.length>0||policy.farMinStays.length>0)&&<details className="pricing-stay-tiers"><summary>{policy.lastMinStays.length+policy.farMinStays.length} booking-window rules</summary><table aria-label="Minimum-stay tiers"><thead><tr><th>Booking window</th><th>Weekday</th><th>Weekend</th></tr></thead><tbody>{[...policy.lastMinStays].sort((a,b)=>a.withinDays-b.withinDays).map(r=><tr key={`l${r.withinDays}`}><td>Within {r.withinDays} days</td><td>{r.weekday}</td><td>{r.weekend}</td></tr>)}{[...policy.farMinStays].sort((a,b)=>a.afterDays-b.afterDays).map(r=><tr key={`f${r.afterDays}`}><td>After {r.afterDays} days</td><td>{r.weekday}</td><td>{r.weekend}</td></tr>)}</tbody></table></details>}
    {policy.orphanMaxNights>0&&<p className="pricing-import-subtle">Fill gaps of {policy.orphanMaxNights} {policy.orphanMaxNights===1?'night':'nights'} or fewer.</p>}
    <details><summary>PriceLabs source</summary><p>Imported {etStamp(source.importedAt)}{source.groupName?` · ${source.groupName}`:''}</p><p>Original settings below; edits above affect the Helm draft only.</p>{source.minCents===null||source.maxCents===null?<p>Unset PriceLabs limits stay blank. Helm previews support $1–$100,000 per night.</p>:null}<dl>{Object.entries(source.settings).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>{source.warnings.map(w=><p key={w}>{w}</p>)}</details>
  </section>;
}
