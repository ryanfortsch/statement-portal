'use server';

import { auth } from '@/auth';
import { setOrderHave, setOrderNote } from '@/lib/order-checklist-db';

/**
 * Server actions for the outfitting order checklist. Auth-gated,
 * service-role backed (property_order_checklist is RLS-locked). No
 * revalidatePath on purpose, same as the readiness walkthrough: writes are
 * optimistic client-side and a revalidate would flash the properties
 * loading state mid-tap.
 */

export async function setOrderHaveAction(args: {
  propertyId: string;
  itemLabel: string;
  count: number;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  return setOrderHave({
    propertyId: args.propertyId,
    itemLabel: args.itemLabel,
    count: args.count,
    updatedByEmail: session.user.email,
  });
}

export async function setOrderNoteAction(args: {
  propertyId: string;
  noteKey: string;
  value: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  return setOrderNote({
    propertyId: args.propertyId,
    noteKey: args.noteKey,
    value: args.value,
    updatedByEmail: session.user.email,
  });
}
