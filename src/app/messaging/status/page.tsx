import Link from 'next/link';
import { Suspense } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { InboxHealth } from '@/components/InboxHealth';
import { Section } from '@/components/Section';

export const dynamic = 'force-dynamic';

export default function MessagingStatusPage() {
  return <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
    <HelmMasthead />
    <div className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 20 }}><Link href="/messaging" className="rt-inline-action">← Messaging</Link></div>
    <Suspense fallback={<Section title="Delivery & sync"><p>Loading checks…</p></Section>}><InboxHealth diagnostics /></Suspense>
    <div style={{ flex: 1 }} />
    <HelmFooter module="Messaging" right="Source coverage and background processing" />
  </div>;
}
