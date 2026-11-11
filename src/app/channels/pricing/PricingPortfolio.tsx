'use client';
import {Fragment,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Button} from '@/components/Button';
import {EmptyState} from '@/components/EmptyState';
import {etStamp} from '@/lib/stable-time';
import {PRICING_WINDOWS,pricingPortfolioView,pricingPortfolioHref,sortPricingPortfolioRows,type PricingPortfolioRow,type PricingWindowDays,type PricingPortfolioView,type PricingPortfolioSort} from '@/lib/dynamic-pricing-portfolio';
import PricingIcon from './PricingIcon';
import PricingOccupancy,{PricingOccupancyKey} from './PricingOccupancy';
import './pricing.css';

const money=(n:number|null)=>n===null?'–':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:n%100?2:0}).format(n/100);
export default function PricingPortfolio({rows,onOpen,demo=false,initialView=pricingPortfolioView()}:{rows:PricingPortfolioRow[];onOpen?:(id:string)=>void;demo?:boolean;initialView?:PricingPortfolioView}) {
  const [window,setWindow]=useState<PricingWindowDays>(initialView.window),[query,setQuery]=useState(initialView.query),[filter,setFilter]=useState(initialView.filter);
  const [sort,setSort]=useState(initialView.sort),[direction,setDirection]=useState(initialView.direction),[connection,setConnection]=useState(initialView.connection);
  const [metrics,setMetrics]=useState<PricingWindowDays[]>([30,60,90]);
  const [bounds,setBounds]=useState(false),[showConnection,setShowConnection]=useState(false);
  const tableRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{tableRef.current?.scrollTo({top:0});},[window,query,filter,sort,direction,connection]);
  const searched=rows.filter(r=>`${r.name} ${r.city} ${r.id}`.toLowerCase().includes(query.trim().toLowerCase())&&(connection==='all'||connection===r.mode));
  const needsData=(r:PricingPortfolioRow)=>r.windows[window].unknown>0||r.windows[window].marketIssue!==null||r.error!==null;
  const below=(r:PricingPortfolioRow)=>r.windows[window].gapPp!==null&&r.windows[window].gapPp!<0;
  const counts={all:searched.length,below:searched.filter(below).length,data:searched.filter(needsData).length};
  const visible=sortPricingPortfolioRows(searched.filter(r=>filter==='all'||filter==='below'&&below(r)||filter==='data'&&needsData(r)),{sort,direction,window});
  const metricSort=['occupancy','market','gap','open'].includes(sort)?sort:'occupancy';
  const metricLabel=metricSort==='market'?'market occupancy':metricSort==='gap'?'occupancy gap':metricSort==='open'?'open nights':'listing occupancy';
  const currentMarkets=searched.filter(r=>r.windows[window].marketPct!==null).length;
  function sortHeader(key:PricingPortfolioSort,label:string,period?:PricingWindowDays) {
    const active=sort===key&&(period===undefined||window===period);
    const next=active&&direction==='asc'?'desc':'asc';
    return <th scope="col" className={key==='name'?'portfolio-sticky':undefined} aria-sort={active?(direction==='asc'?'ascending':'descending'):undefined}>
      <Button variant="quiet" title={`Sort ${period?`${period}-day ${metricLabel}`:label.toLowerCase()} ${next==='asc'?'ascending':'descending'}`} onClick={()=>{setSort(key);setDirection(next);if(period)setWindow(period);}}>
        {label}<span className="portfolio-sort-icon" aria-hidden="true" data-active={active||undefined}><svg width="10" height="14" viewBox="0 0 10 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"><path d="m2 5 3-3 3 3" opacity={active&&direction==='desc'?.2:1}/><path d="m2 9 3 3 3-3" opacity={active&&direction==='asc'?.2:1}/></svg></span>
      </Button>
    </th>;
  }
  function openLink(row:PricingPortfolioRow,review=false) {
    const label=review?<PricingIcon name="next"/>:row.name;
    const className=review?'pricing-icon-button portfolio-review':'portfolio-home-link';
    const accessible=review?`Review prices for ${row.name}`:undefined;
    return onOpen?<Button variant="quiet" size="sm" className={className} aria-label={accessible} title={accessible} onClick={()=>onOpen(row.id)}>{label}</Button>:
      <Link prefetch={false} href={pricingPortfolioHref({window,query,filter,sort,direction,connection},row.id)} className={className} aria-label={accessible} title={accessible}>{label}</Link>;
  }
  return <section className="helm-pricing pricing-portfolio" aria-label="Pricing dashboard">
    <header className="portfolio-heading"><h2>Listings <span className="portfolio-count">{visible.length}{visible.length!==rows.length?` / ${rows.length}`:''}</span></h2>
    <div className="portfolio-controls">
      <label className="portfolio-search"><span className="sr-only">Search listings</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input type="search" placeholder="Search listings" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <div className="portfolio-toolbar">
      <details className="pricing-menu" name="portfolio-options"><summary><PricingIcon name="sliders"/>Filters{filter!=='all'||connection!=='all'?<span className="pricing-filter-dot"/>:null}</summary><div className="pricing-menu-panel">
        <label>Pricing connection<select value={connection} onChange={e=>setConnection(e.target.value as PricingPortfolioView['connection'])}><option value="all">All connections</option><option value="helm_direct">Helm direct</option><option value="shadow">Compare only</option></select></label>
        <label>Compare over<select value={window} onChange={e=>setWindow(Number(e.target.value) as PricingWindowDays)}>{PRICING_WINDOWS.map(n=><option key={n} value={n}>Next {n} days</option>)}</select></label>
        <label>Sort by<select value={sort} onChange={e=>{const value=e.target.value as PricingPortfolioSort;setSort(value);setDirection(value==='open'?'desc':'asc');}}><option value="name">Listing</option><option value="occupancy">Listing occupancy</option><option value="market">Market occupancy</option><option value="gap">Occupancy vs market</option><option value="open">Open nights</option><option value="floor">Min price</option><option value="base">Base price</option><option value="ceiling">Max price</option><option value="connection">Connection</option></select></label>
        <label>Order<select value={direction} onChange={e=>setDirection(e.target.value as 'asc'|'desc')}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
      </div></details>
      <details className="pricing-menu" name="portfolio-options"><summary className="pricing-columns-toggle" aria-label="Choose columns" title="Choose columns"><PricingIcon name="columns"/></summary><div className="pricing-menu-panel"><p>Adjusted occupancy</p>{PRICING_WINDOWS.map(n=><label className="pricing-menu-check" key={n}><input type="checkbox" checked={metrics.includes(n)} onChange={e=>setMetrics(m=>e.target.checked?PRICING_WINDOWS.filter(w=>w===n||m.includes(w)):m.filter(w=>w!==n))}/>Next {n} days</label>)}<hr/><label className="pricing-menu-check"><input type="checkbox" checked={bounds} onChange={e=>setBounds(e.target.checked)}/>Min / max prices</label><label className="pricing-menu-check"><input type="checkbox" checked={showConnection} onChange={e=>setShowConnection(e.target.checked)}/>Connection</label></div></details>
      {(filter!=='all'||connection!=='all'||query)&&<Button variant="quiet" size="sm" onClick={()=>{setQuery('');setFilter('all');setConnection('all');}} aria-label="Clear filters" title="Clear filters"><PricingIcon name="close"/></Button>}
      </div>
    </div>
    </header>
    <div className="portfolio-surface"><div className="portfolio-viewbar"><div className="portfolio-views" role="group" aria-label="Listing views">{([['all','All listings'],['below','Below market'],['data','Data gaps']] as const).map(([value,label])=><Button key={value} variant="quiet" aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}<span>{counts[value]}</span></Button>)}</div><div className="portfolio-table-key"><PricingOccupancyKey/></div></div>
    <div ref={tableRef} className="portfolio-table-wrap" tabIndex={0} role="region" aria-label="Listing prices and occupancy. Scroll for more listings and columns."><table className="portfolio-table" style={{minWidth:`calc(var(--portfolio-listing-width) + ${metrics.length*120+92+44+(bounds?184:0)+(showConnection?150:0)}px)`}}><colgroup><col className="portfolio-listing-col"/>{metrics.map(n=><col key={n} className="portfolio-metric-col"/>)}{bounds&&<col className="portfolio-price-col"/>}<col className="portfolio-price-col"/>{bounds&&<col className="portfolio-price-col"/>}{showConnection&&<col className="portfolio-mode-col"/>}<col className="portfolio-action-col"/></colgroup><caption className="sr-only">Listing prices and adjusted occupancy compared with market</caption><thead><tr>
      {sortHeader('name','Listing')}
      {metrics.map(n=><Fragment key={n}>{sortHeader(metricSort as PricingPortfolioSort,`${n} days`,n)}</Fragment>)}
      {bounds&&sortHeader('floor','Min')}{sortHeader('base','Base price')}{bounds&&sortHeader('ceiling','Max')}{showConnection&&sortHeader('connection','Connection')}<th scope="col"><span className="sr-only">Open calendar</span></th>
    </tr></thead><tbody>{visible.map(row=><tr key={row.id}>
      <td className="portfolio-home portfolio-sticky">{openLink(row)}<span className="portfolio-home-meta">{row.city}{row.bedrooms!==null?` · ${row.bedrooms} BR`:''}{needsData(row)&&<span className="portfolio-data-note" title={row.error??(row.windows[window].unknown?'Calendar incomplete':row.windows[window].marketIssue==='stale'?'Market data expired':'Market data needed')}> · Data gap</span>}</span></td>
      {metrics.map(n=><td key={n} className="portfolio-occupancy-cell"><PricingOccupancy window={row.windows[n]}/></td>)}
      {bounds&&<td>{money(row.floorCents)}</td>}<td className="portfolio-base"><b title={!row.configured?'Draft base price':undefined}>{money(row.baseCents)}</b></td>{bounds&&<td>{money(row.ceilingCents)}</td>}
      {showConnection&&<td><span className="portfolio-connection-state" data-connected={row.mode==='helm_direct'||undefined}>{row.mode==='helm_direct'?'Helm direct':'Compare only'}</span><span className="portfolio-row-note">{row.lastAppliedAt?`Published ${etStamp(row.lastAppliedAt)}`:row.mode==='helm_direct'?'Manual publish':'Publishing off'}</span></td>}
      <td>{openLink(row,true)}</td>
    </tr>)}</tbody></table></div>
    {!visible.length&&<div className="portfolio-empty"><EmptyState>{rows.length?'No listings match these filters.':'No active listings found.'}</EmptyState></div>}
    <div className="portfolio-table-footer"><span>{visible.length} of {rows.length} listings</span><span>{['occupancy','market','gap','open'].includes(sort)?`${window}-day ${metricLabel}`:sort==='floor'?'Min price':sort==='ceiling'?'Max price':sort==='base'?'Base price':sort==='connection'?'Connection':'Listing'} · {direction==='asc'?'ascending':'descending'}</span></div></div>
    <footer className="portfolio-footer"><details className="portfolio-method"><summary>Sources & methodology</summary>
      <p>{demo?'All homes, bookings, prices and market values in this preview are simulated. No live market feed is connected.':'Market comparisons use per-home imports. No automatic market-data feed is connected.'}</p>
      <p>Adjusted occupancy is booked nights divided by booked plus open nights, starting today in each home’s time zone. Owner blocks are excluded. These are on-the-books figures, not a prediction of final occupancy.</p>
      <p>Market is the average imported daily occupancy for the same bookable dates. Both sources need complete coverage, updated within 36 hours. Missing or stale data shows a dash.</p>
      <ul>{rows.map(row=><li key={row.id}><b>{row.name}:</b> calendar {row.observedAt?etStamp(row.observedAt):'unavailable'}; {row.marketSource||'no market source'}{row.marketObservedAt?` · ${etStamp(row.marketObservedAt)}`:''}.</li>)}</ul>
    </details><span className="portfolio-source-status">{demo?'Market: simulated':`Market: imports · ${currentMarkets}/${searched.length} current`}</span><span role="status" className="sr-only">{visible.length===rows.length?`${rows.length} listings`:`${visible.length} of ${rows.length} listings`}</span></footer>
  </section>;
}
