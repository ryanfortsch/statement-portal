'use client';
import {useRef,useState} from 'react';
import {Button} from '@/components/Button';
import {useConfirm} from '@/components/ConfirmDialog';
import {hasUnsavedWork,useUnsavedWorkGuard} from '@/lib/unsaved-work';
import {pricingDraftError,resolvePricingStayRules,type PricingDrafts} from '@/lib/dynamic-pricing-drafts';
import {previewPricingStay,type PricingStayRules} from '@/lib/dynamic-pricing-stays';
import {shiftIsoDay} from '@/lib/sca-quotes-types';
import {pricingMoney} from '@/lib/dynamic-pricing-display';
import type {PricingPolicy,PricingPreview,PricingSnapshot} from '@/lib/dynamic-pricing';
import PricingStayFields from './PricingStayFields';
import PricingIcon from './PricingIcon';
export default function PricingStayControls({state,propertyId,snapshot,preview,policy,commit,closeMenu}:{state:PricingDrafts;propertyId:string;snapshot:PricingSnapshot;preview:PricingPreview|null;policy:PricingPolicy;commit:(s:PricingDrafts)=>void;closeMenu:()=>void}){
  const [work,setWork]=useState(state),[open,setOpen]=useState(false),[view,setView]=useState<'check'|'rules'>('check'),[arrival,setArrival]=useState(snapshot.today),[departure,setDeparture]=useState(shiftIsoDay(snapshot.today,7)),[error,setError]=useState('');
  const dialog=useRef<HTMLDialogElement>(null),{ask}=useConfirm(),dirty=open&&JSON.stringify(work)!==JSON.stringify(state);useUnsavedWorkGuard(dirty);
  const resolved=resolvePricingStayRules(work,{kind:'listing',id:propertyId}),home=work.homes[propertyId];
  async function show(){if(hasUnsavedWork()){await ask({title:'Save pricing rules first',body:'Save the nightly rules before checking stay prices.',confirmLabel:'Return to rules',cancelLabel:'Close'});return;}setWork(state);setError('');setOpen(true);dialog.current?.showModal();}
  async function close(){if(dirty){dialog.current?.close();const yes=await ask({title:'Discard stay-rule changes?',body:'Your saved stay rules will remain unchanged.',confirmLabel:'Discard'});if(!yes){dialog.current?.showModal();return;}}dialog.current?.close();setOpen(false);closeMenu();}
  function modify<K extends keyof PricingStayRules>(key:K,value:PricingStayRules[K]|undefined){setWork({...work,homes:{...work.homes,[propertyId]:{...home,[key]:value}}});setError('');}
  let result:ReturnType<typeof previewPricingStay>|null=null,calculationError='';
  if(open&&preview)try{result=previewPricingStay(snapshot,preview,policy,resolved.rules,arrival,departure);}catch(e){calculationError=pricingDraftError(e);}
  return <><Button variant="quiet" onClick={()=>void show()}>Stay pricing</Button><dialog ref={dialog} className="pricing-draft-dialog pricing-stay-dialog" aria-label="Stay pricing" onCancel={e=>{e.preventDefault();void close();}}>
    <header><div><h2>Stay pricing</h2><p>Helm draft · Accommodation only</p></div><Button variant="quiet" aria-label="Close stay pricing" onClick={()=>void close()}><PricingIcon name="close"/></Button></header>
    <div className="pricing-draft-dialog-body"><div className="pricing-tabs" role="group" aria-label="Stay pricing views"><Button variant="quiet" className="pricing-tab" aria-pressed={view==='check'} onClick={()=>setView('check')}>Check a stay</Button><Button variant="quiet" className="pricing-tab" aria-pressed={view==='rules'} onClick={()=>setView('rules')}>Stay rules</Button></div>
      {view==='rules'?<PricingStayFields rules={resolved.rules} sources={resolved.sources} own={(['lengthOfStay','arrivalDeparture'] as const).filter(k=>home[k]!==undefined)} modify={modify} onInherit={k=>modify(k,undefined)}/>:<>
        <div className="pricing-draft-fields"><label className="pricing-field">Arrival<input type="date" min={snapshot.today} value={arrival} onChange={e=>setArrival(e.target.value)}/></label><label className="pricing-field">Departure<input type="date" min={shiftIsoDay(arrival||snapshot.today,1)} value={departure} onChange={e=>setDeparture(e.target.value)}/></label></div>
        {result&&<div className="pricing-stay-result"><div><h3>{result.nights} nights</h3><span>{result.passes?'Passes draft checks':'Does not pass draft checks'}</span></div>{result.totalCents!==null&&<dl><div><dt>Nightly subtotal</dt><dd>{pricingMoney(result.subtotalCents!,true)}</dd></div><div><dt>Stay-length adjustment{result.threshold?` (${result.threshold}+ nights)` : ''}</dt><dd>{result.adjustmentPct>0?'+':''}{result.adjustmentPct}%</dd></div><div><dt>Draft accommodation total</dt><dd>{pricingMoney(result.totalCents,true)}</dd></div></dl>}{result.limitedNights>0&&<p>Price bounds limited the adjustment on {result.limitedNights} nights.</p>}{result.errors.length>0&&<ul>{result.errors.map(e=><li key={e}>{e}</li>)}</ul>}</div>}
        {calculationError&&<p role="alert" className="pricing-feedback">{calculationError}</p>}{!preview&&<p>Fix nightly pricing rules to calculate a stay.</p>}
        <p className="pricing-draft-note">Uses the arrival-night minimum stay and stored calendar. Taxes, cleaning fees and channel fees are excluded. This is not a booking quote or live availability check.</p>
      </>}
      {error&&<p role="alert" className="pricing-feedback">{error}</p>}
      <div className="pricing-draft-dialog-actions"><Button variant="quiet" onClick={()=>void close()}>Close</Button><Button variant="primary" disabled={!dirty} onClick={()=>{try{commit({...work,homes:{...work.homes,[propertyId]:{...home,version:state.homes[propertyId].version+1}}});dialog.current?.close();setOpen(false);closeMenu();}catch(e){setError(pricingDraftError(e));}}}>Save stay rules</Button></div>
    </div>
  </dialog></>;
}
