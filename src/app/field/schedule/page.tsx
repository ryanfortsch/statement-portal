import { redirect } from 'next/navigation';

/** Retired: the cleaner's booked time sits on each packet stop's line now
 *  (the one datum this tab added), and the claimed work by day is the home
 *  page's "Your packets". Old links land on the home page. */
export default function RetiredSchedulePage() {
  redirect('/field');
}
