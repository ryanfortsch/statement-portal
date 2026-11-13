import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isOwnerSession } from '@/lib/helm-access-server';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { GuestyWritesNotice } from '@/components/channels/GuestyWritesNotice';
import { loadHomeWriteScope } from '@/lib/channels';
import { cleanerReferenceSchema } from '@/lib/channex-messaging/cleaner-runtime-contract';
import { CleanerEnrollmentPanel } from './CleanerEnrollmentPanel';
export const dynamic='force-dynamic';
export default async function CleanerEnrollmentPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  if(!await isOwnerSession())redirect('/channels/65_calderwood');
  const writeScope=await loadHomeWriteScope('65_calderwood');
  const params=await searchParams;
  const parsed=cleanerReferenceSchema.safeParse({captureId:params.captureId,templateDigest:params.templateDigest});
  return <div className="min-h-screen flex flex-col" style={{background:'var(--paper)',color:'var(--ink)'}}>
    <HelmMasthead />
      <GuestyWritesNotice scope={writeScope} />
    <HelmHero plain eyebrow="65 Calderwood · Message handover" title="Cleaner automation"
      line="Keep the existing reminder times and establish one sender."/>
    <main className="w-full max-w-[1000px] mx-auto px-5 sm:px-10 pb-14">
      <Link href="/channels/65_calderwood/message-preparation/templates" className="text-sm underline underline-offset-4">← Original templates</Link>
      <CleanerEnrollmentPanel reference={parsed.success?parsed.data:null}/>
    </main><HelmFooter module="Cleaner automation" right="65 Calderwood"/>
  </div>;
}
