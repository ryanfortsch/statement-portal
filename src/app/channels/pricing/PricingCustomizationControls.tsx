'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Button} from '@/components/Button';
import {useConfirm} from '@/components/ConfirmDialog';
import {hasUnsavedWork,useUnsavedWorkGuard} from '@/lib/unsaved-work';
import {pricingDraftError,pricingDraftsSchema,pricingSeasonConflicts,resolvePricingCustomizations,type PricingDrafts} from '@/lib/dynamic-pricing-drafts';
import {pricingCustomizationKeys,type PricingCustomizations} from '@/lib/dynamic-pricing-customizations';
import PricingCustomizationFields,{pricingCustomizationViews,type PricingCustomizationView} from './PricingCustomizationFields';
import PricingIcon from './PricingIcon';
export default function PricingCustomizationControls({state,propertyId,today,commit,closeRules}:{state:PricingDrafts;propertyId:string;today:string;commit:(s:PricingDrafts)=>void;closeRules:()=>void}){
  const [work,setWork]=useState(state),[view,setView]=useState<PricingCustomizationView>('seasons'),[open,setOpen]=useState(false),[error,setError]=useState('');
  const dialog=useRef<HTMLDialogElement>(null),{ask}=useConfirm(),dirty=open&&JSON.stringify(work)!==JSON.stringify(state);useUnsavedWorkGuard(dirty);
  useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
  const resolved=resolvePricingCustomizations(work,{kind:'listing',id:propertyId}),home=work.homes[propertyId],validation=pricingDraftsSchema.safeParse(work);
  const conflicts=validation.success?pricingSeasonConflicts(validation.data).filter(e=>e.id===propertyId):[];
  async function show(next:PricingCustomizationView){closeRules();if(hasUnsavedWork()){await ask({title:'Save pricing rules first',body:'Save nightly rule changes before opening more customizations.',confirmLabel:'Return',cancelLabel:'Close'});return;}setWork(state);setView(next);setError('');setOpen(true);}
  async function close(){if(dirty){dialog.current?.close();const yes=await ask({title:'Discard customization changes?',body:'Saved rules will remain unchanged.',confirmLabel:'Discard'});if(!yes){dialog.current?.showModal();return;}}dialog.current?.close();setOpen(false);}
  function modify<K extends keyof PricingCustomizations>(key:K,value:PricingCustomizations[K]|undefined){setWork({...work,homes:{...work.homes,[propertyId]:{...home,[key]:value}}});setError('');}
  return <>{pricingCustomizationViews.map(([id,label])=><Button key={id} variant="quiet" onClick={()=>void show(id)}>{label}<PricingIcon name="next"/></Button>)}{open&&createPortal(<div className="helm-pricing"><dialog ref={dialog} className="pricing-draft-dialog pricing-season-dialog" aria-label="Custom pricing rules" onCancel={e=>{e.preventDefault();void close();}}>
    <header><div><h2>Custom pricing rules</h2><p>This listing · Local draft</p></div><Button variant="quiet" aria-label="Close custom pricing rules" onClick={()=>void close()}><PricingIcon name="close"/></Button></header>
    <div className="pricing-draft-dialog-body"><div className="pricing-tabs" role="group" aria-label="Custom rule views">{pricingCustomizationViews.map(([id,label])=><Button key={id} variant="quiet" className="pricing-tab" aria-pressed={view===id} onClick={()=>setView(id)}>{label}</Button>)}</div>
      <PricingCustomizationFields rules={resolved.rules} sources={resolved.sources} own={pricingCustomizationKeys.filter(k=>home[k]!==undefined)} modify={modify} onInherit={k=>modify(k,undefined)} today={today} view={view}/>
      {!validation.success&&<p role="alert" className="pricing-feedback">{pricingDraftError(validation.error)}</p>}{conflicts.length>0&&<p role="alert" className="pricing-feedback">{[...new Set(conflicts.map(c=>c.error))].join(' · ')}</p>}{error&&<p role="alert" className="pricing-feedback">{error}</p>}
      <div className="pricing-draft-dialog-actions"><Button variant="quiet" onClick={()=>void close()}>Close</Button><Button variant="primary" disabled={!dirty||!validation.success||conflicts.length>0} onClick={()=>{try{commit({...work,homes:{...work.homes,[propertyId]:{...home,version:state.homes[propertyId].version+1}}});dialog.current?.close();setOpen(false);}catch(e){setError(pricingDraftError(e));}}}>Save custom rules</Button></div>
    </div>
  </dialog></div>,document.body)}</>;
}
