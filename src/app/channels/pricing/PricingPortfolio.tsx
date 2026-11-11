'use client';
import {useState} from 'react';
import Link from 'next/link';
import {Button} from '@/components/Button';
import {EmptyState} from '@/components/EmptyState';
import {etStamp} from '@/lib/stable-time';
import {PRICING_WINDOWS,pricingPortfolioView,pricingPortfolioHref,type PricingPortfolioRow,type PricingWindowDays,type PricingPortfolioView} from '@/lib/dynamic-pricing-portfolio';
import PricingIcon from './PricingIcon';
import PricingOccupancy,{PricingOccupancyKey} from './PricingOccupancy';
import './pricing.css';

const money=(n:number|null)=>n===null?'–':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:n%100?2:0}).format(n/100);
export default function PricingPortfolio({rows,onOpen,initialView=pricingPortfolioView()}:{rows:PricingPortfolioRow[];onOpen?:(id:string)=>void;initialView?:PricingPortfolioView}) {
  const [window,setWindow]=useState<PricingWindowDays>(initialView.window),[query,setQuery]=useState(initialView.query),[filter,setFilter]=useState(initialView.filter);
  const [sort,setSort]=useState(initialView.sort),[connection,setConnection]=useState(initialView.connection);
  const [metrics,setMetrics]=useState<PricingWindowDays[]>([30,60,90]);
  const [bounds,setBounds]=useState(false),[showConnection,setShowConnection]=useState(false);
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
    const label=review?<PricingIcon name="next"/>:row.name;
    const className=review?'pricing-icon-button portfolio-review':'portfolio-home-link';
    const accessible=review?`Review prices for ${row.name}`:undefined;
    return onOpen?<Button variant="quiet" size="sm" className={className} aria-label={accessible} title={accessible} onClick={()=>onOpen(row.id)}>{label}</Button>:
      <Link prefetch={false} href={pricingPortfolioHref({window,query,filter,sort,connection},row.id)} className={className} aria-label={accessible} title={accessible}>{label}</Link>;
  }
  return <section className="helm-pricing pricing-portfolio" aria-label="Pricing dashboard">
    <header className="portfolio-heading"><h2>Listings <span className="portfolio-count">{visible.length}{visible.length!==rows.length?` / ${rows.length}`:''}</span></h2>
    <div className="portfolio-controls">
      <label className="portfolio-search"><span className="sr-only">Search listings</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input type="search" placeholder="Search listings" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <div className="portfolio-toolbar">
      <details className="pricing-menu" name="portfolio-options"><summary><PricingIcon name="sliders"/>Filters{filter!=='all'||connection!=='all'?<span className="pricing-filter-dot"/>:null}</summary><div className="pricing-menu-panel">
        <label>Show listings<select value={filter} onChange={e=>setFilter(e.target.value as PricingPortfolioView['filter'])}><option value="all">All listings</option><option value="below">Below market</option><option value="data">Missing or stale data</option></select></label>
        <label>Pricing connection<select value={connection} onChange={e=>setConnection(e.target.value as PricingPortfolioView['connection'])}><option value="all">All connections</option><option value="helm_direct">Helm direct</option><option value="shadow">Compare only</option></select></label>
        <label>Compare over<select value={window} onChange={e=>setWindow(Number(e.target.value) as PricingWindowDays)}>{PRICING_WINDOWS.map(n=><option key={n} value={n}>Next {n} days</option>)}</select></label>
        <label>Sort listings<select value={sort} onChange={e=>setSort(e.target.value as PricingPortfolioView['sort'])}><option value="name">Name A–Z</option><option value="gap">Furthest below market</option><option value="occupancy">Lowest occupancy</option><option value="open">Most open nights</option></select></label>
      </div></details>
      <details className="pricing-menu" name="portfolio-options"><summary className="pricing-columns-toggle" aria-label="Choose columns" title="Choose columns"><PricingIcon name="columns"/></summary><div className="pricing-menu-panel"><p>Adjusted occupancy</p>{PRICING_WINDOWS.map(n=><label className="pricing-menu-check" key={n}><input type="checkbox" checked={metrics.includes(n)} onChange={e=>setMetrics(m=>e.target.checked?PRICING_WINDOWS.filter(w=>w===n||m.includes(w)):m.filter(w=>w!==n))}/>Next {n} days</label>)}<hr/><label className="pricing-menu-check"><input type="checkbox" checked={bounds} onChange={e=>setBounds(e.target.checked)}/>Min / max prices</label><label className="pricing-menu-check"><input type="checkbox" checked={showConnection} onChange={e=>setShowConnection(e.target.checked)}/>Connection</label></div></details>
      {(filter!=='all'||connection!=='all'||query)&&<Button variant="quiet" size="sm" onClick={()=>{setQuery('');setFilter('all');setConnection('all');}} aria-label="Clear filters" title="Clear filters"><PricingIcon name="close"/></Button>}
      </div>
    </div>
    </header>
    <div className="portfolio-table-key"><span>Occupancy</span><PricingOccupancyKey/></div>
    <div className="portfolio-table-wrap" tabIndex={0} role="region" aria-label="Listing prices and occupancy. Scroll horizontally for more columns."><table className="portfolio-table" style={{minWidth:230+metrics.length*120+92+44+(bounds?160:0)+(showConnection?150:0)}}><colgroup><col className="portfolio-listing-col"/>{metrics.map(n=><col key={n} className="portfolio-metric-col"/>)}{bounds&&<col className="portfolio-price-col"/>}<col className="portfolio-price-col"/>{bounds&&<col className="portfolio-price-col"/>}{showConnection&&<col className="portfolio-mode-col"/>}<col className="portfolio-action-col"/></colgroup><caption className="sr-only">Listing prices and adjusted occupancy compared with market</caption><thead><tr>
      <th scope="col" className="portfolio-sticky"><Button variant="quiet" onClick={()=>setSort('name')}>Listing {sort==='name'?'↑':''}</Button></th>
      {metrics.map(n=><th key={n} scope="col"><Button variant="quiet" onClick={()=>{setWindow(n);setSort('occupancy');}} title={`Sort by next ${n} days occupancy`}>{n} days {sort==='occupancy'&&window===n?'↑':''}</Button></th>)}
      {bounds&&<th scope="col">Min</th>}<th scope="col">Base price</th>{bounds&&<th scope="col">Max</th>}{showConnection&&<th scope="col">Connection</th>}<th scope="col"><span className="sr-only">Open calendar</span></th>
    </tr></thead><tbody>{visible.map(row=><tr key={row.id}>
      <td className="portfolio-home portfolio-sticky">{openLink(row)}<span className="portfolio-home-meta">{row.city}{row.bedrooms!==null?` · ${row.bedrooms} BR`:''}{(row.error||row.windows[30].unknown||row.windows[30].marketIssue)&&<span className="portfolio-data-note" title={row.error??(row.windows[30].unknown?'Calendar incomplete':row.windows[30].marketIssue==='stale'?'Market data expired':'Market data needed')}> · Data gap</span>}</span></td>
      {metrics.map(n=><td key={n}><PricingOccupancy window={row.windows[n]}/></td>)}
      {bounds&&<td>{money(row.floorCents)}</td>}<td className="portfolio-base"><b title={!row.configured?'Draft base price':undefined}>{money(row.baseCents)}</b></td>{bounds&&<td>{money(row.ceilingCents)}</td>}
      {showConnection&&<td><span className="portfolio-connection-state" data-connected={row.mode==='helm_direct'||undefined}>{row.mode==='helm_direct'?'Helm direct':'Compare only'}</span><span className="portfolio-row-note">{row.lastAppliedAt?`Published ${etStamp(row.lastAppliedAt)}`:row.mode==='helm_direct'?'Manual publish':'Publishing off'}</span></td>}
      <td>{openLink(row,true)}</td>
    </tr>)}</tbody></table></div>
    {!visible.length&&<div className="portfolio-empty"><EmptyState>{rows.length?'No listings match these filters.':'No active listings found.'}</EmptyState></div>}
    <footer className="portfolio-footer"><details className="portfolio-method"><summary>Sources & methodology</summary>
      <p>Adjusted occupancy is booked nights divided by booked plus open nights, starting today in each home’s time zone. Owner blocks are excluded. These are on-the-books figures, not a prediction of final occupancy.</p>
      <p>Market is the average imported daily occupancy for the same bookable dates. Both sources need complete coverage, updated within 36 hours. Missing or stale data shows a dash.</p>
      <ul>{rows.map(row=><li key={row.id}><b>{row.name}:</b> calendar {row.observedAt?etStamp(row.observedAt):'unavailable'}; {row.marketSource||'no market source'}{row.marketObservedAt?` · ${etStamp(row.marketObservedAt)}`:''}.</li>)}</ul>
    </details><span role="status" className="sr-only">{visible.length===rows.length?`${rows.length} listings`:`${visible.length} of ${rows.length} listings`}</span></footer>
  </section>;
}
