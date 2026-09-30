'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
export function RetryDashboard() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())} style={{ font: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}>{pending ? 'Refreshing…' : 'Retry unavailable data'}</button>;
}
