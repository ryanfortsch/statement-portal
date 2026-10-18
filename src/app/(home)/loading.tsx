import { HelmLoading } from '@/components/HelmLoading';

/**
 * The home page's loading screen: the masthead and the "Today" title's
 * place, then rows where the feed will be. Lives in the `(home)` route group
 * so it covers this page only.
 */
export default function HomeLoading() {
  return <HelmLoading eyebrow="HELM" headlineWidth={200} contentRows={6} />;
}
