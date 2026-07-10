'use client';

import { useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

/**
 * Client-side buttons for the public agreement signing page. Mirrors the
 * management contract's SigningButtons: the submit button reads the parent
 * form's pending state so the guest gets immediate feedback (the sign
 * action persists + sends email + redirects, which takes a few seconds),
 * and the floating pill jumps a long agreement straight to the signature
 * block.
 */
export function AgreementSignSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="sca-sign-btn"
    >
      {pending ? 'Signing…' : 'Sign Agreement'}
    </button>
  );
}

export function ScrollToSignAgreementButton() {
  const [visible, setVisible] = useState(true);

  // Hide the pill once the signature form is on screen — it points at
  // something the guest can already see.
  useEffect(() => {
    const target = document.querySelector('.sca-sign-form');
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => setVisible(!entries.some((e) => e.isIntersecting)),
      { threshold: 0.1 },
    );
    obs.observe(target);
    return () => obs.disconnect();
  }, []);

  if (!visible) return null;
  return (
    <button
      type="button"
      className="sca-jump-pill"
      onClick={() => {
        document.querySelector('.sca-sign-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }}
    >
      Jump to signature ↓
    </button>
  );
}
