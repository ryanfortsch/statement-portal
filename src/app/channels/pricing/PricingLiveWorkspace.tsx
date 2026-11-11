'use client';
import {useState} from 'react';
import {Button} from '@/components/Button';
import {etStamp} from '@/lib/stable-time';
import type {PricingLivePortfolio,PricingLiveCalendar} from '@/lib/dynamic-pricing-live';
import PricingPortfolio from './PricingPortfolio';
import PricingCalendar from './PricingCalendar';
import PricingIcon from './PricingIcon';
import './pricing.css';

type Result<T>={ok:true;value:T}|{ok:false;error:string};
export default function PricingLiveWorkspace({initialPortfolio,refreshAction,calendarAction}:{
  initialPortfolio:PricingLivePortfolio;
  refreshAction:()=>Promise<Result<PricingLivePortfolio>>;
  calendarAction:(id:string)=>Promise<Result<PricingLiveCalendar>>;
}) {
  const [portfolio,setPortfolio]=useState(initialPortfolio),[calendar,setCalendar]=useState<PricingLiveCalendar|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function open(id:string) {
    setBusy(true);setError('');
    try {const r=await calendarAction(id);if(!r.ok)throw Error(r.error);setCalendar(r.value);}
    catch {setError('Could not load this calendar. Try again.');}
    finally {setBusy(false);}
  }
  async function refresh() {
    setBusy(true);setError('');
    try {
      const p=await refreshAction();if(!p.ok)throw Error(p.error);setPortfolio(p.value);
      if(calendar) {const c=await calendarAction(calendar.home.id);if(!c.ok)throw Error(c.error);setCalendar(c.value);}
    } catch {setError('Could not refresh all data. The previous snapshot remains visible.');}
    finally {setBusy(false);}
  }
  return <div className="helm-pricing pricing-live-workspace" aria-busy={busy}>
    <div className="pricing-live-toolbar"><span>Read-only · Loaded {etStamp(portfolio.readAt)}</span><Button variant="secondary" size="sm" disabled={busy} onClick={()=>void refresh()}>{busy?'Loading…':'Refresh'}</Button></div>
    {error&&<p role="alert" className="pricing-feedback">{error}</p>}
    <div hidden={calendar!==null} inert={busy}><PricingPortfolio rows={portfolio.rows} observed onOpen={id=>void open(id)}/></div>
    {calendar&&<>
      <div className="pricing-workbench-header"><div className="pricing-listing-navigation"><Button variant="quiet" className="pricing-back-button" disabled={busy} aria-label="All listings" onClick={()=>setCalendar(null)}><PricingIcon name="previous"/></Button>
        <label className="pricing-title-select"><span className="sr-only">Switch listing</span><select value={calendar.home.id} disabled={busy} onChange={e=>void open(e.target.value)}>{portfolio.rows.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label></div>
      </div>
      <p className="pricing-live-source">{calendar.source} · {calendar.sourceObservedAt?`Updated ${etStamp(calendar.sourceObservedAt)}`:'Update time unavailable'} · Current USD rates</p>
      <PricingCalendar key={calendar.home.id} snapshot={calendar.snapshot} preview={null} currentOnly/>
    </>}
  </div>;
}
