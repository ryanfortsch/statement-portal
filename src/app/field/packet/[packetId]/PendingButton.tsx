'use client';

/**
 * The packet page's pending submit button was generalized into the shared
 * house component (src/components/SubmitButton.tsx). Re-exported here so the
 * existing packet + operations imports keep working unchanged. New code
 * should import `@/components/SubmitButton` directly.
 */
export { SubmitButton as PendingButton } from '@/components/SubmitButton';
