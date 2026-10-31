import Link from 'next/link';
import { loadAppointmentAgenda } from '@/lib/appointment-agenda-server';
import { AppointmentAgenda } from '@/components/agenda/AppointmentAgenda';
export default async function AppointmentsPage() {
  const data = await loadAppointmentAgenda();
  return <main style={{ maxWidth: 960, padding: '28px 20px', margin: '0 auto' }}>
    <Link href="/" style={{ fontSize: 13 }}>← Today</Link>
    <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 400 }}>Your business agenda</h1>
    <AppointmentAgenda data={data} full />
    <details><summary>Cancelled appointments</summary>{data.entries.filter(e => e.status === 'cancelled').map(e => <p key={e.id}><Link href={e.href}>{e.title}</Link> · Cancelled</p>)}</details>
  </main>;
}
