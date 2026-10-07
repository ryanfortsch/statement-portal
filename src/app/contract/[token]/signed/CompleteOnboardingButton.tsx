'use client';

import Link, { useLinkStatus } from 'next/link';

/** Use Next's navigation state so interrupted transitions do not lock the link. */
function OnboardingLinkLabel() {
  const { pending } = useLinkStatus();
  return <span aria-busy={pending} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
    {pending ? <><span className="rt-th-spinner" aria-hidden="true" />Loading&hellip;</> : <>Complete the onboarding form &rarr;</>}
  </span>;
}

export function CompleteOnboardingButton({ href }: { href: string }) {
  return <Link href={href} className="rt-th-next-btn"><OnboardingLinkLabel /></Link>;
}
