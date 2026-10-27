import { Suspense } from 'react';
import type { ReactNode } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';
import { MessagingFooter } from '@/components/MessagingFooter';
import { Section } from '@/components/Section';
import { RetryRefresh } from '@/components/RetryRefresh';
import { MessagingTabs } from '@/components/MessagingTabs';
import { QueueSkeleton } from '@/components/QueueSkeleton';
import { isStayConciergeConfigured, listBlurbs, explainError } from '@/lib/stay-concierge';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { BlurbsLibrary } from './BlurbsLibrary';

/**
 * /messaging/blurbs - the Saved replies lens of the Guests tab.
 *
 * The blurb library: per-property (and per-area, and fleet-wide) answers the
 * operator writes ONCE, in her own words. The responder quotes an APPROVED
 * blurb near-verbatim whenever a guest's question matches, instead of
 * composing over the KB - composition over a spotty KB is the failure mode
 * that made parking/beach-gear/recs answers unreliable. Draft blurbs are
 * review-only and never reach a guest.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <MessagingTabs current="guests" lens="blurbs" />
      {children}
      <div style={{ flex: 1 }} />
      <MessagingFooter />
    </div>
  );
}

function NotReachable({ message, retry = false }: { message: string; retry?: boolean }) {
  return (
    <Section title="Service not reachable" eyebrow={retry ? 'Auto-retrying' : 'Setup required'}>
      <div
        style={{
          borderTop: '1px solid var(--ink)',
          padding: '20px 0',
          fontSize: 13,
          color: 'var(--ink-3)',
          lineHeight: 1.6,
        }}
      >
        {message}
        {retry && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-4)' }}>Retrying automatically.</div>}
      </div>
      {retry && <RetryRefresh />}
    </Section>
  );
}

async function loadProperties(): Promise<{ id: string; name: string }[]> {
  try {
    const { data, error } = await supabase.from('properties').select('id, name').order('name');
    if (error || !data) return [];
    return data as { id: string; name: string }[];
  } catch {
    return [];
  }
}

async function LibrarySection() {
  const [res, properties] = await Promise.all([listBlurbs(), loadProperties()]);
  if (!res.ok) return <NotReachable message={explainError(res.error)} retry />;
  return (
    <BlurbsLibrary
      initial={res.data.blurbs}
      categories={res.data.categories}
      properties={properties}
    />
  );
}

export default function BlurbsPage() {
  if (!isStayConciergeConfigured()) {
    return (
      <Shell>
        <NotReachable message="The messaging service is not connected to Helm. Ask Ryan." />
      </Shell>
    );
  }
  return (
    <Shell>
      <Suspense fallback={<QueueSkeleton title="Saved replies" />}>
        <LibrarySection />
      </Suspense>
    </Shell>
  );
}
