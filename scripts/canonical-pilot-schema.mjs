// Deliberately bounded canonical schema used by the isolated synthetic pilot.
// Source SQL stays unmodified; no customer seeds, cutover RPC or external IO.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
export function canonicalPilotSchema() {
  const root=new URL('../',import.meta.url),sources=new Map(),parts=[];
  const read=path=>{const sql=readFileSync(new URL(path,root),'utf8');sources.set(path,createHash('sha256').update(sql).digest('hex'));return sql;};
  const migration=name=>read(`supabase/migrations/${name}.sql`);
  const section=(s,from,to)=>{const start=s.indexOf(from),end=to===undefined?s.length:s.indexOf(to,start);assert.ok(start>=0&&end>start,`Missing schema section: ${from}`);return s.slice(start,end);};
  const plumbing=migration('20260926200000_helm_pms_plumbing');
  parts.push(section(migration('20260430_create_properties'),'create table public.properties (','-- ─── Seed:'));
  parts.push(migration('20260507b_create_channels'),migration('20260507c_channels_extras'));
  parts.push(section(migration('20260518b_channels_calendar_phase1'),'alter table public.bookings','alter table public.inspection_plans'));
  const match=migration('20260527b_property_listing_match');
  parts.push(section(match,'alter table public.properties','-- Backfill:'),section(match,'create or replace function public.derive_listing_match()'));
  parts.push(migration('20260721_property_calendar_days'),migration('20260916120000_property_rental_periods'));
  parts.push(section(plumbing,'create table if not exists public.regions','insert into public.regions'));
  // Metadata only: satisfy the canonical default FK, without loading business seeds.
  parts.push("insert into public.regions(id,label,state,timezone,crew_label,tax_jurisdiction) values('cape_ann','Fictional staging','MA','America/New_York','Fictional','MA');");
  parts.push(section(plumbing,'alter table public.properties','-- Fleet defaults, ALL DISABLED.'));
  parts.push(section(plumbing,'create table if not exists public.guest_threads','-- ── 9.'));
  parts.push(section(plumbing,'create or replace function public.helm_row_conflicts(','-- ── 12.'));
  parts.push(section(plumbing,'-- ── 13.'));
  parts.push(section(migration('20260621c_rls_lockdown_audience_bookings'),'-- bookings (read'));
  return {parts,sources:Object.fromEntries(sources)};
}
