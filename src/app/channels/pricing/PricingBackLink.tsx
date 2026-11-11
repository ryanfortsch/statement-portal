'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useConfirm} from '@/components/ConfirmDialog';
import {hasUnsavedWork} from '@/lib/unsaved-work';
import {pricingPortfolioHref,type PricingPortfolioView} from '@/lib/dynamic-pricing-portfolio';
export default function PricingBackLink({view}:{view:PricingPortfolioView}) {
  const router=useRouter(),{ask}=useConfirm();
  const href=pricingPortfolioHref(view);
  return <div className="portfolio-back"><Link href={href} prefetch={false} onNavigate={event=>{
    if(!hasUnsavedWork())return;
    event.preventDefault();
    void ask({title:'Discard unsaved changes?',body:'Saved rules stay with this home. Unsaved edits will be discarded when you return to the dashboard.',confirmLabel:'Discard and return'})
      .then(discard=>{if(discard)router.push(href);});
  }}>← All homes</Link></div>;
}
