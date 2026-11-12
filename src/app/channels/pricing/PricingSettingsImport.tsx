'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/Button';
import {importPriceLabsSettings,type PriceLabsExports,type PriceLabsSettingsImport} from '@/lib/dynamic-pricing-pricelabs';
import {pricingDraftError,type PricingDrafts} from '@/lib/dynamic-pricing-drafts';
import {importedPricingBound} from '@/lib/dynamic-pricing-import-source';
import PricingIcon from './PricingIcon';
const inputs=[['listings','Manage listings'],['groups','Group customizations'],['rules','Listing customizations'],['overrides','Listing date overrides']] as const;
export default function PricingSettingsImport({homes,state,commit,close}:{homes:{id:string;name:string;guestyListingId?:string|null}[];state:PricingDrafts;commit:(s:PricingDrafts)=>unknown;close:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),[files,setFiles]=useState<PriceLabsExports>({listings:'',groups:'',rules:'',overrides:''}),[review,setReview]=useState<PriceLabsSettingsImport|null>(null),[error,setError]=useState(''),[paste,setPaste]=useState(false);
  useEffect(()=>{dialog.current?.showModal();},[]);
  const price=(n:number|null)=>n===null?'Not set':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:2}).format(n/100);
  function update(key:keyof PriceLabsExports,value:string){setFiles(v=>({...v,[key]:value}));setReview(null);setError('');}
  return <dialog ref={dialog} className="pricing-draft-dialog pricing-settings-import" aria-label="Import PriceLabs settings" onCancel={close}>
    <header><div><h2>Import PriceLabs settings</h2><p>Match by Guesty ID. Save to this browser’s drafts.</p></div><Button variant="quiet" aria-label="Close import" onClick={close}><PricingIcon name="close"/></Button></header>
    <div className="pricing-settings-import-body">
      {!review?<><div className="pricing-settings-files">{inputs.map(([key,label])=><label key={key} className="pricing-field">{label}{paste?<textarea aria-label={`${label} CSV`} rows={3} spellCheck={false} value={files[key]} onChange={e=>update(key,e.target.value)}/>:<input aria-label={`${label} CSV`} type="file" accept=".csv,text/csv" onChange={async e=>{const file=e.target.files?.[0];if(file){if(file.size>2000000){setError('Choose a CSV smaller than 2 MB.');return;}update(key,await file.text());}}}/>}{files[key]&&<span>Loaded</span>}</label>)}</div><Button variant="quiet" onClick={()=>setPaste(!paste)}>{paste?'Choose files instead':'Paste CSV instead'}</Button><p className="pricing-import-hint">USD exports from Manage Listings and Customizations. Date overrides are optional; missing exports remain flagged.</p></>:<>
        <p>{review.rows.length} listings · {review.rows.filter(r=>r.replaces).length} existing drafts replaced · {review.skipped.length} skipped</p>
        <div className="pricing-import-table"><table><thead><tr><th>Listing</th><th>Base</th><th>Min</th><th>Max</th><th>Minimum stay</th></tr></thead><tbody>{review.rows.map(r=>{const h=review.drafts.homes[r.id];return <tr key={r.id}><th>{r.name}</th><td>{price(h.policy.baseCents)}</td><td>{price(importedPricingBound(h.policy,h.importSource,'min'))}</td><td>{price(importedPricingBound(h.policy,h.importSource,'max'))}</td><td>{h.importSource?.minimumStayProfile??`${h.policy.weekdayMinNights} / ${h.policy.weekendMinNights} nights`}</td></tr>;})}</tbody></table></div>
        <details><summary>Import notes</summary><p>Helm previews use its own model and $1–$100,000 supported range. PriceLabs defaults and market algorithms cannot be inferred from exports. Live pricing stays in PriceLabs.</p>{[...new Set(review.rows.flatMap(r=>r.warnings))].map(w=><p key={w}>{w}</p>)}</details>
        {review.skipped.length>0&&<details open><summary>Skipped listings</summary>{review.skipped.map((r,i)=><p key={i}>{r.name}: {r.reason}</p>)}</details>}
      </>}
      {error&&<p className="pricing-feedback" role="alert">{error}</p>}
    </div>
    <footer><Button variant="quiet" onClick={()=>review?setReview(null):close()}>{review?'Back':'Cancel'}</Button>{review?<Button variant="primary" onClick={()=>{try{commit(review.drafts);close();}catch(e){setError(pricingDraftError(e));}}}>Import {review.rows.length} listings</Button>:<Button variant="primary" disabled={!files.listings||!files.groups||!files.rules} onClick={()=>{try{setReview(importPriceLabsSettings(files,homes,state));setError('');}catch(e){setError(pricingDraftError(e));}}}>Review import</Button>}</footer>
  </dialog>;
}
