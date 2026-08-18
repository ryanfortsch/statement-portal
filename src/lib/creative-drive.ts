/**
 * Drive delivery watcher for the Creative module.
 *
 * A contributor delivers by dropping files into their Drive folder:
 * "Creative Assets - <first name>" at the top, one subfolder per shoot (named
 * like the property: "4 Brier Neck"). Inside each shoot folder Helm CREATES a
 * dated finals folder ("Finals - Jul 27") — the deliver-to box.
 *
 * The pay gate: a shoot is worth $0 until the FULL package per its rate card
 * (maxPerShoot qualifying reels + maxCarouselsPerShoot carousels) is in the
 * finals folder. Completing the set is the trigger — the sync materializes the
 * assets in one pass and the whole delivery base goes due on the board at
 * once. Anything outside the finals folder (raw takes, sidecars) is recorded
 * as evidence but never becomes an asset, and partial deliveries show progress
 * ("1 of 2 reels in"), not money.
 *
 * Classification inside finals: video/* = a reel (30s+ qualifies, from Drive
 * metadata); image/* files sharing one immediate parent = one carousel.
 * Reels group like carousels do: videos inside one subfolder of finals — or
 * loose ones whose names differ only by version wording ("no music") — are
 * VERSIONS of one reel, one asset, one base. Folders named like raw/b-roll
 * are skipped everywhere.
 *
 * Money safety: this file never pays anything, and never deletes or edits a
 * paid, posted, viewed, or view-locked asset. The only assets it removes are
 * ones it created itself that no human has touched, when the package gate
 * says they shouldn't exist yet. Paying stays a human click.
 *
 * Auth: the same service-account token as drive-archive.ts (full drive scope —
 * it creates the finals folders). The account needs Contributor on the talent
 * folder.
 */
import 'server-only';
import { fieldDb } from './field-db';
import { getGoogleAccessToken } from './marketing/auth';
import { loadRateCards, type RateCard } from './creative-rates';
import { cardFromSnapshot } from './creative-pay';
import type { ShootRow } from './creative-shoots';

const SCOPE = 'https://www.googleapis.com/auth/drive';
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
  in_finals: boolean;
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
  finalsFolderId: string | null;
  packageComplete: boolean | null; // null = legacy mode (paid assets exist)
  newFiles: number;
  linkedToExisting: number;
  createdReels: number;
  createdCarousels: number;
  removedAssets: number;
  otherFiles: number;
  removedFiles: number;
  note: string | null;
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

/** Create a folder under parentId. Returns its id. */
async function createFolder(token: string, name: string, parentId: string): Promise<string> {
  const res = await fetch(`${API}/files?supportsAllDrives=true&fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  if (!res.ok) throw new Error(`Drive folder create failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

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
  return { id: null, note: null };
}

/** "Finals - Jul 27" from the shoot date — the deliver-to folder's name. */
function finalsFolderName(shootDate: string): string {
  try {
    const label = new Date(`${shootDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `Finals - ${label}`;
  } catch {
    return `Finals - ${shootDate}`;
  }
}

// ── Loaders + shared math for the board and shoot page ──────────────────

export async function loadShootDriveFiles(shootId: string): Promise<DriveFileRow[]> {
  const { data } = await fieldDb()
    .from('creative_drive_files')
    .select('*')
    .eq('shoot_id', shootId)
    .order('drive_created_at', { ascending: true });
  return (data ?? []) as DriveFileRow[];
}

/** All shoots' Drive file rows in one query, for the board's meta chips. */
export async function loadDriveFilesByShoots(shootIds: string[]): Promise<Map<string, DriveFileRow[]>> {
  const map = new Map<string, DriveFileRow[]>();
  if (shootIds.length === 0) return map;
  const { data } = await fieldDb().from('creative_drive_files').select('*').in('shoot_id', shootIds);
  for (const row of (data ?? []) as DriveFileRow[]) {
    const arr = map.get(row.shoot_id) ?? [];
    arr.push(row);
    map.set(row.shoot_id, arr);
  }
  return map;
}

const isQualifyingDuration = (card: RateCard, d: number | null) => d == null || d >= card.minSeconds;

/** Filename without its extension, in the matching alphabet. */
const bareName = (name: string) => norm(name.replace(/\.[A-Za-z0-9]{2,5}$/, ''));

/** A filename's deliverable name: extension off, version wording removed —
 *  "84 Thatcher Reel 1 No Music.mp4" and "84 Thatcher Reel 1.mp4" both come
 *  out "84 thatcher reel 1", so they read as ONE reel. */
export function versionlessName(name: string): string {
  // "Reel.mp4" re-uploaded becomes "Reel (1).mp4" — Drive's duplicate marker,
  // stripped before norm() dissolves the parens. Human numbering ("Reel 1")
  // has no parens and is untouched.
  return bareName(name.replace(/\s*\(\d+\)(?=\.[A-Za-z0-9]{2,5}$|$)/, ''))
    .replace(/\b(?:no|without|with|w|wo)\s+(?:music|audio|sound|vocals?|voiceover)\b/g, ' ')
    .replace(/\b(?:music|audio|sound)\s+(?:version|cut|mix|only)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A finals video's deliverable identity. The contributor delivers a reel's
 *  versions together — either in one subfolder of finals ("Reel 1", the same
 *  convention the carousel photo grouping already uses) or loose with version
 *  suffixes. Same key = same reel = one asset, one base, one slot in the
 *  package gate. */
export function reelGroupKey(
  f: { parent_folder_id: string | null; name: string },
  finalsFolderId: string | null,
): string {
  if (f.parent_folder_id && f.parent_folder_id !== finalsFolderId) return `folder:${f.parent_folder_id}`;
  return `name:${versionlessName(f.name)}`;
}

/** Package progress from the finals folder's files: how many card-qualifying
 *  reels and carousel photo sets are in, and whether the set is complete —
 *  the single formula the sync gate, the board chip, and the shoot page share.
 *  finalsFolderId is required so version GROUPS resolve the same way here as
 *  in the sync: a music + no-music pair is one reel, never two. */
export function finalsProgress(card: RateCard, files: DriveFileRow[], finalsFolderId: string | null): {
  reelsIn: number;
  reelsNeed: number;
  carouselsIn: number;
  carouselsNeed: number;
  complete: boolean;
} {
  const finals = files.filter((f) => f.in_finals && !f.trashed_at);
  // One reel = one deliverable GROUP of videos; it qualifies if any version
  // runs long enough (the cuts can differ by a few seconds).
  const reelGroups = new Map<string, DriveFileRow[]>();
  for (const f of finals) {
    if (!f.mime_type?.startsWith('video/')) continue;
    const k = reelGroupKey(f, finalsFolderId);
    reelGroups.set(k, [...(reelGroups.get(k) ?? []), f]);
  }
  const reelsIn = [...reelGroups.values()].filter((g) =>
    g.some((f) => isQualifyingDuration(card, f.duration_seconds)),
  ).length;
  const groups = new Set(
    finals.filter((f) => f.mime_type?.startsWith('image/')).map((f) => f.parent_folder_id ?? 'loose'),
  ).size;
  const reelsNeed = card.maxPerShoot;
  const carouselsNeed = card.maxCarouselsPerShoot;
  return {
    reelsIn,
    reelsNeed,
    carouselsIn: groups,
    carouselsNeed,
    complete: reelsIn >= reelsNeed && groups >= carouselsNeed,
  };
}

/** "2 of 2 reels + carousel in" / "1 of 2 reels in · waiting on carousel". */
export function finalsProgressLabel(p: ReturnType<typeof finalsProgress>): string {
  const reels = `${Math.min(p.reelsIn, p.reelsNeed)} of ${p.reelsNeed} reel${p.reelsNeed === 1 ? '' : 's'}`;
  if (p.carouselsNeed === 0) return `${reels} in`;
  const car = p.carouselsIn >= p.carouselsNeed ? 'carousel in' : 'waiting on carousel photos';
  return `${reels} in · ${car}`;
}

// ── The sync ────────────────────────────────────────────────────────────

type AssetLite = {
  id: string;
  shoot_id: string;
  kind: 'reel' | 'carousel';
  title: string | null;
  duration_seconds: number | null;
  base_paid_at: string | null;
  topup_paid_at?: string | null;
  views_locked_at: string | null;
  posted_at?: string | null;
  views?: number | null;
  submitted_by_contractor_at: string | null;
  created_at: string;
};

const ASSET_SELECT =
  'id, shoot_id, kind, title, duration_seconds, base_paid_at, topup_paid_at, views_locked_at, posted_at, views, submitted_by_contractor_at, created_at';

function titleFromFilename(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || name.slice(0, 200);
}

function fileDuration(f: DriveFile): number | null {
  const ms = Number(f.videoMediaMetadata?.durationMillis);
  return Number.isFinite(ms) && ms > 0 ? Math.max(1, Math.round(ms / 1000)) : null;
}

type FoundFile = DriveFile & { parentFolderId: string; parentFolderName: string; inFinals: boolean };

/** Every non-folder file under rootId, up to 3 folder levels deep, tagged with
 *  whether it sits inside the finals subtree. Folders named like raw footage
 *  dumps are skipped so they can't spawn phantom reels. */
async function collectFiles(
  token: string,
  rootId: string,
  rootName: string,
  finalsId: string | null,
): Promise<FoundFile[]> {
  const out: FoundFile[] = [];
  let frontier = [{ id: rootId, name: rootName, depth: 0, inFinals: rootId === finalsId }];
  while (frontier.length > 0) {
    const next: typeof frontier = [];
    for (const folder of frontier) {
      const children = await listChildren(token, folder.id);
      for (const c of children) {
        if (c.mimeType === FOLDER_MIME) {
          const n = norm(c.name);
          // Outside finals, "drone" folders are dumps too (Dotti parks the DJI
          // masters there) — but inside finals a folder may NAME a deliverable
          // ("Drone reel"), so the drone skip never applies there.
          const insideFinals = folder.inFinals || c.id === finalsId;
          const isDump = n.includes('raw') || n.includes('b roll') || n.includes('broll') || (!insideFinals && n.includes('drone'));
          if (folder.depth < 3 && !isDump) {
            next.push({ id: c.id, name: c.name, depth: folder.depth + 1, inFinals: insideFinals });
          }
        } else {
          out.push({ ...c, parentFolderId: folder.id, parentFolderName: folder.name, inFinals: folder.inFinals });
        }
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * Scan every open shoot's Drive folder, keep creative_drive_files mirrored,
 * and apply the package gate: materialize assets (and put the delivery base
 * due) only once the finals folder holds the full rate-card set. Idempotent
 * and crash-safe: a file row is claimed (unique drive_file_id) before any
 * asset is created for it, so re-runs and double-clicks can never double-log.
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
    db.from('creative_assets').select(ASSET_SELECT).in('shoot_id', shootIds).order('created_at', { ascending: true }),
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
      finalsFolderId: shoot.drive_finals_folder_id,
      packageComplete: null,
      newFiles: 0,
      linkedToExisting: 0,
      createdReels: 0,
      createdCarousels: 0,
      removedAssets: 0,
      otherFiles: 0,
      removedFiles: 0,
      note: null,
    };
    report.shoots.push(sr);
    const addNote = (msg: string) => { sr.note = sr.note ?? msg; };

    try {
      const contractor = contractors.get(shoot.contractor_id);
      const assets = assetsByShoot.get(shoot.id) ?? [];
      const anyPaid = assets.some((a) => a.base_paid_at || a.topup_paid_at);
      const live = cards.byContractor.get(shoot.contractor_id) ?? cards.def;
      const card = shoot.card_snapshot ? cardFromSnapshot(shoot.card_snapshot, live) : live;

      // 1. Resolve the shoot's folder (pinned > auto-match > create by name).
      if (!sr.folderId) {
        if (!contractor) {
          addNote('contributor not found');
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
          addNote(`no "Creative Assets - ${contractor.full_name.split(' ')[0]}" folder visible — share it with ${saEmail}`);
          continue;
        }
        if (!rootFolders.has(rootId)) {
          rootFolders.set(rootId, (await listChildren(token, rootId)).filter((f) => f.mimeType === FOLDER_MIME));
        }
        const propertyName = shoot.property_id ? propNames.get(shoot.property_id) ?? null : null;
        const match = matchShootFolder(shoot, propertyName, rootFolders.get(rootId)!, taken);
        if (match.id) {
          sr.folderId = match.id;
        } else if (match.note) {
          addNote(match.note); // ambiguous — don't guess, don't create a twin
          continue;
        } else {
          // No folder yet — create one named like the property (the same name
          // the matcher looks for), so the structure exists before the shoot.
          sr.folderId = await createFolder(token, (propertyName ?? shoot.title).slice(0, 100), rootId);
        }
        taken.add(sr.folderId);
        await db.from('creative_shoots').update({ drive_folder_id: sr.folderId, updated_at: new Date().toISOString() }).eq('id', shoot.id);
      }

      // 2. Ensure the dated finals folder — the deliver-to box — exists inside.
      if (!sr.finalsFolderId) {
        const kids = (await listChildren(token, sr.folderId)).filter((f) => f.mimeType === FOLDER_MIME);
        const existing = kids.find((f) => norm(f.name).startsWith('finals'));
        sr.finalsFolderId = existing?.id ?? (await createFolder(token, finalsFolderName(shoot.shoot_date), sr.folderId));
        await db
          .from('creative_shoots')
          .update({ drive_finals_folder_id: sr.finalsFolderId, updated_at: new Date().toISOString() })
          .eq('id', shoot.id);
      }

      // 3. What's in the folder right now?
      const found = await collectFiles(token, sr.folderId, shoot.title, sr.finalsFolderId);
      report.shootsScanned++;

      const known = new Map((filesByShoot.get(shoot.id) ?? []).map((f) => [f.drive_file_id, f]));
      const now = new Date().toISOString();
      const seenIds = new Set<string>();

      // Refresh known rows (files move INTO finals — track parent + flag) and
      // claim fresh ones (unique drive_file_id: if another run beat us to one,
      // it's skipped so nothing double-logs).
      type FileState = {
        rowId: string;
        driveId: string;
        name: string;
        mime: string | null;
        createdTime: string | null;
        duration: number | null;
        parentFolderId: string | null;
        parentFolderName: string | null;
        inFinals: boolean;
        assetId: string | null;
      };
      const states: FileState[] = [];

      for (const f of found) {
        const k = known.get(f.id);
        const dur = fileDuration(f);
        if (k) {
          seenIds.add(f.id);
          const patch: Record<string, unknown> = { last_seen_at: now };
          if (k.name !== f.name) patch.name = f.name;
          if (k.trashed_at) patch.trashed_at = null; // it's back
          if (k.parent_folder_id !== f.parentFolderId) {
            patch.parent_folder_id = f.parentFolderId;
            patch.parent_folder_name = f.parentFolderName;
          }
          if (k.in_finals !== f.inFinals) patch.in_finals = f.inFinals;
          if (k.duration_seconds == null && dur != null) patch.duration_seconds = dur;
          await db.from('creative_drive_files').update(patch).eq('id', k.id);
          states.push({
            rowId: k.id,
            driveId: f.id,
            name: f.name,
            mime: f.mimeType,
            createdTime: k.drive_created_at,
            duration: k.duration_seconds ?? dur,
            parentFolderId: f.parentFolderId,
            parentFolderName: f.parentFolderName,
            inFinals: f.inFinals,
            assetId: k.asset_id,
          });
        } else {
          const { data: claimed } = await db
            .from('creative_drive_files')
            .upsert(
              {
                shoot_id: shoot.id,
                drive_file_id: f.id,
                name: f.name,
                mime_type: f.mimeType,
                size_bytes: Number(f.size) || null,
                duration_seconds: dur,
                parent_folder_id: f.parentFolderId,
                parent_folder_name: f.parentFolderName,
                in_finals: f.inFinals,
                web_view_link: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
                drive_created_at: f.createdTime ?? null,
              },
              { onConflict: 'drive_file_id', ignoreDuplicates: true },
            )
            .select('id')
            .maybeSingle();
          if (!claimed) continue;
          sr.newFiles++;
          report.newFiles++;
          if (!f.mimeType.startsWith('video/') && !f.mimeType.startsWith('image/')) sr.otherFiles++;
          states.push({
            rowId: claimed.id,
            driveId: f.id,
            name: f.name,
            mime: f.mimeType,
            createdTime: f.createdTime ?? null,
            duration: dur,
            parentFolderId: f.parentFolderId,
            parentFolderName: f.parentFolderName,
            inFinals: f.inFinals,
            assetId: null,
          });
        }
      }

      // 4. The package gate.
      const rowsForProgress: DriveFileRow[] = states.map((s) => ({
        id: s.rowId,
        shoot_id: shoot.id,
        asset_id: s.assetId,
        drive_file_id: s.driveId,
        name: s.name,
        mime_type: s.mime,
        size_bytes: null,
        duration_seconds: s.duration,
        parent_folder_id: s.parentFolderId,
        parent_folder_name: s.parentFolderName,
        in_finals: s.inFinals,
        web_view_link: null,
        drive_created_at: s.createdTime,
        first_seen_at: now,
        last_seen_at: now,
        trashed_at: null,
      }));
      const progress = finalsProgress(card, rowsForProgress, sr.finalsFolderId);
      let assetTouches = 0;

      if (anyPaid) {
        // Legacy mode (money already moved): files are evidence only. Link
        // unlinked ones onto existing free assets of the same kind; never
        // create or remove anything.
        const linked = new Set(states.map((s) => s.assetId).filter((v): v is string => !!v));
        const freeOf = (kind: 'reel' | 'carousel') => assets.filter((a) => a.kind === kind && !linked.has(a.id));
        // A reel's versions (music / no-music) share one asset: remember which
        // asset each video group claimed so the pair can't soak up two.
        const reelAssetByGroup = new Map<string, string>();
        for (const s of states) {
          if (s.assetId && s.mime?.startsWith('video/')) {
            reelAssetByGroup.set(reelGroupKey({ parent_folder_id: s.parentFolderId, name: s.name }, sr.finalsFolderId), s.assetId);
          }
        }
        for (const s of states) {
          if (s.assetId || !s.mime) continue;
          const kind = s.mime.startsWith('video/') ? 'reel' : s.mime.startsWith('image/') ? 'carousel' : null;
          if (!kind) continue;
          const groupKey = kind === 'reel' ? reelGroupKey({ parent_folder_id: s.parentFolderId, name: s.name }, sr.finalsFolderId) : null;
          const grouped = groupKey ? reelAssetByGroup.get(groupKey) : undefined;
          const free = grouped ? null : freeOf(kind)[0];
          const assetId = grouped ?? free?.id;
          if (!assetId) continue;
          linked.add(assetId);
          s.assetId = assetId;
          if (groupKey) reelAssetByGroup.set(groupKey, assetId);
          if (!grouped) sr.linkedToExisting++;
          await db.from('creative_drive_files').update({ asset_id: assetId }).eq('id', s.rowId);
        }
      } else if (!progress.complete) {
        sr.packageComplete = false;
        // $0 until the whole set is in. Undo anything the watcher previously
        // materialized that no human has touched (unpaid, unposted, unread,
        // unlocked, contributor-submitted, drive-linked) so nothing reads as
        // owed. Office-logged assets are never touched.
        const driveLinkedIds = new Set(
          (filesByShoot.get(shoot.id) ?? []).map((f) => f.asset_id).filter((v): v is string => !!v),
        );
        const removable = assets.filter(
          (a) =>
            driveLinkedIds.has(a.id) &&
            a.submitted_by_contractor_at &&
            !a.base_paid_at &&
            !a.topup_paid_at &&
            !a.views_locked_at &&
            !a.posted_at &&
            a.views == null,
        );
        if (removable.length > 0) {
          const ids = removable.map((a) => a.id);
          await db.from('creative_assets').delete().in('id', ids); // FK sets files' asset_id null
          sr.removedAssets = removable.length;
          assetsByShoot.set(shoot.id, assets.filter((a) => !ids.includes(a.id)));
        }
        addNote(`${finalsProgressLabel(progress)} — pay triggers when the full set is in the Finals folder`);
      } else {
        sr.packageComplete = true;
        // Full set present: materialize the package from the FINALS files in
        // one pass — this is the moment the delivery base goes due.
        const finalsFiles = states
          .filter((s) => s.inFinals && !!s.mime)
          .sort((a, b) => {
            const ar = norm(a.name).includes('reel') ? 0 : 1;
            const br = norm(b.name).includes('reel') ? 0 : 1;
            if (ar !== br) return ar - br;
            return (a.createdTime ?? '') < (b.createdTime ?? '') ? -1 : 1;
          });
        const linked = new Set(states.map((s) => s.assetId).filter((v): v is string => !!v));
        const freeReels = assets.filter((a) => a.kind === 'reel' && !linked.has(a.id));
        const freeCarousels = assets.filter((a) => a.kind === 'carousel' && !linked.has(a.id));
        const qualifyingReelAssets = () =>
          assets.filter((a) => a.kind === 'reel' && isQualifyingDuration(card, a.duration_seconds)).length;
        const carouselCount = () => assets.filter((a) => a.kind === 'carousel').length;
        const carouselByFolder = new Map<string, string>();
        for (const s of states) {
          if (s.assetId && s.parentFolderId && s.mime?.startsWith('image/')) carouselByFolder.set(s.parentFolderId, s.assetId);
        }

        // Videos first, as deliverable GROUPS: a reel's versions (the music +
        // no-music cuts, in one subfolder or name-suffixed) share ONE asset —
        // one base, one cap slot. The group qualifies if any version runs long
        // enough; the version without version wording (else the longest) names it.
        const videoGroups = new Map<string, FileState[]>();
        for (const s of finalsFiles) {
          if (!s.mime!.startsWith('video/')) continue;
          const k = reelGroupKey({ parent_folder_id: s.parentFolderId, name: s.name }, sr.finalsFolderId);
          videoGroups.set(k, [...(videoGroups.get(k) ?? []), s]);
        }
        for (const group of videoGroups.values()) {
          const dur = group.reduce<number | null>((m, s) => (s.duration != null && (m == null || s.duration > m) ? s.duration : m), null);
          let assetId: string | null = group.find((s) => s.assetId)?.assetId ?? null;
          if (!assetId) {
            if (!isQualifyingDuration(card, dur)) {
              addNote(`a finals video is under ${card.minSeconds}s — recorded, not logged`);
              continue;
            }
            const primary =
              group.find((s) => bareName(s.name) === versionlessName(s.name)) ??
              [...group].sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))[0];
            const submittedAt = group.map((s) => s.createdTime).filter((v): v is string => !!v).sort()[0] ?? now;
            const existing = freeReels.shift();
            if (existing) {
              assetId = existing.id;
              sr.linkedToExisting++;
              if (!existing.base_paid_at && !existing.views_locked_at) {
                const patch: Record<string, unknown> = { updated_at: now };
                if (!existing.submitted_by_contractor_at) patch.submitted_by_contractor_at = submittedAt;
                if (existing.duration_seconds == null && dur != null) patch.duration_seconds = dur;
                await db.from('creative_assets').update(patch).eq('id', existing.id).is('views_locked_at', null);
              }
            } else if (qualifyingReelAssets() < card.maxPerShoot + 1) {
              const { data: created } = await db
                .from('creative_assets')
                .insert({
                  shoot_id: shoot.id,
                  kind: 'reel',
                  title: titleFromFilename(primary.name),
                  platform: 'instagram',
                  duration_seconds: dur,
                  submitted_by_contractor_at: submittedAt,
                })
                .select(ASSET_SELECT)
                .single();
              if (created) {
                assets.push(created as AssetLite);
                assetId = (created as AssetLite).id;
                sr.createdReels++;
                report.assetsCreated++;
              }
            } else {
              addNote(`more finals reels than the card's ${card.maxPerShoot}-reel cap — extras recorded, not logged`);
            }
          }
          if (assetId) {
            linked.add(assetId);
            for (const s of group) {
              if (s.assetId) continue;
              s.assetId = assetId;
              assetTouches++;
              await db.from('creative_drive_files').update({ asset_id: assetId }).eq('id', s.rowId);
            }
          }
        }

        for (const s of finalsFiles) {
          if (s.assetId) continue;
          if (s.mime!.startsWith('video/')) continue; // reels handled above, as groups
          const kind = s.mime!.startsWith('image/') ? 'image' : 'other';
          let assetId: string | null = null;

          if (kind === 'image') {
            const groupKey = s.parentFolderId ?? 'loose';
            const grouped = carouselByFolder.get(groupKey);
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
                    .update({ submitted_by_contractor_at: s.createdTime ?? now, updated_at: now })
                    .eq('id', existing.id)
                    .is('views_locked_at', null);
                }
              } else if (carouselCount() < card.maxCarouselsPerShoot + 1) {
                const { data: created } = await db
                  .from('creative_assets')
                  .insert({
                    shoot_id: shoot.id,
                    kind: 'carousel',
                    title:
                      s.parentFolderName && norm(s.parentFolderName) !== norm(shoot.title) && !norm(s.parentFolderName).startsWith('finals')
                        ? s.parentFolderName.slice(0, 200)
                        : 'Carousel',
                    platform: 'instagram',
                    submitted_by_contractor_at: s.createdTime ?? now,
                  })
                  .select(ASSET_SELECT)
                  .single();
                if (created) {
                  assets.push(created as AssetLite);
                  assetId = (created as AssetLite).id;
                  sr.createdCarousels++;
                  report.assetsCreated++;
                }
              }
              if (assetId) carouselByFolder.set(groupKey, assetId);
            }
          }

          if (assetId) {
            linked.add(assetId);
            s.assetId = assetId;
            assetTouches++;
            await db.from('creative_drive_files').update({ asset_id: assetId }).eq('id', s.rowId);
          }
        }
      }

      // Files that vanished from the folder: mark, keep the asset + pay records.
      for (const [driveId, row] of known) {
        if (!seenIds.has(driveId) && !row.trashed_at) {
          await db.from('creative_drive_files').update({ trashed_at: now }).eq('id', row.id);
          sr.removedFiles++;
        }
      }

      // 5. Stamp the scan. Delivery = the completed package materializing.
      const shootPatch: Record<string, unknown> = { drive_synced_at: now, updated_at: now };
      if (sr.packageComplete && assetTouches > 0) {
        shootPatch.drive_delivered_at = now;
        if (shoot.status === 'scheduled' || shoot.status === 'shot') shootPatch.status = 'delivered';
      }
      if (sr.packageComplete === false) {
        // Incomplete again (e.g. the watcher's earlier partial logging was
        // undone): make sure the shoot doesn't still read as delivered.
        if (shoot.status === 'delivered' && !anyPaid) shootPatch.status = 'shot';
        if (shoot.drive_delivered_at && sr.removedAssets > 0) shootPatch.drive_delivered_at = null;
      }
      await db.from('creative_shoots').update(shootPatch).eq('id', shoot.id).neq('status', 'cancelled');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sr.note = msg.includes('404') || msg.includes('403')
        ? `Drive folder not reachable or not writable — give ${saEmail} Contributor access`
        : msg.slice(0, 200);
      report.errors.push(`${shoot.title}: ${sr.note}`);
    }
  }

  report.ok = report.errors.length === 0;
  return report;
}
