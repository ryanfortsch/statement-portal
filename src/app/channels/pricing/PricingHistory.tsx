'use client';
import {useState} from 'react';
import {Button} from '@/components/Button';
import {etStamp} from '@/lib/stable-time';
import {pricingMoney as money} from '@/lib/dynamic-pricing-display';
import {comparePricingObservations,type PricingObservationRecord,type PricingTracking} from '@/lib/dynamic-pricing-observations';
export default function PricingHistory({observations,tracking,scheduledCaptureEnabled,busy,canCapture,onCapture,onTracking}:{
  observations:PricingObservationRecord[];tracking:PricingTracking;scheduledCaptureEnabled:boolean;busy:boolean;canCapture:boolean;
  onCapture:()=>void;onTracking:(enabled:boolean)=>void;
}) {
  const [night,setNight]=useState(''),[baseline,setBaseline]=useState('');
  const latest=observations[0],previous=observations.find(r=>r.id===baseline)??observations[1];
  const comparison=latest&&previous&&Date.parse(previous.data.capturedAt)<Date.parse(latest.data.capturedAt)?comparePricingObservations(previous.data,latest.data):null;
  const selected=latest?.data.days.some(d=>d.date===night)?night:latest?.data.days[0]?.date;
  return <section className="space-y-4" aria-label="Comparison history">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Saved snapshots</h2>
      <p className="mt-2 max-w-3xl text-sm text-slate-500">Compare recorded rates and booking changes.</p></div>
      <Button disabled={busy||!canCapture} onClick={onCapture}>Save snapshot</Button></div>
    {!canCapture&&<p className="mt-3 text-xs text-amber-800">Save rules before recording a snapshot.</p>}
    {!latest?<p className="rounded-lg bg-slate-50 p-4 text-sm">No snapshots saved yet.</p>:<>
      <p className="mb-3 text-xs text-slate-500">Latest: {etStamp(latest.data.capturedAt)} · {observations.length} recent snapshots</p>
      {observations.length>1&&<label className="text-sm">Compare latest with<select aria-label="Comparison baseline" className="my-2 block w-full rounded-lg border p-2" value={previous?.id??''} onChange={e=>setBaseline(e.target.value)}>{observations.slice(1).map(r=><option key={r.id} value={r.id}>{etStamp(r.data.capturedAt)}</option>)}</select></label>}
      {comparison&&<><div className="my-4 grid gap-3 sm:grid-cols-4">{[
        ['Open → booked',comparison.newlyBooked],['Booked → open',comparison.reopened],['Availability changes',comparison.availabilityChanged],['Unknown / incomparable',comparison.unknown],
      ].map(([label,count])=><div className="rounded-lg bg-slate-50 p-3" key={label}><p className="text-xs text-slate-500">{label}</p><p className="text-xl font-semibold">{count}</p></div>)}</div>
      <p className="text-xs text-slate-500">{comparison.common} shared dates · {comparison.rateChanges} rate changes across {comparison.retainedOpen} nights still open. Counts are nights, not reservations. Reopened dates may include cancellations or calendar corrections.{!comparison.comparableAuthority?' Calendar authority changed; comparisons are withheld.':''}{comparison.policyChanged?' Policy or model version changed.':''}{comparison.evidenceChanged?' Evidence version changed.':''}</p></>}
      <details className="mt-4 border-t pt-4" open><summary className="cursor-pointer font-medium">Nightly history</summary>
        <label className="my-3 block text-sm">Stay night<select aria-label="History stay night" className="mt-1 block w-full rounded-lg border p-2" value={selected??''} onChange={e=>setNight(e.target.value)}>{latest.data.days.map(d=><option key={d.date}>{d.date}</option>)}</select></label>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Recorded','Status','Current','Proposed','Sale forecast'].map(h=><th key={h} className="p-2 text-xs">{h}</th>)}</tr></thead>
          <tbody>{observations.map(r=>{const d=r.data.days.find(d=>d.date===selected);return d&&<tr key={r.id} className="border-t"><td className="p-2">{etStamp(r.data.capturedAt)}</td><td className="p-2">{d.state}</td><td className="p-2">{money(d.currentCents)}</td><td className="p-2">{money(d.recommendedCents)}</td><td className="p-2" title={d.forecastBasis}>{d.saleProbability===null?'—':`${(100*d.saleProbability).toFixed(1)}%`}</td></tr>;})}</tbody></table></div>
        <p className="mt-3 text-xs text-slate-500">Original proposals and forecasts. Published rates and final outcomes may differ.</p>
      </details>
    </>}
    <details className="border-t pt-4"><summary className="cursor-pointer text-sm font-medium">Collection settings</summary>
    <div className="my-4 flex flex-wrap items-center gap-3"><Button size="sm" disabled={busy||!canCapture} onClick={()=>onTracking(!tracking.enabled)}>{tracking.enabled?'Stop daily capture':'Request daily capture'}</Button>
      <span className="text-xs text-slate-500">{tracking.enabled?(scheduledCaptureEnabled?'Daily capture on':'Requested · collector not active'):'Daily capture off'}</span></div>
      <p className="text-xs text-slate-500">Capture saves comparisons; it does not publish prices. Daily capture also requires the collector to be activated.</p>
      {latest&&<p className="mt-3 text-xs text-slate-500">{latest.data.authority} calendar · rules v{latest.data.policyVersion} · {latest.data.modelVersion}</p>}
    </details>
  </section>;
}
