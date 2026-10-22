/**
 * Fraunces, Inter and JetBrains Mono are self-hosted (2026-10-22). Fetching
 * them from Google at build time through next/font/google was the one
 * recurring cause of failed production builds, so nothing may import it again.
 *
 * The faces are split across two files that must agree: the next/font/local
 * calls in src/app/layout.tsx declare the latin subset (the preloaded one),
 * and src/app/fonts/fonts.css declares every other subset, the fallback faces
 * and the three variables. Together they reproduce Google's rules exactly:
 * one face per weight for every subset, real family names, and variables
 * that name the family first. An edit to one file alone (a weight added to
 * latin but not the other subsets, a `variable:` option that would put the
 * const's name ahead of the family) changes rendering without failing the
 * build, so this test reads both. See src/app/fonts/README.md.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const fontsDir = join(repo, 'src/app/fonts');
const layout = readFileSync(join(repo, 'src/app/layout.tsx'), 'utf8');
const css = readFileSync(join(fontsDir, 'fonts.css'), 'utf8');

const FAMILIES = ['Fraunces', 'Inter', 'JetBrains Mono'];
const LICENSES: Record<string, string> = {
  Fraunces: 'OFL-Fraunces.txt',
  Inter: 'OFL-Inter.txt',
  'JetBrains Mono': 'OFL-JetBrainsMono.txt',
};

type Face = { family: string; file: string; style: string; weight: string; range: string };

/** The latin faces, from each localFont({ ... }) call in the layout. */
function latinFaces(): Face[] {
  const faces: Face[] = [];
  for (const call of layout.split('localFont({').slice(1)) {
    const body = call.slice(0, call.indexOf('\n});'));
    const family = /prop: "font-family", value: "([^"]+)"/.exec(body)?.[1];
    const range = /prop: "unicode-range",\s*value:\s*"([^"]+)"/.exec(body)?.[1];
    assert.ok(family, 'every localFont call declares its real family name');
    assert.ok(range, `${family}: the latin call declares its unicode range`);
    for (const m of body.matchAll(/\{ path: "\.\/fonts\/([^"]+)", weight: "(\d+)", style: "(\w+)" \}/g)) {
      faces.push({ family, file: m[1], weight: m[2], style: m[3], range });
    }
  }
  return faces;
}

/** Every @font-face in fonts.css that points at a file. */
function cssFaces(): Face[] {
  return [...css.matchAll(/@font-face \{([^}]*)\}/g)]
    .map(([, body]) => body)
    .filter((body) => body.includes('url('))
    .map((body) => ({
      family: /font-family: "([^"]+)"/.exec(body)![1],
      file: /url\("\.\/([^"]+)"\)/.exec(body)![1],
      style: /font-style: (\w+)/.exec(body)![1],
      weight: /font-weight: (\d+)/.exec(body)![1],
      range: /unicode-range: ([^;]+);/.exec(body)![1],
    }));
}

const key = (f: Face) => `${f.style} ${f.weight}`;

test('nothing imports next/font/google', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name) && /from ['"]next\/font\/google['"]/.test(readFileSync(path, 'utf8'))) {
        offenders.push(relative(repo, path));
      }
    }
  };
  walk(join(repo, 'src'));
  assert.deepEqual(offenders, [], 'next/font/google fetches from Google at build time; self-host instead');
});

test('every font file is a woff2 that exists, and every one is used', () => {
  const referenced = new Set([...latinFaces(), ...cssFaces()].map((f) => f.file));
  for (const file of referenced) {
    const path = join(fontsDir, file);
    assert.ok(existsSync(path), `${file} is referenced but missing`);
    assert.equal(readFileSync(path).subarray(0, 4).toString('latin1'), 'wOF2', `${file} is not woff2`);
  }
  const onDisk = readdirSync(fontsDir).filter((name) => name.endsWith('.woff2'));
  assert.deepEqual(onDisk.filter((name) => !referenced.has(name)), [], 'an unreferenced font file ships for nothing');
});

test('every subset of a family carries the same styles and weights as its latin subset', () => {
  const latin = latinFaces();
  const rest = cssFaces();
  for (const family of FAMILIES) {
    const latinKeys = latin.filter((f) => f.family === family).map(key).sort();
    assert.ok(latinKeys.length > 0, `${family}: no latin faces in layout.tsx`);
    const files = new Set(rest.filter((f) => f.family === family).map((f) => f.file));
    assert.ok(files.size > 0, `${family}: no other subsets in fonts.css`);
    for (const file of files) {
      const faces = rest.filter((f) => f.file === file);
      assert.ok(faces.every((f) => f.family === family), `${file} is declared under two families`);
      const style = faces[0].style;
      const want = latinKeys.filter((k) => k.startsWith(`${style} `));
      assert.deepEqual(faces.map(key).sort(), want, `${file}: weights differ from latin`);
      assert.equal(new Set(faces.map((f) => f.range)).size, 1, `${file}: one unicode range for every weight`);
    }
    for (const f of rest.filter((r) => r.family === family)) {
      assert.ok(!f.file.endsWith('-latin.woff2'), `${f.file}: latin belongs to layout.tsx, where it is preloaded`);
    }
  }
  const ranges = new Set(latin.map((f) => f.range));
  assert.equal(ranges.size, 1, 'the three latin calls declare the same unicode range');
});

test('the variables name the real family first, then its fallback face', () => {
  assert.doesNotMatch(layout, /\bvariable:/, 'next/font/local would write the const name as the first family');
  const vars: Record<string, string> = {
    '--font-fraunces': 'Fraunces',
    '--font-inter': 'Inter',
    '--font-mono-dash': 'JetBrains Mono',
  };
  for (const [name, family] of Object.entries(vars)) {
    assert.ok(css.includes(`${name}: "${family}", "${family} Fallback";`), `${name} must be "${family}", "${family} Fallback"`);
    const fallbacks = css.match(new RegExp(`font-family: "${family} Fallback"; src: local\\(`, 'g')) ?? [];
    assert.equal(fallbacks.length, 1, `${family}: exactly one fallback face`);
  }
});

test('each family ships with its license', () => {
  for (const family of FAMILIES) {
    const text = readFileSync(join(fontsDir, LICENSES[family]), 'utf8');
    assert.match(text, /SIL OPEN FONT LICENSE Version 1\.1/);
  }
});
