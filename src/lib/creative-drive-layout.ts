/**
 * The Drive folder layout for creative shoots, as pure rules.
 *
 * One folder per HOME inside the contributor's "Creative Assets - <name>",
 * shared by every shoot there. Each shoot gets its own dated finals folder
 * in it, and the home keeps one DRONE box beside them:
 *
 *   Creative Assets - Cooper / 7 Sumac / DRONE
 *                                      / Finals - Oct 1
 *                                      / Finals - Oct 22
 *
 * So a second shoot at a home reuses the home's folder rather than making a
 * twin, finds or makes its own finals folder by date, and never reads an
 * earlier shoot's finals as its own files. The Drive I/O lives in
 * creative-drive.ts; this file holds the decisions so they can be tested.
 */

/** Lowercase, alphanumerics + single spaces: the matching alphabet. */
export function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The name Helm gives the raw-footage box it creates in the home folder. */
export const DRONE_BOX_NAME = 'DRONE';

/** "Finals - Jul 27" from the shoot date: the deliver-to folder's name. */
export function finalsFolderName(shootDate: string): string {
  const d = new Date(`${shootDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return `Finals - ${shootDate}`;
  return `Finals - ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export const isFinalsFolderName = (name: string) => norm(name).startsWith('finals');

/** True for a folder that holds raw footage, never deliverables. Raw and
 *  b-roll dumps are skipped anywhere. A drone box is a dump anywhere too,
 *  finals included: that is where the DJI masters get parked, and a dump of
 *  clips sharing one folder would otherwise read as one delivered reel. A
 *  folder whose name says it IS a deliverable ("Drone reel") is not a dump. */
export function isDumpFolder(name: string): boolean {
  const n = norm(name);
  if (n.includes('raw') || n.includes('b roll') || n.includes('broll')) return true;
  return n.includes('drone') && !n.includes('reel') && !n.includes('carousel');
}

type Folder = { id: string; name: string };

/** This shoot's finals folder among the home folder's subfolders, or null to
 *  create one. The folder named for its date wins; else the one finals folder
 *  no other shoot has claimed (a folder made or renamed by hand). Two or more
 *  unclaimed and none named for the date: null, so Helm makes the dated one
 *  rather than guess. */
export function pickFinalsFolder(
  subfolders: Folder[],
  shootDate: string,
  claimedByOthers: ReadonlySet<string>,
): string | null {
  const open = subfolders.filter((f) => isFinalsFolderName(f.name) && !claimedByOthers.has(f.id));
  const want = norm(finalsFolderName(shootDate));
  const dated = open.find((f) => norm(f.name) === want);
  if (dated) return dated.id;
  return open.length === 1 ? open[0].id : null;
}

export type ShootFolderPin = {
  id: string;
  contractor_id: string;
  property_id: string | null;
  shoot_date: string;
  drive_folder_id: string | null;
};

/** The home folder an earlier shoot by the same contributor at the same home
 *  already uses, latest shoot first. A second shoot moves into it. */
export function homeFolderFromEarlierShoot(
  shoot: Pick<ShootFolderPin, 'id' | 'contractor_id' | 'property_id'>,
  others: ShootFolderPin[],
): string | null {
  if (!shoot.property_id) return null;
  const same = others
    .filter(
      (o) =>
        o.id !== shoot.id &&
        o.drive_folder_id &&
        o.contractor_id === shoot.contractor_id &&
        o.property_id === shoot.property_id,
    )
    .sort((a, b) => (a.shoot_date < b.shoot_date ? 1 : -1));
  return same[0]?.drive_folder_id ?? null;
}

/** A subfolder the shoot's scan must not walk for its own files: another
 *  shoot's finals folder sitting in the shared home folder. */
export function isOtherShootsFinals(
  folder: Folder,
  parentIsHome: boolean,
  finalsId: string | null,
): boolean {
  return parentIsHome && folder.id !== finalsId && isFinalsFolderName(folder.name);
}
