import Link from 'next/link';
import {HelmMasthead} from '@/components/HelmMasthead';
import {GuestyWritesNotice} from '@/components/channels/GuestyWritesNotice';
import {requireOwnerEmail} from '@/lib/helm-access-server';
import PricingDemo from './PricingDemo';
import {createPricingDemo} from '@/lib/dynamic-pricing-demo';
export const dynamic='force-dynamic';
export default async function PricingDemoPage(){
  await requireOwnerEmail();
  return <>
      <HelmMasthead />
      <GuestyWritesNotice scope={{kind:'unknown'}} />
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8"><Link href="/channels/pricing" className="text-sm text-slate-500">← Property pricing</Link>
      <h1 className="my-4 text-3xl font-semibold">Try Helm pricing</h1>
      <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><strong>Interactive demo · synthetic property and history.</strong> All controls, including publishing and undo, operate in this browser only. Imports stay in memory. Reloading resets the demo; no production connection or database is used.</div>
      <PricingDemo fixture={createPricingDemo()}/>
    </main></>;
}
