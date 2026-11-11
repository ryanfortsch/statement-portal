'use client';
import {useMemo,useState} from 'react';
import {ResponsiveContainer,ComposedChart,Line,XAxis,YAxis,Tooltip,CartesianGrid,Legend} from 'recharts';
import {Button} from '@/components/Button';
import {useUnsavedWorkGuard} from '@/lib/unsaved-work';
import {etStamp} from '@/lib/stable-time';
import {analyzePricingEvidence,backtestOccupancy,forecastNight,priceResponseScenario,optimizeRatePath} from '@/lib/dynamic-pricing-model';
import {emptyPricingEvidence,importPriceLabsMarket,importPricingHistory,pricingEvidenceSchema,type PricingEvidence} from '@/lib/dynamic-pricing-evidence';
import type {PricingPolicy,PricingPreview,PricingSnapshot} from '@/lib/dynamic-pricing';
const money=(n:number|null)=>n===null?'–':`$${(n/100).toFixed(0)}`;
const pct=(n:number|null)=>n===null?'Unavailable':`${n.toFixed(1)}%`;
const field='mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
export default function PricingInsights({view,propertyId,snapshot,preview,policy,busy,onSave,onUseLearned}:{view:'prices'|'market'|'occupancy'|'data'|'hidden';propertyId:string;snapshot:PricingSnapshot;preview:PricingPreview|null;policy:PricingPolicy;busy:boolean;onSave:(e:PricingEvidence)=>Promise<boolean>;onUseLearned:(base:number)=>void}) {
  const evidence=useMemo(()=>snapshot.evidence??emptyPricingEvidence(propertyId),[snapshot.evidence,propertyId]);
  const [type,setType]=useState('market'),[source,setSource]=useState(''),[observed,setObserved]=useState(''),[pending,setPending]=useState<PricingEvidence|null>(null),[error,setError]=useState('');
  const [elasticity,setElasticity]=useState(2);
  const [chartDays,setChartDays]=useState(90);
  const [chartOpen,setChartOpen]=useState(false),[marketChartOpen,setMarketChartOpen]=useState(false);
  useUnsavedWorkGuard(!!pending);
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
  function chart(kind:'rates'|'occupancy') {return <div className="pricing-chart" role="img" aria-label={kind==='rates'?'Current, proposed and market prices':'Market booked and projected occupancy'}>
    <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data.slice(0,chartDays)} margin={{top:8,right:12,left:0,bottom:4}}><CartesianGrid stroke="#e6ebe8" strokeDasharray="2 4" vertical={false}/><XAxis axisLine={false} tickLine={false} dataKey="date" minTickGap={55} tickFormatter={s=>s.slice(5)} tick={{fontSize:11}}/><YAxis axisLine={false} tickLine={false} domain={kind==='occupancy'?[0,100]:['auto','auto']} tick={{fontSize:11}} tickFormatter={n=>kind==='rates'?`$${n}`:`${n}%`}/><Tooltip formatter={(v)=>typeof v==='number'?(kind==='rates'?`$${v.toFixed(0)}`:`${v.toFixed(1)}%`):v}/><Legend formatter={value=><span className="pricing-chart-label">{value}</span>} wrapperStyle={{fontSize:11}}/>
    {(kind==='rates'?[
      {key:'p25',name:'Market P25',color:'#cbd5e1',dash:''},{key:'p75',name:'Market P75',color:'#94a3b8',dash:''},
      {key:'current',name:'Current',color:'#64748b',dash:'4 4'},{key:'vendor',name:'PriceLabs export',color:'#b58d5f',dash:''},{key:'helm',name:'Helm',color:'#2b685b',dash:''},
    ]:[{key:'market',name:'Booked',color:'#64748b',dash:''},{key:'final',name:'Projected',color:'#0f766e',dash:'5 3'}]).map(line=><Line key={line.key} dataKey={line.key} name={line.name} stroke={line.color} strokeDasharray={line.dash} strokeWidth={line.key==='helm'?2:1} dot={false} isAnimationActive={false}/>)}</ComposedChart></ResponsiveContainer>
  </div>;}
  return <div hidden={view==='hidden'}>
    <section hidden={view!=='market'} aria-label="Market data" className="pricing-panel pricing-market-panel">
      <div className="pricing-insight-card"><header><h3>Nightly rates</h3><div className="pricing-range-control" role="group" aria-label="Chart range">{[30,90,180].map(days=><Button key={days} variant="quiet" aria-pressed={chartDays===days} onClick={()=>setChartDays(days)}>{days}d</Button>)}</div></header>
        {view==='market'&&chart('rates')}<footer>Market asking rates{!analysis.marketFresh&&<span>Current market data needed</span>}</footer></div>
      <div className="pricing-insight-card"><header><h3>Market occupancy</h3><span>Next {chartDays} days</span></header>{view==='market'&&chart('occupancy')}<footer>Projected includes estimated future bookings.</footer></div>
      <details className="pricing-source-details"><summary>Sources & methodology</summary><p>{evidence.marketSource||'No market source imported'} · {analysis.marketFresh?`Updated ${etStamp(evidence.marketObservedAt!)}`:'Current market data needed'}. Market rates are asking prices, not booked rates.</p></details>
    </section>
    <section hidden={view!=='prices'} aria-label="Rate comparison">
      <details className="pricing-chart-disclosure" open={chartOpen} onToggle={e=>setChartOpen(e.currentTarget.open)}><summary className="cursor-pointer text-sm font-medium">Rate comparison chart</summary>
        {view==='prices'&&chartOpen&&chart('rates')}<p className="mt-3 text-xs text-slate-500">Market rates are asking prices.{!analysis.marketFresh?' Market data is missing or expired.':''}</p>
      </details>
    </section>
    <section hidden={view!=='occupancy'} aria-label="Occupancy" className="pricing-panel pricing-performance-panel space-y-5">
      <div className="pricing-performance-summary">{preview?.occupancy.map((w,i)=><div key={w.start}><p className="text-xs text-slate-500">{['Next 15 nights','Nights 16–30','Nights 31–60'][i]}</p><p className="mt-2 text-2xl font-semibold">{w.pct===null?'Unknown':`${Math.round(w.pct)}%`}</p><p className="mt-1 text-xs text-slate-500">{w.booked} of {w.sellable} nights booked{w.unknown?` · ${w.unknown} unknown`:''}</p></div>)}</div>
      <div className="pricing-insight-card"><header><h3>Monthly occupancy</h3><span className="text-xs text-slate-500">{snapshot.days[0]?.date} to {snapshot.days.at(-1)?.date}</span></header>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm" aria-label="Monthly occupancy"><thead><tr>{['Month','Booked nights','Projected','Range','Blocked','Missing data'].map(h=><th key={h} className="border-b p-3 text-xs font-medium">{h}</th>)}</tr></thead><tbody>{months.map(m=><tr key={m.month} className="border-b"><td className="p-3">{new Date(m.month+'-01T12:00:00Z').toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'})}</td><td className="p-3">{m.booked} / {m.sellable}</td><td className="p-3 font-semibold">{pct(m.expected)}</td><td className="p-3">{m.low===null?'–':`${m.low.toFixed(0)}–${m.high!.toFixed(0)}%`}</td><td className="p-3">{m.blocked}</td><td className="p-3">{m.missing||'–'}</td></tr>)}</tbody></table></div>
      <footer>Projected includes future bookings. Range shows scenarios.</footer></div>
      <details className="border-t pt-4" open={marketChartOpen} onToggle={e=>setMarketChartOpen(e.currentTarget.open)}><summary className="cursor-pointer text-sm font-medium">Market occupancy</summary>{view==='occupancy'&&marketChartOpen&&chart('occupancy')}<p className="mt-3 text-xs text-slate-500">{analysis.marketFresh?`Updated ${etStamp(evidence.marketObservedAt!)}`:'Fresh market data required.'}</p></details>
      <details className="border-t pt-4"><summary className="cursor-pointer text-sm font-medium">How this is calculated</summary><p className="mt-3 text-sm text-slate-600">Ranges are scenarios, not confidence intervals. Only dates in this forecast are counted. Booked nights plus each open night’s estimated chance of selling, divided by sellable nights. Blocks are excluded. Missing or stale data suppresses the forecast. Market estimates use last year’s final occupancy plus half the change in same-time booking pace.</p></details>
    </section>
    <section hidden={view!=='data'} aria-label="Pricing data" className="pricing-panel space-y-5">
      <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Data sources</h3><Button size="sm" disabled={!preview} onClick={download}>Export rates</Button></div>
      <dl className="divide-y text-sm"><div className="flex flex-wrap justify-between gap-2 py-3"><dt>Market · {analysis.marketNights} nights<p className="mt-1 text-xs text-slate-500">{evidence.marketSource||'No source'}</p></dt><dd className="text-xs text-slate-500">{evidence.marketObservedAt?`${analysis.marketFresh?'Updated':'Expired'} ${etStamp(evidence.marketObservedAt)}`:'Not imported'}</dd></div>
        <div className="flex flex-wrap justify-between gap-2 py-3"><dt>History · {analysis.historyNights} nights<p className="mt-1 text-xs text-slate-500">{evidence.historySource||'No source'}</p></dt><dd className="text-xs text-slate-500">{analysis.shape.nights} booked · {analysis.shape.monthsCovered} months</dd></div></dl>
      <details className="border-t pt-4" open><summary className="cursor-pointer font-medium">Import CSV</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-3"><label className="text-sm">Data type<select className={field} value={type} onChange={e=>{setType(e.target.value);setPending(null);}}><option value="market">PriceLabs daily market CSV</option><option value="history">Historical inventory CSV</option></select></label>
          <label className="text-sm">Observed at<input type="text" placeholder="YYYY-MM-DD HH:MM (local)" className={field} value={observed} onChange={e=>{setObserved(e.target.value);setPending(null);}}/></label>
          <label className="text-sm">{type==='history'?'Source':'Comparable listings'}<input className={field} value={source} onChange={e=>{setSource(e.target.value);setPending(null);}} placeholder={type==='history'?'Calendar export':'Area, bedrooms, listing count'}/></label></div>
        <p className="mt-3 text-xs text-slate-500">{type==='market'?'Use the daily Neighborhood Data export. Observation time may differ from download time.':'One row per calendar night. Include open and blocked dates; use original booking dates, not import dates.'} Exclude guest details.</p>
        {type==='history'&&<p className="mt-3 text-xs text-slate-500">Columns: date,state,booked_on,rent_cents. States: open, booked, blocked, unknown. Rent is accommodation only, allocated per night; leave unknown values blank.</p>}
        <label className="my-4 block text-sm">CSV file<input type="file" accept=".csv,text/csv" disabled={busy} className="mt-2 block max-w-full text-sm" onChange={e=>void readFile(e.target.files?.[0])}/></label>
        {error&&<p role="alert" className="my-3 text-sm text-red-700">{error}</p>}
        {pending&&<div className="border-l-2 border-amber-500 pl-4 text-sm"><p>{type==='market'?pending.market.length:pending.history.length} nights ready. Replaces this source and invalidates previous publishing reviews.</p><Button className="mt-3" variant="primary" disabled={busy} onClick={async()=>{if(await onSave(pending))setPending(null);}}>Save imported data</Button></div>}
      </details>
      <details className="border-t pt-4"><summary className="cursor-pointer font-medium">Historical pricing patterns</summary>
        <div className="my-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm">Base reference <b>{money(analysis.shape.baseCents)}</b> · {analysis.shape.nights} booked nights</p><Button size="sm" disabled={!analysis.shape.qualified||busy} onClick={()=>onUseLearned(analysis.shape.baseCents!)}>Use in draft rules</Button></div>
        <p className="text-xs text-slate-500">Historical booked rates can reflect the previous pricing provider. Sparse samples are pulled toward neutral.</p>
        <div className="my-4 grid grid-cols-3 gap-2 sm:grid-cols-6">{analysis.shape.monthlyFactors.map((f,i)=><div key={i} className="border-b py-3 text-xs"><b>{new Date(Date.UTC(2026,i,1)).toLocaleString('en-US',{month:'short',timeZone:'UTC'})}</b><p className="mt-1">{f.toFixed(2)}× · {analysis.shape.monthCount[i]} nights</p></div>)}</div>
      </details>
      <details className="border-t pt-4"><summary className="cursor-pointer font-medium">Forecast validation</summary>
        <p className="my-3 text-xs text-slate-500">Last 90 completed nights, using only earlier data at each cutoff. Lower Brier scores are better. This cannot reconstruct cancellations or establish revenue gains.</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Lead time','Nights tested','Brier score','No-pickup baseline','Predicted / actual'].map(h=><th className="p-2 text-xs" key={h}>{h}</th>)}</tr></thead><tbody>{backtest.map(b=><tr key={b.lead} className="border-t"><td className="p-2">{b.lead} days</td><td className="p-2">{b.count}</td><td className="p-2">{b.brier?.toFixed(3)??'–'}</td><td className="p-2">{b.noPickupBrier?.toFixed(3)??'–'}</td><td className="p-2">{b.count?`${pct(b.predictedPct)} / ${pct(b.actualPct)}`:'More history needed'}</td></tr>)}</tbody></table></div>
      </details>
      <details className="border-t pt-4"><summary className="cursor-pointer font-medium">Price sensitivity experiment</summary><p className="my-3 text-xs text-slate-500">Assumed price response. Results do not change recommendations or publish rates.</p>
        <label className="block text-sm">Sensitivity: {elasticity.toFixed(1)}<input className="mt-2 block w-full" type="range" min="0.2" max="8" step="0.1" value={elasticity} onChange={e=>setElasticity(Number(e.target.value))}/></label>
        {scenario&&example?<p className="mt-3 text-sm">{example.date}: {money(scenario.best.cents)} · {(scenario.best.probability*100).toFixed(0)}% assumed sale probability · {money(scenario.best.expectedCents)} expected revenue.</p>:<p className="mt-3 text-sm text-slate-500">Market or historical data required.</p>}
        {pathScenario&&<p className="mt-3 text-xs text-slate-500">Three equal booking opportunities: {pathScenario.path.map(p=>money(p.cents)).join(' → ')}. Expected revenue: {money(pathScenario.expectedCents)}. The opportunity split and sensitivity are assumptions.</p>}
      </details>
      <details className="border-t pt-4"><summary className="cursor-pointer font-medium">Model notes</summary><ul className="mt-3 list-disc space-y-2 pl-4 text-sm text-slate-600">{preview?.warnings.map(w=><li key={w}>{w}</li>)}</ul><p className="mt-3 text-xs text-slate-500">{preview?.modelVersion} · Independent prototype · Market exports still depend on PriceLabs. Automatic market feeds and OTA rate publishing are not connected.</p></details>
    </section>
  </div>;
}
