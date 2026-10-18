import { HelmLoading } from '@/components/HelmLoading';

// Inside the Growth layout, which already draws the masthead and strip.
export default function MarketingLoading() {
  return <HelmLoading bare eyebrow="Helm · Marketing" headlineWidth={420} contentRows={5} />;
}
