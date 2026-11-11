'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Button} from '@/components/Button';
import {EmptyState} from '@/components/EmptyState';
import {etStamp} from '@/lib/stable-time';
import {PRICING_WINDOWS,pricingPortfolioView,pricingPortfolioHref,pricingPortfolioTotals,sortPricingPortfolioRows,type PricingPortfolioRow,type PricingWindowDays,type PricingPortfolioView,type PricingPortfolioSort} from '@/lib/dynamic-pricing-portfolio';
import PricingIcon from './PricingIcon';
import './pricing.css';

const money=(n:number|null)=>n===null?'–':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:n%100?2:0}).format(n/100);
const percent=(n:number|null)=>n===null?'–':`${n.toFixed(1)}%`;
const points=(n:number|null)=>{if(n===null)return '–';const rounded=Math.round(n*10)/10;return `${rounded>0?'+':''}${rounded.toFixed(1)} pts`;};
const sortLabels:Record<PricingPortfolioSort,string>={name:'Listing',occupancy:'Your occupancy',market:'Market occupancy',gap:'Difference',open:'Open nights',base:'Base price',floor:'Min price',ceiling:'Max price',connection:'Connection'};

export default function PricingPortfolio({rows,onOpen,demo=false,initialView=pricingPortfolioView()}:{rows:PricingPortfolioRow[];onOpen?:(id:string)=>void;demo?:boolean;initialView?:PricingPortfolioView}) {
  const [window,setWindow]=useState<PricingWindowDays>(initialView.window),[query,setQuery]=useState(initialView.query),[filter,setFilter]=useState(initialView.filter);
  const [sort,setSort]=useState(initialView.sort),[direction,setDirection]=useState(initialView.direction),[connection,setConnection]=useState(initialView.connection);
  const [bounds,setBounds]=useState(false),[showConnection,setShowConnection]=useState(false),[showOpen,setShowOpen]=useState(false);
  const tableRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{tableRef.current?.scrollTo({top:0});},[window,query,filter,sort,direction,connection]);
  const searched=rows.filter(r=>`${r.name} ${r.city} ${r.id}`.toLowerCase().includes(query.trim().toLowerCase())&&(connection==='all'||connection===r.mode));
  const needsData=(r:PricingPortfolioRow)=>r.windows[window].unknown>0||r.windows[window].marketIssue!==null||r.error!==null;
  const below=(r:PricingPortfolioRow)=>r.windows[window].gapPp!==null&&r.windows[window].gapPp!<0;
  const visible=sortPricingPortfolioRows(searched.filter(r=>filter==='all'||filter==='below'&&below(r)||filter==='data'&&needsData(r)),{sort,direction,window});
  // Keep the overview anchored to the full portfolio when narrowing the listing table.
  const totals=pricingPortfolioTotals(rows,window);
  const scope=`${totals.comparableHomes} of ${rows.length} homes compared`;
  function sortHeader(key:PricingPortfolioSort,label=sortLabels[key]) {
    const active=sort===key,next=active&&direction==='asc'?'desc':'asc';
    return <th scope="col" className={key==='name'?'portfolio-sticky':undefined} aria-sort={active?(direction==='asc'?'ascending':'descending'):undefined}>
      <Button variant="quiet" title={`Sort ${label.toLowerCase()} ${next==='asc'?'ascending':'descending'}`} onClick={()=>{setSort(key);setDirection(next);}}>
        <span>{label}</span><span className="portfolio-sort-icon" aria-hidden="true" data-active={active||undefined}><svg width="10" height="14" viewBox="0 0 10 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"><path d="m2 5 3-3 3 3" opacity={active&&direction==='desc'?.2:1}/><path d="m2 9 3 3 3-3" opacity={active&&direction==='asc'?.2:1}/></svg></span>
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
  function dataNote(row:PricingPortfolioRow) {
    const w=row.windows[window];
    return row.error?'Calendar unavailable':w.unknown?'Calendar incomplete':!w.bookable?'No bookable nights':w.marketIssue==='stale'?'Market outdated':w.marketIssue==='partial'?'Market incomplete':w.marketIssue==='missing'?'Market unavailable':null;
  }
  return <section className="helm-pricing pricing-portfolio" aria-label="Pricing dashboard">
    <header className="portfolio-overview-heading"><h2>Portfolio <span>{rows.length} homes</span></h2><label><span className="sr-only">Occupancy period</span><select value={window} onChange={e=>setWindow(Number(e.target.value) as PricingWindowDays)}>{PRICING_WINDOWS.map(n=><option key={n} value={n}>Next {n} days</option>)}</select></label></header>
    <div className="portfolio-overview" role="region" aria-label="Portfolio overview">
      <div className="portfolio-comparison"><h3>Occupancy vs market</h3>
        {([['Your homes',totals.comparedOccupancyPct],['Market',totals.marketPct]] as const).map(([label,value])=><div className="portfolio-comparison-row" key={label}><span>{label}</span><div aria-hidden="true">{value!==null&&<i style={{width:`${value}%`}}/>}</div><strong>{percent(value)}</strong></div>)}
        <p><b>{totals.gapPp===null?'No comparison':`${points(totals.gapPp)} vs market`}</b><span title="Weighted by bookable nights. Both sides use the same homes and dates with complete, current data.">{scope}</span></p>
      </div>
      <div className="portfolio-overview-stat"><h3>Open nights</h3><strong>{totals.currentHomes?totals.open.toLocaleString('en-US'):'–'}</strong><p>{totals.currentHomes} of {rows.length} calendars</p></div>
      <div className="portfolio-overview-stat"><h3>Homes below market</h3><strong>{totals.comparableHomes?totals.belowMarket:'–'}<span> / {totals.comparableHomes}</span></strong><p>Compared homes</p></div>
    </div>
    <header className="portfolio-heading"><h3>Listings <span className="portfolio-count">{visible.length}{visible.length!==rows.length?` / ${rows.length}`:''}</span></h3>
    <div className="portfolio-controls">
      <label className="portfolio-search"><span className="sr-only">Search listings</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input type="search" placeholder="Search listings" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <div className="portfolio-toolbar">
      <details className="pricing-menu" name="portfolio-options"><summary><PricingIcon name="sliders"/>Filters{filter!=='all'||connection!=='all'?<span className="pricing-filter-dot"/>:null}</summary><div className="pricing-menu-panel">
        <label>Show<select value={filter} onChange={e=>setFilter(e.target.value as PricingPortfolioView['filter'])}><option value="all">All listings</option><option value="below">Occupancy below market</option><option value="data">Unavailable measurements</option></select></label>
        <label>Pricing connection<select value={connection} onChange={e=>setConnection(e.target.value as PricingPortfolioView['connection'])}><option value="all">All connections</option><option value="helm_direct">Helm direct</option><option value="shadow">Compare only</option></select></label>
        <label>Sort by<select value={sort} onChange={e=>{const value=e.target.value as PricingPortfolioSort;setSort(value);setDirection(value==='open'?'desc':'asc');}}>{Object.entries(sortLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
        <label>Order<select value={direction} onChange={e=>setDirection(e.target.value as 'asc'|'desc')}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
      </div></details>
      <details className="pricing-menu" name="portfolio-options"><summary className="pricing-columns-toggle" aria-label="Choose columns" title="Choose columns"><PricingIcon name="columns"/></summary><div className="pricing-menu-panel"><p>Additional columns</p><label className="pricing-menu-check"><input type="checkbox" checked={showOpen} onChange={e=>setShowOpen(e.target.checked)}/>Open nights</label><label className="pricing-menu-check"><input type="checkbox" checked={bounds} onChange={e=>setBounds(e.target.checked)}/>Min / max prices</label><label className="pricing-menu-check"><input type="checkbox" checked={showConnection} onChange={e=>setShowConnection(e.target.checked)}/>Connection</label></div></details>
      {(filter!=='all'||connection!=='all'||query)&&<Button variant="quiet" size="sm" onClick={()=>{setQuery('');setFilter('all');setConnection('all');}} aria-label="Clear filters" title="Clear filters"><PricingIcon name="close"/></Button>}
      </div>
    </div>
    </header>
    <div className="portfolio-surface">
    <div ref={tableRef} className="portfolio-table-wrap" tabIndex={0} role="region" aria-label="Listing prices and occupancy. Scroll for more listings and columns."><table className="portfolio-table" style={{minWidth:`calc(var(--portfolio-listing-width) + ${3*104+92+44+(showOpen?104:0)+(bounds?184:0)+(showConnection?150:0)}px)`}}><colgroup><col className="portfolio-listing-col"/>{['your','market','gap'].map(key=><col key={key} className="portfolio-metric-col"/>)}{showOpen&&<col className="portfolio-metric-col"/>}{bounds&&<col className="portfolio-price-col"/>}<col className="portfolio-price-col"/>{bounds&&<col className="portfolio-price-col"/>}{showConnection&&<col className="portfolio-mode-col"/>}<col className="portfolio-action-col"/></colgroup><caption className="sr-only">Next {window} days: your booked occupancy and market occupancy, excluding owner blocks. Difference is in percentage points.</caption><thead><tr>
      {sortHeader('name')}{sortHeader('occupancy')}{sortHeader('market')}{sortHeader('gap')}{showOpen&&sortHeader('open')}
      {bounds&&sortHeader('floor','Min')}{sortHeader('base')}{bounds&&sortHeader('ceiling','Max')}{showConnection&&sortHeader('connection')}<th scope="col"><span className="sr-only">Open calendar</span></th>
    </tr></thead><tbody>{visible.map(row=>{const w=row.windows[window],note=dataNote(row);return <tr key={row.id}>
      <td className="portfolio-home portfolio-sticky">{openLink(row)}<span className="portfolio-home-meta">{row.city}{row.bedrooms!==null?` · ${row.bedrooms} BR`:''}</span>{note&&<span className="portfolio-data-note">{note}</span>}</td>
      <td className="portfolio-value" title={w.unknown?'Calendar incomplete':`${w.booked} booked / ${w.bookable} bookable nights; ${w.blocked} owner-blocked nights excluded`}>{percent(w.occupancyPct)}</td>
      <td className="portfolio-value" title={w.marketPct===null?(note??'Market unavailable'):`${row.marketSource}; ${row.marketObservedAt?etStamp(row.marketObservedAt):'observation time unavailable'}`}>{percent(w.marketPct)}</td>
      <td><span className="portfolio-difference" data-direction={w.gapPp===null?'unknown':w.gapPp<0?'below':w.gapPp>0?'above':'even'} title="Percentage points: your occupancy minus market occupancy">{points(w.gapPp)}</span></td>
      {showOpen&&<td className="portfolio-value">{w.unknown?'–':w.open}</td>}
      {bounds&&<td>{money(row.floorCents)}</td>}<td className="portfolio-base"><b title={!row.configured?'Draft base price':undefined}>{money(row.baseCents)}</b></td>{bounds&&<td>{money(row.ceilingCents)}</td>}
      {showConnection&&<td><span className="portfolio-connection-state" data-connected={row.mode==='helm_direct'||undefined}>{row.mode==='helm_direct'?'Helm direct':'Compare only'}</span><span className="portfolio-row-note">{row.lastAppliedAt?`Published ${etStamp(row.lastAppliedAt)}`:row.mode==='helm_direct'?'Manual publish':'Publishing off'}</span></td>}
      <td>{openLink(row,true)}</td>
    </tr>;})}</tbody></table></div>
    {!visible.length&&<div className="portfolio-empty"><EmptyState>{rows.length?'No listings match these filters.':'No active listings found.'}</EmptyState></div>}
    <div className="portfolio-table-footer"><span>Next {window} days · owner blocks excluded</span><span>{sortLabels[sort]} · {direction==='asc'?'ascending':'descending'}</span></div></div>
    <footer className="portfolio-footer"><details className="portfolio-method"><summary>Sources & methodology</summary>
      <p>{demo?'All homes, bookings, prices and market values in this preview are simulated. No live market feed is connected.':'Market comparisons use per-home imports. No automatic market-data feed is connected.'}</p>
      <p>Your occupancy is booked nights divided by booked plus open nights. Owner blocks are excluded. These are on-the-books figures, not a prediction of final occupancy. Difference is your occupancy minus market occupancy, in percentage points.</p>
      <p>The overview covers all {rows.length} homes and the selected period, regardless of table filters. Market comparisons include only homes with complete, current data on both sides, weighted by bookable nights. Open nights include all complete calendars.</p>
      <p>Market is the average imported daily occupancy for the same bookable dates. Both sources need complete coverage, updated within 36 hours. Missing or stale data shows a dash.</p>
      <ul>{rows.map(row=><li key={row.id}><b>{row.name}:</b> calendar {row.observedAt?etStamp(row.observedAt):'unavailable'}; {row.marketSource||'no market source'}{row.marketObservedAt?` · ${etStamp(row.marketObservedAt)}`:''}.</li>)}</ul>
    </details><span className="portfolio-source-status">{demo?'Market: simulated':`Market: imports · ${totals.comparableHomes}/${rows.length} compared`}</span><span role="status" className="sr-only">{visible.length===rows.length?`${rows.length} listings`:`${visible.length} of ${rows.length} listings`}</span></footer>
  </section>;
}
