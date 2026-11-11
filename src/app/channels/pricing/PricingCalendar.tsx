'use client';
import {useRef, useState} from 'react';
import {Button} from '@/components/Button';
import {EmptyState} from '@/components/EmptyState';
import {pricingCalendarMonth, pricingNightStatus, needsPricingAttention, type PricingNightStatus} from '@/lib/dynamic-pricing-view';
import type {PricingPreview, PricingSnapshot} from '@/lib/dynamic-pricing';
import PricingIcon from './PricingIcon';

const money = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? 'Unavailable' : new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', minimumFractionDigits:0, maximumFractionDigits:2}).format(n / 100);
const monthLabel = (month:string) => new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US', {month:'long', year:'numeric', timeZone:'UTC'});
const dateLabel = (date:string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric', timeZone:'UTC'});
const labels: Record<PricingNightStatus, string> = {ready:'Ready to review', review:'Needs review', manual:'Manual price', booked:'Booked', blocked:'Blocked', unknown:'No data'};

export default function PricingCalendar({snapshot, preview, baseCents}: {
  snapshot:PricingSnapshot; preview:PricingPreview|null; baseCents:number;
}) {
  const months = [...new Set(snapshot.days.map(d => d.date.slice(0,7)))];
  const [month,setMonth] = useState(months[0]), [layout,setLayout] = useState<'calendar'|'table'>('calendar');
  const [filter,setFilter] = useState<'all'|'attention'>('all'), [selectedDate,setSelectedDate] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const activeMonth = months.includes(month) ? month : months[0];
  const monthCells = pricingCalendarMonth(activeMonth, snapshot, preview);
  const todayIndex=monthCells.findIndex(c=>c?.date===snapshot.today);
  const cells=todayIndex>=7?monthCells.slice(Math.floor(todayIndex/7)*7):monthCells;
  const visible = cells.filter(c => c?.day && (filter === 'all' || needsPricingAttention(c.status!)));
  const selected = visible.find(c => c!.date === selectedDate) ?? visible.find(c => c!.day!.state === 'open') ?? visible[0];
  const recommendation = selected?.recommendation;
  const attention = snapshot.days.filter(d => needsPricingAttention(pricingNightStatus(d, preview?.days.find(r => r.date === d.date))));
  const steps = recommendation?.steps.filter((s,i,all) => !s.label.startsWith('Minimum stay:') && (i === 0 || s.resultCents !== all[i-1].resultCents)) ?? [];

  function selectNight(date:string) {
    setSelectedDate(date);
    dialog.current?.showModal();
  }
  function jumpToAttention() {
    setFilter(filter === 'attention' ? 'all' : 'attention');
    if (filter !== 'attention' && attention[0]) {setMonth(attention[0].date.slice(0,7)); setSelectedDate(attention[0].date);}
  }
  function details() {
    if (!selected) return <EmptyState rule={false}>Select a date to see its price.</EmptyState>;
    return <>
      <div className="pricing-detail-head"><p className="pricing-detail-status" data-status={selected.status}>{labels[selected.status!]}</p><h3>{dateLabel(selected.date)}</h3></div>
      <div className="pricing-detail-price"><span>Proposed nightly rate</span><strong>{money(recommendation?.recommendedCents)}</strong>
        <p>Current {money(selected.day!.currentCents)}{recommendation?.changePct != null && <span> · {recommendation.changePct > 0 ? '+' : ''}{recommendation.changePct.toFixed(1)}%</span>}</p>
      </div>
      {selected.day!.state === 'open' && <div className="pricing-detail-minimum"><span>Minimum stay</span><b>{recommendation?.minNights ?? 'Unknown'} {recommendation?.minNights === 1 ? 'night' : 'nights'}</b></div>}
      {!!recommendation?.reasons.length && <ul className="pricing-detail-reasons" data-status={selected.status}>{recommendation.reasons.map(r => <li key={r}>{r}</li>)}</ul>}
      {!!steps.length && <div className="pricing-calculation"><h4>Price calculation</h4><ol>{steps.map((s,i) => <li key={i}><span>{s.label}{s.adjustmentPct !== 0 && <small>{s.adjustmentPct > 0 ? '+' : ''}{s.adjustmentPct.toFixed(1)}%</small>}</span><b>{money(s.resultCents)}</b></li>)}</ol></div>}
    </>;
  }
  return <section aria-label="Nightly prices" className="pricing-calendar">
    <div className="pricing-calendar-toolbar">
      <div className="pricing-month-control"><Button size="sm" onClick={()=>{setMonth(months[0]);setFilter('all');}}>Today</Button><label className="sr-only" htmlFor="pricing-month">Month</label><select id="pricing-month" value={activeMonth} onChange={e => setMonth(e.target.value)}>{months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
        <div><Button variant="quiet" className="pricing-icon-button" aria-label="Previous month" disabled={months.indexOf(activeMonth) === 0} onClick={() => setMonth(months[months.indexOf(activeMonth)-1])}><PricingIcon name="previous"/></Button><Button variant="quiet" className="pricing-icon-button" aria-label="Next month" disabled={months.indexOf(activeMonth) === months.length-1} onClick={() => setMonth(months[months.indexOf(activeMonth)+1])}><PricingIcon name="next"/></Button></div>
      </div>
      <div className="pricing-display-controls">{attention.length>0&&<Button variant="quiet" className="pricing-attention" aria-pressed={filter==='attention'} onClick={jumpToAttention}>{attention.length} need review</Button>}<select aria-label="Show nights" value={filter} onChange={e => setFilter(e.target.value as typeof filter)}><option value="all">All dates</option><option value="attention">Needs review</option></select>
        <div className="pricing-view-switch" role="group" aria-label="Price display">{(['calendar','table'] as const).map(v => <Button key={v} variant="quiet" aria-label={v === 'calendar' ? 'Calendar' : 'Table'} title={v === 'calendar' ? 'Calendar' : 'Table'} aria-pressed={layout === v} onClick={() => setLayout(v)}><PricingIcon name={v}/></Button>)}</div>
      </div>
    </div>
    <div className="pricing-calendar-layout"><div className="pricing-calendar-main">
      {layout === 'calendar' ? <div className="pricing-month-grid">
        <div className="pricing-weekdays">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <span key={d}>{d}</span>)}</div>
        <div className="pricing-days" aria-label={`${monthLabel(activeMonth)} prices`}>
          {cells.map((cell,index) => {
            if (!cell) return <div key={`pad-${index}`} className="pricing-day-empty"/>;
            if (!cell.day) return <div key={cell.date} className="pricing-day-outside" aria-label={`${cell.date}, outside forecast`}><span>{cell.dayNumber}</span></div>;
            const matches = filter === 'all' || needsPricingAttention(cell.status!);
            const rate = cell.recommendation?.recommendedCents;
            return <Button key={cell.date} variant="quiet" className="pricing-day" data-status={cell.status} data-level={cell.day.state==='open'&&rate!=null?(rate<baseCents*.85?'lower':rate>baseCents*1.15?'higher':'base'):undefined} data-weekend={index % 7 === 0 || index % 7 === 6 || undefined} disabled={!matches}
              aria-pressed={cell.date === selectedDate} aria-label={`${dateLabel(cell.date)}, ${labels[cell.status!]}${cell.day.state === 'open' ? `, ${money(rate)}` : ''}`} onClick={() => selectNight(cell.date)}>
              <span className="pricing-day-top"><span data-today={cell.date === snapshot.today || undefined}>{cell.dayNumber}</span>{cell.status === 'review' || cell.status === 'unknown' ? <span className="pricing-dot"/> : cell.status === 'manual' ? <PricingIcon name="lock"/> : null}</span>
              {cell.day.state === 'open' ? <><span className="pricing-day-rate" data-long={(rate != null && rate >= 100000) || undefined}>{rate == null ? 'No price' : money(rate)}</span><span className="pricing-day-stay">{cell.status === 'manual' ? 'Manual' : <><span className="pricing-stay-full">{cell.recommendation?.minNights ?? '?'} night min</span><span className="pricing-stay-short">Min {cell.recommendation?.minNights ?? '?'}</span></>}</span></> : <span className="pricing-day-state">{labels[cell.status!]}</span>}
            </Button>;
          })}
        </div>
      </div> : <div className="pricing-table-wrap"><table aria-label="Monthly prices"><thead><tr>{['Date','Current','Proposed','Min stay','Status'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{visible.map(cell => <tr key={cell!.date} data-selected={cell!.date === selected?.date || undefined}>
        <td><Button variant="quiet" onClick={() => selectNight(cell!.date)}>{dateLabel(cell!.date)}</Button></td><td>{money(cell!.day!.currentCents)}</td><td><b>{money(cell!.recommendation?.recommendedCents)}</b></td><td>{cell!.recommendation?.minNights ?? 'N/A'}</td><td>{labels[cell!.status!]}</td>
      </tr>)}</tbody></table></div>}
      {!visible.length && <EmptyState rule={false}>No dates need review this month.</EmptyState>}
      <div className="pricing-calendar-caption"><span className="pricing-rate-legend">Vs. base <i data-level="lower"/>Below 85% <i data-level="base"/>85–115% <i data-level="higher"/>Above 115%</span><span><i className="pricing-dot"/>Review <PricingIcon name="lock"/>Manual</span></div>
      <p className="pricing-calendar-note">Nightly rates in USD, before taxes and fees. Select a night for its calculation.</p>
    </div></div>
    <dialog ref={dialog} className="pricing-detail-dialog" aria-label="Nightly price details" onClick={e => {if(e.target === e.currentTarget) dialog.current?.close();}}>
      <div className="pricing-dialog-content"><Button variant="quiet" className="pricing-icon-button pricing-close-detail" aria-label="Close price details" onClick={() => dialog.current?.close()}><PricingIcon name="close"/></Button>{details()}</div>
    </dialog>
  </section>;
}
