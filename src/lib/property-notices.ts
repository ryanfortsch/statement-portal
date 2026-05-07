import { supabase } from '@/lib/supabase';

/**
 * Bespoke per-property guest notices. Each one is a 4×6 Stay Cape Ann
 * placard meant to be slipped into a glass case or taped near a fixture
 * to call out a property-specific quirk that the standardized
 * deliverables (Welcome Guide / WiFi Placard / Information Note) don't
 * cover — "please run the bathroom fan during showers", "no parking
 * past midnight on the harbor side", etc.
 *
 * Persisted in `public.property_notices`; cascades on property delete.
 */
export type PropertyNotice = {
  id: string;
  property_id: string;
  eyebrow: string | null;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
};

/** All notices for a property, newest first. */
export async function getPropertyNotices(propertyId: string): Promise<PropertyNotice[]> {
  const { data, error } = await supabase
    .from('property_notices')
    .select('*')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as PropertyNotice[] | null) ?? [];
}

/** Single notice by id; null if not found. Useful for the renderer + editor. */
export async function getPropertyNotice(noticeId: string): Promise<PropertyNotice | null> {
  const { data, error } = await supabase
    .from('property_notices')
    .select('*')
    .eq('id', noticeId)
    .maybeSingle();
  if (error) throw error;
  return (data as PropertyNotice | null) ?? null;
}

/**
 * Split a notice body into paragraphs on blank lines. Single newlines
 * stay inside a paragraph; double newlines (or more) break to a new one.
 * Empty paragraphs are dropped so a trailing blank line doesn't leave a
 * dangling empty <p> on the placard.
 */
export function splitNoticeParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
