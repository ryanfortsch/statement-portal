'use client';
import {useTransition} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useConfirm} from '@/components/ConfirmDialog';
import {hasUnsavedWork} from '@/lib/unsaved-work';
import {pricingPortfolioHref,type PricingPortfolioView} from '@/lib/dynamic-pricing-portfolio';
export default function PricingBackLink({view,selectedId,homes=[]}:{view:PricingPortfolioView;selectedId?:string;homes?:{id:string;name:string}[]}) {
  const router=useRouter(),{ask}=useConfirm();
  const [pending,startTransition]=useTransition();
  async function switchHome(id:string) {
    if(!homes.some(h=>h.id===id)||id===selectedId)return;
    if(hasUnsavedWork()&&!await ask({title:'Discard unsaved changes?',body:'Saved rules stay with this home. Unsaved edits will be discarded.',confirmLabel:'Discard and continue'}))return;
    startTransition(()=>router.push(pricingPortfolioHref(view,id)));
  }
  const href=pricingPortfolioHref(view);
  return <div className="helm-pricing portfolio-back"><Link href={href} prefetch={false} onNavigate={event=>{
    if(!hasUnsavedWork())return;
    event.preventDefault();
    void ask({title:'Discard unsaved changes?',body:'Saved rules stay with this home. Unsaved edits will be discarded when you return to the dashboard.',confirmLabel:'Discard and return'})
      .then(discard=>{if(discard)router.push(href);});
  }}>← All listings</Link>{selectedId&&<label className="pricing-demo-switch"><span className="sr-only">Switch listing</span><select value={selectedId} disabled={pending} onChange={e=>void switchHome(e.target.value)}>{homes.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}</select></label>}</div>;
}
