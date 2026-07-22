'use server';

/**
 * Office actions for creative rate cards. Separate file from packets/actions
 * on purpose: this is the Creative trade's pay config, not packet machinery.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { saveRateCard, resetRateCard, type RateTier } from '@/lib/creative-rates';

async function staffEmail(): Promise<string> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');
  return session.user.email;
}

/** "$1,250", "1250", "1,250.50" -> cents; null when blank or unparseable. */
function money(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? '').replace(/[$,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

function intIn(v: FormDataEntryValue | null, lo: number, hi: number, dflt: number): number {
  const n = Number(String(v ?? '').trim());
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

export async function saveRateCardAction(formData: FormData) {
  const email = await staffEmail();
  const contractorId = String(formData.get('contractor_id') || '').trim() || null;

  const baseCents = money(formData.get('base')) ?? 12500;
  const carouselCents = money(formData.get('carousel')) ?? 0;

  const tiers: RateTier[] = [];
  for (let i = 0; i < 12; i++) {
    const views = Number(String(formData.get(`tier_views_${i}`) ?? '').replace(/[,\s]/g, ''));
    const cents = money(formData.get(`tier_pay_${i}`));
    if (Number.isFinite(views) && views > 0 && cents != null) tiers.push({ views, cents });
  }
  // Distinct rungs only - two rows at the same view mark keep the higher pay.
  const byViews = new Map<number, number>();
  for (const t of tiers) byViews.set(t.views, Math.max(byViews.get(t.views) ?? 0, t.cents));
  const cleanTiers: RateTier[] = [...byViews.entries()]
    .map(([views, cents]) => ({ views, cents }))
    .sort((a, b) => a.views - b.views);

  const extraTerms = String(formData.get('extra_terms') || '')
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((t) => t.slice(0, 300));

  await saveRateCard(
    {
      contractorId,
      baseCents,
      tiers: cleanTiers,
      carouselCents,
      minSeconds: intIn(formData.get('min_seconds'), 0, 600, 25),
      countDays: intIn(formData.get('count_days'), 1, 90, 14),
      maxPerShoot: intIn(formData.get('max_per_shoot'), 1, 10, 2),
      extraTerms,
    },
    email,
  );

  // One revalidate + anchored redirect, the exact proven shape of the other
  // Helm form actions. (No revalidate for /field/rate-card or the hiring
  // package: both are force-dynamic, there is no cache to purge, and the
  // extra revalidate was the one unproven element in the 2026-07-22
  // stuck-on-"Saving" incident.)
  revalidatePath('/operations/contractors');
  redirect(`/operations/contractors?trade=creative#${contractorId ? `rc-${contractorId}` : 'rate-card'}`);
}

export async function resetRateCardAction(formData: FormData) {
  await staffEmail();
  const contractorId = String(formData.get('contractor_id') || '').trim();
  if (contractorId) await resetRateCard(contractorId);
  revalidatePath('/operations/contractors');
  redirect(`/operations/contractors?trade=creative${contractorId ? `#rc-${contractorId}` : ''}`);
}
