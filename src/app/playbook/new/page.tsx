import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { getPropertyOptions } from '@/lib/playbook';
import { PlaybookEditor } from '../PlaybookEditor';

export const dynamic = 'force-dynamic';

export default async function NewPlaybookEntryPage() {
  const session = await auth();
  if (!session?.user?.email) redirect('/auth/signin?callbackUrl=/playbook/new');

  const properties = await getPropertyOptions();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="playbook" />
      <PlaybookEditor mode="new" properties={properties} />
      <div className="flex-1" />
      <HelmFooter module="Playbook" />
    </div>
  );
}
