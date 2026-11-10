'use client';
import {useMemo} from 'react';
import PricingWorkbench,{type PricingServices} from '../PricingWorkbench';
import {createPricingDemo,createPricingDemoServices} from '@/lib/dynamic-pricing-demo';
/** Complete service override: every action stays in this browser's memory. */
export default function PricingDemo({fixture}:{fixture:ReturnType<typeof createPricingDemo>}) {
  const services=useMemo<PricingServices>(()=>createPricingDemoServices(fixture),[fixture]);
  return <PricingWorkbench propertyId="demo_home" name="Demo coastal home" authority="helm" initialPolicy={fixture.policy} initialSnapshot={fixture.snapshot} initialProfile={null} initialRuns={[]} services={services}/>;
}
