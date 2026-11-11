'use client';
import {useState} from 'react';
import Link from 'next/link';
import {Button} from '@/components/Button';
import {buttonClass} from '@/lib/button-class';
import {EmptyState} from '@/components/EmptyState';
import {etStamp} from '@/lib/stable-time';
import {PRICING_WINDOWS,pricingPortfolioView,pricingPortfolioHref,type PricingPortfolioRow,type PricingWindowDays,type PricingPortfolioView} from '@/lib/dynamic-pricing-portfolio';
import './pricing.css';

const percent=(n:number|null)=>n===null?'–':`${Math.round(n)}%`;
const money=(n:number|null)=>n===null?'–':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:n%100?2:0}).format(n/100);
export default function PricingPortfolio({rows,onOpen,sample=false,initialView=pricingPortfolioView()}:{rows:PricingPortfolioRow[];onOpen?:(id:string)=>void;sample?:boolean;initialView?:PricingPortfolioView}) {
  const [window,setWindow]=useState<PricingWindowDays>(initialView.window),[query,setQuery]=useState(initialView.query),[filter,setFilter]=useState(initialView.filter);
  const [sort,setSort]=useState(initialView.sort),[connection,setConnection]=useState(initialView.connection);
  const [metrics,setMetrics]=useState<PricingWindowDays[]>([30,60,90]);
  const visible=rows.filter(r=>{
    const w=r.windows[window];
    return `${r.name} ${r.city} ${r.id}`.toLowerCase().includes(query.trim().toLowerCase())&&
      (connection==='all'||connection===r.mode)&&
      (filter==='all'||filter==='below'&&w.gapPp!==null&&w.gapPp<0||filter==='data'&&(w.unknown>0||w.marketIssue!==null||r.error!==null));
  }).sort((a,b)=>{
    const aw=a.windows[window],bw=b.windows[window];
    if(sort==='occupancy')return (aw.occupancyPct??Infinity)-(bw.occupancyPct??Infinity)||a.name.localeCompare(b.name);
    if(sort==='gap')return (aw.gapPp??Infinity)-(bw.gapPp??Infinity)||a.name.localeCompare(b.name);
    if(sort==='open')return (bw.unknown?-1:bw.open)-(aw.unknown?-1:aw.open)||a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name,undefined,{numeric:true});
  });
  function openLink(row:PricingPortfolioRow,review=false) {
    const label=review?'Review prices':row.name;
    const className=review?`${buttonClass('secondary','sm')} portfolio-review`:'portfolio-home-link';
    return onOpen?<Button variant={review?'secondary':'quiet'} size="sm" className={className} aria-label={review?`Review prices for ${row.name}`:undefined} onClick={()=>onOpen(row.id)}>{label}</Button>:
      <Link prefetch={false} href={pricingPortfolioHref({window,query,filter,sort,connection},row.id)} className={className} aria-label={review?`Review prices for ${row.name}`:undefined}>{label}</Link>;
  }
  return <section className="helm-pricing pricing-portfolio" aria-label="Pricing dashboard">
    <header className="portfolio-heading"><h2>Pricing dashboard</h2>{sample&&<span>Sample portfolio</span>}</header>
    <div className="portfolio-controls">
      <label className="portfolio-search"><span className="sr-only">Search listings</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input type="search" placeholder="Search listings or cities" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <span role="status">Showing <b>{visible.length}/{rows.length}</b> listings</span>
    </div>
    <div className="portfolio-toolbar">
      <label><span className="sr-only">Quick filters</span><select value={filter} onChange={e=>setFilter(e.target.value as PricingPortfolioView['filter'])}><option value="all">Quick filters</option><option value="below">Below market</option><option value="data">Missing or stale data</option></select></label>
      <details className="pricing-menu" name="portfolio-options"><summary>Filters</summary><div className="pricing-menu-panel">
        <label>Pricing connection<select value={connection} onChange={e=>setConnection(e.target.value as PricingPortfolioView['connection'])}><option value="all">All connections</option><option value="helm_direct">Helm direct</option><option value="shadow">Compare only</option></select></label>
        <label>Compare over<select value={window} onChange={e=>setWindow(Number(e.target.value) as PricingWindowDays)}>{PRICING_WINDOWS.map(n=><option key={n} value={n}>Next {n} days</option>)}</select></label>
        <label>Sort listings<select value={sort} onChange={e=>setSort(e.target.value as PricingPortfolioView['sort'])}><option value="name">Name A–Z</option><option value="gap">Furthest below market</option><option value="occupancy">Lowest occupancy</option><option value="open">Most open nights</option></select></label>
      </div></details>
      <details className="pricing-menu" name="portfolio-options"><summary>Metrics</summary><div className="pricing-menu-panel"><p>Adjusted occupancy</p>{PRICING_WINDOWS.map(n=><label className="pricing-menu-check" key={n}><input type="checkbox" checked={metrics.includes(n)} onChange={e=>setMetrics(m=>e.target.checked?PRICING_WINDOWS.filter(w=>w===n||m.includes(w)):m.filter(w=>w!==n))}/>Next {n} days</label>)}</div></details>
      {(filter!=='all'||connection!=='all'||query)&&<Button variant="quiet" size="sm" onClick={()=>{setQuery('');setFilter('all');setConnection('all');}}>Clear filters</Button>}
    </div>
    <div className="portfolio-table-wrap" tabIndex={0} role="region" aria-label="Listing prices and occupancy. Scroll horizontally for more columns."><table className="portfolio-table"><caption className="sr-only">Listing prices and adjusted occupancy compared with market</caption><thead><tr>
      <th scope="col" className="portfolio-sticky"><Button variant="quiet" onClick={()=>setSort('name')}>Listings {sort==='name'?'↑':''}</Button></th><th scope="col">Calendar</th>
      {metrics.map(n=><th key={n} scope="col"><Button variant="quiet" onClick={()=>{setWindow(n);setSort('occupancy');}} title={`Sort by next ${n} days occupancy`}>Adj. occ. ({n} days) {sort==='occupancy'&&window===n?'↑':''}</Button><span>Listing / market</span></th>)}
      <th scope="col">Minimum</th><th scope="col">Base price</th><th scope="col">Maximum</th><th scope="col">Pricing connection</th>
    </tr></thead><tbody>{visible.map(row=><tr key={row.id}>
      <td className="portfolio-home portfolio-sticky"><span className="portfolio-home-meta">{row.authority==='helm'?'Helm':'Guesty'} · {row.city}{row.bedrooms!==null?` · ${row.bedrooms} BR`:''}</span>{openLink(row)}{row.error&&<span className="portfolio-row-note">{row.error}</span>}</td>
      <td>{openLink(row,true)}</td>
      {metrics.map(n=>{const w=row.windows[n];const issue=w.unknown?'Calendar incomplete':!w.bookable?'No bookable nights':w.marketIssue==='stale'?'Market data out of date':w.marketIssue==='missing'?'No market data':w.marketIssue==='partial'?'Market data incomplete':null;
        return <td key={n} className="portfolio-occupancy" title={issue??`${w.booked} booked, ${w.open} open, ${w.blocked} blocked. ${w.gapPp!.toFixed(1)} percentage points versus market.`}>
          <span className="portfolio-occ-value" data-direction={w.gapPp===null?'unknown':w.gapPp<0?'below':'above'}>{percent(w.occupancyPct)}</span><span className="portfolio-market-value"> / {percent(w.marketPct)}</span>
          {issue&&<span className="portfolio-row-note">{issue}</span>}
        </td>;})}
      <td>{money(row.floorCents)}</td><td><b>{money(row.baseCents)}</b>{row.baseCents!==null&&!row.configured&&<span className="portfolio-row-note">Draft</span>}</td><td>{money(row.ceilingCents)}</td>
      <td><span className="portfolio-connection-state" data-connected={row.mode==='helm_direct'||undefined}>{row.mode==='helm_direct'?'Helm direct':'Compare only'}</span><span className="portfolio-row-note">{row.lastAppliedAt?`Published ${etStamp(row.lastAppliedAt)}`:row.mode==='helm_direct'?'Manual publish':'Publishing off'}</span></td>
    </tr>)}</tbody></table></div>
    {!visible.length&&<div className="portfolio-empty"><EmptyState>{rows.length?'No listings match these filters.':'No active listings found.'}</EmptyState></div>}
    <footer className="portfolio-footer"><details className="portfolio-method"><summary>Occupancy & data sources</summary>
      <p>Adjusted occupancy is booked nights divided by booked plus open nights, starting today in each home’s time zone. Owner blocks are excluded. These are on-the-books figures, not a prediction of final occupancy.</p>
      <p>Market is the average imported daily occupancy for the same bookable dates. Both sources need complete coverage, updated within 36 hours. Missing or stale data shows a dash.</p>
      <ul>{rows.map(row=><li key={row.id}><b>{row.name}:</b> calendar {row.observedAt?etStamp(row.observedAt):'unavailable'}; {row.marketSource||'no market source'}{row.marketObservedAt?` · ${etStamp(row.marketObservedAt)}`:''}.</li>)}</ul>
    </details><span>{visible.length} listings</span></footer>
  </section>;
}
