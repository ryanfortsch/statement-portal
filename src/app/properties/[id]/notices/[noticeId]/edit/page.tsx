import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { NoticeEditorForm } from '@/components/properties/NoticeEditorForm';
import { DeletePropertyNoticeButton } from '@/components/properties/DeletePropertyNoticeButton';
import { updatePropertyNotice, deletePropertyNotice } from '@/app/properties/actions';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import { getPropertyNotice } from '@/lib/property-notices';
import type { HelmPropertyRow } from '@/lib/properties';

export const dynamic = 'force-dynamic';

async function getProperty(id: string): Promise<HelmPropertyRow | null> {
  if (!isHelmConfigured) return null;
  const { data, error } = await supabase
    .from('properties')
    .select('id, name, title')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as HelmPropertyRow) ?? null;
}

/**
 * Edit (or delete) an existing bespoke notice. The delete button is its
 * own client component so we can confirm before invoking the server
 * action.
 */
export default async function EditPropertyNoticePage({
  params,
}: {
  params: Promise<{ id: string; noticeId: string }>;
}) {
  const { id, noticeId } = await params;
  const [p, notice] = await Promise.all([getProperty(id), getPropertyNotice(noticeId)]);
  if (!p) notFound();
  if (!notice || notice.property_id !== id) notFound();

  const updateAction = updatePropertyNotice.bind(null, id, noticeId);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="properties" />

      <div className="max-w-[680px] mx-auto px-10" style={{ width: '100%', paddingTop: 32, paddingBottom: 64 }}>
        <Link
          href={`/properties/${p.id}`}
          style={{
            fontSize: 11,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            textDecoration: 'none',
          }}
        >
          ← {p.name}
        </Link>

        <h1 className="font-serif" style={{ fontSize: 40, fontWeight: 300, letterSpacing: '-0.02em', margin: '18px 0 6px', color: 'var(--ink)' }}>
          Edit <em>notice.</em>
        </h1>
        <p style={{ margin: '0 0 30px', fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.55 }}>
          Updates re-render the 4 × 6 placard for {p.name}. Reprint and slot the new copy when ready.
        </p>

        <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 26 }}>
          <NoticeEditorForm
            action={updateAction}
            propertyId={p.id}
            initial={{ eyebrow: notice.eyebrow, title: notice.title, body: notice.body }}
            submitLabel="Save changes"
          />
        </div>

        <div style={{ marginTop: 36, paddingTop: 22, borderTop: '1px solid var(--rule)' }}>
          <div className="eyebrow" style={{ fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-3)', fontWeight: 600, marginBottom: 8 }}>
            Danger zone
          </div>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.55 }}>
            Removes the notice from {p.name} and revokes the printed placard URL. This can&rsquo;t be undone.
          </p>
          <DeletePropertyNoticeButton
            action={deletePropertyNotice.bind(null, id, noticeId)}
            confirmText={`Delete the “${notice.title}” notice from ${p.name}? This can't be undone.`}
          />
        </div>
      </div>
    </div>
  );
}
