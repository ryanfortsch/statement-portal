import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
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
  if(selected) try { [workspace,history]=await Promise.all([readPricingWorkspace(selected.id),readPricingObservationWorkspace(selected.id)]); } catch(e) { error=e instanceof Error?e.message:'Unable to load pricing'; }
  return <>
      <HelmMasthead />
      <GuestyWritesNotice scope={selected?{kind:'home',guestyRun:selected.calendar_authority!=='helm',otaReadsHelm:false}:{kind:'unknown'}} />
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
    <Link href="/channels" className="text-sm text-slate-500">← Channels</Link>
    <div className="mt-4 mb-7"><p className="text-xs font-semibold uppercase tracking-widest text-teal-700">Helm · Revenue tools</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Price each night with a reason.</h1>
      <p className="mt-2 max-w-3xl text-slate-600">Set the rules, compare the calendar, then choose which homes use Helm for direct booking rates.</p></div>
    <p className="mb-5"><Link className="text-sm font-medium text-teal-700 underline" href="/channels/pricing/demo">Try the interactive demo with sample data →</Link></p>
    <form className="mb-6 flex items-end gap-3" action="/channels/pricing">
      <label className="text-sm font-medium">Property<select name="property" defaultValue={selected?.id} className="mt-1 block rounded-lg border p-2">
        {fleet.map(p=><option key={p.id} value={p.id}>{p.name} · {p.calendar_authority==='helm'?'Helm calendar':'Guesty calendar'}</option>)}</select></label>
      <button className="rounded-lg bg-slate-900 px-4 py-2 text-white">Open</button>
    </form>
    {error&&<p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5">{error}</p>}
    {!selected&&<p>No active properties found.</p>}
    {workspace&&selected&&<PricingWorkbench key={selected.id} propertyId={selected.id} name={selected.name}
      authority={selected.calendar_authority} initialPolicy={workspace.policy} initialSnapshot={workspace.snapshot}
      initialProfile={workspace.profile} initialRuns={workspace.runs} initialEvidenceVersion={workspace.context.evidence?.version??0}
      initialObservations={history?.observations} initialTracking={history?.tracking} scheduledCaptureEnabled={history?.scheduledCaptureEnabled} />}
  </main></>;
}
