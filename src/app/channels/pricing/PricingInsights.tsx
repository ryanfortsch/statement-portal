'use client';
import {useMemo,useState} from 'react';
import {ResponsiveContainer,ComposedChart,Line,XAxis,YAxis,Tooltip,CartesianGrid,Legend} from 'recharts';
import {Button} from '@/components/Button';
import {etStamp} from '@/lib/stable-time';
import {analyzePricingEvidence,backtestOccupancy,forecastNight,priceResponseScenario,optimizeRatePath} from '@/lib/dynamic-pricing-model';
import {emptyPricingEvidence,importPriceLabsMarket,importPricingHistory,pricingEvidenceSchema,type PricingEvidence} from '@/lib/dynamic-pricing-evidence';
import type {PricingPolicy,PricingPreview,PricingSnapshot} from '@/lib/dynamic-pricing';
const money=(n:number|null)=>n===null?'—':`$${(n/100).toFixed(0)}`;
const pct=(n:number|null)=>n===null?'Insufficient data':`${n.toFixed(1)}%`;
const field='mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
export default function PricingInsights({propertyId,snapshot,preview,policy,busy,onSave,onUseLearned}:{propertyId:string;snapshot:PricingSnapshot;preview:PricingPreview|null;policy:PricingPolicy;busy:boolean;onSave:(e:PricingEvidence)=>Promise<boolean>;onUseLearned:(base:number)=>void}) {
  const evidence=useMemo(()=>snapshot.evidence??emptyPricingEvidence(propertyId),[snapshot.evidence,propertyId]);
  const [type,setType]=useState('market'),[source,setSource]=useState(''),[observed,setObserved]=useState(''),[pending,setPending]=useState<PricingEvidence|null>(null),[error,setError]=useState('');
  const [elasticity,setElasticity]=useState(2),[tab,setTab]=useState<'rates'|'occupancy'|'calendar'>('rates');
  const [calendarMonth,setCalendarMonth]=useState(snapshot.today.slice(0,7));
  const analysis=useMemo(()=>analyzePricingEvidence(evidence,snapshot.today,new Date(snapshot.observedAt)),[evidence,snapshot]);
  const forecasts=useMemo(()=>new Map(snapshot.days.map(d=>[d.date,forecastNight(evidence,d.date,snapshot.today,new Date(snapshot.observedAt))])),[evidence,snapshot]);
  const backtest=useMemo(()=>backtestOccupancy(evidence.history,snapshot.today),[evidence,snapshot.today]);
  const data=snapshot.days.map(d=>{const r=preview?.days.find(n=>n.date===d.date),m=evidence.market.find(n=>n.date===d.date),f=forecasts.get(d.date);
    return {date:d.date,current:d.currentCents===null?null:d.currentCents/100,helm:r?.recommendedCents==null?null:r.recommendedCents/100,
      vendor:m?.vendorCents==null?null:m.vendorCents/100,p25:m?.p25Cents==null?null:m.p25Cents/100,p75:m?.p75Cents==null?null:m.p75Cents/100,
      market:analysis.marketFresh?m?.occupancyPct:null,final:analysis.marketFresh&&m?.occupancyPct!=null&&f?.basis.startsWith('market')&&f.probability!==null?m.occupancyPct+(100-m.occupancyPct)*f.probability:null};});
  const months=[...new Set(snapshot.days.map(d=>d.date.slice(0,7)))].map(month=>{
    const days=snapshot.days.filter(d=>d.date.startsWith(month)),sellable=days.filter(d=>d.state==='open'||d.state==='booked'),booked=days.filter(d=>d.state==='booked').length;
    let expected=booked,low=booked,high=booked,missing=days.filter(d=>d.state==='unknown').length;
    for(const day of sellable.filter(d=>d.state==='open')){const f=forecasts.get(day.date)!;if(f.probability===null)missing++;else{expected+=f.probability;low+=f.low!;high+=f.high!;}}
    const stale=days.some(d=>Date.parse(snapshot.observedAt)-Date.parse(d.observedAt)>36*3600000||Date.parse(d.observedAt)>Date.parse(snapshot.observedAt));
    const valid=sellable.length>0&&!missing&&!stale;
    return {month,booked,sellable:sellable.length,blocked:days.filter(d=>d.state==='blocked').length,missing,expected:valid?100*expected/sellable.length:null,low:valid?100*low/sellable.length:null,high:valid?100*high/sellable.length:null};
  });
  const example=snapshot.days.find(d=>d.state==='open'&&forecasts.get(d.date)?.probability!=null);
  const ref=example?preview?.days.find(d=>d.date===example.date)?.recommendedCents:null;
  const scenario=example&&ref?priceResponseScenario(ref,forecasts.get(example.date)!.probability!,elasticity,policy.floorCents,policy.ceilingCents):null;
  const pathScenario=scenario&&ref&&example?optimizeRatePath(ref,policy.floorCents,policy.ceilingCents,[60,30,0].map(leadDays=>({leadDays,elasticity,probability:1-Math.pow(1-forecasts.get(example.date)!.probability!,1/3)}))):null;
  const monthDays=snapshot.days.filter(d=>d.date.startsWith(calendarMonth));
  const firstOffset=monthDays.length?new Date(monthDays[0].date+'T12:00:00Z').getUTCDay():0;
  async function readFile(file:File|undefined){setError('');setPending(null);if(!file)return;
    try{
      if(!source.trim())throw Error('Describe the market comparable set or historical source.');
      if(!observed)throw Error('Enter when the source data was observed; the download time may differ.');
      if(file.size>1500000)throw Error('Choose a file smaller than 1.5 MB');
      if(!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/.test(observed))throw Error('Use a local date and time in YYYY-MM-DD HH:MM format.');
      const timestamp=new Date(observed.replace(' ','T')).toISOString();if(Date.parse(timestamp)>Date.now())throw Error('Observation time cannot be in the future');
      const csv=await file.text();const next=type==='market'?{...evidence,market:importPriceLabsMarket(csv),marketSource:`PriceLabs export · ${source.trim()}`,marketObservedAt:timestamp}:
        {...evidence,history:importPricingHistory(csv),historySource:source.trim(),historyObservedAt:timestamp};
      setPending(pricingEvidenceSchema.parse(next));
    }catch(e){setError(e instanceof Error?e.message:'Could not read CSV');}
  }
  function download(){if(!preview)return;const lines=['date,current_usd,helm_usd,minimum_nights,publish_eligible',...preview.days.map(d=>[d.date,d.currentCents===null?'':d.currentCents/100,d.recommendedCents===null?'':d.recommendedCents/100,d.minNights??'',d.eligible].join(','))];
    const url=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/csv'})),a=document.createElement('a');a.href=url;a.download=`helm-pricing-${propertyId}-${snapshot.today}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <section className="space-y-5 rounded-2xl border bg-white p-5 sm:p-6" aria-label="Pricing intelligence">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-teal-700">Demand & evidence</p><h2 className="mt-1 text-xl font-semibold">See the market. Explain the price.</h2><p className="mt-2 max-w-3xl text-sm text-slate-500">Current bookings, projected pickup and asking prices answer different questions. Imported observations stay attached to this property and every publishing review.</p></div><Button disabled={!preview} onClick={download}>Export comparison</Button></div>
    <div className="grid gap-3 sm:grid-cols-3">{[
      ['Market evidence',`${analysis.marketNights} nights`,evidence.marketObservedAt?`${analysis.marketFresh?'Fresh':'Expired'} · ${etStamp(evidence.marketObservedAt)}`:'No daily market source connected'],
      ['Historical inventory',`${analysis.historyNights} nights`,`${analysis.shape.nights} priced booked nights · ${analysis.shape.monthsCovered} months`],
      ['Learned base reference',money(analysis.shape.baseCents),'Accommodation ADR reference; needs owner calibration'],
    ].map(([label,value,detail])=><div key={label} className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>)}</div>
    <p className="text-xs text-slate-500">{evidence.marketSource||'No market source'} · {evidence.historySource||'No historical source'}</p>
    <div className="flex flex-wrap gap-2"><Button size="sm" variant={tab==='rates'?'primary':'secondary'} onClick={()=>setTab('rates')}>Nightly prices</Button><Button size="sm" variant={tab==='occupancy'?'primary':'secondary'} onClick={()=>setTab('occupancy')}>Market booked & projected</Button><Button size="sm" variant={tab==='calendar'?'primary':'secondary'} onClick={()=>setTab('calendar')}>Pricing calendar</Button></div>
    {tab==='calendar'?<div><label className="text-sm">Calendar month<select className={field} value={calendarMonth} onChange={e=>setCalendarMonth(e.target.value)}>{months.map(m=><option key={m.month}>{m.month}</option>)}</select></label>
      <div className="mt-4 grid grid-cols-7 gap-1">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=><div key={d} className="p-2 text-center text-xs text-slate-500">{d}</div>)}{Array.from({length:firstOffset},(_,i)=><div key={`pad-${i}`}/>)}
        {monthDays.map(d=>{const r=preview?.days.find(n=>n.date===d.date);return <div key={d.date} className={`min-h-24 rounded-lg border p-2 ${d.state==='booked'?'bg-slate-200':d.state!=='open'?'bg-slate-50 text-slate-400':r?.eligible?'border-teal-200 bg-teal-50':'border-amber-200 bg-amber-50'}`} title={r?.steps.map(s=>s.label).join(' → ')}><p className="text-xs">{Number(d.date.slice(-2))}</p><p className="mt-2 text-sm font-semibold">{d.state==='open'?money(r?.recommendedCents??null):d.state}</p><p className="mt-1 text-[10px]">{d.state==='open'?`${r?.minNights??'—'} night min`:''}</p></div>;})}</div>
      <p className="mt-3 text-xs text-slate-500">Teal: eligible after review. Amber: needs review or protected. Bookings and blocked dates stay unchanged.</p></div>:<div className="h-80 w-full" role="img" aria-label={tab==='rates'?'Nightly Helm, current and PriceLabs price comparison':'Market on-the-books occupancy and final occupancy scenario'}>
      <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{top:8,right:12,left:0,bottom:4}}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="date" minTickGap={55} tickFormatter={s=>s.slice(5)} tick={{fontSize:11}}/><YAxis domain={tab==='occupancy'?[0,100]:['auto','auto']} tick={{fontSize:11}} tickFormatter={n=>tab==='rates'?`$${n}`:`${n}%`}/><Tooltip formatter={(v)=>typeof v==='number'?(tab==='rates'?`$${v.toFixed(0)}`:`${v.toFixed(1)}%`):v}/><Legend wrapperStyle={{fontSize:12}}/>
      {(tab==='rates'?[
        {key:'p25',name:'Market 25th asking',color:'#cbd5e1',dash:''},{key:'p75',name:'Market 75th asking',color:'#94a3b8',dash:''},
        {key:'current',name:'Current',color:'#64748b',dash:'4 4'},{key:'vendor',name:'PriceLabs export',color:'#e87965',dash:''},{key:'helm',name:'Helm',color:'#0f766e',dash:''},
      ]:[{key:'market',name:'Market booked now',color:'#64748b',dash:''},{key:'final',name:'Market final scenario',color:'#0f766e',dash:'5 3'}])
        .map(line=><Line key={line.key} dataKey={line.key} name={line.name} stroke={line.color} strokeDasharray={line.dash} strokeWidth={line.key==='helm'?2:1} dot={false} isAnimationActive={false}/>)}
      </ComposedChart></ResponsiveContainer>
    </div>}
    <p className="text-xs text-slate-500">Market rates are asking prices. The final-occupancy line uses last year’s final occupancy plus half the change in same-time booking pace; it is an uncalibrated scenario. Expired market rates remain visible for comparison only.</p>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="mb-3 text-left font-semibold">Your forward occupancy · visible nights in each month</caption><thead className="bg-slate-50"><tr>{['Month','Booked / sellable','Blocks','Projected final','Sensitivity range','Missing forecasts'].map(h=><th key={h} className="p-3 text-xs font-medium">{h}</th>)}</tr></thead><tbody>{months.map(m=><tr key={m.month} className="border-t"><td className="p-3">{m.month}</td><td className="p-3">{m.booked} / {m.sellable}</td><td className="p-3">{m.blocked}</td><td className="p-3 font-semibold text-teal-800">{pct(m.expected)}</td><td className="p-3">{m.low===null?'—':`${m.low.toFixed(0)}–${m.high!.toFixed(0)}%`}</td><td className="p-3">{m.missing}</td></tr>)}</tbody></table></div>
    <div className="flex flex-wrap gap-2 text-xs">{[
      `${preview?.days.filter(d=>d.eligible).length??0} nights eligible after review`,
      `${preview?.days.filter(d=>d.reasons.some(r=>r.includes('review limit'))).length??0} large price changes`,
      `${preview?.days.filter(d=>d.reasons.some(r=>r.includes('fit this gap'))).length??0} unfillable gaps`,
      `${snapshot.days.filter(d=>d.state==='unknown').length} unknown calendar nights`,
      `${preview?.days.filter(d=>d.recommendedCents===policy.floorCents).length??0} nights at price floor`,
    ].map(label=><span className="rounded-full bg-slate-100 px-3 py-2" key={label}>{label}</span>)}</div>
    <p className="text-xs text-slate-500">Booked nights count as 100%; each open night adds its conditional chance of selling. Blocks are excluded. Missing or stale calendar coverage suppresses the forecast. Ranges show sensitivity, not a guaranteed outcome or portfolio confidence interval.</p>
    <details className="border-t pt-4"><summary className="cursor-pointer font-medium">Historical learning and validation</summary>
      <p className="my-3 text-sm text-slate-500">Monthly medians are shrunk toward neutral when samples are sparse; weekday effects use the remaining price differences. These patterns describe past booked rates and can inherit the previous pricing provider’s decisions.</p>
      <Button disabled={!analysis.shape.qualified||busy} onClick={()=>onUseLearned(analysis.shape.baseCents!)}>Use learned base and price shape in draft</Button>
      <div className="my-4 grid grid-cols-4 gap-2 sm:grid-cols-6">{analysis.shape.monthlyFactors.map((f,i)=><div key={i} className="rounded-lg bg-slate-50 p-3 text-xs"><b>{new Date(2026,i,1).toLocaleString('en-US',{month:'short'})}</b><p>{f.toFixed(2)}× · {analysis.shape.monthCount[i]} nights</p></div>)}</div>
      <h3 className="font-medium">Walk-forward occupancy check</h3><p className="my-2 text-xs text-slate-500">Last 90 completed nights, training only on dates before each simulated decision. Brier score: lower is better. This retrospective test cannot reconstruct cancellations or changing owner blocks, and does not prove revenue uplift.</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Lead time','Evaluated nights','Brier','No-pickup baseline','Predicted / actual sales'].map(h=><th className="p-2 text-xs" key={h}>{h}</th>)}</tr></thead><tbody>{backtest.map(b=><tr key={b.lead} className="border-t"><td className="p-2">{b.lead} days</td><td className="p-2">{b.count}</td><td className="p-2">{b.brier?.toFixed(3)??'—'}</td><td className="p-2">{b.noPickupBrier?.toFixed(3)??'—'}</td><td className="p-2">{b.count?`${pct(b.predictedPct)} / ${pct(b.actualPct)}`:'More history needed'}</td></tr>)}</tbody></table></div>
    </details>
    <details className="border-t pt-4"><summary className="cursor-pointer font-medium">Price-response sandbox</summary><p className="my-3 text-sm text-slate-500">Explore how an assumed price response changes expected nightly revenue. This elasticity is supplied by you, not learned. This sandbox cannot publish prices.</p>
      <label className="block text-sm">Assumed price sensitivity: {elasticity.toFixed(1)}<input className="mt-2 block w-full" type="range" min="0.2" max="8" step="0.1" value={elasticity} onChange={e=>setElasticity(Number(e.target.value))}/></label>
      {scenario&&example?<p className="mt-3 text-sm">For {example.date}, this assumption selects {money(scenario.best.cents)} within your bounds, with {(scenario.best.probability*100).toFixed(0)}% modeled sale probability and {money(scenario.best.expectedCents)} expected revenue per available night. This is a sensitivity calculation, not a validated recommendation.</p>:<p className="mt-3 text-sm text-slate-500">Import usable market or historical evidence to enable the scenario.</p>}
      {pathScenario&&<p className="mt-3 text-sm text-slate-600">Rate-path experiment: with three equal conditional booking opportunities and the same sensitivity, dynamic programming selects {pathScenario.path.map(p=>money(p.cents)).join(' → ')} from far out to arrival. Expected revenue: {money(pathScenario.expectedCents)}. The opportunity split is an assumption; this path is not applied to your calendar.</p>}
    </details>
    <details className="border-t pt-4"><summary className="cursor-pointer font-medium">Import or replace evidence</summary><p className="my-3 text-sm text-slate-500">Use PriceLabs’ daily Neighborhood Data CSV for market comparison. Historical CSVs need one row per calendar night, including known open and blocked nights. Missing nights are never assumed vacant. Do not include guest information.</p>
      <div className="grid gap-3 sm:grid-cols-3"><label className="text-sm">Data type<select className={field} value={type} onChange={e=>{setType(e.target.value);setPending(null);}}><option value="market">PriceLabs daily market CSV</option><option value="history">Historical inventory CSV</option></select></label>
      <label className="text-sm">Source observation time<input type="text" placeholder="YYYY-MM-DD HH:MM (local time)" className={field} value={observed} onChange={e=>{setObserved(e.target.value);setPending(null);}}/></label>
      <label className="text-sm">{type==='history'?'History source':'Market comparable set'}<input className={field} value={source} onChange={e=>{setSource(e.target.value);setPending(null);}} placeholder={type==='history'?'Verified calendar export':'Area, bedrooms and listing count'}/></label></div>
      {type==='history'&&<p className="my-3 text-xs text-slate-500">Columns: date,state,booked_on,rent_cents. States: open, booked, blocked, unknown. Rent is accommodation only, allocated to the night; leave it blank when unknown. Booking date must be the original reservation date, not an import date.</p>}
      <label className="my-4 block text-sm">Choose CSV<input type="file" accept=".csv,text/csv" disabled={busy} className="mt-2 block text-sm" onChange={e=>void readFile(e.target.files?.[0])}/></label>
      {error&&<p role="alert" className="my-3 text-sm text-red-700">{error}</p>}
      {pending&&<div className="rounded-xl bg-amber-50 p-4 text-sm"><p>Ready for {propertyId}: {pending.market.length} market dates and {pending.history.length} historical nights. Saving replaces this data type, invalidates old publishing reviews, and changes no live rates.</p><Button className="mt-3" disabled={busy} onClick={async()=>{if(await onSave(pending))setPending(null);}}>Save evidence for this property</Button></div>}
    </details>
  </section>;
}
