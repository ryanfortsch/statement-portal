import { loadAppointmentAgenda } from '@/lib/appointment-agenda-server';
import type { AgendaData } from '@/lib/appointment-agenda';
import { AppointmentAgenda } from './AppointmentAgenda';
/** The home's Upcoming block. The feed passes the agenda it already loaded
 *  (it decides from the same data whether the block prints at all); a caller
 *  without one gets it loaded here. */
export async function AppointmentAgendaSection({ data }: { data?: AgendaData } = {}) {
  return <AppointmentAgenda data={data ?? await loadAppointmentAgenda()} />;
}
