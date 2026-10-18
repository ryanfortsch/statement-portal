import { redirect } from 'next/navigation';

/** Retired: the post-visit report is the portal's one "Flag something" form
 *  now, in the tab strip. Old links land there. */
export default function RetiredReportPage() {
  redirect('/field/flag');
}
