import { HelmFooter } from '@/components/HelmFooter';
import { QuotesTab } from '../QuotesTab';

export const dynamic = 'force-dynamic';

// The Quotes tab of the Growth strip (owners only): Stay Cape Ann custom quotes and
// booking requests. Composed here, accepted and paid on staycapeann.com.
export default function QuotesIndexPage() {
  return (
    <div className="flex-1 flex flex-col">
      <QuotesTab />
      <HelmFooter module="Quotes" right="Stay Cape Ann · Rising Tide" />
    </div>
  );
}
