#!/usr/bin/env node
/**
 * One-time Perfection → Helm data importer.
 *
 * Reads Perfection table dumps (JSON exports from the Supabase dashboard)
 * out of this directory and emits an inserts.sql file that loads the
 * data into Helm's work_slips / tasks / task_comments tables, mapped to
 * Helm's property slugs and user emails.
 *
 * Run: node scripts/perfection-import/import.mjs
 *
 * See ./README.md for the export + apply steps. The script is purely a
 * SQL generator — it does NOT touch any database directly. Apply the
 * generated inserts.sql via supabase CLI or SQL Editor.
 *
 * Idempotency: every INSERT carries the original Perfection uuid in
 * legacy_perfection_id with an ON CONFLICT DO UPDATE clause, so re-
 * running this against an already-imported set updates rather than
 * duplicates.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = __dirname;
const outFile = path.join(dataDir, 'inserts.sql');

// ─── Read inputs ────────────────────────────────────────────────────
const required = ['properties.json', 'work_slips.json', 'tasks.json'];
for (const fname of required) {
  const p = path.join(dataDir, fname);
  if (!fs.existsSync(p)) {
    console.error(`missing required file: ${p}`);
    console.error('see ./README.md for how to export from Perfection.');
    process.exit(1);
  }
}

const perfProperties = readJson('properties.json');
const perfWorkSlips = readJson('work_slips.json');
const perfTasks = readJson('tasks.json');
const perfTaskComments = fs.existsSync(path.join(dataDir, 'task_comments.json'))
  ? readJson('task_comments.json')
  : [];
const userMap = fs.existsSync(path.join(dataDir, 'user-map.json'))
  ? readJson('user-map.json')
  : {};

// ─── Helm property slug map (hand-curated; mirrors src/lib/properties.ts) ─
// Perfection's properties.code is expected to match these slugs. Any
// Perfection property whose code falls outside this list won't be
// mapped and its work slips / tasks will be skipped with a warning.
const HELM_PROPERTY_SLUGS = new Set([
  '3_south_st',
  '21_horton',
  '53_rocky_neck',
  '4_brier_neck',
  '30_woodward',
  '20_hammond',
  '20_enon',
  '73_rocky_neck',
  '17_beach_rd',
  '3_locust',
]);

// ─── Build perfection-uuid → helm-slug map ───────────────────────────
const perfUuidToSlug = new Map();
const unmappedProps = [];
for (const p of perfProperties) {
  let slug = null;
  if (p.code && HELM_PROPERTY_SLUGS.has(p.code)) {
    slug = p.code;
  } else if (p.code) {
    // Heuristic: lowercase + spaces→underscore, strip punctuation.
    const norm = p.code.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    if (HELM_PROPERTY_SLUGS.has(norm)) slug = norm;
  }
  if (!slug && p.address) {
    const addrSlug = guessSlugFromAddress(p.address);
    if (addrSlug && HELM_PROPERTY_SLUGS.has(addrSlug)) slug = addrSlug;
  }
  if (slug) {
    perfUuidToSlug.set(p.id, slug);
  } else {
    unmappedProps.push(p);
  }
}

// ─── Collect unique user UUIDs so the operator can build user-map ────
const userIds = new Set();
for (const t of perfTasks) {
  if (t.created_by_user_id) userIds.add(t.created_by_user_id);
  if (t.assigned_to_user_id) userIds.add(t.assigned_to_user_id);
}
for (const c of perfTaskComments) {
  if (c.author_user_id) userIds.add(c.author_user_id);
}

// ─── Translate ───────────────────────────────────────────────────────
const PLACEHOLDER_EMAIL = 'imported@perfection.legacy';
function emailFor(uuid) {
  if (!uuid) return null;
  return userMap[uuid] || PLACEHOLDER_EMAIL;
}

// work_slips uses created_by TEXT in Perfection (free-form), so just
// pass it through; Helm stores in created_by_email.
function workSlipCreatedByEmail(raw) {
  if (!raw) return PLACEHOLDER_EMAIL;
  if (raw.includes('@')) return raw;
  // If Perfection stored "Ryan", "AL", etc., leave as label — Helm
  // schema requires email-shaped string. Fall back to placeholder
  // and stash the original in created_by_label later if Dotti wants.
  return PLACEHOLDER_EMAIL;
}

const importedWorkSlips = [];
const skippedWorkSlips = [];
for (const ws of perfWorkSlips) {
  const slug = perfUuidToSlug.get(ws.property_id);
  if (!slug) {
    skippedWorkSlips.push({ ws, reason: 'unmapped property' });
    continue;
  }
  importedWorkSlips.push({
    legacy_perfection_id: ws.id,
    property_id: slug,
    title: ws.title,
    description: ws.description,
    location: ws.location,
    category: ws.category || 'maintenance',
    priority: ws.priority || 'normal',
    status: ws.status || 'open',
    created_by_email: workSlipCreatedByEmail(ws.created_by),
    created_at: ws.created_at,
  });
}

const importedTasks = [];
const skippedTasks = [];
for (const t of perfTasks) {
  // tasks.property_ids is a uuid[] in Perfection; map each to a slug,
  // skip the whole task only if NONE of its properties map (typically
  // the task is then corporate-scope anyway).
  const slugs = (t.property_ids || []).map((u) => perfUuidToSlug.get(u)).filter(Boolean);
  if (t.scope === 'property' && slugs.length === 0 && (t.property_ids || []).length > 0) {
    skippedTasks.push({ t, reason: 'no property mapped' });
    continue;
  }
  importedTasks.push({
    legacy_perfection_id: t.id,
    title: t.title,
    description: t.description,
    scope: t.scope || 'corporate',
    property_ids: slugs.length > 0 ? slugs : null,
    status: t.status || 'open',
    priority: t.priority || 'medium',
    assigned_to_email: emailFor(t.assigned_to_user_id),
    due_date: t.due_date,
    tags: t.tags && t.tags.length > 0 ? t.tags : null,
    created_by_email: emailFor(t.created_by_user_id),
    created_at: t.created_at,
    updated_at: t.updated_at,
  });
}

// ─── Generate SQL ────────────────────────────────────────────────────
const sql = [];

sql.push('-- Generated by scripts/perfection-import/import.mjs');
sql.push(`-- Source: ${perfProperties.length} props, ${perfWorkSlips.length} work_slips, ${perfTasks.length} tasks`);
sql.push(`-- Generated at: ${new Date().toISOString()}`);
sql.push('');
sql.push('begin;');
sql.push('');

if (importedWorkSlips.length > 0) {
  sql.push('-- ── work_slips ──────────────────────────────────────────────');
  for (const ws of importedWorkSlips) {
    sql.push(workSlipInsertSql(ws));
  }
  sql.push('');
}

if (importedTasks.length > 0) {
  sql.push('-- ── tasks ────────────────────────────────────────────────────');
  for (const t of importedTasks) {
    sql.push(taskInsertSql(t));
  }
  sql.push('');
}

if (perfTaskComments.length > 0) {
  sql.push('-- ── task_comments ────────────────────────────────────────────');
  sql.push('-- Re-attached via legacy_perfection_id of the parent task.');
  for (const c of perfTaskComments) {
    sql.push(taskCommentInsertSql(c));
  }
  sql.push('');
}

sql.push('commit;');
sql.push('');

fs.writeFileSync(outFile, sql.join('\n'));

// ─── Report ──────────────────────────────────────────────────────────
console.log(`Wrote ${outFile}`);
console.log('');
console.log(`property mapping: ${perfUuidToSlug.size} mapped, ${unmappedProps.length} unmapped`);
if (unmappedProps.length > 0) {
  console.log('  unmapped:');
  for (const p of unmappedProps) console.log(`    - ${p.code} (${p.address})`);
}
console.log(`work_slips: ${importedWorkSlips.length} imported, ${skippedWorkSlips.length} skipped`);
console.log(`tasks:      ${importedTasks.length} imported, ${skippedTasks.length} skipped`);
if (perfTaskComments.length > 0) {
  console.log(`task_comments: ${perfTaskComments.length}`);
}
console.log('');

const unmappedUserIds = [...userIds].filter((u) => !userMap[u]);
if (unmappedUserIds.length > 0) {
  console.log(`unique user UUIDs without mapping (using ${PLACEHOLDER_EMAIL} placeholder):`);
  for (const u of unmappedUserIds) console.log(`  ${u}`);
  console.log('  → add to user-map.json and re-run for proper attribution');
  console.log('');
}

console.log('Apply with: SUPABASE_ACCESS_TOKEN=<token> supabase db query --linked \\');
console.log(`            --file ${path.relative(process.cwd(), outFile)}`);

// ─── Helpers ─────────────────────────────────────────────────────────
function readJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, filename), 'utf8'));
}

/** Quote a value for inline SQL. Returns 'NULL' for null/undefined,
 *  unquoted numbers/booleans, escaped single-quote-wrapped strings. */
function q(v) {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    return `ARRAY[${v.map(q).join(', ')}]::text[]`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

function workSlipInsertSql(ws) {
  return `insert into public.work_slips (
  legacy_perfection_id, property_id, title, description, location,
  category, priority, status, created_by_email, created_at
) values (
  ${q(ws.legacy_perfection_id)}::uuid, ${q(ws.property_id)}, ${q(ws.title)}, ${q(ws.description)}, ${q(ws.location)},
  ${q(ws.category)}::work_slip_category, ${q(ws.priority)}::work_slip_priority, ${q(ws.status)}::work_slip_status, ${q(ws.created_by_email)}, ${q(ws.created_at)}::timestamptz
) on conflict (legacy_perfection_id) do update set
  title = excluded.title,
  description = excluded.description,
  location = excluded.location,
  category = excluded.category,
  priority = excluded.priority,
  status = excluded.status,
  property_id = excluded.property_id,
  updated_at = now();`;
}

function taskInsertSql(t) {
  return `insert into public.tasks (
  legacy_perfection_id, title, description, scope, property_ids,
  status, priority, assigned_to_email, due_date, tags,
  created_by_email, created_at, updated_at
) values (
  ${q(t.legacy_perfection_id)}::uuid, ${q(t.title)}, ${q(t.description)}, ${q(t.scope)}::task_scope, ${q(t.property_ids)},
  ${q(t.status)}::task_status, ${q(t.priority)}::task_priority, ${q(t.assigned_to_email)}, ${q(t.due_date)}::date, ${q(t.tags)},
  ${q(t.created_by_email)}, ${q(t.created_at)}::timestamptz, ${q(t.updated_at)}::timestamptz
) on conflict (legacy_perfection_id) do update set
  title = excluded.title,
  description = excluded.description,
  scope = excluded.scope,
  property_ids = excluded.property_ids,
  status = excluded.status,
  priority = excluded.priority,
  assigned_to_email = excluded.assigned_to_email,
  due_date = excluded.due_date,
  tags = excluded.tags,
  updated_at = excluded.updated_at;`;
}

function taskCommentInsertSql(c) {
  // task_comments has no legacy id — re-imports duplicate. Only first
  // run should include task_comments.json.
  return `insert into public.task_comments (task_id, author_email, body, created_at)
select t.id, ${q(emailFor(c.author_user_id))}, ${q(c.body)}, ${q(c.created_at)}::timestamptz
from public.tasks t where t.legacy_perfection_id = ${q(c.task_id)}::uuid;`;
}

/** Best-effort address → slug guess. "21 Horton St, Gloucester MA" →
 *  "21_horton". Used only as a fallback when properties.code doesn't
 *  match. */
function guessSlugFromAddress(addr) {
  const head = addr.split(',')[0]?.trim().toLowerCase() ?? '';
  const cleaned = head
    .replace(/\b(st|street|rd|road|ave|avenue|ln|lane|dr|drive|blvd|boulevard|way|cir|circle|ct|court|pl|place|ter|terrace)\b\.?/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join('_');
  // Common explicit overrides.
  const overrides = {
    '17_beach': '17_beach_rd',
    '3_south': '3_south_st',
    '4_brier': '4_brier_neck',
  };
  return overrides[cleaned] ?? cleaned;
}
