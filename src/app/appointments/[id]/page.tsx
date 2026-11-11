import { notFound } from 'next/navigation';
import { HelmHero } from '@/components/HelmHero';
import { loadAppointmentAgenda } from '@/lib/appointment-agenda-server';
import { AppointmentForm } from '../AppointmentForm';
export default async function AppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, data] = await Promise.all([params, loadAppointmentAgenda()]);
  const entry = data.entries.find(e => e.id === id && e.editable);
  if (!entry) notFound();
  return <>
    <HelmHero plain eyebrow="Helm · Appointments" title="Edit appointment" />
    <main className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 48, width: '100%' }}>
      <AppointmentForm key={`${entry.id}:${entry.version}`} initial={entry} available={data.canSave} />
    </main>
  </>;
}
