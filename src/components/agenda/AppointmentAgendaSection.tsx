import { loadAppointmentAgenda } from '@/lib/appointment-agenda-server';
import { AppointmentAgenda } from './AppointmentAgenda';
export async function AppointmentAgendaSection() {
  return <AppointmentAgenda data={await loadAppointmentAgenda()} />;
}
