/**
 * Drive delivery watcher for the Creative module.
 *
 * A contributor delivers raw assets by dropping files into their Drive folder:
 * "Creative Assets - <first name>" at the top, one subfolder per shoot (named
 * like the property: "4 Brier Neck"), files loose or in nested folders (e.g.
 * "Carousel - July 2026"). This module scans those folders, mirrors every file
 * into creative_drive_files, and logs/links creative_assets so the delivery
 * base goes DUE on the board the moment the files land — no one has to chase
 * or bug the contributor about the upload.
 *
 * Classification: video/* = a reel; image/* files sharing one immediate parent
 * folder = one carousel; anything else is recorded but never becomes an asset.
 * Folders named like raw/b-roll are skipped so a footage dump can't spawn
 * phantom reels.
 *
 * Money safety: this file never pays anything, and never writes to a paid or
 * view-locked asset. It only creates asset rows (computeShootPay's caps decide
 * what counts) and stamps delivery evidence. Paying stays a human click.
 *
 * Auth: the same service-account token as drive-archive.ts, but read-only
 * scope. The service account must be able to see the talent folder (it lives
 * in the Rising Tide Shared Drive).
 */
import 'server-only';
import { fieldDb } from './field-db';
import { getGoogleAccessToken } from './marketing/auth';
import { loadRateCards } from './creative-rates';
import { cardFromSnapshot } from './creative-pay';
import type { ShootRow } from './creative-shoots';

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const API = 'https://www.googleapis.com/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** True when the Drive watcher can run (service-account key present). */
export const isCreativeDriveConfigured = () => !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

export type DriveFileRow = {
  id: string;
  shoot_id: string;
  asset_id: string | null;
  drive_file_id: string;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  parent_folder_id: string | null;
  parent_folder_name: string | null;
  web_view_link: string | null;
  drive_created_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  trashed_at: string | null;
};

export type ShootSyncReport = {
  shootId: string;
  title: string;
  folderId: string | null;
  newFiles: number;
  linkedToExisting: number;
  createdReels: number;
  createdCarousels: number;
  otherFiles: number;
  removedFiles: number;
  note: string | null; // unmatched folder, ambiguity, per-shoot error
};

export type DriveSyncReport = {
  ok: boolean;
  ranAt: string;
  shootsScanned: number;
  newFiles: number;
  assetsCreated: number;
  shoots: ShootSyncReport[];
  errors: string[];
};

// ── Drive REST helpers (Shared Drive aware, same pattern as drive-archive) ──

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  webViewLink?: string;
  videoMediaMetadata?: { durationMillis?: string };
};

function esc(s: string): string {
  return s.replace(/'/g, "\\'");
}

async function driveList(token: string, q: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const url =
      `${API}/files?q=${encodeURIComponent(q)}` +
      `&fields=${encodeURIComponent('nextPageToken, files(id,name,mimeType,size,createdTime,webViewLink,videoMediaMetadata(durationMillis))')}` +
      `&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Drive list failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
    out.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

const listChildren = (token: string, parentId: string) =>
  driveList(token, `'${esc(parentId)}' in parents and trashed = false`);

/** Lowercase, alphanumerics + single spaces — the matching alphabet. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Find the talent's root folder by convention: "Creative Assets - <name>". */
async function findTalentFolder(token: string, fullName: string): Promise<string | null> {
  const first = fullName.split(' ')[0];
  const candidates = [...new Set([`Creative Assets - ${first}`, `Creative Assets - ${fullName}`])];
  for (const name of candidates) {
    const hits = await driveList(
      token,
      `name = '${esc(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    );
    if (hits.length > 0) return hits[0].id;
  }
  return null;
}

type FoundFile = DriveFile & { parentFolderId: string; parentFolderName: string };

/** Every non-folder file under rootId, up to 3 folder levels deep. Folders
 *  named like raw footage dumps are skipped so they can't spawn phantom reels. */
async function collectFiles(token: string, rootId: string, rootName: string): Promise<FoundFile[]> {
  const out: FoundFile[] = [];
  let frontier = [{ id: rootId, name: rootName, depth: 0 }];
  while (frontier.length > 0) {
    const next: typeof frontier = [];
    for (const folder of frontier) {
      const children = await listChildren(token, folder.id);
      for (const c of children) {
        if (c.mimeType === FOLDER_MIME) {
          const n = norm(c.name);
          const isDump = n.includes('raw') || n.includes('b roll') || n.includes('broll');
          if (folder.depth < 3 && !isDump) next.push({ id: c.id, name: c.name, depth: folder.depth + 1 });
        } else {
          out.push({ ...c, parentFolderId: folder.id, parentFolderName: folder.name });
        }
      }
    }
    frontier = next;
  }
  return out;
}

/** Match a shoot to one of the talent-root's child folders by name: the folder
 *  title equals / prefixes the property name (or vice versa), or appears in the
 *  shoot title. Exactly one hit or nothing — ambiguity is reported, not guessed. */
function matchShootFolder(
  shoot: Pick<ShootRow, 'title'>,
  propertyName: string | null,
  folders: DriveFile[],
  taken: Set<string>,
): { id: string | null; note: string | null } {
  const np = propertyName ? norm(propertyName) : null;
  const nt = norm(shoot.title);
  const hits = folders.filter((f) => {
    if (taken.has(f.id)) return false;
    const n = norm(f.name);
    if (n.length < 3) return false;
    if (np && (n === np || np.startsWith(n) || n.startsWith(np))) return true;
    return nt.includes(n);
  });
  if (hits.length === 1) return { id: hits[0].id, note: null };
  if (hits.length > 1) return { id: null, note: `${hits.length} Drive folders match — paste the right one on the shoot page` };
  return { id: null, note: 'no Drive folder matched — name one like the property, or paste its link on the shoot page' };
}

// ── Loaders for the board + shoot page ──────────────────────────────────

export async function loadShootDriveFiles(shootId: string): Promise<DriveFileRow[]> {
  const { data } = await fieldDb()
    .from('creative_drive_files')
    .select('*')
    .eq('shoot_id', shootId)
    .order('drive_created_at', { ascending: true });
  return (data ?? []) as DriveFileRow[];
}

/** Non-trashed Drive file count per shoot, for the board's meta line. */
export async function loadDriveFileCounts(shootIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (shootIds.length === 0) return map;
  const { data } = await fieldDb()
    .from('creative_drive_files')
    .select('shoot_id')
    .in('shoot_id', shootIds)
    .is('trashed_at', null);
  for (const row of (data ?? []) as { shoot_id: string }[]) {
    map.set(row.shoot_id, (map.get(row.shoot_id) ?? 0) + 1);
  }
  return map;
}

// ── The sync ────────────────────────────────────────────────────────────

type AssetLite = {
  id: string;
  shoot_id: string;
  kind: 'reel' | 'carousel';
  title: string | null;
  duration_seconds: number | null;
  base_paid_at: string | null;
  views_locked_at: string | null;
  submitted_by_contractor_at: string | null;
  created_at: string;
};

function titleFromFilename(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || name.slice(0, 200);
}

function fileDuration(f: DriveFile): number | null {
  const ms = Number(f.videoMediaMetadata?.durationMillis);
  return Number.isFinite(ms) && ms > 0 ? Math.max(1, Math.round(ms / 1000)) : null;
}

/**
 * Scan every open shoot's Drive folder and reconcile what's there into the
 * ledger. Idempotent and crash-safe: a file row is claimed (unique
 * drive_file_id) before any asset is created for it, so re-runs and
 * double-clicks can never double-log.
 */
export async function syncCreativeDrive(): Promise<DriveSyncReport> {
  const ranAt = new Date().toISOString();
  const report: DriveSyncReport = { ok: true, ranAt, shootsScanned: 0, newFiles: 0, assetsCreated: 0, shoots: [], errors: [] };
  if (!isCreativeDriveConfigured()) {
    report.ok = false;
    report.errors.push('GOOGLE_SERVICE_ACCOUNT_KEY is not set in this environment');
    return report;
  }

  const db = fieldDb();
  const { data: sData } = await db
    .from('creative_shoots')
    .select('*')
    .in('status', ['scheduled', 'shot', 'delivered', 'approved']);
  const shoots = ((sData ?? []) as ShootRow[]).sort((a, b) => (a.shoot_date < b.shoot_date ? 1 : -1));
  if (shoots.length === 0) return report;

  const shootIds = shoots.map((s) => s.id);
  const contractorIds = [...new Set(shoots.map((s) => s.contractor_id))];
  const propertyIds = [...new Set(shoots.map((s) => s.property_id).filter((v): v is string => !!v))];

  const [{ data: aData }, { data: fData }, { data: cData }, { data: pData }, { data: takenData }, cards] = await Promise.all([
    db
      .from('creative_assets')
      .select('id, shoot_id, kind, title, duration_seconds, base_paid_at, views_locked_at, submitted_by_contractor_at, created_at')
      .in('shoot_id', shootIds)
      .order('created_at', { ascending: true }),
    db.from('creative_drive_files').select('*').in('shoot_id', shootIds),
    db.from('contractors').select('id, full_name, drive_folder_id').in('id', contractorIds),
    propertyIds.length
      ? db.from('properties').select('id, name').in('id', propertyIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    // Folders already pinned to ANY shoot (incl. settled/cancelled), so a new
    // shoot at the same property can't silently claim an old shoot's folder.
    db.from('creative_shoots').select('id, drive_folder_id').not('drive_folder_id', 'is', null),
    loadRateCards(),
  ]);

  const assetsByShoot = new Map<string, AssetLite[]>();
  for (const a of (aData ?? []) as AssetLite[]) {
    const arr = assetsByShoot.get(a.shoot_id) ?? [];
    arr.push(a);
    assetsByShoot.set(a.shoot_id, arr);
  }
  const filesByShoot = new Map<string, DriveFileRow[]>();
  for (const f of (fData ?? []) as DriveFileRow[]) {
    const arr = filesByShoot.get(f.shoot_id) ?? [];
    arr.push(f);
    filesByShoot.set(f.shoot_id, arr);
  }
  const contractors = new Map(((cData ?? []) as { id: string; full_name: string; drive_folder_id: string | null }[]).map((c) => [c.id, c]));
  const propNames = new Map(((pData ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const taken = new Set(
    ((takenData ?? []) as { id: string; drive_folder_id: string }[])
      .filter((r) => !shootIds.includes(r.id) || shoots.find((s) => s.id === r.id)?.drive_folder_id)
      .map((r) => r.drive_folder_id),
  );

  let token: string;
  let saEmail = 'the Helm service account';
  try {
    token = await getGoogleAccessToken([SCOPE]);
    saEmail = (JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!) as { client_email?: string }).client_email ?? saEmail;
  } catch (err) {
    report.ok = false;
    report.errors.push(`Google auth failed: ${err instanceof Error ? err.message : String(err)}`);
    return report;
  }

  // Talent-root child folders, listed once per contractor.
  const rootFolders = new Map<string, DriveFile[]>();

  for (const shoot of shoots) {
    const sr: ShootSyncReport = {
      shootId: shoot.id,
      title: shoot.title,
      folderId: shoot.drive_folder_id,
      newFiles: 0,
      linkedToExisting: 0,
      createdReels: 0,
      createdCarousels: 0,
      otherFiles: 0,
      removedFiles: 0,
      note: null,
    };
    report.shoots.push(sr);

    try {
      const contractor = contractors.get(shoot.contractor_id);

      // 1. Resolve the shoot's folder (pinned > auto-match by name).
      if (!sr.folderId) {
        if (!contractor) {
          sr.note = 'contributor not found';
          continue;
        }
        let rootId = contractor.drive_folder_id;
        if (!rootId) {
          rootId = await findTalentFolder(token, contractor.full_name);
          if (rootId) {
            contractor.drive_folder_id = rootId;
            await db.from('contractors').update({ drive_folder_id: rootId }).eq('id', contractor.id);
          }
        }
        if (!rootId) {
          sr.note = `no "Creative Assets - ${contractor.full_name.split(' ')[0]}" folder visible — share it with ${saEmail}`;
          continue;
        }
        if (!rootFolders.has(rootId)) {
          rootFolders.set(rootId, (await listChildren(token, rootId)).filter((f) => f.mimeType === FOLDER_MIME));
        }
        const match = matchShootFolder(shoot, shoot.property_id ? propNames.get(shoot.property_id) ?? null : null, rootFolders.get(rootId)!, taken);
        if (!match.id) {
          sr.note = match.note;
          continue;
        }
        sr.folderId = match.id;
        taken.add(match.id);
        await db.from('creative_shoots').update({ drive_folder_id: match.id, updated_at: new Date().toISOString() }).eq('id', shoot.id);
      }

      // 2. What's in the folder right now?
      const found = await collectFiles(token, sr.folderId, shoot.title);
      report.shootsScanned++;

      const known = new Map((filesByShoot.get(shoot.id) ?? []).map((f) => [f.drive_file_id, f]));
      const assets = assetsByShoot.get(shoot.id) ?? [];
      const linkedAssetIds = new Set(
        [...(filesByShoot.get(shoot.id) ?? [])].map((f) => f.asset_id).filter((v): v is string => !!v),
      );
      // Existing carousel grouping: parent folder -> the carousel it delivered.
      const carouselByFolder = new Map<string, string>();
      for (const f of filesByShoot.get(shoot.id) ?? []) {
        if (f.asset_id && f.parent_folder_id && f.mime_type?.startsWith('image/')) {
          carouselByFolder.set(f.parent_folder_id, f.asset_id);
        }
      }

      const live = cards.byContractor.get(shoot.contractor_id) ?? cards.def;
      const card = shoot.card_snapshot ? cardFromSnapshot(shoot.card_snapshot, live) : live;

      // Refresh files we already knew about.
      const seenIds = new Set<string>();
      const now = new Date().toISOString();
      for (const f of found) {
        const k = known.get(f.id);
        if (!k) continue;
        seenIds.add(f.id);
        const patch: Record<string, unknown> = { last_seen_at: now };
        if (k.name !== f.name) patch.name = f.name;
        if (k.trashed_at) patch.trashed_at = null; // it's back
        await db.from('creative_drive_files').update(patch).eq('id', k.id);
      }

      // One reconcile queue: fresh files PLUS known files that never became
      // assets (they arrived past a full quota, or a previous run died
      // mid-link) and are still present in the folder — so a cleanup or a
      // freed slot picks them up on the next pass instead of never.
      type Cand = {
        rowId: string | null; // existing creative_drive_files.id, null = fresh
        driveId: string;
        name: string;
        mime: string;
        createdTime: string | null;
        duration: number | null;
        parentFolderId: string | null;
        parentFolderName: string | null;
        webViewLink: string | null;
        size: number | null;
      };
      const cands: Cand[] = [
        ...found
          .filter((f) => !known.has(f.id))
          .map((f) => ({
            rowId: null,
            driveId: f.id,
            name: f.name,
            mime: f.mimeType,
            createdTime: f.createdTime ?? null,
            duration: fileDuration(f),
            parentFolderId: f.parentFolderId,
            parentFolderName: f.parentFolderName,
            webViewLink: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
            size: Number(f.size) || null,
          })),
        ...(filesByShoot.get(shoot.id) ?? [])
          .filter((r) => !r.asset_id && !r.trashed_at && seenIds.has(r.drive_file_id) && !!r.mime_type)
          .map((r) => ({
            rowId: r.id,
            driveId: r.drive_file_id,
            name: r.name,
            mime: r.mime_type!,
            createdTime: r.drive_created_at,
            duration: r.duration_seconds,
            parentFolderId: r.parent_folder_id,
            parentFolderName: r.parent_folder_name ?? shoot.title,
            webViewLink: r.web_view_link,
            size: r.size_bytes,
          })),
      ].sort((a, b) => {
        // Finished deliverables are named like finals ("StayCapeAnn_Reel_2");
        // log those before raw takes, then oldest upload first.
        const ar = norm(a.name).includes('reel') ? 0 : 1;
        const br = norm(b.name).includes('reel') ? 0 : 1;
        if (ar !== br) return ar - br;
        return (a.createdTime ?? '') < (b.createdTime ?? '') ? -1 : 1;
      });

      const freeReels = assets.filter((a) => a.kind === 'reel' && !linkedAssetIds.has(a.id));
      const freeCarousels = assets.filter((a) => a.kind === 'carousel' && !linkedAssetIds.has(a.id));
      const reelCount = () => assets.filter((a) => a.kind === 'reel').length;
      const carouselCount = () => assets.filter((a) => a.kind === 'carousel').length;
      // Quotas count QUALIFYING reels (long enough, or length unknown) so a
      // pile of short takes can't use up the slots a finished reel needs.
      const qualifiesDur = (d: number | null) => d == null || d >= card.minSeconds;
      const qualifyingReels = () => assets.filter((a) => a.kind === 'reel' && qualifiesDur(a.duration_seconds)).length;
      const addNote = (msg: string) => { sr.note = sr.note ?? msg; };
      let assetTouches = 0;

      for (const f of cands) {
        const kind = f.mime.startsWith('video/') ? 'reel' : f.mime.startsWith('image/') ? 'image' : 'other';

        let rowId = f.rowId;
        if (!rowId) {
          // Claim the fresh file first (unique drive_file_id) — if another run
          // beat us to it, skip entirely so nothing is ever double-logged.
          const { data: claimed } = await db
            .from('creative_drive_files')
            .upsert(
              {
                shoot_id: shoot.id,
                drive_file_id: f.driveId,
                name: f.name,
                mime_type: f.mime,
                size_bytes: f.size,
                duration_seconds: f.duration,
                parent_folder_id: f.parentFolderId,
                parent_folder_name: f.parentFolderName,
                web_view_link: f.webViewLink,
                drive_created_at: f.createdTime,
              },
              { onConflict: 'drive_file_id', ignoreDuplicates: true },
            )
            .select('id')
            .maybeSingle();
          if (!claimed) continue;
          rowId = claimed.id;
          sr.newFiles++;
          report.newFiles++;
        }

        let assetId: string | null = null;
        if (kind === 'reel') {
          const existing = freeReels.shift();
          if (existing) {
            assetId = existing.id;
            sr.linkedToExisting++;
            // Fill delivery evidence on the existing row — never on a paid or
            // locked asset, so committed money can't be re-qualified.
            if (!existing.base_paid_at && !existing.views_locked_at) {
              const patch: Record<string, unknown> = { updated_at: now };
              if (!existing.submitted_by_contractor_at) patch.submitted_by_contractor_at = f.createdTime ?? now;
              if (existing.duration_seconds == null && f.duration != null) patch.duration_seconds = f.duration;
              await db.from('creative_assets').update(patch).eq('id', existing.id).is('views_locked_at', null);
            }
          } else if (
            // A qualifying video gets a slot while qualifying reels are under
            // the cap (+1 spare for judgment calls); a short take only gets one
            // when it's the sole video (so a real short delivery still surfaces
            // for the office's "count it anyway" override).
            qualifiesDur(f.duration) ? qualifyingReels() < card.maxPerShoot + 1 : reelCount() === 0
          ) {
            const { data: created } = await db
              .from('creative_assets')
              .insert({
                shoot_id: shoot.id,
                kind: 'reel',
                title: titleFromFilename(f.name),
                platform: 'instagram',
                duration_seconds: f.duration,
                submitted_by_contractor_at: f.createdTime ?? now,
              })
              .select('id, shoot_id, kind, title, duration_seconds, base_paid_at, views_locked_at, submitted_by_contractor_at, created_at')
              .single();
            if (created) {
              assets.push(created as AssetLite);
              assetId = (created as AssetLite).id;
              sr.createdReels++;
              report.assetsCreated++;
            }
          } else {
            addNote(
              qualifiesDur(f.duration)
                ? `more qualifying videos than the card's ${card.maxPerShoot}-reel cap — extras recorded, not logged`
                : `short clips under ${card.minSeconds}s recorded, not logged`,
            );
          }
        } else if (kind === 'image') {
          const grouped = f.parentFolderId ? carouselByFolder.get(f.parentFolderId) : undefined;
          if (grouped) {
            assetId = grouped;
          } else {
            const existing = freeCarousels.shift();
            if (existing) {
              assetId = existing.id;
              sr.linkedToExisting++;
              if (!existing.base_paid_at && !existing.views_locked_at && !existing.submitted_by_contractor_at) {
                await db
                  .from('creative_assets')
                  .update({ submitted_by_contractor_at: f.createdTime ?? now, updated_at: now })
                  .eq('id', existing.id)
                  .is('views_locked_at', null);
              }
            } else if (carouselCount() < card.maxCarouselsPerShoot + 1) {
              const { data: created } = await db
                .from('creative_assets')
                .insert({
                  shoot_id: shoot.id,
                  kind: 'carousel',
                  title: f.parentFolderName && norm(f.parentFolderName) !== norm(shoot.title) ? f.parentFolderName.slice(0, 200) : 'Carousel',
                  platform: 'instagram',
                  submitted_by_contractor_at: f.createdTime ?? now,
                })
                .select('id, shoot_id, kind, title, duration_seconds, base_paid_at, views_locked_at, submitted_by_contractor_at, created_at')
                .single();
              if (created) {
                assets.push(created as AssetLite);
                assetId = (created as AssetLite).id;
                sr.createdCarousels++;
                report.assetsCreated++;
              }
            }
            if (assetId && f.parentFolderId) carouselByFolder.set(f.parentFolderId, assetId);
          }
        } else if (!f.rowId) {
          sr.otherFiles++;
        }

        if (assetId) {
          linkedAssetIds.add(assetId);
          assetTouches++;
          await db.from('creative_drive_files').update({ asset_id: assetId }).eq('id', rowId);
        }
      }

      // Files that vanished from the folder: mark, keep the asset + pay records.
      for (const [driveId, row] of known) {
        if (!seenIds.has(driveId) && !row.trashed_at) {
          await db.from('creative_drive_files').update({ trashed_at: now }).eq('id', row.id);
          sr.removedFiles++;
        }
      }

      // 3. Stamp the scan; new files or newly logged/linked assets = a
      // delivery moment (recovery can log an asset with zero fresh files).
      const delivered = sr.newFiles > 0 || assetTouches > 0;
      const shootPatch: Record<string, unknown> = { drive_synced_at: now, updated_at: now };
      if (delivered) shootPatch.drive_delivered_at = now;
      if (delivered && assets.length > 0 && (shoot.status === 'scheduled' || shoot.status === 'shot')) {
        shootPatch.status = 'delivered';
      }
      await db.from('creative_shoots').update(shootPatch).eq('id', shoot.id).neq('status', 'cancelled');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sr.note = msg.includes('404') || msg.includes('403')
        ? `Drive folder not reachable — share it (or the Shared Drive) with ${saEmail}`
        : msg.slice(0, 200);
      report.errors.push(`${shoot.title}: ${sr.note}`);
    }
  }

  report.ok = report.errors.length === 0;
  return report;
}
