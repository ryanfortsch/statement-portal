import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { stagingBoardEnabled } from '@/lib/channex-staging/board';
import { StagingBoard } from './StagingBoard';

export const dynamic = 'force-dynamic';
export const metadata = { title: '17 Beach staging | Helm', robots: { index: false, follow: false } };
export default async function ChannexStagingPage() {
  const session = await auth();
  if (!session?.user?.email?.endsWith('@risingtidestr.com')) redirect('/auth/signin?callbackUrl=%2Fchannels%2Fstaging');
  return <StagingBoard enabled={stagingBoardEnabled(process.env)} />;
}
