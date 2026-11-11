'use client';
import {useMemo,useState} from 'react';
import Link from 'next/link';
import {Button} from '@/components/Button';
import {buttonClass} from '@/lib/button-class';
import {EmptyState} from '@/components/EmptyState';
import {etStamp} from '@/lib/stable-time';
import {PRICING_WINDOWS,pricingPortfolioTotals,pricingPortfolioView,pricingPortfolioHref,type PricingPortfolioRow,type PricingWindowDays,type PricingPortfolioView} from '@/lib/dynamic-pricing-portfolio';
import PricingIcon from './PricingIcon';
import './pricing.css';

const percent=(n:number|null)=>n===null?'–':`${Math.round(n)}%`;
const precisePercent=(n:number|null)=>n===null?'–':`${n.toFixed(1)}%`;
const money=(n:number|null)=>n===null?'–':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:n%100?2:0}).format(n/100);
const points=(n:number|null)=>n===null?'–':`${n>0?'+':''}${Math.round(n*10)/10} pts`;
type Filter='all'|'below'|'data';
type Sort='name'|'occupancy'|'gap'|'open';
export default function PricingPortfolio({rows,onOpen,sample=false,initialView=pricingPortfolioView()}:{rows:PricingPortfolioRow[];onOpen?:(id:string)=>void;sample?:boolean;initialView?:PricingPortfolioView}) {
  const [window,setWindow]=useState<PricingWindowDays>(initialView.window),[query,setQuery]=useState(initialView.query),[filter,setFilter]=useState<Filter>(initialView.filter);
  const [sort,setSort]=useState<Sort>(initialView.sort),[connection,setConnection]=useState<PricingPortfolioView['connection']>(initialView.connection);
  const totals=useMemo(()=>pricingPortfolioTotals(rows,window),[rows,window]);
  const gaps=rows.filter(r=>r.windows[window].unknown||r.windows[window].marketIssue||r.error).length;
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
    return onOpen?<Button variant={review?'secondary':'quiet'} size="sm" className={className} aria-label={review?`Review prices for ${row.name}`:undefined} onClick={()=>onOpen(row.id)}>{label}{review&&<PricingIcon name="next"/>}</Button>:
      <Link prefetch={false} href={pricingPortfolioHref({window,query,filter,sort,connection},row.id)} className={className} aria-label={review?`Review prices for ${row.name}`:undefined}>{label}{review&&<PricingIcon name="next"/>}</Link>;
  }
  return <section className="helm-pricing pricing-portfolio" aria-label="Pricing dashboard">
    <header className="portfolio-heading"><div><h2>Pricing dashboard</h2><p>{rows.length} homes{sample?' · Sample portfolio':''}</p></div>
      <div className="portfolio-period"><span>Looking ahead</span><div role="group" aria-label="Occupancy period">{PRICING_WINDOWS.map(n=><Button key={n} variant="quiet" size="sm" aria-pressed={window===n} onClick={()=>setWindow(n)}>{n} days</Button>)}</div></div>
    </header>
    <div className="portfolio-summary" aria-label={`Next ${window} days portfolio summary`}>
      <div><span>Booked occupancy</span><strong>{percent(totals.occupancyPct)}</strong><p>{totals.currentHomes?`${totals.booked} of ${totals.bookable} bookable nights`:'Current calendar needed'}{totals.currentHomes<rows.length&&` · ${totals.currentHomes}/${rows.length} homes`}</p></div>
      <div><span>Compared with market</span><strong data-direction={totals.gapPp!==null&&totals.gapPp<0?'below':'above'}>{points(totals.gapPp)}</strong><p>{totals.comparableHomes?`${precisePercent(totals.comparedOccupancyPct)} booked / ${precisePercent(totals.marketPct)} market · ${totals.comparableHomes} homes`:'Add current market data'}</p></div>
      <div><span>Open nights</span><strong>{totals.currentHomes?totals.open:'–'}</strong><p>{totals.currentHomes?`${totals.blocked} blocked nights excluded`:'Current calendar needed'}</p></div>
    </div>
    <div className="portfolio-filterbar"><div role="group" aria-label="Home filters">
      {([['all','All homes',rows.length],['below','Below market',totals.belowMarket],['data','Data gaps',gaps]] as const).map(([id,label,count])=><Button variant="quiet" size="sm" key={id} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}<span>{count}</span></Button>)}
    </div></div>
    <div className="portfolio-controls">
      <label className="portfolio-search"><span className="sr-only">Search homes</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input type="search" placeholder="Search homes or cities" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <label><span className="sr-only">Pricing connection</span><select value={connection} onChange={e=>setConnection(e.target.value as PricingPortfolioView['connection'])}><option value="all">All connections</option><option value="helm_direct">Helm direct</option><option value="shadow">Compare only</option></select></label>
      <label><span className="sr-only">Sort homes</span><select value={sort} onChange={e=>setSort(e.target.value as Sort)}><option value="name">Name A–Z</option><option value="gap">Furthest below market</option><option value="occupancy">Lowest occupancy</option><option value="open">Most open nights</option></select></label>
    </div>
    <div className="portfolio-table-wrap"><table className="portfolio-table"><caption className="sr-only">Homes and occupancy over the next {window} days</caption><thead><tr>
      <th scope="col">Home</th><th scope="col">Next {window} days<span>Booked / market</span></th><th scope="col" className="portfolio-open-column">Open nights</th><th scope="col">Base price</th><th scope="col" className="portfolio-connection-column">Pricing</th><th scope="col"><span className="sr-only">Review</span></th>
    </tr></thead><tbody>{visible.map(row=>{
      const w=row.windows[window],below=w.gapPp!==null&&w.gapPp<0;
      const issue=w.unknown?'Calendar incomplete':!w.bookable?'No bookable nights':w.marketIssue==='stale'?'Market data out of date':w.marketIssue==='missing'?'No market data':w.marketIssue==='partial'?'Market data incomplete':null;
      return <tr key={row.id}>
        <td className="portfolio-home"><div>{openLink(row)}<span>{row.city}{row.bedrooms!==null?` · ${row.bedrooms} ${row.bedrooms===1?'bedroom':'bedrooms'}`:''}</span><small className="portfolio-connection-compact">{row.mode==='helm_direct'?'Helm direct':'Compare only'}</small></div></td>
        <td className="portfolio-occupancy" data-direction={below?'below':'above'}><div className="portfolio-occ-numbers"><b>{percent(w.occupancyPct)}</b><span>/ {percent(w.marketPct)}</span>{w.gapPp!==null&&<small>{points(w.gapPp)}</small>}</div>
          {w.occupancyPct!==null&&<div className="portfolio-meter" aria-hidden="true"><i style={{width:`${w.occupancyPct}%`}}/>{w.marketPct!==null&&<em style={{left:`${Math.min(99,w.marketPct)}%`}}/>}</div>}
          <span className="portfolio-row-note">{row.error??issue??`${w.booked} booked · ${w.open} open`}</span>
        </td>
        <td className="portfolio-open-column"><b>{w.unknown?'–':w.open}</b><span className="portfolio-row-note">{w.blocked} blocked</span></td>
        <td className="portfolio-base"><b>{money(row.baseCents)}</b><span className="portfolio-row-note">{row.floorCents!==null?`${money(row.floorCents)}–${money(row.ceilingCents)}`:'Not set'}{row.baseCents!==null&&!row.configured?' · Draft':''}</span></td>
        <td className="portfolio-connection-column"><span className="portfolio-connection-state" data-connected={row.mode==='helm_direct'||undefined}>{row.mode==='helm_direct'?'Helm direct':'Compare only'}</span><span className="portfolio-row-note">{row.mode==='helm_direct'?'Manual publish':'Rates unchanged'}</span></td>
        <td className="portfolio-row-action">{openLink(row,true)}</td>
      </tr>;
    })}</tbody></table></div>
    {!visible.length&&<div className="portfolio-empty"><EmptyState>{rows.length?'No homes match these filters.':'No active homes found.'}</EmptyState>{rows.length>0&&<Button variant="quiet" size="sm" onClick={()=>{setQuery('');setFilter('all');setConnection('all');}}>Clear filters</Button>}</div>}
    <footer className="portfolio-footer"><span role="status">{visible.length} of {rows.length} homes</span><span>Bar: booked occupancy · Marker: market</span></footer>
    <details className="portfolio-method"><summary>How these numbers are calculated</summary>
      <p>Next {window} calendar nights, starting today in each home’s time zone. Booked occupancy is confirmed booked nights divided by booked plus open nights. Owner blocks are excluded. Missing or stale calendar dates withhold the percentage.</p>
      <p>Market is the average imported daily occupancy for the same bookable dates. Data must be no more than 36 hours old and cover every compared date. Portfolio comparisons use only homes with complete current data on both sides, weighted by their bookable nights. The summary covers all homes; filters only change the rows. These are on-the-books figures, not a prediction of final occupancy.</p>
      <ul>{rows.map(row=><li key={row.id}><b>{row.name}:</b> calendar {row.observedAt?etStamp(row.observedAt):'unavailable'}; {row.marketSource||'no market source'}{row.marketObservedAt?` · ${etStamp(row.marketObservedAt)}`:''}.</li>)}</ul>
    </details>
  </section>;
}
