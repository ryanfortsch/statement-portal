import { HelmFooter } from '@/components/HelmFooter';
import { AgreementsTab } from '../AgreementsTab';

export const dynamic = 'force-dynamic';

// The Agreements tab of the Growth strip: bespoke Stay Cape Ann rental
// agreements for direct and mid-term stays. Was a ?tab=agreements lens on
// /guests; old ?tab= URLs are handled by next.config redirects.
export default function AgreementsIndexPage() {
  return (
    <div className="flex-1 flex flex-col">
      <AgreementsTab />
      <HelmFooter module="Agreements" right="Stay Cape Ann · Rising Tide" />
    </div>
  );
}
