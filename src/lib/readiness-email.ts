/**
 * Readiness review email — sends the current state of a prospect's
 * walkthrough checklist to the Rising Tide team (Allie + Ryan + Dotti)
 * for internal review. The team can then polish + forward to the owner.
 *
 * Not sent to the owner directly: Dotti's preference is to keep this an
 * internal handoff so the team can sanity-check the list (and the
 * walkthrough notes that may include sensitive info like lock codes)
 * before it goes outbound.
 *
 * Composed entirely as inline HTML/text — no PDF attachment for v1. The
 * recipients can copy/paste relevant sections into their own follow-up
 * to the owner.
 */
import { sendTransactionalViaResend } from '@/lib/resend';
import type { ProjectionRow } from '@/lib/projections-types';
import {
  READINESS_NOTE_FIELDS,
  computeReadiness,
} from '@/lib/projections-readiness';

const FROM_NAME = 'Rising Tide · Helm';
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'allie@risingtidestr.com';

// Team review distribution. Allie owns ops day-to-day so she's the
// primary; Ryan + Dotti are CC'd. Pulled from env so the addresses can be
// swapped without a code change if any of them moves on.
const TEAM_TO = process.env.READINESS_REVIEW_TO || 'allie@risingtidestr.com';
const TEAM_CC = (process.env.READINESS_REVIEW_CC || 'ryan@risingtidestr.com,dotti@risingtidestr.com')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export async function sendReadinessReviewEmail(args: {
  projection: ProjectionRow;
  /** Person who triggered the send — surfaces in the body. */
  triggeredBy?: string | null;
  /** Absolute Helm URL of the readiness page so reviewers can jump in. */
  readinessUrl: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const { projection, triggeredBy, readinessUrl } = args;

  // Re-derive groups + need counts from the projection so the email
  // reflects the same quantities the analyst saw on screen.
  const { groups } = computeReadiness(projection);
  const state = projection.readiness_state ?? null;
  const have = state?.have ?? {};
  const checked = state?.checked ?? [];
  const notes = state?.notes ?? {};

  // Build the "still needed" list using the same fallback the client uses:
  // legacy `checked` entries count as full, the canonical `have` dict
  // wins when present.
  type StillNeeded = { label: string; group: string; have: number; need: number };
  const stillNeeded: StillNeeded[] = [];
  let itemsDone = 0;
  let itemsTotal = 0;
  for (const g of groups) {
    for (const it of g.items) {
      itemsTotal += 1;
      const rawHave = have[it.label] ?? (checked.includes(it.label) ? it.count : 0);
      const h = Math.min(rawHave, it.count);
      if (h >= it.count) {
        itemsDone += 1;
      } else {
        stillNeeded.push({ label: it.label, group: g.title, have: h, need: it.count });
      }
    }
  }

  const propertyAddress = projection.property_address;
  const prospectName = projection.prospect_name || 'the owner';
  const prospectFirst =
    projection.prospect_first_names || projection.prospect_first_name || prospectName;

  // ─── HTML body ──────────────────────────────────────────────────────
  const stillNeededHtml = stillNeeded.length === 0
    ? `<p style="color:#4a9d6b;font-weight:600;">Everything is accounted for. The property is guest-ready.</p>`
    : `
      <ul style="padding-left:18px;margin:8px 0 0;">
        ${stillNeeded
          .map((n) => `
            <li style="margin:6px 0;">
              <strong>${escapeHtml(n.label)}</strong>
              <span style="color:#6b7c83;font-size:13px;"> · ${escapeHtml(n.group)}</span>
              <span style="color:#c85a3a;font-weight:600;float:right;">
                ${n.have > 0 ? `${n.have} / ${n.need}` : `need ${n.need}`}
              </span>
            </li>
          `)
          .join('')}
      </ul>
    `;

  const notesHtml = READINESS_NOTE_FIELDS
    .map((f) => {
      const v = notes[f.key];
      if (!v || !v.trim()) return null;
      return `
        <div style="margin:10px 0;">
          <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7c83;font-weight:600;">${escapeHtml(f.label)}</div>
          <div style="font-size:14px;color:#1e2e34;white-space:pre-wrap;margin-top:2px;">${escapeHtml(v)}</div>
        </div>
      `;
    })
    .filter(Boolean)
    .join('');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;font-size:15px;line-height:1.55;color:#1e2e34;max-width:640px;">
      <p style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#6b7c83;margin:0 0 4px;">Property Readiness · Review</p>
      <h1 style="font-family:'Fraunces',Georgia,serif;font-weight:300;font-size:26px;letter-spacing:-0.01em;margin:0 0 6px;color:#1e2e34;">${escapeHtml(propertyAddress)}</h1>
      <p style="color:#6b7c83;font-size:13px;margin:0 0 18px;">For ${escapeHtml(prospectFirst)}${triggeredBy ? ` · walked through by ${escapeHtml(triggeredBy)}` : ''}.</p>

      <p>Hi team —</p>
      <p>Sharing the current state of the readiness walkthrough for <strong>${escapeHtml(propertyAddress)}</strong>. Review the list below and forward the polished version to ${escapeHtml(prospectFirst)} when you're ready.</p>

      <div style="background:#f6f1e3;border-left:3px solid #c85a3a;padding:10px 14px;margin:18px 0;">
        <strong>${itemsDone} of ${itemsTotal} items complete</strong>
        ${stillNeeded.length > 0 ? ` · ${stillNeeded.length} still needed` : ''}
      </div>

      <h2 style="font-family:'Fraunces',Georgia,serif;font-weight:400;font-size:18px;margin:22px 0 4px;">Still needed</h2>
      ${stillNeededHtml}

      ${notesHtml
        ? `<h2 style="font-family:'Fraunces',Georgia,serif;font-weight:400;font-size:18px;margin:24px 0 4px;">Walkthrough notes</h2>${notesHtml}`
        : ''}

      <p style="margin-top:28px;">
        <a href="${readinessUrl}" style="display:inline-block;background:#1e2e34;color:#faf7f1;text-decoration:none;padding:11px 20px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;font-weight:600;">Open in Helm →</a>
      </p>

      <p style="font-size:11px;color:#6b7c83;margin-top:32px;border-top:1px solid #e6dfd0;padding-top:12px;">
        Rising Tide · risingtidestr.com · (978) 865-2387<br/>
        This is an internal review email. Forward to the owner once the list looks clean.
      </p>
    </div>
  `;

  // ─── Plain-text fallback ────────────────────────────────────────────
  const lines: string[] = [];
  lines.push(`Property Readiness Review — ${propertyAddress}`);
  lines.push(`For ${prospectFirst}${triggeredBy ? ` · walked through by ${triggeredBy}` : ''}`);
  lines.push('');
  lines.push(`${itemsDone} of ${itemsTotal} items complete${stillNeeded.length > 0 ? ` · ${stillNeeded.length} still needed` : ''}`);
  lines.push('');
  if (stillNeeded.length === 0) {
    lines.push('Everything is accounted for. The property is guest-ready.');
  } else {
    lines.push('STILL NEEDED');
    for (const n of stillNeeded) {
      const qty = n.have > 0 ? `${n.have} / ${n.need}` : `need ${n.need}`;
      lines.push(`  - ${n.label} (${n.group}) — ${qty}`);
    }
  }
  const populatedNotes = READINESS_NOTE_FIELDS.filter((f) => (notes[f.key] ?? '').trim());
  if (populatedNotes.length > 0) {
    lines.push('');
    lines.push('WALKTHROUGH NOTES');
    for (const f of populatedNotes) {
      lines.push(`  ${f.label}: ${notes[f.key]}`);
    }
  }
  lines.push('');
  lines.push(`Open in Helm: ${readinessUrl}`);
  lines.push('');
  lines.push('— Rising Tide');

  const ok = await sendTransactionalViaResend({
    to: TEAM_TO,
    cc: TEAM_CC,
    fromName: FROM_NAME,
    fromEmail: FROM_EMAIL,
    subject: `Readiness review — ${propertyAddress}`,
    html,
    text: lines.join('\n'),
  });

  return ok ? { ok: true } : { ok: false, reason: 'resend send failed' };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
