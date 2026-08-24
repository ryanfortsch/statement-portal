import { HelmLoading } from '@/components/HelmLoading';

// No hero: the board dropped its masthead, so the skeleton leads with the
// list the way the real page does.
export default function WorkLoading() {
  return <HelmLoading bare hero={false} contentRows={6} />;
}
