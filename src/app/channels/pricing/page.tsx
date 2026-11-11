import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { Button } from '@/components/Button';
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
export const dynamic='force-dynamic';
export default async function PricingPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  await requireOwnerEmail();
  const [params,fleet]=await Promise.all([searchParams,listFleetProperties()]);
  const view=pricingPortfolioView(params);
  const selected=params.property?fleet.find(p=>p.id===params.property):undefined;
  const portfolio=!params.property?await readPricingPortfolio(fleet):null;
  let workspace:Awaited<ReturnType<typeof readPricingWorkspace>>|null=null,error='';
  let history:Awaited<ReturnType<typeof readPricingObservationWorkspace>>|null=null;
  if(selected) try { [workspace,history]=await Promise.all([readPricingWorkspace(selected.id),readPricingObservationWorkspace(selected.id)]); } catch { error='Pricing is unavailable. Refresh or ask Ryan to finish setup.'; }
  return <>
      <HelmMasthead />
      <GuestyWritesNotice scope={selected?{kind:'home',guestyRun:selected.calendar_authority!=='helm',otaReadsHelm:false}:{kind:'unknown'}} />
    <div className="pricing-page-shell"><header className="pricing-page-heading">
      <HelmHero plain eyebrow="" title="Helm pricing" paddingTop={16} paddingBottom={16}/>
      {selected&&<form className="pricing-property-picker" action="/channels/pricing">
        <label className="sr-only" htmlFor="pricing-property">Property</label><select id="pricing-property" name="property" defaultValue={selected?.id}>
          {fleet.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <Button type="submit" size="sm">Open</Button>
      </form>}
      <Link href="/channels/pricing/demo">Sample portfolio</Link>
    </header><main>
    {error&&<p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5">{error}</p>}
    {params.property&&!selected&&<EmptyState>Home not found in the active portfolio.</EmptyState>}
    {params.property&&<PricingBackLink view={view}/>}
    {portfolio&&<PricingPortfolio rows={portfolio} initialView={view}/>}
    {workspace&&selected&&<PricingWorkbench key={selected.id} propertyId={selected.id} name={selected.name}
      authority={selected.calendar_authority} initialPolicy={workspace.policy} initialSnapshot={workspace.snapshot}
      initialProfile={workspace.profile} initialRuns={workspace.runs} initialEvidenceVersion={workspace.context.evidence?.version??0}
      initialObservations={history?.observations} initialTracking={history?.tracking} scheduledCaptureEnabled={history?.scheduledCaptureEnabled} />}
  </main></div><HelmFooter module="Pricing" right="" /></>;
}
