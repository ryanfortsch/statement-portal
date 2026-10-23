/**
 * One Drive folder per home, one finals folder per shoot (Dotti, 2026-10-23):
 *
 *   Creative Assets - Cooper / 7 Sumac / DRONE
 *                                      / Finals - Oct 1
 *                                      / Finals - Oct 22
 *
 * A second shoot at a home moves into the home's folder, gets its own dated
 * finals folder, shares the DRONE box, and never reads the first shoot's
 * finals as its own files.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  finalsFolderName,
  homeFolderFromEarlierShoot,
  isDumpFolder,
  isOtherShootsFinals,
  pickFinalsFolder,
  type ShootFolderPin,
} from '../creative-drive-layout.ts';

const first: ShootFolderPin = {
  id: 'shoot-oct-1',
  contractor_id: 'cooper',
  property_id: '7_sumac',
  shoot_date: '2026-10-01',
  drive_folder_id: 'sumac-home',
};

test('finals folders are named for the shoot date', () => {
  assert.equal(finalsFolderName('2026-10-22'), 'Finals - Oct 22');
  assert.equal(finalsFolderName('2026-10-01'), 'Finals - Oct 1');
  assert.equal(finalsFolderName('not a date'), 'Finals - not a date');
});

test('a second shoot at the same home moves into the home folder', () => {
  const second = { id: 'shoot-oct-22', contractor_id: 'cooper', property_id: '7_sumac' };
  assert.equal(homeFolderFromEarlierShoot(second, [first]), 'sumac-home');
});

test('another home or another contributor never lends its folder', () => {
  assert.equal(
    homeFolderFromEarlierShoot({ id: 'x', contractor_id: 'cooper', property_id: '21_horton' }, [first]),
    null,
  );
  assert.equal(
    homeFolderFromEarlierShoot({ id: 'x', contractor_id: 'someone-else', property_id: '7_sumac' }, [first]),
    null,
  );
  assert.equal(homeFolderFromEarlierShoot({ id: 'x', contractor_id: 'cooper', property_id: null }, [first]), null);
});

test('the latest earlier shoot at the home wins', () => {
  const older = { ...first, id: 'old', shoot_date: '2026-08-01', drive_folder_id: 'old-home' };
  const second = { id: 'shoot-oct-22', contractor_id: 'cooper', property_id: '7_sumac' };
  assert.equal(homeFolderFromEarlierShoot(second, [older, first]), 'sumac-home');
});

test('the second shoot takes the finals folder named for its date, not the first shoot\'s', () => {
  const kids = [
    { id: 'drone', name: 'DRONE' },
    { id: 'f1', name: 'Finals - Oct 1' },
    { id: 'f22', name: 'Finals - Oct 22' },
  ];
  assert.equal(pickFinalsFolder(kids, '2026-10-22', new Set(['f1'])), 'f22');
  // Even when the first shoot's finals is not yet pinned, the dated one wins.
  assert.equal(pickFinalsFolder(kids, '2026-10-22', new Set()), 'f22');
});

test('a hand-made finals folder no shoot has claimed is taken', () => {
  const kids = [
    { id: 'f1', name: 'Finals - Oct 1' },
    { id: 'mine', name: 'Finals' },
  ];
  assert.equal(pickFinalsFolder(kids, '2026-10-22', new Set(['f1'])), 'mine');
});

test('a claimed finals folder is never shared; none free means create one', () => {
  const kids = [{ id: 'f1', name: 'Finals - Oct 1' }];
  assert.equal(pickFinalsFolder(kids, '2026-10-22', new Set(['f1'])), null);
  // Two free and neither dated: make the dated one rather than guess.
  const two = [
    { id: 'a', name: 'Finals - Sep 3' },
    { id: 'b', name: 'Finals - Sep 9' },
  ];
  assert.equal(pickFinalsFolder(two, '2026-10-22', new Set()), null);
});

test('a scan skips another shoot\'s finals in the home folder, and only there', () => {
  assert.equal(isOtherShootsFinals({ id: 'f1', name: 'Finals - Oct 1' }, true, 'f22'), true);
  assert.equal(isOtherShootsFinals({ id: 'f22', name: 'Finals - Oct 22' }, true, 'f22'), false);
  assert.equal(isOtherShootsFinals({ id: 'r1', name: 'Reel 1' }, true, 'f22'), false);
  // A subfolder inside this shoot's finals is never another shoot's finals.
  assert.equal(isOtherShootsFinals({ id: 'x', name: 'Finals cut' }, false, 'f22'), false);
});

test('the DRONE box is a dump; a drone reel is a deliverable', () => {
  assert.equal(isDumpFolder('DRONE'), true);
  assert.equal(isDumpFolder('Drone reel'), false);
  assert.equal(isDumpFolder('Finals - Oct 22'), false);
});

test('the watcher makes the DRONE box in the home folder, not inside finals', () => {
  const src = readFileSync(new URL('../creative-drive.ts', import.meta.url), 'utf8');
  assert.match(src, /createFolder\(token, DRONE_BOX_NAME, sr\.folderId\)/);
  assert.doesNotMatch(src, /createFolder\(token, DRONE_BOX_NAME, sr\.finalsFolderId\)/);
  assert.match(src, /isOtherShootsFinals\(c, folder\.id === rootId, finalsId\)/);
  assert.match(src, /homeFolderFromEarlierShoot\(shoot, pins\)/);
});
