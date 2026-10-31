'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { decideTestimonial } from '@/lib/guest-testimonials-store';

/**
 * The two verbs on a direct guest's testimonial (Reviews tab): show it on the
 * home's staycapeann.com page, or keep it off. Both are reversible, so neither
 * asks first. Any signed-in login may decide: a testimonial is operations,
 * not money.
 */
async function decide(formData: FormData, status: 'approved' | 'hidden'): Promise<void> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) throw new Error('Not signed in');
  const id = String(formData.get('id') || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Bad testimonial id');
  await decideTestimonial(id, status, email);
  revalidatePath('/guests');
}

export async function approveTestimonial(formData: FormData): Promise<void> {
  await decide(formData, 'approved');
}

export async function hideTestimonial(formData: FormData): Promise<void> {
  await decide(formData, 'hidden');
}
