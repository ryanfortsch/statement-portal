'use client';
import { useEffect } from 'react';
import { invalidatePendingCounts } from '@/lib/pending-count-client';
export function MessagingCountsRefresh({ revision }: { revision: string }) {
  useEffect(() => { invalidatePendingCounts(); }, [revision]);
  return null;
}
