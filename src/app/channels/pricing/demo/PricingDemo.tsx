'use client';
import {useEffect,useMemo,useState} from 'react';
import {Button} from '@/components/Button';
import {useConfirm} from '@/components/ConfirmDialog';
import {hasUnsavedWork} from '@/lib/unsaved-work';
import PricingWorkbench from '../PricingWorkbench';
import PricingPortfolio from '../PricingPortfolio';
import PricingIcon from '../PricingIcon';
import {createPricingPortfolioDemo,createPricingDemoServices,createDemoObservations} from '@/lib/dynamic-pricing-demo';
import {pricingPortfolioRow} from '@/lib/dynamic-pricing-portfolio';

type Workspace=Awaited<ReturnType<ReturnType<typeof createPricingDemoServices>['refresh']>>['value'];
/** Every home has independent in-memory services. No production actions are used. */
export default function PricingDemo({fixtures}:{fixtures:ReturnType<typeof createPricingPortfolioDemo>}) {
  const services=useMemo(()=>new Map(fixtures.map(f=>[f.home.id,createPricingDemoServices(f.fixture,f.home.authority)])),[fixtures]);
  const [workspaces,setWorkspaces]=useState<Record<string,Workspace>>(()=>Object.fromEntries(fixtures.map(f=>[f.home.id,{
    ...f.fixture,profile:null,runs:[],evidenceVersion:0,observations:createDemoObservations(f.fixture,f.home.authority),tracking:{enabled:false,version:0},scheduledCaptureEnabled:false,
  }])));
  const [selected,setSelected]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [evaluatedAt,setEvaluatedAt]=useState(fixtures[0]?.fixture.snapshot.observedAt??new Date().toISOString());
  const {ask}=useConfirm();
  useEffect(()=>{window.scrollTo({top:0,behavior:'instant'});},[selected]);
  const rows=fixtures.map(f=>pricingPortfolioRow(f.home,workspaces[f.home.id],f.fixture.snapshot.today,new Date(evaluatedAt)));
  const home=fixtures.find(f=>f.home.id===selected)?.home,workspace=selected?workspaces[selected]:null;
  async function returnToPortfolio(next:string|null=null) {
    if(!selected||busy)return;
    if(hasUnsavedWork()&&!await ask({title:'Discard unsaved changes?',body:'Saved rules stay with this home. Unsaved edits will be discarded.',confirmLabel:'Discard and continue'}))return;
    setBusy(true);setError('');
    try {const result=await services.get(selected)!.refresh();setWorkspaces(w=>({...w,[selected]:result.value}));setEvaluatedAt(new Date().toISOString());setSelected(next);}
    catch {setError('Could not refresh the dashboard. Try again.');}
    finally {setBusy(false);}
  }
  return <>
    <div hidden={selected!==null}><PricingPortfolio rows={rows} onOpen={setSelected} demo/></div>
    {home&&workspace&&<>
      {error&&<p role="alert">{error}</p>}
      <PricingWorkbench key={home.id} propertyId={home.id} name={home.name} authority={home.authority} initialPolicy={workspace.policy}
        navigation={<div className="pricing-listing-navigation"><Button variant="quiet" className="pricing-back-button" aria-label="All listings" title="All listings" disabled={busy} onClick={()=>void returnToPortfolio()}><PricingIcon name="previous"/></Button><label className="pricing-title-select"><span className="sr-only">Switch listing</span><select value={home.id} disabled={busy} onChange={e=>void returnToPortfolio(e.target.value)}>{fixtures.map(f=><option key={f.home.id} value={f.home.id}>{f.home.name}</option>)}</select></label></div>}
        initialSnapshot={workspace.snapshot} initialProfile={workspace.profile} initialRuns={workspace.runs} initialEvidenceVersion={workspace.evidenceVersion}
        initialObservations={workspace.observations} initialTracking={workspace.tracking} services={services.get(home.id)!}/></>}
  </>;
}
