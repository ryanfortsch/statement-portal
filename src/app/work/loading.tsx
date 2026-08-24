import { HelmLoading } from '@/components/HelmLoading';

export default function WorkLoading() {
  // Heroless: the board opens straight onto its tab row, with no eyebrow
  // or headline for a placeholder to stand in for.
  return <HelmLoading bare heroless contentRows={7} />;
}
