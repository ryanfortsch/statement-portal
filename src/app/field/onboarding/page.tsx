import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { onboardingComplete } from '@/lib/field-types';
import { FieldShell } from '../FieldShell';
import { OnboardingForm } from './OnboardingForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Set up your account · Rising Tide Field',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

export default async function OnboardingPage() {
  const contractor = await resolveContractorFromCookie();
  if (!contractor) redirect('/field');
  // Once the self-serve setup is done, send them home. The background check is
  // ours to clear, not theirs to redo.
  if (onboardingComplete(contractor)) redirect('/field');

  return (
    <FieldShell contractorName={contractor.full_name}>
      <div style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--signal)', fontWeight: 600, marginBottom: 8 }}>
        Set up your account
      </div>
      <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, marginBottom: 18 }}>
        Two quick things before you claim
      </h1>

      <OnboardingForm defaultName={contractor.full_name} defaultPhone={contractor.phone} />
    </FieldShell>
  );
}
