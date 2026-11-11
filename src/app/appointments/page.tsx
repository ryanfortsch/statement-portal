import Link from 'next/link';
import { HelmHero } from '@/components/HelmHero';
import { loadAppointmentAgenda } from '@/lib/appointment-agenda-server';
import { AppointmentAgenda } from '@/components/agenda/AppointmentAgenda';
export default async function AppointmentsPage() {
  const data = await loadAppointmentAgenda();
  return <>
    <HelmHero plain eyebrow="Helm · Appointments" title="Appointments" />
    <main className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 48, width: '100%' }}>
      <AppointmentAgenda data={data} full />
      <details><summary>Cancelled appointments</summary>{data.entries.filter(e => e.status === 'cancelled').map(e => <p key={e.id}><Link href={e.href}>{e.title}</Link> · Cancelled</p>)}</details>
    </main>
  </>;
}
