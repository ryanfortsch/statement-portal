import { notFound } from 'next/navigation';
import Link from 'next/link';
import { loadAppointmentAgenda } from '@/lib/appointment-agenda-server';
import { AppointmentForm } from '../AppointmentForm';
export default async function NewAppointmentPage({ searchParams }: { searchParams: Promise<{ meeting?: string; capture?: string; link?: string }> }) {
  const [{ meeting, capture, link }, data] = await Promise.all([searchParams, loadAppointmentAgenda()]);
  let initial = capture ? data.entries.find(e => e.id === `capture:${capture}`) : meeting ? data.entries.find(e => e.id === `meeting:${meeting}`) : undefined;
  if ((meeting || capture) && !initial) notFound();
  const existing = data.entries.filter(e => e.editable);
  if (link) {
    const target = existing.find(e => e.id === link);
    if (!capture || !initial || !target) notFound();
    initial = { ...target, sourceKeys: [...new Set([...target.sourceKeys, ...initial.sourceKeys])],
      sourceUpdates: [...(target.sourceUpdates || []), ...(initial.sourceUpdates || [])].filter((u, i, all) => all.findIndex(x => x.key === u.key) === i),
      reviewReason: 'New conversation linked for review. Update the existing appointment from the latest sources.' };
  }
  return <main style={{ maxWidth: 800, padding: '28px 20px', margin: '0 auto' }}><h1>{initial ? 'Review appointment' : 'Add appointment'}</h1>
    {capture && !link && existing.length > 0 && <details style={{ marginBottom: 18 }}><summary>Does this update an existing appointment?</summary><p>Link the conversation to its appointment to avoid creating another one.</p><ul>{existing.map(e => <li key={e.id}><Link href={`/appointments/new?capture=${encodeURIComponent(capture)}&link=${encodeURIComponent(e.id)}`}>{e.title} · {e.date || 'Not dated'}</Link></li>)}</ul></details>}
    {link && <p>Reviewing changes to your existing appointment. Saving will keep its identity.</p>}
    <AppointmentForm key={initial?.id || 'new'} initial={initial} available={data.canSave} /></main>;
}
