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
  revalidatePath('/operations/packets/test');
  revalidatePath('/operations/packets');
  revalidatePath('/operations/contractors');
}

export async function resetFieldTestAction(): Promise<void> {
  await requireStaff();
  await resetFieldTest();
  revalidatePath('/operations/packets/test');
  revalidatePath('/operations/packets');
  revalidatePath('/operations/contractors');
}
