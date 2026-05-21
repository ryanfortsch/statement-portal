/**
 * Build + send an inspection report email to Allie + Ryan when an inspection
 * is finalized. Mirrors the structure of `/inspections/[id]/render` (issues,
 * work slips, property notes, inspection notes) but flattened into email-safe
 * HTML and with photos linked back to their hosted URLs. Always sends to the
 * shared `ALWAYS_CC` list; never throws — failures are logged and swallowed
 * so completion never blocks on email delivery.
 */
import { supabase } from '@/lib/supabase';
import { sendTransactionalViaResend } from '@/lib/resend';
import { ALWAYS_CC } from '@/lib/properties';
import type {
  InspectionRow,
  InspectionItemRow,
  InspectionResultRow,
  PropertyZoneRow,
} from '@/lib/inspections-types';

type PropertyShape = {
  id: string;
  name: string;
  title: string | null;
  address: string | null;
  city: string;
  owner_last: string | null;
};

type ReportNote = {
  id: string;
  inspection_item_id: string | null;
  note_text: string;
  note_type: 'INSPECTION_NOTE' | 'PROPERTY_NOTE';
  author_email: string;
  created_at: string;
  photo_urls: string[] | null;
};

type ReportWorkSlip = {
  id: string;
  inspection_item_id: string | null;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  location: string | null;
  created_at: string;
  photo_urls: string[] | null;
};

function helmBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_HELM_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://helm.risingtidestr.com'
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPhotos(urls: string[] | null | undefined): string {
  if (!urls || urls.length === 0) return '';
  const thumbs = urls
    .map(
      (url) =>
        `<a href="${url}" style="text-decoration:none; margin:2px; display:inline-block;"><img src="${url}" alt="" width="92" height="69" style="display:block; width:92px; height:69px; object-fit:cover; border:1px solid #d8d4cb;" /></a>`,
    )
    .join('');
  return `<div style="margin-top:8px; line-height:0;">${thumbs}</div>`;
}

export async function sendInspectionReportEmail(inspectionId: string): Promise<void> {
  const { data: inspection } = await supabase
    .from('inspections')
    .select('*')
    .eq('id', inspectionId)
    .maybeSingle();
  if (!inspection) return;

  const insp = inspection as InspectionRow;

  const [
    { data: property },
    { data: results },
    { data: items },
    { data: notes },
    { data: workSlips },
    { data: zoneRows },
  ] = await Promise.all([
    supabase
      .from('properties')
      .select('id, name, title, address, city, owner_last')
      .eq('id', insp.property_id)
      .maybeSingle(),
    supabase
      .from('inspection_results')
      .select('id, inspection_id, item_id, property_zone_id, status, notes, photo_urls, created_at')
      .eq('inspection_id', inspectionId),
    supabase
      .from('inspection_items')
      .select('id, template_id, category, title, description, sort_order')
      .eq('template_id', insp.template_id),
    supabase
      .from('inspection_notes')
      .select('id, inspection_item_id, note_text, note_type, author_email, created_at, photo_urls')
      .eq('inspection_id', inspectionId)
      .order('created_at', { ascending: true }),
    supabase
      .from('work_slips')
      .select('id, inspection_item_id, title, description, category, priority, location, created_at, photo_urls')
      .eq('inspection_id', inspectionId)
      .order('created_at', { ascending: true }),
    supabase
      .from('property_zones')
      .select('*')
      .eq('property_id', insp.property_id)
      .order('walk_order', { ascending: true }),
  ]);

  if (!property) return;

  const prop = property as PropertyShape;
  const allItems = (items ?? []) as InspectionItemRow[];
  const itemMap = new Map<string, InspectionItemRow>();
  for (const it of allItems) itemMap.set(it.id, it);

  const zoneMap = new Map<string, PropertyZoneRow>();
  for (const z of (zoneRows ?? []) as PropertyZoneRow[]) zoneMap.set(z.id, z);

  const allResults = (results ?? []) as InspectionResultRow[];
  const issues = allResults
    .filter((r) => r.status === 'issue')
    .map((r) => ({
      result: r,
      item: itemMap.get(r.item_id),
      zone: r.property_zone_id ? zoneMap.get(r.property_zone_id) ?? null : null,
    }))
    .filter(
      (x): x is { result: InspectionResultRow; item: InspectionItemRow; zone: PropertyZoneRow | null } =>
        !!x.item,
    )
    .sort((a, b) => {
      const aw = a.zone?.walk_order ?? Infinity;
      const bw = b.zone?.walk_order ?? Infinity;
      if (aw !== bw) return aw - bw;
      return a.item.sort_order - b.item.sort_order;
    });

  const allNotes = (notes ?? []) as ReportNote[];
  const propertyNotes = allNotes.filter((n) => n.note_type === 'PROPERTY_NOTE');
  const inspectionNotes = allNotes.filter((n) => n.note_type === 'INSPECTION_NOTE');
  const slips = (workSlips ?? []) as ReportWorkSlip[];

  const completedDate = (insp.completed_at ? new Date(insp.completed_at) : new Date()).toLocaleDateString(
    'en-US',
    { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
  );

  const totalItems = insp.total_items ?? allResults.length;
  const passCount = insp.pass_count ?? 0;
  const issueCount = insp.issue_count ?? issues.length;
  const naCount = insp.na_count ?? 0;

  const headlineSummary =
    issueCount === 0
      ? `Clean walkthrough. All ${totalItems} items checked.`
      : `${issueCount} ${issueCount === 1 ? 'item' : 'items'} flagged across ${totalItems} checked${
          slips.length > 0
            ? `; ${slips.length} work ${slips.length === 1 ? 'slip' : 'slips'} created`
            : ''
        }.`;

  const subject =
    issueCount === 0
      ? `[Inspection] ${prop.name} · ${completedDate} · clean walkthrough`
      : `[Inspection] ${prop.name} · ${completedDate} · ${issueCount} flagged`;

  const reportUrl = `${helmBaseUrl()}/inspections/${inspectionId}/render`;
  const summaryUrl = `${helmBaseUrl()}/inspections/${inspectionId}/summary`;

  const sectionHeader = (title: string, eyebrow: string) => `
    <table cellpadding="0" cellspacing="0" style="width:100%; border-bottom:1px solid #1e2e34; margin:24px 0 8px 0;">
      <tr>
        <td style="font-family:Georgia,serif; font-size:16px; font-weight:400; color:#1e2e34; padding-bottom:6px;">${escapeHtml(title)}</td>
        <td style="font-family:-apple-system,sans-serif; font-size:10px; letter-spacing:.22em; text-transform:uppercase; color:#6b7780; text-align:right; padding-bottom:6px;">${escapeHtml(eyebrow)}</td>
      </tr>
    </table>
  `;

  const issuesHtml =
    issues.length === 0
      ? ''
      : sectionHeader('Issues', `${issues.length} flagged`) +
        issues
          .map(
            (row) => `
        <div style="padding:10px 0; border-bottom:1px solid #e7e3d9;">
          <div style="font-size:9px; letter-spacing:.18em; text-transform:uppercase; font-weight:600; color:#c85a3a; margin-bottom:4px;">${escapeHtml(row.zone?.name ?? row.item.category)}${row.zone?.floor_label ? ` <span style="color:#98a0a4; font-weight:400;">· ${escapeHtml(row.zone.floor_label)}</span>` : ''}</div>
          <div style="font-size:14px; color:#1e2e34; font-weight:500;">${escapeHtml(row.item.title)}</div>
          ${row.result.notes ? `<div style="margin-top:4px; font-size:13px; color:#4a565b; font-style:italic; line-height:1.45;">&ldquo;${escapeHtml(row.result.notes)}&rdquo;</div>` : ''}
          ${renderPhotos(row.result.photo_urls)}
        </div>`,
          )
          .join('');

  const slipsHtml =
    slips.length === 0
      ? ''
      : sectionHeader('Work Slips Created', `${slips.length} new`) +
        slips
          .map((ws) => {
            const item = ws.inspection_item_id ? itemMap.get(ws.inspection_item_id) : null;
            return `
        <div style="padding:10px 0; border-bottom:1px solid #e7e3d9;">
          <div style="font-size:9px; letter-spacing:.18em; text-transform:uppercase; font-weight:600; color:#c85a3a; margin-bottom:4px;">${escapeHtml(ws.category.replace('_', ' '))} · ${escapeHtml(ws.priority)}</div>
          <div style="font-size:14px; color:#1e2e34; font-weight:500;">${escapeHtml(ws.title)}</div>
          ${item ? `<div style="margin-top:2px; font-size:11px; color:#98a0a4;">From card: ${escapeHtml(item.title)}</div>` : ''}
          ${ws.location ? `<div style="margin-top:2px; font-size:12px; color:#6b7780;">Location: ${escapeHtml(ws.location)}</div>` : ''}
          ${ws.description ? `<div style="margin-top:4px; font-size:13px; color:#4a565b; line-height:1.45;">${escapeHtml(ws.description)}</div>` : ''}
          ${renderPhotos(ws.photo_urls)}
        </div>`;
          })
          .join('');

  const propertyNotesHtml =
    propertyNotes.length === 0
      ? ''
      : sectionHeader('Property Notes', `${propertyNotes.length} pinned`) +
        propertyNotes
          .map((n) => {
            const item = n.inspection_item_id ? itemMap.get(n.inspection_item_id) : null;
            const isPhotoOnly = n.note_text === '(photo)' && (n.photo_urls?.length ?? 0) > 0;
            return `
        <div style="padding:10px 0 10px 12px; border-bottom:1px solid #e7e3d9; border-left:2px solid #2c4a52;">
          ${!isPhotoOnly ? `<div style="font-size:13px; color:#1e2e34; line-height:1.5;">${escapeHtml(n.note_text)}</div>` : ''}
          ${item ? `<div style="margin-top:3px; font-size:11px; color:#98a0a4;">Re: ${escapeHtml(item.title)}</div>` : ''}
          ${renderPhotos(n.photo_urls)}
        </div>`;
          })
          .join('');

  const inspectionNotesHtml =
    inspectionNotes.length === 0
      ? ''
      : sectionHeader('Inspection Notes', String(inspectionNotes.length)) +
        inspectionNotes
          .map((n) => {
            const item = n.inspection_item_id ? itemMap.get(n.inspection_item_id) : null;
            const isPhotoOnly = n.note_text === '(photo)' && (n.photo_urls?.length ?? 0) > 0;
            return `
        <div style="padding:8px 0; border-bottom:1px solid #f0ece1;">
          ${!isPhotoOnly ? `<div style="font-size:13px; color:#1e2e34; line-height:1.5; font-style:italic;">&ldquo;${escapeHtml(n.note_text)}&rdquo;</div>` : ''}
          ${item ? `<div style="margin-top:3px; font-size:11px; color:#98a0a4;">Re: ${escapeHtml(item.title)}</div>` : ''}
          ${renderPhotos(n.photo_urls)}
        </div>`;
          })
          .join('');

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#1e2e34; max-width:640px; line-height:1.55; padding:8px;">
  <p style="font-family:ui-monospace,'SF Mono',monospace; font-size:11px; letter-spacing:.22em; text-transform:uppercase; color:#6b7780; margin:0 0 6px 0;">Rising Tide · Inspection Report</p>
  <h1 style="font-family:Georgia,serif; font-size:26px; font-weight:400; letter-spacing:-0.01em; color:#1e2e34; margin:0 0 4px 0;">${escapeHtml(prop.name)}</h1>
  <p style="font-size:13px; color:#6b7780; margin:0 0 14px 0;">${escapeHtml(prop.address || prop.title || prop.city)}${prop.owner_last ? ` · ${escapeHtml(prop.owner_last)}` : ''}</p>
  <p style="font-size:14px; color:#2f3e44; font-style:italic; margin:0 0 6px 0;">${escapeHtml(headlineSummary)}</p>
  <p style="font-size:12px; color:#6b7780; margin:0 0 22px 0;">${escapeHtml(completedDate)} · Walked by ${escapeHtml(insp.inspector_name || 'inspector')}</p>

  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse; border-top:1px solid #1e2e34; border-bottom:1px solid #1e2e34; width:100%; margin-bottom:16px;">
    <tr>
      <td style="padding:14px 12px; border-right:1px solid #d8d4cb; width:25%;">
        <div style="font-size:9px; letter-spacing:.22em; text-transform:uppercase; color:#6b7780; margin-bottom:4px;">Total</div>
        <div style="font-family:Georgia,serif; font-size:22px; color:#1e2e34;">${totalItems}</div>
      </td>
      <td style="padding:14px 12px; border-right:1px solid #d8d4cb; width:25%;">
        <div style="font-size:9px; letter-spacing:.22em; text-transform:uppercase; color:#6b7780; margin-bottom:4px;">Pass</div>
        <div style="font-family:Georgia,serif; font-size:22px; color:#2e7d4f;">${passCount}</div>
      </td>
      <td style="padding:14px 12px; border-right:1px solid #d8d4cb; width:25%;">
        <div style="font-size:9px; letter-spacing:.22em; text-transform:uppercase; color:#6b7780; margin-bottom:4px;">Issue</div>
        <div style="font-family:Georgia,serif; font-size:22px; color:#c85a3a;">${issueCount}</div>
      </td>
      <td style="padding:14px 12px; width:25%;">
        <div style="font-size:9px; letter-spacing:.22em; text-transform:uppercase; color:#6b7780; margin-bottom:4px;">N/A</div>
        <div style="font-family:Georgia,serif; font-size:22px; color:#98a0a4;">${naCount}</div>
      </td>
    </tr>
  </table>

  ${issuesHtml}
  ${slipsHtml}
  ${propertyNotesHtml}
  ${inspectionNotesHtml}

  <div style="margin-top:32px; padding-top:18px; border-top:1px solid #1e2e34;">
    <a href="${reportUrl}" style="display:inline-block; padding:10px 18px; background:#1e2e34; color:#faf7f1; text-decoration:none; font-size:13px; letter-spacing:.04em; margin-right:8px;">View full report</a>
    <a href="${summaryUrl}" style="display:inline-block; padding:10px 18px; border:1px solid #1e2e34; color:#1e2e34; text-decoration:none; font-size:13px; letter-spacing:.04em;">Open in Helm</a>
  </div>

  <p style="margin-top:28px; font-family:ui-monospace,'SF Mono',monospace; font-size:9px; letter-spacing:.22em; text-transform:uppercase; color:#98a0a4;">Rising Tide · Helm</p>
</div>
  `.trim();

  const textLines: string[] = [
    'Rising Tide · Inspection Report',
    '',
    prop.name,
    `${prop.address || prop.title || prop.city}${prop.owner_last ? ` · ${prop.owner_last}` : ''}`,
    '',
    headlineSummary,
    `${completedDate} · Walked by ${insp.inspector_name || 'inspector'}`,
    '',
    `Total: ${totalItems}  ·  Pass: ${passCount}  ·  Issue: ${issueCount}  ·  N/A: ${naCount}`,
  ];
  if (issues.length > 0) {
    textLines.push('', `ISSUES (${issues.length})`);
    for (const row of issues) {
      const label = row.zone
        ? `${row.zone.name}${row.zone.floor_label ? ` (${row.zone.floor_label})` : ''}`
        : row.item.category;
      textLines.push(`  · [${label}] ${row.item.title}`);
      if (row.result.notes) textLines.push(`      "${row.result.notes}"`);
    }
  }
  if (slips.length > 0) {
    textLines.push('', `WORK SLIPS CREATED (${slips.length})`);
    for (const ws of slips) {
      textLines.push(`  · [${ws.priority}] ${ws.title} (${ws.category.replace('_', ' ')})`);
    }
  }
  textLines.push('', `Full report: ${reportUrl}`, `Summary in Helm: ${summaryUrl}`);
  const text = textLines.join('\n');

  // Inspection reports go from a Rising Tide ops sender, not the guest-facing
  // staycapeann.com sender that the booking-inquiry flow uses. Requires the
  // risingtidestr.com domain to be verified in Resend; until then this send
  // will fail (logged + swallowed below, completion still proceeds).
  for (const to of ALWAYS_CC) {
    await sendTransactionalViaResend({
      to,
      subject,
      html,
      text,
      fromEmail: 'helm@risingtidestr.com',
      fromName: 'Rising Tide · Helm',
    }).catch((err) => console.warn('[inspection-email] resend failed for', to, err));
  }
}
