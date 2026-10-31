import { notFound } from 'next/navigation';
import { loadAppointmentAgenda } from '@/lib/appointment-agenda-server';
import { AppointmentForm } from '../AppointmentForm';
export default async function AppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, data] = await Promise.all([params, loadAppointmentAgenda()]);
  const entry = data.entries.find(e => e.id === id && e.editable);
  if (!entry) notFound();
  return <main style={{ maxWidth: 800, padding: '28px 20px', margin: '0 auto' }}><h1>Edit appointment</h1><AppointmentForm key={`${entry.id}:${entry.version}`} initial={entry} available={data.canSave} /></main>;
}
