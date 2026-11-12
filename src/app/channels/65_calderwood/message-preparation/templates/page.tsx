import Link from 'next/link';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { isOwnerSession } from '@/lib/helm-access-server';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { GuestyWritesNotice } from '@/components/channels/GuestyWritesNotice';
import { loadHomeWriteScope } from '@/lib/channels';
import { templateReferenceSchema } from '@/lib/channex-messaging/template-workflow-contract';
import { TemplatePanel } from './TemplatePanel';

export const dynamic = 'force-dynamic';
export default async function TemplateReleasePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!await isOwnerSession()) redirect('/channels/65_calderwood');
  const writeScope = await loadHomeWriteScope('65_calderwood');
  const params = await searchParams;
  const parsed = templateReferenceSchema.extend({ releaseId: z.uuid().optional() }).safeParse({
    captureId: params.captureId, rulesSha256: params.rulesSha256, ...(params.releaseId ? { releaseId: params.releaseId } : {}),
  });
  return <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
    <HelmMasthead />
      <GuestyWritesNotice scope={writeScope} />
    <HelmHero plain eyebrow="65 Calderwood · Message handover" title="Template release"
      line="Keep an exact record of the originals before changing how Helm uses them." />
    <main className="w-full max-w-[1100px] mx-auto px-5 sm:px-10 pb-14">
      <Link href="/channels/65_calderwood/message-preparation" className="text-sm underline underline-offset-4">← Message preparation</Link>
      <TemplatePanel initialReference={parsed.success ? parsed.data : null} />
    </main><HelmFooter module="Template release" right="65 Calderwood" />
  </div>;
}
