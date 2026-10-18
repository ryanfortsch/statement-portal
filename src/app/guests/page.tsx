import { HelmFooter } from '@/components/HelmFooter';
import { ReviewsTab, type ReviewsTabParams } from './ReviewsTab';

export const dynamic = 'force-dynamic';

// The Reviews tab of the Growth strip lives at the bare /guests, so deep
// links like /guests?days=30 keep working; old ?tab= URLs are handled by
// next.config redirects. The strip itself renders from the Growth layout.
export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<ReviewsTabParams>;
}) {
  const sp = await searchParams;

  return (
    <div className="flex-1 flex flex-col">
      <ReviewsTab params={sp} />
      <HelmFooter module="Reviews" right="Source: Guesty" />
    </div>
  );
}
