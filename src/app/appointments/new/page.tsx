import { notFound } from 'next/navigation';
import { loadAppointmentAgenda } from '@/lib/appointment-agenda-server';
import { AppointmentForm } from '../AppointmentForm';
export default async function NewAppointmentPage({ searchParams }: { searchParams: Promise<{ meeting?: string }> }) {
  const [{ meeting }, data] = await Promise.all([searchParams, loadAppointmentAgenda()]);
  const initial = meeting ? data.entries.find(e => e.id === `meeting:${meeting}`) : undefined;
  if (meeting && !initial) notFound();
  return <main style={{ maxWidth: 800, padding: '28px 20px', margin: '0 auto' }}><h1>{initial ? 'Review appointment' : 'Add appointment'}</h1><AppointmentForm initial={initial} available={data.canSave} /></main>;
}
