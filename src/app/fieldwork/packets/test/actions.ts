'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { seedFieldTest, resetFieldTest } from '@/lib/field-test';

async function requireStaff(): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');
}

export async function seedFieldTestAction(): Promise<void> {
  await requireStaff();
  await seedFieldTest();
  revalidatePath('/fieldwork/packets/test');
  revalidatePath('/fieldwork/packets');
  revalidatePath('/fieldwork/roster');
}

export async function resetFieldTestAction(): Promise<void> {
  await requireStaff();
  await resetFieldTest();
  revalidatePath('/fieldwork/packets/test');
  revalidatePath('/fieldwork/packets');
  revalidatePath('/fieldwork/roster');
}
