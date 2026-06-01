import { HelmLoading } from '@/components/HelmLoading';

export default function Loading() {
  return <HelmLoading current="playbook" eyebrow="Helm · Playbook" headlineWidth={420} contentRows={6} />;
}
