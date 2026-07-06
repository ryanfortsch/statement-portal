import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { Section } from '@/components/Section';
import { Stat } from '@/components/Stat';
import { PhotoThumbs } from '@/components/PhotoUploader';
import { ArchiveTrigger } from './ArchiveTrigger';
import { supabase } from '@/lib/supabase';
import { fieldDb, isFieldConfigured } from '@/lib/field-db';
import { auth } from '@/auth';
import { suppliesLabel } from '@/lib/inspection-supplies';
import type {
  InspectionRow,
  InspectionItemRow,
  InspectionResultRow,
  PropertyZoneRow,
} from '@/lib/inspections-types';

export const dynamic = 'force-dynamic';

type PropertyShape = { id: string; name: string; title: string | null; city: string };

type ResultWithItem = {
  result: InspectionResultRow;
  item: InspectionItemRow;
  zone: PropertyZoneRow | null;
};

type SummaryNote = {
  id: string;
  inspection_item_id: string | null;
  note_text: string;
  note_type: 'INSPECTION_NOTE' | 'PROPERTY_NOTE';
  author_email: string;
  created_at: string;
  photo_urls: string[] | null;
};

type SummaryWorkSlip = {
  id: string;
  inspection_item_id: string | null;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  location: string | null;
  status: string;
  created_at: string;
  photo_urls: string[] | null;
};

/** The Field visit behind this inspection, when a contractor ran it from a
 *  packet stop: on-site timing + door-verified arrival + the packet itself. */
type FieldVisit = {
  packetId: string;
  packetTitle: string;
  startedAt: string | null;
  completedAt: string | null;
  departedAt: string | null;
  arrivedVerifiedAt: string | null;
};

async function loadFieldVisit(inspectionId: string): Promise<FieldVisit | null> {
  if (!isFieldConfigured) return null;
  const { data } = await fieldDb()
    .from('packet_stops')
    .select('started_at, completed_at, departed_at, arrived_verified_at, inspection_packets!inner(id, title)')
    .eq('inspection_id', inspectionId)
    .maybeSingle();
  const row = data as {
    started_at: string | null;
    completed_at: string | null;
    departed_at: string | null;
    arrived_verified_at: string | null;
    inspection_packets: { id: string; title: string };
  } | null;
  if (!row) return null;
  return {
    packetId: row.inspection_packets.id,
    packetTitle: row.inspection_packets.title,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    departedAt: row.departed_at,
    arrivedVerifiedAt: row.arrived_verified_at,
  };
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function durationLabel(fromIso: string, toIso: string): string | null {
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const m = Math.round(ms / 60000);
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

async function getInspection(id: string): Promise<{
  inspection: InspectionRow;
  property: PropertyShape;
  results: ResultWithItem[];
  notes: SummaryNote[];
  workSlips: SummaryWorkSlip[];
  itemMap: Map<string, InspectionItemRow>;
} | null> {
  const { data: inspection } = await supabase
    .from('inspections')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!inspection) return null;

  const insp = inspection as InspectionRow;

  const [{ data: property }, { data: results }, { data: items }, { data: notesData }, { data: workSlipsData }, { data: zoneRows }] = await Promise.all([
    supabase
      .from('properties')
      .select('id, name, title, city')
      .eq('id', insp.property_id)
      .maybeSingle(),
    supabase
      .from('inspection_results')
      .select('id, inspection_id, item_id, property_zone_id, status, notes, photo_urls, created_at')
      .eq('inspection_id', id),
    supabase
      .from('inspection_items')
      .select('id, template_id, category, title, description, sort_order')
      .eq('template_id', insp.template_id),
    supabase
      .from('inspection_notes')
      .select('id, inspection_item_id, note_text, note_type, author_email, created_at, photo_urls')
      .eq('inspection_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('work_slips')
      .select('id, inspection_item_id, title, description, category, priority, location, status, created_at, photo_urls')
      .eq('inspection_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('property_zones')
      .select('*')
      .eq('property_id', insp.property_id)
      .order('walk_order', { ascending: true }),
  ]);

  if (!property) return null;

  const itemMap = new Map<string, InspectionItemRow>();
  for (const it of (items ?? []) as InspectionItemRow[]) {
    itemMap.set(it.id, it);
  }

  const zoneMap = new Map<string, PropertyZoneRow>();
  for (const z of (zoneRows ?? []) as PropertyZoneRow[]) {
    zoneMap.set(z.id, z);
  }

  const merged: ResultWithItem[] = ((results ?? []) as InspectionResultRow[])
    .map((r) => {
      const item = itemMap.get(r.item_id);
      if (!item) return null;
      const zone = r.property_zone_id ? zoneMap.get(r.property_zone_id) ?? null : null;
      return { result: r, item, zone };
    })
    .filter((x): x is ResultWithItem => x !== null)
    .sort((a, b) => {
      // Zone-mapped results sort by zone walk_order, then item sort_order.
      // Fallback results (no zone) sort by item sort_order only and land
      // at the bottom of the list.
      const aw = a.zone?.walk_order ?? Infinity;
      const bw = b.zone?.walk_order ?? Infinity;
      if (aw !== bw) return aw - bw;
      return a.item.sort_order - b.item.sort_order;
    });

  return {
    inspection: insp,
    property: property as PropertyShape,
    results: merged,
    notes: (notesData ?? []) as SummaryNote[],
    workSlips: (workSlipsData ?? []) as SummaryWorkSlip[],
    itemMap,
  };
}

type Params = { id: string };

export default async function InspectionSummaryPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const [data, visit, session] = await Promise.all([getInspection(id), loadFieldVisit(id), auth()]);
  if (!data) notFound();
  // Contractors land here after completing a run; office-only links (packet,
  // work board) render only for a signed-in staffer.
  const isStaff = !!session?.user?.email;

  const { inspection, property, results, notes, workSlips, itemMap } = data;

  // Time on site: the Field stop's clock when a contractor ran it (Start tap →
  // done/departed), else the inspection's own started/completed stamps.
  const clockStart = visit?.startedAt ?? inspection.started_at;
  const clockEnd = visit?.departedAt ?? visit?.completedAt ?? inspection.completed_at;
  const onSite = clockStart && clockEnd ? durationLabel(clockStart, clockEnd) : null;
  const issues = results.filter((r) => r.result.status === 'issue');
  const passes = results.filter((r) => r.result.status === 'pass');
  const nas = results.filter((r) => r.result.status === 'na');
  const propertyNotes = notes.filter((n) => n.note_type === 'PROPERTY_NOTE');
  const inspectionNotes = notes.filter((n) => n.note_type === 'INSPECTION_NOTE');

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="operations" />

      {/* HEADER */}
      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{
          paddingTop: 32,
          paddingBottom: 16,
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Link
          href="/inspections"
          style={{
            fontSize: 11,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            textDecoration: 'none',
          }}
        >
          ← All Inspections
        </Link>
        <Link
          href={`/inspections/${id}/render`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 11,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink)',
            textDecoration: 'none',
            border: '1px solid var(--ink)',
            padding: '8px 14px',
            fontWeight: 600,
          }}
        >
          Print / PDF →
        </Link>
      </section>

      {/* HERO */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 16, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Inspection &middot; complete</div>
        <h1
          className="font-serif"
          style={{
            fontSize: 44,
            lineHeight: 1.05,
            fontWeight: 300,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            maxWidth: 720,
          }}
        >
          {property.name}
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: 'var(--ink-3)' }}>
          {property.city} &middot; {inspection.inspector_name} &middot; Completed {formatDateTime(inspection.completed_at)}
        </p>
        {(onSite || visit) && (
          <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline', fontSize: 13, color: 'var(--ink-3)' }}>
            {clockStart && <span>Started {fmtTime(clockStart)}</span>}
            {clockStart && clockEnd && <span style={{ color: 'var(--ink-4)' }}>·</span>}
            {clockEnd && <span>Finished {fmtTime(clockEnd)}</span>}
            {onSite && (
              <>
                <span style={{ color: 'var(--ink-4)' }}>·</span>
                <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{onSite} on site</span>
              </>
            )}
            {visit?.arrivedVerifiedAt && (
              <span title={`Smart lock recorded their code at ${fmtTime(visit.arrivedVerifiedAt)}`} style={{ color: 'var(--positive)', fontWeight: 600 }}>
                ✓ arrival verified at the door
              </span>
            )}
            {visit && isStaff && (
              <Link href={`/operations/packets/${visit.packetId}`} style={{ color: 'var(--tide-deep)', textDecoration: 'none', fontWeight: 600 }}>
                {visit.packetTitle} →
              </Link>
            )}
          </div>
        )}
        {/* Drive archive — fires on mount if this completed inspection
            isn't archived yet, then shows the link to the Drive copy. */}
        <div style={{ marginTop: 10 }}>
          <ArchiveTrigger inspectionId={inspection.id} initialDriveUrl={inspection.drive_url} />
        </div>
      </section>

      {/* STAT GRID */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 48, width: '100%' }}>
        <div
          className="rt-helm-stat-strip"
          style={{
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--ink)',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
          }}
        >
          <Stat label="Total" value={String(inspection.total_items)} size="hero" />
          <Stat label="Pass" value={String(inspection.pass_count)} size="hero" valueColor="var(--positive)" />
          <Stat label="Issue" value={String(inspection.issue_count)} size="hero" valueColor="var(--signal)" />
          <Stat label="N/A" value={String(inspection.na_count)} size="hero" valueColor="var(--ink-4)" last />
        </div>
      </section>

      {/* ISSUES */}
      <Section
        title="Issues"
        eyebrow={`${issues.length} flagged`}
        empty={issues.length === 0}
        emptyMessage="No issues flagged on this inspection. Clean walkthrough."
      >
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {issues.map((row) => (
            <IssueRow key={row.result.id} row={row} />
          ))}
        </div>
      </Section>

      {/* SUPPLIES CHECK — each "low" item already became a Rising Tide
          restock work slip on completion (visible in the section below). */}
      <Section
        title="Supplies"
        eyebrow={
          (inspection.supplies_low ?? []).length === 0
            ? 'all stocked'
            : `${inspection.supplies_low.length} low`
        }
        empty={false}
        emptyMessage=""
      >
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {(inspection.supplies_low ?? []).length === 0 ? (
            <div style={{ padding: '18px 0', color: 'var(--ink-3)', fontSize: 13 }}>
              All supplies marked OK. No restocks needed.
            </div>
          ) : (
            inspection.supplies_low.map((key) => (
              <div
                key={key}
                style={{
                  padding: '14px 0',
                  borderBottom: '1px solid var(--rule)',
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 14,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: '.18em',
                    textTransform: 'uppercase',
                    fontWeight: 600,
                    color: 'var(--signal)',
                    minWidth: 38,
                  }}
                >
                  Low
                </span>
                <span style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}>
                  {suppliesLabel(key)}
                </span>
                <span style={{ fontSize: 11, color: 'var(--ink-4)', marginLeft: 'auto' }}>
                  Restock slip created
                </span>
              </div>
            ))
          )}
        </div>
      </Section>

      {/* WORK SLIPS CREATED THIS INSPECTION */}
      {workSlips.length > 0 && (
        <Section
          title="Work Slips Created"
          eyebrow={`${workSlips.length} new`}
          empty={false}
          emptyMessage=""
        >
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {workSlips.map((ws) => {
              const item = ws.inspection_item_id ? itemMap.get(ws.inspection_item_id) : null;
              return (
                <div
                  key={ws.id}
                  style={{
                    padding: '16px 0',
                    borderBottom: '1px solid var(--rule)',
                    display: 'grid',
                    gridTemplateColumns: '160px 1fr auto',
                    gap: 24,
                    alignItems: 'baseline',
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      letterSpacing: '.18em',
                      textTransform: 'uppercase',
                      fontWeight: 600,
                      color: 'var(--signal)',
                    }}
                  >
                    {ws.category.replaceAll('_', ' ')}
                  </span>
                  <div>
                    {isStaff ? (
                      <Link href={`/work/${ws.id}`} style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500, textDecoration: 'underline', textDecorationColor: 'var(--rule)', textUnderlineOffset: 3 }}>
                        {ws.title}
                      </Link>
                    ) : (
                      <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}>{ws.title}</div>
                    )}
                    {item && (
                      <div style={{ marginTop: 2, fontSize: 11, color: 'var(--ink-4)' }}>
                        From: {item.title}
                      </div>
                    )}
                    {ws.location && (
                      <div style={{ marginTop: 2, fontSize: 12, color: 'var(--ink-3)' }}>
                        Location: {ws.location}
                      </div>
                    )}
                    {ws.description && (
                      <div style={{ marginTop: 6, fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.4 }}>
                        {ws.description}
                      </div>
                    )}
                    {ws.photo_urls && ws.photo_urls.length > 0 && (
                      <PhotoThumbs urls={ws.photo_urls} size={72} />
                    )}
                  </div>
                  <span style={{ textAlign: 'right' }}>
                    <span
                      style={{
                        display: 'block',
                        fontSize: 10,
                        letterSpacing: '.18em',
                        textTransform: 'uppercase',
                        color: ws.priority === 'high' ? 'var(--negative)' : 'var(--ink-3)',
                      }}
                    >
                      {ws.priority}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        marginTop: 4,
                        fontSize: 10,
                        letterSpacing: '.16em',
                        textTransform: 'uppercase',
                        color: ws.status === 'done' ? 'var(--positive)' : ws.status === 'in_progress' ? 'var(--tide-deep)' : 'var(--ink-4)',
                      }}
                    >
                      {ws.status.replaceAll('_', ' ')}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* PROPERTY NOTES (pinned to folder) */}
      {propertyNotes.length > 0 && (
        <Section
          title="Property Notes (pinned)"
          eyebrow={`${propertyNotes.length}`}
          empty={false}
          emptyMessage=""
        >
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {propertyNotes.map((n) => {
              const item = n.inspection_item_id ? itemMap.get(n.inspection_item_id) : null;
              return (
                <div
                  key={n.id}
                  style={{
                    padding: '14px 0',
                    borderBottom: '1px solid var(--rule)',
                    borderLeft: '2px solid var(--tide-deep)',
                    paddingLeft: 14,
                    marginLeft: -14,
                  }}
                >
                  <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.5 }}>{n.note_text}</div>
                  {item && (
                    <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)' }}>
                      Re: {item.title}
                    </div>
                  )}
                  {n.photo_urls && n.photo_urls.length > 0 && (
                    <PhotoThumbs urls={n.photo_urls} size={72} />
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* INSPECTION-SCOPED NOTES */}
      {inspectionNotes.length > 0 && (
        <Section
          title="Inspection Notes"
          eyebrow={`${inspectionNotes.length}`}
          empty={false}
          emptyMessage=""
        >
          <div style={{ borderTop: '1px solid var(--rule)' }}>
            {inspectionNotes.map((n) => {
              const item = n.inspection_item_id ? itemMap.get(n.inspection_item_id) : null;
              return (
                <div
                  key={n.id}
                  style={{ padding: '12px 0', borderBottom: '1px solid var(--rule-soft)' }}
                >
                  <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5, fontStyle: 'italic' }}>
                    &ldquo;{n.note_text}&rdquo;
                  </div>
                  {item && (
                    <div style={{ marginTop: 3, fontSize: 11, color: 'var(--ink-4)' }}>
                      Re: {item.title}
                    </div>
                  )}
                  {n.photo_urls && n.photo_urls.length > 0 && (
                    <PhotoThumbs urls={n.photo_urls} size={64} />
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* COMPLETED ITEMS */}
      <Section
        title="Passed"
        eyebrow={`${passes.length} clean`}
        empty={passes.length === 0}
        emptyMessage="—"
      >
        <div style={{ borderTop: '1px solid var(--rule)' }}>
          {passes.map((row) => (
            <CompactRow key={row.result.id} row={row} statusColor="var(--positive)" />
          ))}
        </div>
      </Section>

      {nas.length > 0 && (
        <Section title="Not Applicable" eyebrow={`${nas.length}`} empty={false} emptyMessage="">
          <div style={{ borderTop: '1px solid var(--rule)' }}>
            {nas.map((row) => (
              <CompactRow key={row.result.id} row={row} statusColor="var(--ink-4)" />
            ))}
          </div>
        </Section>
      )}

      <HelmFooter module="Inspection" right="Source: Helm" />
    </div>
  );
}

function IssueRow({ row }: { row: ResultWithItem }) {
  return (
    <div
      style={{
        padding: '18px 0',
        borderBottom: '1px solid var(--rule)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '160px 1fr',
          gap: 24,
          alignItems: 'baseline',
        }}
      >
        <span
          style={{
            fontSize: 10,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            fontWeight: 600,
            color: 'var(--signal)',
          }}
        >
          {row.item.category}
        </span>
        <div>
          {row.zone && (
            <div
              style={{
                fontSize: 10,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                color: 'var(--tide-deep)',
                fontWeight: 600,
                marginBottom: 4,
              }}
            >
              {row.zone.name}
              {row.zone.floor_label && (
                <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>
                  {' · '}
                  {row.zone.floor_label}
                </span>
              )}
            </div>
          )}
          <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}>{row.item.title}</div>
          {row.result.notes && (
            <div style={{ marginTop: 6, fontSize: 13, color: 'var(--ink-3)', fontStyle: 'italic' }}>
              &ldquo;{row.result.notes}&rdquo;
            </div>
          )}
          {row.result.photo_urls && row.result.photo_urls.length > 0 && (
            <PhotoThumbs urls={row.result.photo_urls} size={72} />
          )}
        </div>
      </div>
    </div>
  );
}

function CompactRow({ row, statusColor }: { row: ResultWithItem; statusColor: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr auto',
        gap: 24,
        alignItems: 'baseline',
        padding: '10px 0',
        borderBottom: '1px solid var(--rule-soft)',
        fontSize: 12,
      }}
    >
      <span style={{ color: 'var(--ink-4)' }}>{row.zone?.name ?? row.item.category}</span>
      <span style={{ color: 'var(--ink-3)' }}>{row.item.title}</span>
      <span
        style={{
          fontSize: 10,
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          color: statusColor,
        }}
      >
        {row.result.status}
      </span>
    </div>
  );
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  try {
    const d = new Date(value);
    return d.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}
