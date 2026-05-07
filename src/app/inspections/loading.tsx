import { HelmLoading } from '@/components/HelmLoading';

export default function InspectionsLoading() {
  return <HelmLoading current="inspections" eyebrow="Helm · Inspections" headlineWidth={420} contentRows={5} />;
}
