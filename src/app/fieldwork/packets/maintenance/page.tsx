import { redirect } from 'next/navigation';

/** Retired: the maintenance bundler lives on the Handymen board now, in the
 *  slot the inspection calendar holds on the Inspectors board. Old links land
 *  there. */
export default function RetiredMaintenancePage() {
  redirect('/fieldwork/packets?trade=maintenance#maintenance-jobs');
}
