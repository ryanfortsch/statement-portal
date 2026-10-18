import { HelmLoading } from '@/components/HelmLoading';

// Inside the Growth layout, which already draws the masthead and strip. The
// Reviews, Contacts, Agreements and Quotes tabs open on their list, not a hero.
export default function GuestsLoading() {
  return <HelmLoading bare hero={false} contentRows={8} />;
}
