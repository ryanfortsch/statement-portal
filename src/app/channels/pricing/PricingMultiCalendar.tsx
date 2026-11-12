'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Button} from '@/components/Button';
import {useConfirm} from '@/components/ConfirmDialog';
import {useUnsavedWorkGuard} from '@/lib/unsaved-work';
import {etStamp} from '@/lib/stable-time';
import {shiftIsoDay} from '@/lib/sca-quotes-types';
import {pricingDateRange,pricingMoney as money} from '@/lib/dynamic-pricing-display';
import {pricingGroupId,pricingGroupName,pricingInGroup,pricingDraftError,type PricingDrafts,type PricingOverride} from '@/lib/dynamic-pricing-drafts';
import type {PricingPortfolioRow} from '@/lib/dynamic-pricing-portfolio';
import {loadPricingMultiCalendars,pricingMultiDates,pricingMultiDraft,preparePricingBulkOverride,type PricingCalendarReader,type PricingCalendarResult} from '@/lib/dynamic-pricing-multicalendar';
import PricingIcon from './PricingIcon';

const shortDay=(date:string,part:'day'|'weekday'|'month')=>new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US',{timeZone:'UTC',...(part==='day'?{day:'numeric' as const}:part==='weekday'?{weekday:'short' as const}:{month:'short' as const})});
type Review=ReturnType<typeof preparePricingBulkOverride>;

export default function PricingMultiCalendar({homes,readAt,active,state,groupId,readCalendar,onOpen,commit}:{
  homes:PricingPortfolioRow[];readAt:string;active:boolean;state:PricingDrafts;groupId:string;readCalendar:PricingCalendarReader;onOpen:(id:string)=>void;commit:(s:PricingDrafts)=>void;
}) {
  const today=homes.map(h=>h.windows[30].start).sort()[0]??readAt.slice(0,10),lastDate=shiftIsoDay(today,179);
  const [start,setStart]=useState(today),[count,setCount]=useState(14),[query,setQuery]=useState(''),[mode,setMode]=useState<'current'|'draft'>('current'),[showStays,setShowStays]=useState(false),[descending,setDescending]=useState(false);
  const [loaded,setLoaded]=useState<{epoch:string;rows:PricingCalendarResult[]}>({epoch:'',rows:[]}),[attempt,setAttempt]=useState(0),[selected,setSelected]=useState<string[]>([]);
  const [night,setNight]=useState<{id:string;date:string}|null>(null),[editing,setEditing]=useState<{ids:string[];rule:PricingOverride}|null>(null),[review,setReview]=useState<{value:Review;baseline:string}|null>(null),[error,setError]=useState(''),[message,setMessage]=useState('');
  const grid=useRef<HTMLDivElement>(null),inspector=useRef<HTMLDialogElement>(null),editor=useRef<HTMLDialogElement>(null),{ask}=useConfirm();
  const epoch=`${readAt}/${attempt}`,loading=loaded.epoch!==epoch;
  useUnsavedWorkGuard(!!editing);
  useEffect(()=>{
    if(!active||loaded.epoch===epoch)return;
    let cancelled=false;
    void loadPricingMultiCalendars(homes.map(h=>h.id),readCalendar,()=>cancelled).then(rows=>{if(!cancelled)setLoaded({epoch,rows});});
    return ()=>{cancelled=true;};
  },[active,epoch,homes,readCalendar,loaded.epoch]);
  useEffect(()=>{if(night)inspector.current?.showModal();else inspector.current?.close();},[night]);
  useEffect(()=>{if(editing)editor.current?.showModal();else editor.current?.close();},[editing]);
  useEffect(()=>{grid.current?.scrollTo({left:0});},[start,count]);
  const calendars=useMemo(()=>loading?[]:loaded.rows.flatMap(r=>r.calendar?[r.calendar]:[]),[loaded.rows,loading]);
  const models=useMemo(()=>new Map(calendars.map(c=>[c.home.id,pricingMultiDraft(c,state,new Date())])),[calendars,state]);
  const visible=homes.filter(h=>(!groupId||pricingInGroup(state,h.id,groupId))&&`${h.name} ${h.city} ${pricingGroupName(state,pricingGroupId(state,h.id))}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name,'en',{numeric:true})*(descending?-1:1));
  const selectable=visible.filter(h=>state.homes[h.id]&&models.has(h.id)),chosen=selectable.filter(h=>selected.includes(h.id)).map(h=>h.id);
  const dates=pricingMultiDates(start<today?today:start,count),end=dates.at(-1)!;
  const monthBands=dates.reduce<{month:string;count:number}[]>((all,d)=>{const month=d.slice(0,7),last=all.at(-1);if(last?.month===month)last.count++;else all.push({month,count:1});return all;},[]);
  function openOverride(ids=chosen,date?:string){setError('');setMessage('');setReview(null);setEditing({ids,rule:{id:crypto.randomUUID(),label:'Date override',start:date??dates[0],end:date??end,kind:'percent',value:0,minNights:null,weekdays:[0,1,2,3,4,5,6]}});}
  function edit(patch:Partial<PricingOverride>){setEditing(e=>e?{...e,rule:{...e.rule,...patch}}:e);setReview(null);setError('');}
  async function closeEditor(){
    editor.current?.close();
    if(await ask({title:'Discard this override?',body:'No draft changes have been saved.',confirmLabel:'Discard'})){setEditing(null);setReview(null);setError('');}else editor.current?.showModal();
  }
  function reviewChanges(){if(!editing)return;try{setReview({value:preparePricingBulkOverride(state,editing.ids,calendars,editing.rule,new Date()),baseline:JSON.stringify(state)});setError('');}catch(e){setReview(null);setError(pricingDraftError(e));}}
  function saveChanges(){if(!editing||!review)return;try{
    if(review.baseline!==JSON.stringify(state))throw Error('Rules changed. Review again before saving.');
    const checked=preparePricingBulkOverride(state,editing.ids,calendars,editing.rule,new Date());
    if(JSON.stringify(checked.changes)!==JSON.stringify(review.value.changes))throw Error('Calendar evidence changed. Review again before saving.');
    commit(checked.next);setMessage(`Override saved to ${editing.ids.length} ${editing.ids.length===1?'listing':'listings'}. Live rates unchanged.`);setEditing(null);setReview(null);setSelected([]);setMode('draft');
  }catch(e){setReview(null);setError(pricingDraftError(e));}}
  const selectedHome=homes.find(h=>h.id===night?.id),selectedCalendar=calendars.find(c=>c.home.id===night?.id),model=night?models.get(night.id):null,day=model?.snapshot.days.find(d=>d.date===night?.date),proposal=model?.preview?.days.find(d=>d.date===night?.date);
  const steps=proposal?.steps.filter((s,i,all)=>!s.label.startsWith('Minimum stay:')&&(i===0||s.resultCents!==all[i-1].resultCents))??[];
  return <section className="pricing-multi" aria-label="Multi calendar" aria-busy={loading}>
    <header className="pricing-multi-heading"><h2>Multi calendar <span>{visible.length} homes</span></h2><label className="portfolio-search"><span className="sr-only">Search calendar listings</span><input type="search" placeholder="Search listings or groups" value={query} onChange={e=>{setQuery(e.target.value);setSelected([]);}}/></label></header>
    <div className="pricing-multi-toolbar">
      <div className="pricing-multi-dates"><Button variant="quiet" className="pricing-icon-button" aria-label="Previous dates" disabled={start<=today} onClick={()=>setStart(shiftIsoDay(start,-count)<today?today:shiftIsoDay(start,-count))}><PricingIcon name="previous"/></Button><label><span className="sr-only">Calendar start date</span><input aria-label="Calendar start date" type="date" value={start} min={today} max={shiftIsoDay(lastDate,1-count)} onChange={e=>{const value=e.target.value;if(value>=today&&value<=shiftIsoDay(lastDate,1-count))setStart(value);}}/></label><Button variant="quiet" className="pricing-icon-button" aria-label="Next dates" disabled={end>=lastDate} onClick={()=>setStart(shiftIsoDay(start,count)>shiftIsoDay(lastDate,1-count)?shiftIsoDay(lastDate,1-count):shiftIsoDay(start,count))}><PricingIcon name="next"/></Button><Button variant="quiet" size="sm" onClick={()=>setStart(today)}>Today</Button>
        <select aria-label="Calendar date span" value={count} onChange={e=>{const next=Number(e.target.value);setCount(next);if(start>shiftIsoDay(lastDate,1-next))setStart(shiftIsoDay(lastDate,1-next));}}>{[7,14,30].map(n=><option key={n} value={n}>{n} days</option>)}</select></div>
      <div className="pricing-view-switch" role="group" aria-label="Multi calendar rates"><Button variant="quiet" aria-pressed={mode==='current'} onClick={()=>setMode('current')}>Current rates</Button><Button variant="quiet" aria-pressed={mode==='draft'} onClick={()=>setMode('draft')}>Helm draft</Button></div>
      <label className="pricing-stay-toggle"><input type="checkbox" checked={showStays} onChange={e=>setShowStays(e.target.checked)}/>Min stay</label>
    </div>
    {chosen.length>0&&<div className="pricing-multi-selection"><span>{chosen.length} selected</span><Button variant="primary" size="sm" onClick={()=>openOverride()}>Override dates</Button><Button variant="quiet" size="sm" onClick={()=>setSelected([])}>Clear</Button></div>}
    {message&&<p role="status" className="pricing-feedback">{message}</p>}
    <div ref={grid} className="pricing-multi-scroll" tabIndex={0} role="region" aria-label="Portfolio calendar. Scroll across dates and down through listings.">
      <table className="pricing-multi-table"><colgroup><col className="pricing-multi-name-col"/>{dates.map(d=><col key={d} className="pricing-multi-date-col"/>)}</colgroup><thead>
        <tr className="pricing-multi-months"><th className="pricing-multi-pinned" rowSpan={2} scope="col" aria-sort={descending?'descending':'ascending'}><div><input type="checkbox" aria-label="Select all configured calendar listings" disabled={!selectable.length} checked={selectable.length>0&&chosen.length===selectable.length} onChange={e=>setSelected(e.target.checked?selectable.map(h=>h.id):[])}/><Button variant="quiet" onClick={()=>setDescending(v=>!v)} aria-label={`Sort calendar listings ${descending?'ascending':'descending'}`}>Listing <span aria-hidden="true">{descending?'↓':'↑'}</span></Button></div></th>{monthBands.map(b=><th scope="colgroup" key={b.month} colSpan={b.count}><span className="pricing-multi-month-label">{shortDay(b.month+'-01','month')} {b.month.slice(0,4)}</span></th>)}</tr>
        <tr>{dates.map(d=><th scope="col" key={d} data-weekend={[5,6].includes(new Date(d+'T12:00:00Z').getUTCDay())||undefined} data-today={d===today||undefined}><span>{shortDay(d,'weekday')}</span><b>{shortDay(d,'day')}</b></th>)}</tr>
      </thead><tbody>{visible.map(home=>{
        const m=models.get(home.id),byDate=new Map(m?.snapshot.days.map(d=>[d.date,d])),proposed=new Map(m?.preview?.days.map(d=>[d.date,d])),configured=!!state.homes[home.id];
        return <tr key={home.id}><th scope="row" className="pricing-multi-pinned"><div className="pricing-multi-home"><input type="checkbox" aria-label={`Select ${home.name}`} checked={chosen.includes(home.id)} disabled={!configured||!m} title={!configured?'Configure this listing’s draft first':!m?'Calendar unavailable':undefined} onChange={e=>setSelected(e.target.checked?[...selected,home.id]:selected.filter(id=>id!==home.id))}/><div><Button variant="quiet" onClick={()=>onOpen(home.id)}>{home.name}</Button>{loading?<small>Loading…</small>:!m?<small>Calendar unavailable</small>:m.error?<small>{m.error}</small>:mode==='draft'&&!configured?<small>Configure prices</small>:null}</div></div></th>
          {dates.map(date=>{const d=byDate.get(date),p=proposed.get(date),status=d?.state??'unknown',price=mode==='current'?d?.currentCents:p?.recommendedCents,min=mode==='current'?d?.minNights:p?.minNights,review=mode==='draft'&&status==='open'&&!d?.protected&&!!p&&!p.eligible;
            return <td key={date} data-state={status} data-weekend={[5,6].includes(new Date(date+'T12:00:00Z').getUTCDay())||undefined}><Button variant="quiet" className="pricing-multi-night" disabled={!d} aria-label={`${home.name}, ${date}, ${status}${status==='open'?`, ${money(price)}${min?`, minimum ${min} nights`:''}`:''}`} onClick={()=>setNight({id:home.id,date})}>
              {status==='open'?<><span>{money(price)}</span>{showStays&&<small>{min??'–'}n</small>}{d?.protected?<i title="Manual price" className="pricing-multi-indicator"><PricingIcon name="lock"/></i>:review?<i title="Needs review" className="pricing-dot pricing-multi-indicator"/>:null}</>:status==='booked'?<span className="pricing-booked-mark" title="Booked"/>:status==='blocked'?<PricingIcon name="lock"/>:<span>–</span>}
            </Button></td>;
          })}</tr>;
      })}</tbody></table>
      {!visible.length&&<p className="pricing-multi-empty">No listings match.</p>}
    </div>
    <footer className="pricing-multi-footer"><div className="pricing-calendar-key"><span><i className="pricing-booked-key"/>Booked</span><span><i className="pricing-blocked-key"/>Blocked</span>{mode==='draft'&&<span><i className="pricing-dot"/>Review</span>}</div><span>{pricingDateRange(dates[0],end)} · USD / night</span><span>{loading?'Loading calendars…':`${calendars.length} / ${homes.length} calendars`}</span>{!loading&&calendars.length<homes.length&&<Button variant="quiet" size="sm" onClick={()=>setAttempt(v=>v+1)}>Retry unavailable</Button>}</footer>
    <dialog ref={inspector} className="pricing-detail-dialog" aria-label="Portfolio night details" onCancel={()=>setNight(null)}>
      <div className="pricing-dialog-content"><div className="pricing-inspector-toolbar"><h2>{selectedHome?.name}</h2><Button variant="quiet" aria-label="Close portfolio night" onClick={()=>setNight(null)}><PricingIcon name="close"/></Button></div><p>{night?.date} · {day?.state??'Unavailable'}{day?.protected?' · Manual price':''}</p>
        <div className="pricing-detail-comparison"><div><span>Current · USD / night</span><strong>{day?.state==='open'?money(day.currentCents,true):'–'}</strong></div><div><span>Helm draft · USD / night</span><strong>{day?.state==='open'?money(proposal?.recommendedCents,true):'–'}</strong></div></div>
        {day?.state==='open'&&<div className="pricing-detail-minimum"><span>Min stay · current / draft</span><b>{day.minNights??'–'} / {proposal?.minNights??'–'}</b></div>}
        {proposal?.reasons.length?<ul className="pricing-detail-reasons">{proposal.reasons.map((r,i)=><li key={i}>{r}</li>)}</ul>:null}
        {!!steps.length&&<div className="pricing-calculation"><h4>Price breakdown</h4><ol>{steps.map((s,i)=><li key={i}><span>{s.label}</span><b>{money(s.resultCents,true)}</b></li>)}</ol></div>}
        <div className="pricing-draft-dialog-actions"><Button variant="secondary" onClick={()=>{if(night){setNight(null);onOpen(night.id);}}}>Review property</Button>{night&&state.homes[night.id]&&day?.state==='open'&&!day.protected&&<Button variant="primary" onClick={()=>{const n=night;setNight(null);openOverride([n.id],n.date);}}>Override dates</Button>}</div>
        <p className="pricing-draft-note">{selectedCalendar?.source} · {selectedCalendar?.sourceObservedAt?etStamp(selectedCalendar.sourceObservedAt):'Update unavailable'} · Drafts do not sync.</p>
      </div>
    </dialog>
    <dialog ref={editor} className="pricing-draft-dialog pricing-multi-editor" aria-label="Bulk date override" onCancel={e=>{e.preventDefault();void closeEditor();}}>
      <header><div><h2>Override dates</h2><p>{editing?.ids.length} listings · Draft only</p></div><Button variant="quiet" aria-label="Close bulk override" onClick={()=>void closeEditor()}><PricingIcon name="close"/></Button></header>
      {editing&&<div className="pricing-draft-dialog-body"><details><summary>{editing.ids.length} selected listings</summary><ul>{editing.ids.map(id=><li key={id}>{homes.find(h=>h.id===id)?.name}</li>)}</ul></details><div className="pricing-draft-fields">
        <label className="pricing-field">Name<input value={editing.rule.label} maxLength={80} onChange={e=>edit({label:e.target.value})}/></label>
        <label className="pricing-field">Price rule<select value={editing.rule.kind} onChange={e=>edit({kind:e.target.value as PricingOverride['kind'],value:0})}><option value="percent">Adjust Helm price (%)</option><option value="fixed">Fixed nightly price</option><option value="stay">Minimum stay only</option></select></label>
        <label className="pricing-field">First night<input type="date" min={today} max={lastDate} value={editing.rule.start} onChange={e=>edit({start:e.target.value})}/></label><label className="pricing-field">Last night<input type="date" min={today} max={lastDate} value={editing.rule.end} onChange={e=>edit({end:e.target.value})}/></label>
        {editing.rule.kind!=='stay'&&<label className="pricing-field">{editing.rule.kind==='fixed'?'Nightly price ($)':'Adjustment (%)'}<input type="number" step={editing.rule.kind==='fixed'?0.01:1} value={editing.rule.kind==='fixed'?editing.rule.value/100:editing.rule.value} onChange={e=>edit({value:editing.rule.kind==='fixed'?Math.round(Number(e.target.value)*100):Number(e.target.value)})}/></label>}
        <label className="pricing-field">Minimum nights<input type="number" min={1} max={30} placeholder="Use pricing rules" value={editing.rule.minNights??''} onChange={e=>edit({minNights:e.target.value===''?null:Number(e.target.value)})}/></label>
      </div><fieldset className="pricing-weekday-picker"><legend>Apply on</legend>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((label,n)=><label key={n}><input type="checkbox" checked={editing.rule.weekdays.includes(n)} onChange={e=>edit({weekdays:e.target.checked?[...editing.rule.weekdays,n].sort():editing.rule.weekdays.filter(d=>d!==n)})}/>{label}</label>)}</fieldset>
      {review&&<div className="pricing-multi-review"><table aria-label="Override review"><thead><tr><th>Listing</th><th>Changed nights</th><th>Draft rate</th><th>Skipped</th></tr></thead><tbody>{review.value.changes.map(c=><tr key={c.id}><th>{c.name}</th><td>{c.changed}</td><td>{c.minimumCents===c.maximumCents?money(c.minimumCents,true):`${money(c.minimumCents,true)}–${money(c.maximumCents,true)}`}{!!c.limited&&<small>{c.limited} at price limits</small>}{!!c.review&&<small>{c.review} need review</small>}</td><td>{c.skipped}</td></tr>)}</tbody></table></div>}
      <p className="pricing-draft-note">Minimum and maximum prices still apply. Booked, blocked and manual-price nights are skipped. Saving creates listing overrides; live rates stay unchanged.</p>
      {error&&<p role="alert" className="pricing-feedback">{error}</p>}
      <div className="pricing-draft-dialog-actions"><Button variant="secondary" onClick={reviewChanges}>Review changes</Button><Button variant="primary" disabled={!review} onClick={saveChanges}>Save draft overrides</Button></div>
      </div>}
    </dialog>
  </section>;
}
