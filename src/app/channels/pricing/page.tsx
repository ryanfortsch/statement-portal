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
export const dynamic='force-dynamic';
export default async function PricingPage({searchParams}:{searchParams:Promise<{property?:string}>}) {
  await requireOwnerEmail();
  const [params,fleet]=await Promise.all([searchParams,listFleetProperties()]);
  const selected=fleet.find(p=>p.id===params.property)??fleet.find(p=>p.id==='65_calderwood')??fleet[0];
  let workspace:Awaited<ReturnType<typeof readPricingWorkspace>>|null=null,error='';
  let history:Awaited<ReturnType<typeof readPricingObservationWorkspace>>|null=null;
  if(selected) try { [workspace,history]=await Promise.all([readPricingWorkspace(selected.id),readPricingObservationWorkspace(selected.id)]); } catch { error='Pricing is unavailable. Refresh or ask Ryan to finish setup.'; }
  return <>
      <HelmMasthead />
      <GuestyWritesNotice scope={selected?{kind:'home',guestyRun:selected.calendar_authority!=='helm',otaReadsHelm:false}:{kind:'unknown'}} />
    <HelmHero plain eyebrow="" title="Helm pricing" />
    <main className="mx-auto w-full max-w-7xl px-4 pb-8 sm:px-8">
    <Link href="/channels" className="text-sm text-slate-500">← Channels</Link>
    <form className="my-5 flex flex-wrap items-end gap-3" action="/channels/pricing">
      <label className="text-sm font-medium">Property<select name="property" defaultValue={selected?.id} className="mt-1 block rounded-lg border p-2">
        {fleet.map(p=><option key={p.id} value={p.id}>{p.name} · {p.calendar_authority==='helm'?'Helm calendar':'Guesty calendar'}</option>)}</select></label>
      <Button type="submit" size="sm">Open</Button>
      <Link className="ml-auto py-2 text-sm text-slate-500 underline" href="/channels/pricing/demo">Sample property</Link>
    </form>
    {error&&<p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5">{error}</p>}
    {!selected&&<EmptyState>No active properties found.</EmptyState>}
    {workspace&&selected&&<PricingWorkbench key={selected.id} propertyId={selected.id} name={selected.name}
      authority={selected.calendar_authority} initialPolicy={workspace.policy} initialSnapshot={workspace.snapshot}
      initialProfile={workspace.profile} initialRuns={workspace.runs} initialEvidenceVersion={workspace.context.evidence?.version??0}
      initialObservations={history?.observations} initialTracking={history?.tracking} scheduledCaptureEnabled={history?.scheduledCaptureEnabled} />}
  </main><HelmFooter module="Pricing" right="" /></>;
}
