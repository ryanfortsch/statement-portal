import Link from 'next/link';
import {HelmMasthead} from '@/components/HelmMasthead';
import {HelmHero} from '@/components/HelmHero';
import {HelmFooter} from '@/components/HelmFooter';
import {GuestyWritesNotice} from '@/components/channels/GuestyWritesNotice';
import {requireOwnerEmail} from '@/lib/helm-access-server';
import PricingDemo from './PricingDemo';
import {createPricingPortfolioDemo} from '@/lib/dynamic-pricing-demo';
export const dynamic='force-dynamic';
export default async function PricingDemoPage(){
  await requireOwnerEmail();
  return <>
      <HelmMasthead />
      <GuestyWritesNotice scope={{kind:'unknown'}} />
    <div className="pricing-page-shell"><header className="pricing-page-heading">
      <HelmHero plain eyebrow="" title="Helm pricing" paddingTop={16} paddingBottom={16}/>
      <Link href="/channels/pricing">Your homes</Link>
      <p>Demo · simulated data</p>
    </header><main>
      <PricingDemo fixtures={createPricingPortfolioDemo()}/>
      <p className="pricing-demo-note">Sample data. Changes stay in this browser and reset on reload.</p>
    </main></div><HelmFooter module="Pricing" right="" /></>;
}
