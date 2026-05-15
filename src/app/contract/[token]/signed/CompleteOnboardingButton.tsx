'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * "Complete the onboarding form" CTA on the contract-signed
 * confirmation page. Same pattern as the DownloadCopyButton sibling
 * on this page: the click takes a beat (Next.js has to compile +
 * render the next route), and a plain <Link> gives no visible
 * feedback during that window. Owners click and assume nothing
 * happened, then click again.
 *
 * On click: lock the button into a busy state with a spinner +
 * "Loading…" label, then push the route. The button stays busy
 * until the navigation resolves (useTransition keeps isPending
 * true through the await).
 */
export function CompleteOnboardingButton({ href }: { href: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Local "clicked" flag so the busy state survives even if the
  // route transition is fast enough that isPending blinks back to
  // false before the new page paints.
  const [clicked, setClicked] = useState(false);
  const busy = isPending || clicked;

  return (
    <Link
      href={href}
      className={busy ? 'rt-th-next-btn is-preparing' : 'rt-th-next-btn'}
      aria-busy={busy ? 'true' : 'false'}
      onClick={(e) => {
        if (busy) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        setClicked(true);
        startTransition(() => {
          router.push(href);
        });
      }}
    >
      {busy ? (
        <>
          <span className="rt-th-spinner" aria-hidden="true" />
          Loading&hellip;
        </>
      ) : (
        <>Complete the onboarding form &rarr;</>
      )}
    </Link>
  );
}
