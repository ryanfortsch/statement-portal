import { auth } from '@/auth';
import { notFound, redirect } from 'next/navigation';
import { stagingBoardEnabled } from '@/lib/channex-staging/board';
import { HoldRehearsal } from './HoldRehearsal';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Message hold rehearsal | Helm', robots: { index: false, follow: false } };
export default async function AutomationRehearsalPage() {
  if (!stagingBoardEnabled(process.env)) notFound();
  const session = await auth();
  if (!session?.user?.email?.endsWith('@risingtidestr.com'))
    redirect('/auth/signin?callbackUrl=%2Fchannels%2Fstaging%2Fautomation-rehearsal');
  return <HoldRehearsal />;
}
