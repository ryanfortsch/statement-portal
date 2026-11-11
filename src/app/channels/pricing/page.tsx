import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { EmptyState } from '@/components/EmptyState';
import { GuestyWritesNotice } from '@/components/channels/GuestyWritesNotice';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { listFleetProperties } from '@/lib/fleet';
import { readPricingWorkspace } from '@/lib/dynamic-pricing-store';
import { readPricingObservationWorkspace } from '@/lib/dynamic-pricing-observations-server';
import PricingWorkbench from './PricingWorkbench';
import PricingPortfolio from './PricingPortfolio';
import PricingBackLink from './PricingBackLink';
import {readPricingPortfolio} from '@/lib/dynamic-pricing-portfolio-server';
import {pricingPortfolioView} from '@/lib/dynamic-pricing-portfolio';
import {supabaseAdmin} from '@/lib/supabase-admin';
import {readPricingLivePortfolio} from '@/lib/dynamic-pricing-live.server';
import PricingLiveWorkspace from './PricingLiveWorkspace';
import {refreshPricingLiveAction,readPricingLiveCalendarAction} from './live-actions';
import { capturePricingObservationAction,setPricingTrackingAction,savePricingEvidenceAction,publishPricingAction,refreshPricingAction,reviewPricingAction,savePricingAction,undoPricingAction } from './actions';
const pricingServices={save:savePricingAction,refresh:refreshPricingAction,review:reviewPricingAction,publish:publishPricingAction,undo:undoPricingAction,evidence:savePricingEvidenceAction,observe:capturePricingObservationAction,tracking:setPricingTrackingAction};
export const dynamic='force-dynamic';
export default async function PricingPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  await requireOwnerEmail();
  const [params,fleet]=await Promise.all([searchParams,listFleetProperties()]);
  const live=params.live==='1';
  const view=pricingPortfolioView(params);
  let livePortfolio:Awaited<ReturnType<typeof readPricingLivePortfolio>>|null=null,liveError=false;
  if(live)try {livePortfolio=await readPricingLivePortfolio(supabaseAdmin);}catch {liveError=true;}
  const selected=!live&&params.property?fleet.find(p=>p.id===params.property):undefined;
  const portfolio=!live&&!params.property?await readPricingPortfolio(fleet):null;
  let workspace:Awaited<ReturnType<typeof readPricingWorkspace>>|null=null,error='';
  let history:Awaited<ReturnType<typeof readPricingObservationWorkspace>>|null=null;
  if(selected) try { [workspace,history]=await Promise.all([readPricingWorkspace(selected.id),readPricingObservationWorkspace(selected.id)]); } catch { error='Pricing is unavailable. Refresh or ask Ryan to finish setup.'; }
  return <>
      <HelmMasthead />
      <GuestyWritesNotice scope={selected?{kind:'home',guestyRun:selected.calendar_authority!=='helm',otaReadsHelm:false}:{kind:'unknown'}} />
    <div className="pricing-page-shell"><header className="pricing-page-heading">
      <HelmHero plain eyebrow="" title="Helm pricing" paddingTop={16} paddingBottom={16}/>
      <div className="flex gap-4"><Link href={live?'/channels/pricing':'/channels/pricing?live=1'}>{live?'Pricing model':'Live calendar'}</Link><Link href="/channels/pricing/demo">Sample portfolio</Link></div>
    </header><main>
    {liveError&&<EmptyState>Calendar data is unavailable. Refresh to try again.</EmptyState>}
    {livePortfolio&&<PricingLiveWorkspace initialPortfolio={livePortfolio} refreshAction={refreshPricingLiveAction} calendarAction={readPricingLiveCalendarAction}/>}
    {error&&<p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5">{error}</p>}
    {!live&&params.property&&!selected&&<EmptyState>Home not found in the active portfolio.</EmptyState>}
    {!live&&params.property&&!workspace&&<PricingBackLink view={view} selectedId={selected?.id} homes={fleet.map(p=>({id:p.id,name:p.name}))}/>}
    {portfolio&&<PricingPortfolio rows={portfolio} initialView={view}/>}
    {workspace&&selected&&<PricingWorkbench services={pricingServices} key={selected.id} propertyId={selected.id} name={selected.name}
      navigation={<PricingBackLink view={view} selectedId={selected.id} homes={fleet.map(p=>({id:p.id,name:p.name}))}/>}
      authority={selected.calendar_authority} initialPolicy={workspace.policy} initialSnapshot={workspace.snapshot}
      initialProfile={workspace.profile} initialRuns={workspace.runs} initialEvidenceVersion={workspace.context.evidence?.version??0}
      initialObservations={history?.observations} initialTracking={history?.tracking} scheduledCaptureEnabled={history?.scheduledCaptureEnabled} />}
  </main></div><HelmFooter module="Pricing" right="" /></>;
}
