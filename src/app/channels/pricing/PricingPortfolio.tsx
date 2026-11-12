'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import Link from 'next/link';
import {Button} from '@/components/Button';
import {etStamp} from '@/lib/stable-time';
import {pricingMoney as money,pricingPercent as percent,pricingDateRange,pricingPeriodDates} from '@/lib/dynamic-pricing-display';
import {PRICING_WINDOWS,pricingPortfolioView,pricingPortfolioHref,pricingPortfolioTotals,sortPricingPortfolioRows,type PricingPortfolioRow,type PricingWindowDays,type PricingPortfolioView,type PricingPortfolioSort} from '@/lib/dynamic-pricing-portfolio';
import {pricingActivityValue,pricingActivityDescription} from '@/lib/dynamic-pricing-activity';
import PricingIcon from './PricingIcon';
import './pricing.css';

type Column={key:PricingPortfolioSort;label:string;period?:string;width:number;description:string;render:(r:PricingPortfolioRow)=>ReactNode};
const points=(n:number|null)=>n===null?'–':`${n>0?'+':''}${Math.round(n*10)/10} pts`;

export default function PricingPortfolio({rows,onOpen,demo=false,observed=false,initialView=pricingPortfolioView()}:{rows:PricingPortfolioRow[];onOpen?:(id:string)=>void;demo?:boolean;observed?:boolean;initialView?:PricingPortfolioView}) {
  const [window,setWindow]=useState<PricingWindowDays>(initialView.window),[query,setQuery]=useState(initialView.query),[filter,setFilter]=useState(initialView.filter);
  const [sort,setSort]=useState(initialView.sort),[direction,setDirection]=useState(initialView.direction),[connection,setConnection]=useState(initialView.connection);
  const [optional,setOptional]=useState<PricingPortfolioSort[]>(observed?['occupancy60','occupancy90','rate','booked7']:['market','gap','base']);
  const table=useRef<HTMLDivElement>(null);
  useEffect(()=>{table.current?.scrollTo({top:0});},[window,query,filter,sort,direction,connection]);
  const totals=pricingPortfolioTotals(rows,window),period=`Next ${window} days`,dates=pricingPeriodDates(rows.map(r=>r.windows[window]));
  const missing=(r:PricingPortfolioRow)=>!!r.error||(observed?[window,30,60,90]:[window]).some(n=>r.windows[n as PricingWindowDays].unknown>0);
  const unavailable=rows.filter(missing).length;
  const visible=sortPricingPortfolioRows(rows.filter(r=>`${r.name} ${r.city}`.toLowerCase().includes(query.trim().toLowerCase())&&(connection==='all'||connection===r.mode)&&
    (filter==='all'||filter==='data'&&missing(r)||filter==='below'&&r.windows[window].gapPp!==null&&r.windows[window].gapPp!<0)),{sort,direction,window});
  const description='Reserved nights ÷ reserved plus available nights. Blocks excluded. Missing calendars are not treated as vacant.';
  const occupancy=(r:PricingPortfolioRow,n:PricingWindowDays)=>{
    const w=r.windows[n];return <div className="portfolio-occupancy-cell" title={`${pricingDateRange(w.start,w.end)}: ${w.unknown?'Calendar incomplete':`${w.booked} reserved / ${w.bookable} bookable nights; ${w.blocked} blocked`}`}>
      <strong>{percent(w.occupancyPct)}</strong><span aria-hidden="true">{w.occupancyPct!==null&&<i style={{width:`${w.occupancyPct}%`}}/>}</span>
    </div>;
  };
  const columns:Column[]=[
    ...([30,60,90] as const).map(n=>({key:`occupancy${n}` as PricingPortfolioSort,label:'Occupancy',period:`Next ${n} days`,width:100,description,render:(r:PricingPortfolioRow)=>occupancy(r,n)})),
    {key:'occupancy',label:'Occupancy',period,width:100,description,render:r=>occupancy(r,window)},
    {key:'market',label:'Market',period,width:100,description:'Market occupancy on the same bookable dates, from current imported evidence.',render:r=><span title={r.marketSource||'Market data unavailable'}>{percent(r.windows[window].marketPct)}</span>},
    {key:'gap',label:'Difference',period,width:100,description:'Your occupancy minus market occupancy, in percentage points.',render:r=>points(r.windows[window].gapPp)},
    {key:'open',label:'Available',period,width:94,description:'Available nights in the selected period. Booked and blocked nights excluded.',render:r=>r.windows[window].unknown?'–':r.windows[window].open},
    {key:'rate',label:'Asking rate',period,width:106,description:'Average current price of available nights, not booked ADR. Taxes and fees excluded.',render:r=>money(r.currentRateCents?.[window]??null)},
    ...([7,45] as const).map(n=>({key:`booked${n}` as PricingPortfolioSort,label:'Nights booked',period:`Past ${n} days`,width:108,description:'Whole nights in surviving bookings received in this period, for any stay dates. ≥ means incomplete booking-date coverage.',render:(r:PricingPortfolioRow)=><span title={pricingActivityDescription(r.activity,n)}>{pricingActivityValue(r.activity,n)}</span>})),
    ...(['floor','base','ceiling'] as const).map(key=>({key,label:{floor:'Min price',base:'Base price',ceiling:'Max price'}[key],width:95,description:'Saved pricing policy, not the current nightly rate.',render:(r:PricingPortfolioRow)=>money(key==='floor'?r.floorCents:key==='base'?r.baseCents:r.ceilingCents)})),
    {key:'connection',label:'Connection',width:120,description:'Pricing authority and delivery mode.',render:r=>r.mode==='helm_direct'?'Helm direct':'Compare only'},
  ];
  const primary=observed?'occupancy30':'occupancy',available=columns.filter(c=>observed?['occupancy30','occupancy60','occupancy90','open','rate','booked7','booked45'].includes(c.key):!['occupancy30','occupancy60','occupancy90','rate','booked7','booked45'].includes(c.key));
  const shown=available.filter(c=>c.key===primary||optional.includes(c.key));
  function toggle(key:PricingPortfolioSort){setOptional(v=>v.includes(key)?v.filter(k=>k!==key):[...v,key]);if(sort===key){setSort('name');setDirection('asc');}}
  function header(key:PricingPortfolioSort,label:string,sub?:string,tip?:string){const active=sort===key;return <th key={key} scope="col" className={key==='name'?'portfolio-sticky':undefined} aria-sort={active?(direction==='asc'?'ascending':'descending'):undefined}><Button variant="quiet" title={tip} aria-label={`Sort ${label}${sub?` ${sub}`:''}`} onClick={()=>{setSort(key);setDirection(active&&direction==='asc'?'desc':'asc');}}><span>{label}{sub&&<small>{sub}</small>}</span><span className="portfolio-order" data-active={active||undefined} aria-hidden="true">{active&&direction==='desc'?'↓':'↑'}</span></Button></th>;}
  function open(row:PricingPortfolioRow,icon=false){const label=icon?<PricingIcon name="next"/>:row.name;return onOpen?<Button variant="quiet" className={icon?'portfolio-open':'portfolio-home-link'} aria-label={icon?`Review prices for ${row.name}`:undefined} onClick={()=>onOpen(row.id)}>{label}</Button>:<Link prefetch={false} className={icon?'portfolio-open':'portfolio-home-link'} aria-label={icon?`Review prices for ${row.name}`:undefined} href={pricingPortfolioHref({window,query,filter,sort,direction,connection},row.id)}>{label}</Link>;}
  const clear=()=>{setQuery('');setFilter('all');setConnection('all');};
  return <section className="helm-pricing pricing-portfolio pricing-portfolio-v2" aria-label="Pricing dashboard">
    <header className="portfolio-title-row"><h2>Portfolio <span>{rows.length} listings</span></h2><div className="portfolio-period"><label><span className="sr-only">Metric period</span><select aria-label="Metric period" value={window} onChange={e=>setWindow(Number(e.target.value) as PricingWindowDays)}>{PRICING_WINDOWS.map(n=><option key={n} value={n}>Summary · next {n} days</option>)}</select></label></div></header>
    <div className="portfolio-summary-strip" role="region" aria-label="Portfolio overview">
      <div title={description}><span>{observed?'Occupancy':'Compared occupancy'} <small>{period}</small></span><strong>{percent(observed?totals.occupancyPct:totals.comparedOccupancyPct)}</strong><i className="portfolio-summary-meter" aria-hidden="true"><i style={{width:`${(observed?totals.occupancyPct:totals.comparedOccupancyPct)??0}%`}}/></i></div>
      <div><span>Available nights <small>{period}</small></span><strong>{totals.currentHomes?totals.open.toLocaleString('en-US'):'–'}</strong></div>
      <div><span>Reserved nights <small>{period}</small></span><strong>{totals.currentHomes?totals.booked.toLocaleString('en-US'):'–'}</strong></div>
      {!observed&&<div><span>Market occupancy <small>{totals.comparableHomes} homes compared</small></span><strong>{percent(totals.marketPct)}</strong></div>}
    </div>
    <div className="portfolio-context"><span>{dates} · {totals.currentHomes}/{rows.length} calendars · Blocks excluded</span><span>{observed?'Market data not connected':demo?'Simulated data':`Market: ${totals.comparableHomes} homes compared`}</span></div>
    <div className="portfolio-command-row"><div className="portfolio-filter-tabs" role="group" aria-label="Listing filters"><Button variant="quiet" aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>All <span>{rows.length}</span></Button>{unavailable>0&&<Button variant="quiet" aria-pressed={filter==='data'} onClick={()=>setFilter('data')}>Unavailable <span>{unavailable}</span></Button>}{!observed&&<Button variant="quiet" aria-pressed={filter==='below'} onClick={()=>setFilter('below')}>Below market <span>{totals.belowMarket}</span></Button>}</div>
      <div className="portfolio-controls"><label className="portfolio-search"><span className="sr-only">Search listings</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input type="search" placeholder="Find a listing" value={query} onChange={e=>setQuery(e.target.value)}/></label>
        <details className="pricing-menu" name="portfolio-options"><summary><PricingIcon name="columns"/>Columns</summary><div className="pricing-menu-panel">{available.filter(c=>c.key!==primary).map(c=><label className="pricing-menu-check" key={c.key}><input type="checkbox" checked={optional.includes(c.key)} onChange={()=>toggle(c.key)}/>{c.label}{c.period?` · ${c.period.toLowerCase()}`:''}</label>)}{!observed&&<label>Connection<select value={connection} onChange={e=>setConnection(e.target.value as PricingPortfolioView['connection'])}><option value="all">All</option><option value="helm_direct">Helm direct</option><option value="shadow">Compare only</option></select></label>}</div></details>
        {(query||filter!=='all'||connection!=='all')&&<Button variant="quiet" aria-label="Clear filters" title="Clear filters" onClick={clear}><PricingIcon name="close"/></Button>}
      </div>
    </div>
    <div className="portfolio-surface"><div ref={table} className="portfolio-table-wrap" tabIndex={0} role="region" aria-label="Listing prices and occupancy. Scroll for more listings and columns."><table className="portfolio-table" style={{minWidth:180+shown.reduce((n,c)=>n+c.width,0)+42}}><colgroup><col style={{width:180}}/>{shown.map(c=><col key={c.key} style={{width:c.width}}/>)}<col style={{width:42}}/></colgroup><caption className="sr-only">Forward occupancy uses the period in each column. Asking rates and available nights use {period}, {dates}. Nights booked uses the past window shown.</caption><thead><tr>{header('name','Listing')}{shown.map(c=>header(c.key,c.label,c.period,c.description))}<th scope="col"><span className="sr-only">Open calendar</span></th></tr></thead><tbody>{visible.map(row=><tr key={row.id}><td className="portfolio-home portfolio-sticky">{open(row)}{missing(row)?<span className="portfolio-data-note">{row.error?'Calendar unavailable':'Calendar incomplete'}</span>:!row.windows[window].bookable?<span className="portfolio-data-note">Fully blocked</span>:null}</td>{shown.map(c=><td key={c.key} className="portfolio-number">{c.render(row)}</td>)}<td>{open(row,true)}</td></tr>)}</tbody></table></div>
      {!visible.length&&<div className="portfolio-empty"><p>{rows.length?'No listings match.':'No active listings.'}</p>{rows.length>0&&<Button variant="quiet" onClick={clear}>Clear filters</Button>}</div>}
      <div className="portfolio-table-footer"><span role="status">{visible.length} of {rows.length} listings</span><span>USD / night · Current asking rates</span></div>
    </div>
    <footer className="portfolio-footer"><details className="portfolio-method"><summary>Sources & definitions</summary><p>{observed?'Rates and availability come from Helm’s stored Guesty mirrors and native calendars. Refresh rereads Helm; it does not force an upstream sync. No independent market feed is connected.':demo?'All listing, rate and market figures are simulated.':'Market comparisons require current, complete imported evidence.'}</p><p>{description} These figures are current booked occupancy, not a forecast of final occupancy. Each column names its date horizon. Summary totals cover the whole portfolio regardless of table filters. The summary period also controls asking-rate and available-night columns.</p><p>Asking rate is the average available nightly price, not booked ADR. Nights booked counts whole nights in surviving confirmed/completed bookings received in the past 7 or 45 local days, for any stay dates. ≥ means some original booking dates are unverified; those measurements sort last. Counts do not reconstruct net cancellations or historical pace.</p><p>Missing or stale calendar data stays blank. Market comparisons use the same homes and bookable dates on both sides. The summary’s market figure covers {totals.comparableHomes} homes; matched listing occupancy is {percent(totals.comparedOccupancyPct)}.</p><ul>{rows.map(row=><li key={row.id}>{row.name}: calendar {row.observedAt?etStamp(row.observedAt):'unavailable'}; {row.marketSource||'no market source'}.</li>)}</ul></details></footer>
  </section>;
}
