import Link from 'next/link';
import {HelmMasthead} from '@/components/HelmMasthead';
import {HelmHero} from '@/components/HelmHero';
import {HelmFooter} from '@/components/HelmFooter';
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
    <HelmHero plain eyebrow="" title="Helm pricing" />
    <main className="mx-auto w-full max-w-7xl px-4 pb-8 sm:px-8"><Link href="/channels/pricing" className="text-sm text-slate-500">← Property pricing</Link>
      <p className="my-4 text-xs text-slate-500">Sample data. Changes stay in this browser and reset on reload.</p>
      <PricingDemo fixture={createPricingDemo()}/>
    </main><HelmFooter module="Pricing" right="" /></>;
}
