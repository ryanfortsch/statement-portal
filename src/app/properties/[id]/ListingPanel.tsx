'use client';

import { useActionState, useRef, useState, useTransition, type ReactNode } from 'react';
import { upload } from '@vercel/blob/client';
import {
  addPhotoUrlAction,
  deletePhotoAction,
  draftListingWithAiAction,
  movePhotoAction,
  recordUploadedPhotoAction,
  saveListingContentAction,
  setHeroAction,
  updatePhotoAction,
  type ListingActionResult,
  type ListingAiDraft,
  type ListingFormState,
} from './listing-actions';
import Link from 'next/link';
import type { ListingContentRow, ListingPhotoRow } from '@/lib/listing-content';
import { descriptionBlocksFrom, splitSummary } from '@/lib/listing-copy-shape';
import { HousePolicyReadout, type HousePolicyValues } from './HousePolicyReadout';
import { HowWeSellIt, type HowWeSellItValues } from './HowWeSellIt';
import { etStamp } from '@/lib/stable-time';
import { useConfirm } from '@/components/ConfirmDialog';
import { Drawer } from '@/components/Drawer';
import { buttonClass } from '@/lib/button-class';

/**
 * The property page's Listing section (Guest & listing tab): the listing as
 * a guest reads it, one block at a time, each with its own Edit.
 *
 *   Title and summary   the title, the tagline and the highlights
 *   About               the space and the neighborhood, as About blocks
 *   Guest access...     the OTA-only copy (access, interaction, notes)
 *   How we sell it      the campaign AI's selling points (Cape Ann homes)
 *   Amenities           read here; the catalog edits in a drawer
 *   Rooms and beds      read here; edited on Facts
 *   Photos              the gallery; Edit photos manages it
 *   Home type and size  property type, room type, the counts
 *
 * The three copy blocks are one form, so Draft with AI can fill all of them
 * and one Save keeps the draft. Every other block saves only its own columns
 * (the action's `part`), so saving amenities never blanks the copy.
 *
 * The read view uses the same shapers toScaListing does (listing-copy-shape),
 * so the tagline, highlights and About blocks here are what staycapeann.com
 * would show. Server-only data (the catalog, the bed summary) is computed on
 * the page and passed in, so this bundle never imports the service-role
 * client.
 */

export type ListingPanelProps = {
  propertyId: string;
  content: ListingContentRow | null;
  photos: ListingPhotoRow[];
  /** bedSummary(rooms) from the page: the fleet line and one line per sleeping room. */
  beds: { text: string; perRoom: Array<{ name: string; beds: string }> };
  catalog: ReadonlyArray<{ group: string; items: string[] }>;
  helmRun: boolean;
  registry: { title: string | null; bedrooms: number | null; bathrooms: number | null };
  /** House rules and occupancy are read from the House policy columns on properties. */
  housePolicy: HousePolicyValues;
  /** How we sell it (Cape Ann homes only); null or absent hides the block. */
  sellIt?: { ok: true; row: HowWeSellItValues | null } | { ok: false } | null;
};

const fold = (s: string): string => s.toLowerCase().replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();

export function ListingPanel({ propertyId, content, photos, beds, catalog, registry, housePolicy, sellIt }: ListingPanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <CopyBlocks propertyId={propertyId} content={content} registry={registry} />
      {sellIt && <SellItBlock propertyId={propertyId} sellIt={sellIt} />}
      <AmenitiesBlock propertyId={propertyId} content={content} catalog={catalog} />
      <Block title="Rooms and beds" note={beds.text || undefined} action={<Link href={`/properties/${propertyId}?tab=facts#rooms`} style={facts}>Edit on Facts &rarr;</Link>}>
        {beds.perRoom.length === 0 ? (
          <Empty>No beds on file.</Empty>
        ) : (
          <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px 24px', margin: 0 }}>
            {beds.perRoom.map((r) => (
              <div key={r.name}>
                <dt style={termStyle}>{r.name}</dt>
                <dd style={{ margin: '2px 0 0', fontSize: 14, color: 'var(--ink)' }}>{r.beds}</dd>
              </div>
            ))}
          </dl>
        )}
      </Block>
      <Gallery propertyId={propertyId} photos={photos} />
      <BasicsBlock propertyId={propertyId} content={content} registry={registry} housePolicy={housePolicy} />
    </div>
  );
}

// ── Blocks ──────────────────────────────────────────────────────────────────

function Block({ id, title, note, action, children }: { id?: string; title: string; note?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} style={{ borderTop: '1px solid var(--rule)', padding: '16px 0 22px', scrollMarginTop: 120 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', minWidth: 0 }}>
          <h3 className="font-serif" style={{ fontSize: 18, fontWeight: 400, letterSpacing: '-0.01em', margin: 0, color: 'var(--ink)' }}>{title}</h3>
          {note && <span style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>{note}</span>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function EditButton({ what, onClick, disabled, label = 'Edit' }: { what: string; onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" className={buttonClass('secondary', 'sm')} aria-label={label === 'Edit' ? `Edit ${what.toLowerCase()}` : undefined} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 13, color: 'var(--ink-4)' }}>{children}</div>;
}

function Paragraphs({ text, style }: { text: string; style?: React.CSSProperties }) {
  const paras = text.replace(/\r\n/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <>
      {paras.map((p, i) => (
        <p key={i} style={{ margin: '0 0 10px', fontSize: 14, lineHeight: 1.6, color: 'var(--ink-2)', whiteSpace: 'pre-line', maxWidth: 720, ...style }}>{p}</p>
      ))}
    </>
  );
}

// ── Copy: title and summary, About, guest access and notes ─────────────────

const COPY_FIELDS = ['title', 'summary', 'space', 'access', 'interaction', 'neighborhood', 'notes'] as const;
type CopyField = (typeof COPY_FIELDS)[number];
type CopyValues = Record<CopyField, string>;
type CopyBlockId = 'summary' | 'about' | 'access';
const BLOCK_FIELDS: Record<CopyBlockId, readonly CopyField[]> = {
  summary: ['title', 'summary'],
  about: ['space', 'neighborhood'],
  access: ['access', 'interaction', 'notes'],
};
const AI_BODY = ['summary', 'space', 'access', 'neighborhood'] as const;

function savedCopy(content: ListingContentRow | null, registry: ListingPanelProps['registry']): CopyValues {
  return {
    title: content?.title ?? registry.title ?? '',
    summary: content?.summary ?? '',
    space: content?.space ?? '',
    access: content?.access ?? '',
    interaction: content?.interaction ?? '',
    neighborhood: content?.neighborhood ?? '',
    notes: content?.notes ?? '',
  };
}

function CopyBlocks({ propertyId, content, registry }: { propertyId: string; content: ListingContentRow | null; registry: ListingPanelProps['registry'] }) {
  const action = saveListingContentAction.bind(null, propertyId);
  const [state, formAction, pending] = useActionState<ListingFormState, FormData>(action, { error: null });
  const formKey = content?.updated_at ?? 'new';
  const [values, setValues] = useState<CopyValues>(() => savedCopy(content, registry));
  const [open, setOpen] = useState<ReadonlySet<CopyBlockId>>(() => new Set());
  // A save (or anyone's newer save) brings a newer record: adopt it and
  // close the blocks. Render-phase adjustment, so no flash of the old text.
  const [adopted, setAdopted] = useState(formKey);
  const [aiBrief, setAiBrief] = useState('');
  const [aiNote, setAiNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [drafting, startDraft] = useTransition();
  const { choose } = useConfirm();
  if (adopted !== formKey) {
    setAdopted(formKey);
    setValues(savedCopy(content, registry));
    setOpen(new Set());
    setAiNote(null);
  }

  const set = (field: CopyField, value: string) => setValues((v) => ({ ...v, [field]: value }));
  const openBlock = (b: CopyBlockId) => setOpen((o) => new Set(o).add(b));
  const cancelBlock = (b: CopyBlockId) => {
    const saved = savedCopy(content, registry);
    setValues((v) => {
      const next = { ...v };
      for (const f of BLOCK_FIELDS[b]) next[f] = saved[f];
      return next;
    });
    setOpen((o) => {
      const next = new Set(o);
      next.delete(b);
      return next;
    });
  };
  const nothingWritten = COPY_FIELDS.every((f) => !values[f].trim());
  const editing = open.size > 0;

  // Draft with AI fills the four Guesty description fields (and a blank
  // title); Save keeps them. It opens every copy block so nothing it wrote
  // goes unseen.
  const onDraft = async () => {
    const current = Object.fromEntries((['title', ...AI_BODY] as const).map((k) => [k, values[k].trim()])) as ListingAiDraft;
    const hasCopy = AI_BODY.some((k) => current[k]);
    const allFilled = AI_BODY.every((k) => current[k]);
    const pick = hasCopy
      ? await choose({
          title: 'Replace the summary, the space, guest access and the neighborhood with a new AI draft?',
          body: allFilled
            ? 'Every field already has text, so Keep my text changes nothing.'
            : 'Fill blanks only keeps your text and drafts just the empty fields.',
          choices: [
            { value: 'replace', label: 'Replace with AI draft' },
            ...(allFilled ? [] : [{ value: 'fill' as const, label: 'Fill blanks only' }]),
          ],
          cancelLabel: allFilled ? 'Keep my text' : 'Cancel',
        })
      : 'fill';
    if (pick === null) return;
    const overwrite = pick === 'replace';
    setAiNote(null);
    startDraft(async () => {
      try {
        const res = await draftListingWithAiAction(propertyId, aiBrief);
        if (!res.ok) {
          setAiNote({ kind: 'err', text: res.error });
          return;
        }
        setValues((v) => {
          const next = { ...v };
          for (const k of AI_BODY) {
            const mine = v[k].trim();
            next[k] = overwrite ? res.draft[k] || mine : mine || res.draft[k];
          }
          // The title is a name, not copy: a draft only fills a blank one.
          next.title = v.title.trim() || res.draft.title;
          return next;
        });
        setOpen(new Set(['summary', 'about', 'access']));
        const source = res.photos ? `the property record and ${res.photos} Listing photo${res.photos === 1 ? '' : 's'}` : 'the property record';
        setAiNote({ kind: 'ok', text: `Drafted from ${source}. Review it, then Save.` });
      } catch {
        setAiNote({ kind: 'err', text: 'Could not draft the listing. Try again.' });
      }
    });
  };

  const footer = (b: CopyBlockId) => (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
      <button type="submit" className={buttonClass('primary', 'sm')} disabled={pending || drafting} aria-busy={pending}>
        {pending ? 'Saving…' : 'Save'}
      </button>
      <button type="button" className={buttonClass('quiet')} onClick={() => cancelBlock(b)} disabled={pending}>
        Cancel
      </button>
    </div>
  );
  // A closed block still posts its fields, unchanged, so one Save never
  // blanks the copy in a block nobody opened.
  const hidden = (b: CopyBlockId) => BLOCK_FIELDS[b].map((f) => <input key={f} type="hidden" name={f} value={values[f]} />);

  const { tagline, highlights } = splitSummary(values.summary);
  const about = descriptionBlocksFrom(values.space);

  return (
    <form action={formAction} aria-label="Listing copy" style={{ margin: 0 }}>
      <input type="hidden" name="part" value="copy" />

      {(editing || nothingWritten) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0 16px' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className={buttonClass('secondary', 'sm')} onClick={onDraft} disabled={drafting || pending} aria-busy={drafting}>
              {drafting ? 'Drafting…' : 'Draft with AI'}
            </button>
            <input
              value={aiBrief}
              onChange={(e) => setAiBrief(e.target.value)}
              maxLength={2000}
              placeholder="Optional: what makes it special, e.g. the view at low tide"
              aria-label="Note for Draft with AI"
              style={{ ...input, flex: '1 1 260px', width: 'auto' }}
            />
          </div>
          {aiNote && <span role="status" style={{ fontSize: 12, color: aiNote.kind === 'ok' ? 'var(--positive)' : 'var(--negative)' }}>{aiNote.text}</span>}
        </div>
      )}

      <Block
        title="Title and summary"
        note={content?.updated_at ? `Saved ${etStamp(content.updated_at)}${content.updated_by ? ` by ${content.updated_by}` : ''}` : undefined}
        action={!open.has('summary') && <EditButton what="Title and summary" onClick={() => openBlock('summary')} />}
      >
        {open.has('summary') ? (
          <div style={editorStyle}>
            <TextField name="title" label="Title" value={values.title} onChange={(v) => set('title', v)} />
            <TextField name="summary" label="Summary" hint="✓ lines become the highlights; the rest is the tagline" value={values.summary} onChange={(v) => set('summary', v)} rows={4} />
            {footer('summary')}
          </div>
        ) : (
          <>
            {hidden('summary')}
            {!values.title.trim() && !values.summary.trim() ? (
              <Empty>Nothing written yet.</Empty>
            ) : (
              <div style={{ maxWidth: 720 }}>
                {values.title.trim() && (
                  <div className="font-serif" style={{ fontSize: 24, lineHeight: 1.25, letterSpacing: '-0.01em', color: 'var(--ink)' }}>{values.title}</div>
                )}
                {tagline && <p style={{ margin: '8px 0 0', fontSize: 15, lineHeight: 1.55, color: 'var(--ink-2)' }}>{tagline}</p>}
                {highlights.length > 0 && (
                  <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'grid', gap: 4 }}>
                    {highlights.map((h, i) => (
                      <li key={i} style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                        <span aria-hidden style={{ color: 'var(--positive)', marginRight: 8 }}>✓</span>
                        {h}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </Block>

      <Block title="About" action={!open.has('about') && <EditButton what="About" onClick={() => openBlock('about')} />}>
        {open.has('about') ? (
          <div style={editorStyle}>
            <TextField name="space" label="The space" hint="room by room; ☆ headings and → bullets become sections" value={values.space} onChange={(v) => set('space', v)} rows={10} />
            <TextField name="neighborhood" label="Neighborhood" value={values.neighborhood} onChange={(v) => set('neighborhood', v)} rows={5} />
            {footer('about')}
          </div>
        ) : (
          <>
            {hidden('about')}
            {about.length === 0 && !values.neighborhood.trim() ? (
              <Empty>Nothing written yet.</Empty>
            ) : (
              <div style={{ maxWidth: 720 }}>
                {about.map((b, i) =>
                  b.kind === 'heading' ? (
                    <div key={i} style={{ ...termStyle, margin: i === 0 ? '0 0 6px' : '14px 0 6px' }}>{b.text}</div>
                  ) : b.kind === 'bullets' ? (
                    <ul key={i} style={{ margin: '0 0 10px', paddingLeft: 18, listStyle: 'disc', display: 'grid', gap: 3 }}>
                      {b.items.map((item, j) => (
                        <li key={j} style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--ink-2)' }}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p key={i} style={{ margin: '0 0 10px', fontSize: 14, lineHeight: 1.6, color: 'var(--ink-2)' }}>{b.text}</p>
                  ),
                )}
                {values.neighborhood.trim() && (
                  <>
                    <div style={{ ...termStyle, margin: about.length ? '14px 0 6px' : '0 0 6px' }}>The neighborhood</div>
                    <Paragraphs text={values.neighborhood} />
                  </>
                )}
              </div>
            )}
          </>
        )}
      </Block>

      <Block title="Guest access and notes" action={!open.has('access') && <EditButton what="Guest access and notes" onClick={() => openBlock('access')} />}>
        {open.has('access') ? (
          <div style={editorStyle}>
            <TextField name="access" label="Guest access" hint="what the guest may use; never the door code" value={values.access} onChange={(v) => set('access', v)} rows={3} />
            <TextField name="interaction" label="Interaction with guests" value={values.interaction} onChange={(v) => set('interaction', v)} rows={2} />
            <TextField name="notes" label="Other things to note" value={values.notes} onChange={(v) => set('notes', v)} rows={3} />
            {footer('access')}
          </div>
        ) : (
          <>
            {hidden('access')}
            <dl style={{ display: 'grid', gap: 12, margin: 0, maxWidth: 720 }}>
              {(
                [
                  ['Guest access', values.access],
                  ['Interaction with guests', values.interaction],
                  ['Other things to note', values.notes],
                ] as const
              ).map(([label, text]) => (
                <div key={label}>
                  <dt style={termStyle}>{label}</dt>
                  <dd style={{ margin: '3px 0 0' }}>
                    {text.trim() ? <Paragraphs text={text} style={{ margin: '0 0 6px' }} /> : <Empty>Not written.</Empty>}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </Block>

      {state.error && <div role="alert" style={{ fontSize: 12, color: 'var(--negative)', margin: '-8px 0 14px' }}>{state.error}</div>}
      {!state.error && state.ok && state.message && (
        <div role="status" style={{ fontSize: 12, color: 'var(--positive)', margin: '-8px 0 14px' }}>{state.message}</div>
      )}
    </form>
  );
}

function TextField({ name, label, hint, value, onChange, rows }: { name: CopyField; label: string; hint?: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={labelStyle}>{label}</span>
      {rows && rows > 1 ? (
        <textarea name={name} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} style={{ ...input, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
      ) : (
        <input name={name} value={value} onChange={(e) => onChange(e.target.value)} style={input} />
      )}
      {hint && <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{hint}</span>}
    </label>
  );
}

// ── How we sell it ──────────────────────────────────────────────────────────

function SellItBlock({ propertyId, sellIt }: { propertyId: string; sellIt: NonNullable<ListingPanelProps['sellIt']> }) {
  const [editing, setEditing] = useState(false);
  if (!sellIt.ok) {
    return (
      <Block id="how-we-sell-it" title="How we sell it">
        <div role="alert" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
          This could not be loaded. Nothing you saved has changed.{' '}
          <a href={`/properties/${propertyId}?tab=guest#how-we-sell-it`}>Retry</a>
        </div>
      </Block>
    );
  }
  const row = sellIt.row;
  const points = (row?.selling_points ?? []).filter((p) => p.trim());
  const lines: Array<[string, string | null]> = [
    ['Tagline', row?.tagline ?? null],
    ['Lead with', row?.primary_selling_point ?? null],
    ['Best for', row?.best_for ?? null],
    ['Notes', row?.notes ?? null],
  ];
  const anything = lines.some(([, v]) => v && v.trim()) || points.length > 0 || row?.on_water;
  return (
    <Block
      id="how-we-sell-it"
      title="How we sell it"
      note={row?.on_water ? 'On the water' : undefined}
      action={editing ? <EditButton what="How we sell it" label="Cancel" onClick={() => setEditing(false)} /> : <EditButton what="How we sell it" onClick={() => setEditing(true)} />}
    >
      {editing ? (
        <HowWeSellIt propertyId={propertyId} row={row} onSaved={() => setEditing(false)} />
      ) : !anything ? (
        <Empty>Nothing written yet.</Empty>
      ) : (
        <dl style={{ display: 'grid', gap: 10, margin: 0, maxWidth: 720 }}>
          {lines
            .filter(([, v]) => v && v.trim())
            .map(([label, v]) => (
              <div key={label}>
                <dt style={termStyle}>{label}</dt>
                <dd style={{ margin: '3px 0 0', fontSize: 14, lineHeight: 1.55, color: 'var(--ink-2)' }}>{v}</dd>
              </div>
            ))}
          {points.length > 0 && (
            <div>
              <dt style={termStyle}>Selling points</dt>
              <dd style={{ margin: '3px 0 0' }}>
                <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc', display: 'grid', gap: 3 }}>
                  {points.map((p, i) => (
                    <li key={i} style={{ fontSize: 14, color: 'var(--ink-2)' }}>{p}</li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
        </dl>
      )}
    </Block>
  );
}

// ── Amenities: read here, the catalog in a drawer ───────────────────────────

function AmenitiesBlock({ propertyId, content, catalog }: { propertyId: string; content: ListingContentRow | null; catalog: ListingPanelProps['catalog'] }) {
  const action = saveListingContentAction.bind(null, propertyId);
  const [state, formAction, pending] = useActionState<ListingFormState, FormData>(action, { error: null });
  const [drawer, setDrawer] = useState(false);
  const formKey = content?.updated_at ?? 'new';
  const [adopted, setAdopted] = useState(formKey);
  if (adopted !== formKey) {
    setAdopted(formKey);
    setDrawer(false);
  }
  const amenities = content?.amenities ?? [];
  const have = new Set(amenities.map(fold));
  const catalogKeys = new Set(catalog.flatMap((g) => g.items.map(fold)));
  const extras = amenities.filter((a) => !catalogKeys.has(fold(a)));
  const groups = catalog.map((g) => ({ group: g.group, items: g.items.filter((i) => have.has(fold(i))) })).filter((g) => g.items.length > 0);
  if (extras.length) groups.push({ group: 'Other', items: extras });
  const notIncluded = content?.amenities_not_included ?? [];

  return (
    <Block
      title="Amenities"
      note={amenities.length ? `${amenities.length} on file` : undefined}
      action={<EditButton what="Amenities" onClick={() => setDrawer(true)} />}
    >
      {groups.length === 0 && notIncluded.length === 0 ? (
        <Empty>None on file.</Empty>
      ) : (
        <dl style={{ display: 'grid', gap: 10, margin: 0, maxWidth: 820 }}>
          {groups.map((g) => (
            <div key={g.group} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 160px) 1fr', gap: 12, alignItems: 'baseline' }}>
              <dt style={termStyle}>{g.group}</dt>
              <dd style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)' }}>{g.items.join(' · ')}</dd>
            </div>
          ))}
          {notIncluded.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 160px) 1fr', gap: 12, alignItems: 'baseline' }}>
              <dt style={termStyle}>Not included</dt>
              <dd style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--ink-3)' }}>{notIncluded.join(' · ')}</dd>
            </div>
          )}
        </dl>
      )}
      {!drawer && !state.error && state.ok && state.message && <div role="status" style={{ fontSize: 12, color: 'var(--positive)', marginTop: 10 }}>{state.message}</div>}

      {drawer && (
        <Drawer title="Amenities" eyebrow="Listing" onClose={() => setDrawer(false)}>
          <form action={formAction} aria-label="Amenities" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <input type="hidden" name="part" value="amenities" />
            {catalog.map((g) => (
              <fieldset key={g.group} style={{ border: 'none', margin: 0, padding: 0 }}>
                <legend style={{ ...termStyle, marginBottom: 6 }}>{g.group}</legend>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 4 }}>
                  {g.items.map((item) => (
                    <label key={item} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}>
                      <input type="checkbox" name="amenities" value={item} defaultChecked={have.has(fold(item))} /> {item}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={labelStyle}>Other amenities</span>
              <textarea name="amenities_extra" rows={3} defaultValue={extras.join('\n')} placeholder="One per line, anything not in the list" style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={labelStyle}>Not included</span>
              <textarea name="amenities_not_included" rows={3} defaultValue={notIncluded.join('\n')} placeholder="One per line, e.g. No washer" style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }} />
            </label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', position: 'sticky', bottom: -40, background: 'var(--paper)', padding: '12px 0' }}>
              <button type="submit" className={buttonClass('primary', 'sm')} disabled={pending} aria-busy={pending}>
                {pending ? 'Saving…' : 'Save amenities'}
              </button>
              <button type="button" className={buttonClass('quiet')} onClick={() => setDrawer(false)} disabled={pending}>
                Cancel
              </button>
              {state.error && <span role="alert" style={{ fontSize: 12, color: 'var(--negative)' }}>{state.error}</span>}
            </div>
          </form>
        </Drawer>
      )}
    </Block>
  );
}

// ── Home type and size ──────────────────────────────────────────────────────

function BasicsBlock({
  propertyId,
  content,
  registry,
  housePolicy,
}: {
  propertyId: string;
  content: ListingContentRow | null;
  registry: ListingPanelProps['registry'];
  housePolicy: HousePolicyValues;
}) {
  const action = saveListingContentAction.bind(null, propertyId);
  const [state, formAction, pending] = useActionState<ListingFormState, FormData>(action, { error: null });
  const [editing, setEditing] = useState(false);
  const formKey = content?.updated_at ?? 'new';
  const [adopted, setAdopted] = useState(formKey);
  if (adopted !== formKey) {
    setAdopted(formKey);
    setEditing(false);
  }
  const bedrooms = content?.bedrooms ?? registry.bedrooms;
  const bathrooms = content?.bathrooms ?? registry.bathrooms;
  const parts = [
    content?.property_type,
    content?.room_type,
    bedrooms != null ? `${bedrooms} bedroom${bedrooms === 1 ? '' : 's'}` : null,
    bathrooms != null ? `${bathrooms} bath${bathrooms === 1 ? '' : 's'}` : null,
    content?.beds != null ? `${content.beds} bed${content.beds === 1 ? '' : 's'}` : null,
  ].filter((v): v is string => !!v && String(v).trim() !== '');

  return (
    <Block title="Home type and size" action={!editing && <EditButton what="Home type and size" onClick={() => setEditing(true)} />}>
      {editing ? (
        <form action={formAction} aria-label="Home type and size" style={editorStyle}>
          <input type="hidden" name="part" value="basics" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px 18px' }}>
            <Small name="property_type" label="Property type" defaultValue={content?.property_type ?? ''} placeholder="House" />
            <Small name="room_type" label="Room type" defaultValue={content?.room_type ?? ''} placeholder="Entire home/apt" />
            <Small name="bedrooms" label="Bedrooms" defaultValue={bedrooms ?? ''} numeric />
            <Small name="bathrooms" label="Bathrooms" defaultValue={bathrooms ?? ''} numeric />
            <Small name="beds" label="Beds" defaultValue={content?.beds ?? ''} numeric />
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="submit" className={buttonClass('primary', 'sm')} disabled={pending} aria-busy={pending}>
              {pending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className={buttonClass('quiet')} onClick={() => setEditing(false)} disabled={pending}>
              Cancel
            </button>
            {state.error && <span role="alert" style={{ fontSize: 12, color: 'var(--negative)' }}>{state.error}</span>}
          </div>
        </form>
      ) : parts.length === 0 ? (
        <Empty>Not set.</Empty>
      ) : (
        <div style={{ fontSize: 14, color: 'var(--ink)' }}>{parts.join(' · ')}</div>
      )}
      <div style={{ marginTop: 12 }}>
        <HousePolicyReadout propertyId={propertyId} values={housePolicy} fields={['maxOccupancy', 'houseRules']} />
      </div>
    </Block>
  );
}

function Small({ name, label, defaultValue, placeholder, numeric }: { name: string; label: string; defaultValue: string | number; placeholder?: string; numeric?: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={labelStyle}>{label}</span>
      <input name={name} defaultValue={defaultValue} placeholder={placeholder} inputMode={numeric ? 'decimal' : undefined} style={input} />
    </label>
  );
}

// ── Gallery ─────────────────────────────────────────────────────────────────

// The photo goes browser to Vercel Blob on a token from this route, never
// through a server action (their body is capped at 4 MB, next.config.ts).
// The route enforces the same cap, types and listings/<property>/ folder;
// the checks below only spare the operator a doomed upload.
const PHOTO_UPLOAD_ROUTE = '/api/blob/listing-photo';
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const PHOTO_EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};
const PHOTO_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);

/** Extension for the Blob pathname, or null when the file is not a photo type
 *  the token accepts. Some browsers hand HEIC over with an empty type, so the
 *  file name decides then. */
function photoExt(f: File): string | null {
  const named = (f.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  if (f.type) {
    const byType = PHOTO_EXT_BY_TYPE[f.type.toLowerCase()];
    if (!byType) return null;
    return PHOTO_EXTS.has(named) ? named : byType;
  }
  return PHOTO_EXTS.has(named) ? named : null;
}

/** Pixel size as the browser decodes it, or null (HEIC in Chrome, a corrupt
 *  file). Never blocks the upload. */
function readPixelSize(f: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    let objectUrl: string | null = null;
    const done = (v: { width: number; height: number } | null) => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
      resolve(v);
    };
    try {
      objectUrl = URL.createObjectURL(f);
      const img = new Image();
      const timer = window.setTimeout(() => done(null), 8000);
      img.onload = () => {
        window.clearTimeout(timer);
        done(img.naturalWidth > 0 && img.naturalHeight > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null);
      };
      img.onerror = () => {
        window.clearTimeout(timer);
        done(null);
      };
      img.src = objectUrl;
    } catch {
      done(null);
    }
  });
}

/** The Blob client only says "Failed to retrieve the client token" whatever
 *  the route answered, so name the likely causes instead of echoing that. */
function uploadErrorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '');
  if (/client token/i.test(raw)) {
    return 'Helm could not open an upload for this photo (signed out, photo storage not configured, or the type or size was refused). Add by URL instead, or reload and retry.';
  }
  return raw ? `Upload failed: ${raw}` : 'Upload failed.';
}

function Gallery({ propertyId, photos }: { propertyId: string; photos: ListingPhotoRow[] }) {
  const [managing, setManaging] = useState(false);
  const [pending, start] = useTransition();
  const { ask } = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [url, setUrl] = useState('');
  const [urlCaption, setUrlCaption] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [fileCaption, setFileCaption] = useState('');
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  // A thrown action (deploy skew, a dropped connection) lands as a message
  // here rather than escaping the transition to the page's error boundary.
  const run = (id: string, fn: () => Promise<ListingActionResult>) => {
    setBusy(id);
    start(async () => {
      try {
        const r = await fn();
        setMsg(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error });
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error && e.message ? e.message : 'That did not go through. Reload and try again.' });
      } finally {
        setBusy(null);
      }
    });
  };

  const uploadPhoto = (f: File) => {
    const ext = photoExt(f);
    if (!ext) {
      setMsg({ ok: false, text: `Unsupported type ${f.type || f.name}; JPEG, PNG, WebP or HEIC.` });
      return;
    }
    if (f.size > MAX_PHOTO_BYTES) {
      setMsg({ ok: false, text: `Photo is ${(f.size / (1024 * 1024)).toFixed(1)} MB; the limit is 12 MB.` });
      return;
    }
    const caption = fileCaption;
    run('upload', async () => {
      setUploadPct(0);
      try {
        const size = await readPixelSize(f);
        let blobUrl: string;
        try {
          const put = await upload(`listings/${propertyId}/${Date.now()}.${ext}`, f, {
            access: 'public',
            handleUploadUrl: PHOTO_UPLOAD_ROUTE,
            contentType: f.type || undefined,
            onUploadProgress: (p) => setUploadPct(Math.round(p.percentage)),
          });
          blobUrl = put.url;
        } catch (e) {
          return { ok: false, error: uploadErrorText(e) };
        }
        const r = await recordUploadedPhotoAction(propertyId, {
          url: blobUrl,
          caption,
          width: size?.width ?? null,
          height: size?.height ?? null,
        });
        if (r.ok) {
          if (fileRef.current) fileRef.current.value = '';
          setFileCaption('');
        }
        return r;
      } finally {
        setUploadPct(null);
      }
    });
  };

  const ordered = [...photos].sort((a, b) => a.sort_order - b.sort_order);
  // Read in the order a guest meets them: the hero first.
  const shown = [...ordered].sort((a, b) => Number(b.is_hero) - Number(a.is_hero));
  const hero = photos.find((p) => p.is_hero) ?? null;

  return (
    <Block
      title="Photos"
      note={photos.length ? `${photos.length} in the gallery${hero ? '' : ', no hero yet'}` : undefined}
      action={<EditButton what="Photos" label={managing ? 'Done' : 'Edit photos'} onClick={() => setManaging((m) => !m)} disabled={pending} />}
    >
      {!managing ? (
        shown.length === 0 ? (
          <Empty>No photos yet.</Empty>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
            {shown.map((p) => (
              <figure key={p.id} style={{ margin: 0 }}>
                <div style={{ position: 'relative', aspectRatio: '4 / 3', background: 'var(--paper-3)', overflow: 'hidden', border: `1px solid ${p.is_hero ? 'var(--signal)' : 'var(--rule)'}` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumbnail_url ?? p.url} alt={p.caption ?? ''} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  {p.is_hero && <span style={{ ...heroBadge, position: 'absolute', top: 6, left: 6 }}>Hero</span>}
                </div>
                {p.caption && <figcaption style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 5, lineHeight: 1.4 }}>{p.caption}</figcaption>}
              </figure>
            ))}
          </div>
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {ordered.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
              {ordered.map((p, i) => (
                <PhotoCard
                  key={p.id}
                  photo={p}
                  index={i}
                  count={ordered.length}
                  busy={busy === p.id && pending}
                  onMove={(dir) => run(p.id, () => movePhotoAction(propertyId, p.id, dir))}
                  onHero={() => run(p.id, () => setHeroAction(propertyId, p.id))}
                  onDelete={async () => {
                    if (!(await ask({
                      title: 'Remove this photo from the gallery?',
                      body: 'Every listing that reads this gallery stops showing it.',
                      confirmLabel: 'Remove photo',
                      tone: 'danger',
                    }))) return;
                    run(p.id, () => deletePhotoAction(propertyId, p.id));
                  }}
                  onSave={(caption, roomHint) => run(p.id, () => updatePhotoAction(propertyId, p.id, { caption, room_hint: roomHint }))}
                />
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginTop: 4 }}>
            <div style={{ border: '1px solid var(--rule)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="eyebrow">Upload</div>
              <input ref={fileRef} type="file" accept="image/*" style={{ fontSize: 12, color: 'var(--ink-2)' }} />
              <input value={fileCaption} onChange={(e) => setFileCaption(e.target.value)} placeholder="Caption (optional)" style={input} />
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  const f = fileRef.current?.files?.[0];
                  if (!f) {
                    setMsg({ ok: false, text: 'Pick a photo first.' });
                    return;
                  }
                  uploadPhoto(f);
                }}
                className={buttonClass('primary', 'sm')}
                style={{ alignSelf: 'flex-start' }}
              >
                {busy === 'upload' && pending
                  ? uploadPct != null && uploadPct > 0 && uploadPct < 100
                    ? `Uploading ${uploadPct}%`
                    : 'Uploading…'
                  : 'Upload to gallery'}
              </button>
              <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>JPEG, PNG, WebP or HEIC, 12 MB max.</span>
            </div>
            <div style={{ border: '1px solid var(--rule)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="eyebrow">Add by link</div>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="Photo link" style={input} />
              <input value={urlCaption} onChange={(e) => setUrlCaption(e.target.value)} placeholder="Caption (optional)" style={input} />
              <button
                type="button"
                disabled={pending || !url.trim()}
                onClick={() =>
                  run('url', async () => {
                    const r = await addPhotoUrlAction(propertyId, { url, caption: urlCaption });
                    if (r.ok) {
                      setUrl('');
                      setUrlCaption('');
                    }
                    return r;
                  })
                }
                className={buttonClass('secondary', 'sm')}
                style={{ alignSelf: 'flex-start' }}
              >
                {busy === 'url' && pending ? 'Adding…' : 'Add photo'}
              </button>
            </div>
          </div>
        </div>
      )}
      {msg && <div role={msg.ok ? 'status' : 'alert'} style={{ fontSize: 12, color: msg.ok ? 'var(--positive)' : 'var(--negative)', marginTop: 10 }}>{msg.text}</div>}
    </Block>
  );
}

const PHOTO_SOURCE_LABEL: Record<string, string> = { guesty_seed: 'From Guesty', drive: 'From Drive' };

function PhotoCard({
  photo,
  index,
  count,
  busy,
  onMove,
  onHero,
  onDelete,
  onSave,
}: {
  photo: ListingPhotoRow;
  index: number;
  count: number;
  busy: boolean;
  onMove: (dir: -1 | 1) => void;
  onHero: () => void;
  onDelete: () => void;
  onSave: (caption: string, roomHint: string) => void;
}) {
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [roomHint, setRoomHint] = useState(photo.room_hint ?? '');
  const dirty = caption !== (photo.caption ?? '') || roomHint !== (photo.room_hint ?? '');
  return (
    <div style={{ border: `1px solid ${photo.is_hero ? 'var(--signal)' : 'var(--rule)'}`, display: 'flex', flexDirection: 'column', opacity: busy ? 0.6 : 1 }}>
      <div style={{ position: 'relative', aspectRatio: '4 / 3', background: 'var(--paper-3)', overflow: 'hidden' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.thumbnail_url ?? photo.url} alt={photo.caption ?? ''} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', gap: 4 }}>
          <span className="font-mono" style={{ fontSize: 10, background: 'var(--paper)', color: 'var(--ink-3)', padding: '2px 6px' }}>{index + 1}</span>
          {photo.is_hero && <span style={heroBadge}>Hero</span>}
          {PHOTO_SOURCE_LABEL[photo.source] && <span style={{ fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', background: 'var(--paper)', color: 'var(--ink-4)', padding: '3px 6px' }}>{PHOTO_SOURCE_LABEL[photo.source]}</span>}
        </div>
      </div>
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption" aria-label="Caption" style={{ ...input, fontSize: 12, padding: '6px 8px' }} />
        <input value={roomHint} onChange={(e) => setRoomHint(e.target.value)} placeholder="Room (e.g. Bedroom 2) for the sleeping card" aria-label="Room" style={{ ...input, fontSize: 12, padding: '6px 8px' }} />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => onMove(-1)} disabled={busy || index === 0} style={quietLink} aria-label="Move earlier">↑</button>
            <button type="button" onClick={() => onMove(1)} disabled={busy || index === count - 1} style={quietLink} aria-label="Move later">↓</button>
            {!photo.is_hero && <button type="button" onClick={onHero} disabled={busy} style={quietLink}>Make hero</button>}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {dirty && <button type="button" onClick={() => onSave(caption, roomHint)} disabled={busy} style={{ ...quietLink, color: 'var(--ink)' }}>Save</button>}
            <button type="button" onClick={onDelete} disabled={busy} style={{ ...quietLink, color: 'var(--negative)' }}>Remove</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shared styles ───────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const termStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-4)',
};

const editorStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 820 };

const facts: React.CSSProperties = { fontSize: 12, color: 'var(--tide-deep)', textDecoration: 'none' };

const input: React.CSSProperties = {
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  padding: '8px 10px',
  fontSize: 13,
  color: 'var(--ink)',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const heroBadge: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  background: 'var(--signal)',
  color: 'var(--paper)',
  padding: '3px 6px',
};

const quietLink: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  fontSize: 11,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-4)',
  cursor: 'pointer',
  fontWeight: 500,
};
