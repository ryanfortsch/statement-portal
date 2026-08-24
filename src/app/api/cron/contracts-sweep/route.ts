import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { authorizeCron } from '@/lib/cron-auth';
import { fetchContractPdf } from '@/lib/contract-email';
import {
  archiveContractToDrive,
  isDriveArchiveConfigured,
  listContractDriveFiles,
} from '@/lib/drive-archive';

/**
 * GET /api/cron/contracts-sweep — weekly (Mon 7am ET), manual-triggerable
 * by a signed-in user like the other crons.
 *
 * Keeps the contract paper trail closed in both directions:
 *
 * 1. Helm → Drive: any projection that is fully countersigned but has no
 *    contract_drive_url gets its executed PDF rendered and archived to
 *    Helm Records / Contracts / <year>/ (the 225 Washington gap: signed
 *    2026-06-24, invisible in the Drive folder for two months). Capped
 *    per run — the render is the slow step.
 *
 * 2. Drive → register: every PDF in the Contracts year folders is diffed
 *    against property_contracts.drive_file_id (and the projections'
 *    archived urls, which the register page already surfaces separately
 *    as "register" items). Unmatched files land in contract_drive_orphans
 *    and show on the /properties/contracts radar, so a contract someone
 *    digs up and drops into Drive announces itself. Orphans self-clear
 *    once registered or removed.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const MAX_ARCHIVES_PER_RUN = 3;

function driveFileIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/file\/d\/([^/?#]+)/) || url.match(/[?&]id=([^&#]+)/);
  return m ? m[1] : null;
}

export async function GET(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  if (!isDriveArchiveConfigured()) {
    return NextResponse.json({ ok: false, error: 'Drive archive not configured' }, { status: 503 });
  }

  const summary: {
    archived: Array<{ projectionId: string; address: string | null; url?: string; error?: string }>;
    orphansNew: string[];
    orphansCleared: number;
    orphansOpen: number;
    listError?: string;
  } = { archived: [], orphansNew: [], orphansCleared: 0, orphansOpen: 0 };

  // ── 1. Archive countersigned contracts that never reached Drive. ──
  try {
    const { data } = await supabase
      .from('projections')
      .select('id, property_address, prospect_name, onboarding_token, contract_countersigned_at, contract_drive_url')
      .not('contract_countersigned_at', 'is', null)
      .is('contract_drive_url', null)
      .limit(MAX_ARCHIVES_PER_RUN);
    const rows = (data ?? []) as Array<{
      id: string;
      property_address: string | null;
      prospect_name: string | null;
      onboarding_token: string | null;
      contract_countersigned_at: string;
    }>;
    const origin = request.nextUrl.origin;
    for (const proj of rows) {
      try {
        const dateStr = proj.contract_countersigned_at.slice(0, 10);
        const filename = `${proj.property_address ?? 'Contract'} - ${proj.prospect_name ?? 'Owner'} - Executed ${dateStr}.pdf`
          .replace(/[\\/:*?"<>|]/g, '')
          .trim();
        const pdf = await fetchContractPdf({ projectionId: proj.id, origin, token: proj.onboarding_token });
        const archive = await archiveContractToDrive({ pdf, filename, year: dateStr.slice(0, 4) });
        if (archive.ok && archive.url) {
          await supabase.from('projections').update({ contract_drive_url: archive.url }).eq('id', proj.id);
          summary.archived.push({ projectionId: proj.id, address: proj.property_address, url: archive.url });
        } else {
          summary.archived.push({ projectionId: proj.id, address: proj.property_address, error: archive.reason || 'archive failed' });
        }
      } catch (err) {
        summary.archived.push({
          projectionId: proj.id,
          address: proj.property_address,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    console.error('[contracts-sweep] archive pass failed:', err);
  }

  // ── 2. Diff the Drive folder against the register; maintain orphans. ──
  try {
    const [files, registered, projected, existing] = await Promise.all([
      listContractDriveFiles(),
      supabase.from('property_contracts').select('drive_file_id').not('drive_file_id', 'is', null),
      supabase.from('projections').select('contract_drive_url').not('contract_drive_url', 'is', null),
      supabase.from('contract_drive_orphans').select('drive_file_id'),
    ]);
    const known = new Set<string>();
    for (const r of (registered.data ?? []) as Array<{ drive_file_id: string }>) known.add(r.drive_file_id);
    for (const r of (projected.data ?? []) as Array<{ contract_drive_url: string }>) {
      const id = driveFileIdFromUrl(r.contract_drive_url);
      if (id) known.add(id);
    }

    const orphans = files.filter((f) => !known.has(f.id));
    const orphanIds = new Set(orphans.map((f) => f.id));
    const existingIds = new Set(
      ((existing.data ?? []) as Array<{ drive_file_id: string }>).map((r) => r.drive_file_id),
    );

    const nowIso = new Date().toISOString();
    const fresh = orphans.filter((f) => !existingIds.has(f.id));
    if (fresh.length > 0) {
      await supabase.from('contract_drive_orphans').insert(
        fresh.map((f) => ({
          drive_file_id: f.id,
          title: f.name,
          folder_year: f.year,
          drive_url: f.webViewLink,
        })),
      );
      summary.orphansNew = fresh.map((f) => f.name);
    }
    const still = orphans.filter((f) => existingIds.has(f.id));
    if (still.length > 0) {
      await supabase
        .from('contract_drive_orphans')
        .update({ last_seen_at: nowIso })
        .in('drive_file_id', still.map((f) => f.id));
    }
    const cleared = [...existingIds].filter((id) => !orphanIds.has(id));
    if (cleared.length > 0) {
      await supabase.from('contract_drive_orphans').delete().in('drive_file_id', cleared);
      summary.orphansCleared = cleared.length;
    }
    summary.orphansOpen = orphans.length;
  } catch (err) {
    summary.listError = err instanceof Error ? err.message : String(err);
    console.error('[contracts-sweep] Drive diff failed:', err);
  }

  return NextResponse.json({ ok: true, ...summary });
}
