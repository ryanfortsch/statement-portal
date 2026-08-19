import { redirect } from 'next/navigation';

// The agreements list renders as a tab of /guests; this bare URL just lands there.
export default function AgreementsIndexPage() {
  redirect('/guests?tab=agreements');
}
