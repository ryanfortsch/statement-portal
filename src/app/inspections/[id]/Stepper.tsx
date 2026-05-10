'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  saveResult,
  completeInspection,
  addInspectionNote,
  createWorkSlipFromInspection,
} from '../actions';
import type {
  InspectionStatus,
  WorkSlipCategory,
  WorkSlipPriority,
} from '@/lib/inspections-types';
import { PhotoUploader, PhotoThumbs } from '@/components/PhotoUploader';
import { compressImage } from '@/lib/image-compress';

type StepperItem = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  item_category: string | null;
};

type StepperResult = {
  item_id: string;
  status: InspectionStatus;
  notes: string | null;
};

type StepperNote = {
  id: string;
  inspection_item_id: string | null;
  note_text: string;
  note_type: 'INSPECTION_NOTE' | 'PROPERTY_NOTE';
  author_email: string;
  created_at: string;
  photo_urls?: string[];
};

type StepperWorkSlip = {
  id: string;
  inspection_item_id: string | null;
  title: string;
  category: WorkSlipCategory;
  priority: WorkSlipPriority;
  created_at: string;
  photo_urls?: string[];
};

type Props = {
  inspectionId: string;
  propertyId: string;
  propertyName: string;
  inspectorName: string;
  items: StepperItem[];
  initialResults: StepperResult[];
  initialNotes?: StepperNote[];
  initialWorkSlips?: StepperWorkSlip[];
};

export function Stepper({
  inspectionId,
  propertyId,
  propertyName,
  inspectorName,
  items,
  initialResults,
  initialNotes = [],
  initialWorkSlips = [],
}: Props) {
  const router = useRouter();
  const [results, setResults] = useState<Map<string, StepperResult>>(
    () => new Map(initialResults.map((r) => [r.item_id, r]))
  );
  const [notes, setNotesList] = useState<StepperNote[]>(initialNotes);
  const [workSlips, setWorkSlips] = useState<StepperWorkSlip[]>(initialWorkSlips);
  const [activeIdx, setActiveIdx] = useState<number>(() => {
    const firstUnmarked = items.findIndex((i) => !initialResults.find((r) => r.item_id === i.id));
    return firstUnmarked === -1 ? items.length : firstUnmarked;
  });
  const [, startTransition] = useTransition();
  const [isCompleting, setIsCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showWorkSlipModal, setShowWorkSlipModal] = useState(false);

  const total = items.length;
  const markedCount = results.size;
  const showReview = activeIdx >= total;
  const activeItem = !showReview ? items[activeIdx] : null;
  const activeResult = activeItem ? results.get(activeItem.id) : null;

  // Notes / work slips for the active card (filtered from the full lists)
  const activeNotes = activeItem
    ? notes.filter((n) => n.inspection_item_id === activeItem.id)
    : [];
  const activeWorkSlips = activeItem
    ? workSlips.filter((ws) => ws.inspection_item_id === activeItem.id)
    : [];

  function applyOptimistic(next: StepperResult) {
    setResults((prev) => {
      const m = new Map(prev);
      m.set(next.item_id, next);
      return m;
    });
  }

  function persist(next: StepperResult) {
    startTransition(async () => {
      const res = await saveResult({
        inspectionId,
        itemId: next.item_id,
        status: next.status,
        notes: next.notes,
      });
      if (!res.ok) setError(res.error);
    });
  }

  function mark(status: InspectionStatus) {
    if (!activeItem) return;
    setError(null);
    const next: StepperResult = {
      item_id: activeItem.id,
      status,
      notes: activeResult?.notes ?? null,
    };
    applyOptimistic(next);
    persist(next);
    // Advance after a beat so the user sees their mark register
    setTimeout(() => setActiveIdx((i) => Math.min(i + 1, total)), 180);
  }

  async function submitNote(text: string, asProperty: boolean, photoUrls: string[]): Promise<string | null> {
    if (!activeItem) return 'No active card';
    const res = await addInspectionNote({
      inspectionId,
      propertyId,
      itemId: activeItem.id,
      text,
      noteType: asProperty ? 'PROPERTY_NOTE' : 'INSPECTION_NOTE',
      photoUrls,
    });
    if (!res.ok) return res.error;
    setNotesList((prev) => [
      ...prev,
      {
        id: res.id,
        inspection_item_id: activeItem.id,
        note_text: text.trim() || '(photo)',
        note_type: asProperty ? 'PROPERTY_NOTE' : 'INSPECTION_NOTE',
        author_email: '',
        created_at: new Date().toISOString(),
        photo_urls: photoUrls,
      },
    ]);
    return null;
  }

  async function submitWorkSlip(input: {
    title: string;
    description: string;
    location: string;
    category: WorkSlipCategory;
    priority: WorkSlipPriority;
    photoUrls: string[];
  }): Promise<string | null> {
    if (!activeItem) return 'No active card';
    const res = await createWorkSlipFromInspection({
      inspectionId,
      propertyId,
      itemId: activeItem.id,
      title: input.title,
      description: input.description,
      location: input.location,
      category: input.category,
      priority: input.priority,
      photoUrls: input.photoUrls,
    });
    if (!res.ok) return res.error;
    setWorkSlips((prev) => [
      ...prev,
      {
        id: res.id,
        inspection_item_id: activeItem.id,
        title: input.title.trim(),
        category: input.category,
        priority: input.priority,
        created_at: new Date().toISOString(),
        photo_urls: input.photoUrls,
      },
    ]);
    return null;
  }

  function goPrev() {
    if (activeIdx > 0) setActiveIdx(activeIdx - 1);
  }
  function goNext() {
    if (activeIdx < total) setActiveIdx(activeIdx + 1);
  }

  async function complete() {
    setError(null);
    setIsCompleting(true);
    try {
      await completeInspection(inspectionId);
      router.push(`/inspections/${inspectionId}/summary`);
    } catch (e) {
      setIsCompleting(false);
      setError(e instanceof Error ? e.message : 'Failed to complete');
    }
  }

  // ─── Review screen (after last card) ───────────────────────────────
  if (showReview) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <TopBar markedCount={markedCount} total={total} onExit={() => router.push('/inspections')} />

        <section className="max-w-[760px] mx-auto px-6 sm:px-10" style={{ paddingTop: 24, paddingBottom: 120, width: '100%', flex: 1 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>{propertyName} · {inspectorName}</div>
          <h1 className="font-serif" style={{ fontSize: 36, lineHeight: 1.05, fontWeight: 300, letterSpacing: '-0.02em' }}>
            All {total} cards. <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>Ready to wrap?</em>
          </h1>
          <p style={{ marginTop: 12, color: 'var(--ink-3)', fontSize: 14 }}>
            Tap any card to revisit. {markedCount} of {total} marked.
          </p>

          <div style={{ marginTop: 28, borderTop: '1px solid var(--ink)' }}>
            {items.map((it, idx) => {
              const r = results.get(it.id);
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setActiveIdx(idx)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '16px 0',
                    borderBottom: '1px solid var(--rule)',
                    display: 'grid',
                    gridTemplateColumns: '40px 1fr auto',
                    gap: 16,
                    alignItems: 'baseline',
                  }}
                >
                  <span className="font-mono" style={{ fontSize: 11, color: 'var(--signal)', letterSpacing: '.08em' }}>
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}>{it.title}</div>
                    {r?.notes && (
                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic' }}>
                        &ldquo;{r.notes}&rdquo;
                      </div>
                    )}
                  </div>
                  <StatusBadge status={r?.status ?? null} />
                </button>
              );
            })}
          </div>

          {error && <ErrorBlock error={error} />}
        </section>

        <BottomBar>
          <button
            type="button"
            onClick={goPrev}
            disabled={isCompleting}
            style={ghostBtn()}
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={complete}
            disabled={isCompleting || markedCount === 0}
            style={{ ...primaryBtn(), opacity: markedCount === 0 ? 0.5 : 1 }}
          >
            {isCompleting ? 'Completing…' : 'Complete Inspection →'}
          </button>
        </BottomBar>
      </div>
    );
  }

  // ─── Card screen ───────────────────────────────────────────────────
  if (!activeItem) return null;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <TopBar
        markedCount={markedCount}
        total={total}
        currentIdx={activeIdx}
        onExit={() => router.push('/inspections')}
      />

      {/* CARD */}
      <section
        className="max-w-[760px] mx-auto px-6 sm:px-10"
        style={{ paddingTop: 32, paddingBottom: 200, width: '100%', flex: 1 }}
      >
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          {(activeItem.item_category || 'EVERY_TIME').replaceAll('_', ' ')} &middot; {activeItem.category}
        </div>
        <h1
          className="font-serif"
          style={{
            fontSize: 32,
            lineHeight: 1.1,
            fontWeight: 400,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
          }}
        >
          {activeItem.title}
        </h1>
        {activeItem.description && (
          <p style={{ marginTop: 14, fontSize: 16, lineHeight: 1.5, color: 'var(--ink-3)' }}>
            {activeItem.description}
          </p>
        )}

        {/* Mark indicator (subtle, just so the inspector knows it's saved) */}
        {activeResult && (
          <div style={{ marginTop: 20 }}>
            <StatusBadge status={activeResult.status} />
          </div>
        )}

        {/* Notes + work slips already attached to this card */}
        {(activeNotes.length > 0 || activeWorkSlips.length > 0 || activeResult?.notes) && (
          <div style={{ marginTop: 24 }}>
            {activeResult?.notes && (
              <div
                style={{
                  marginBottom: 10,
                  padding: '10px 14px',
                  borderLeft: '2px solid var(--ink-4)',
                  background: 'var(--paper-2)',
                  fontSize: 13,
                  color: 'var(--ink-3)',
                  fontStyle: 'italic',
                }}
              >
                {activeResult.notes}
              </div>
            )}
            {activeNotes.map((n) => {
              const isPhotoOnly = n.note_text === '(photo)' && (n.photo_urls?.length ?? 0) > 0;
              const label = isPhotoOnly
                ? n.note_type === 'PROPERTY_NOTE'
                  ? 'Property Photo · pinned to folder'
                  : 'Photo'
                : n.note_type === 'PROPERTY_NOTE'
                  ? 'Property Note · pinned to folder'
                  : 'Inspection Note';
              return (
                <div
                  key={n.id}
                  style={{
                    marginBottom: 10,
                    padding: '10px 14px',
                    borderLeft: `2px solid ${n.note_type === 'PROPERTY_NOTE' ? 'var(--tide-deep)' : 'var(--ink-4)'}`,
                    background: 'var(--paper-2)',
                  }}
                >
                  <div style={{ fontSize: 9, letterSpacing: '.18em', textTransform: 'uppercase', color: n.note_type === 'PROPERTY_NOTE' ? 'var(--tide-deep)' : 'var(--ink-4)', marginBottom: 4, fontWeight: 600 }}>
                    {label}
                  </div>
                  {!isPhotoOnly && (
                    <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.4 }}>{n.note_text}</div>
                  )}
                  {n.photo_urls && n.photo_urls.length > 0 && <PhotoThumbs urls={n.photo_urls} size={64} />}
                </div>
              );
            })}
            {activeWorkSlips.map((ws) => (
              <div
                key={ws.id}
                style={{
                  marginBottom: 10,
                  padding: '10px 14px',
                  borderLeft: '2px solid var(--signal)',
                  background: 'var(--paper-2)',
                }}
              >
                <div style={{ fontSize: 9, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--signal)', marginBottom: 4, fontWeight: 600 }}>
                  Work Slip · {ws.priority}
                </div>
                <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.4 }}>{ws.title}</div>
                {ws.photo_urls && ws.photo_urls.length > 0 && <PhotoThumbs urls={ws.photo_urls} size={64} />}
              </div>
            ))}
          </div>
        )}

        {/* Action row: + Add note · + Photo · + Work slip */}
        <div style={{ marginTop: 24, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setShowNoteModal(true)}
            style={{
              background: 'none',
              border: '1px solid var(--rule)',
              padding: '10px 16px',
              fontSize: 11,
              letterSpacing: '.16em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
              cursor: 'pointer',
            }}
          >
            + Add note
          </button>
          <QuickPhotoButton
            folder={`inspections/${inspectionId.slice(0, 8)}/quick`}
            onPhoto={(url) => submitNote('', false, [url])}
          />
          <button
            type="button"
            onClick={() => setShowWorkSlipModal(true)}
            style={{
              background: 'none',
              border: '1px solid var(--signal)',
              color: 'var(--signal)',
              padding: '10px 16px',
              fontSize: 11,
              letterSpacing: '.16em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            + Work slip
          </button>
        </div>

        {error && <ErrorBlock error={error} />}
      </section>

      {/* MODALS */}
      {showNoteModal && activeItem && (
        <NoteModal
          itemTitle={activeItem.title}
          inspectionId={inspectionId}
          onClose={() => setShowNoteModal(false)}
          onSubmit={async (text, asProperty, photos) => {
            const err = await submitNote(text, asProperty, photos);
            if (err) return err;
            setShowNoteModal(false);
            return null;
          }}
        />
      )}
      {showWorkSlipModal && activeItem && (
        <WorkSlipModal
          itemTitle={activeItem.title}
          inspectionId={inspectionId}
          onClose={() => setShowWorkSlipModal(false)}
          onSubmit={async (input) => {
            const err = await submitWorkSlip(input);
            if (err) return err;
            setShowWorkSlipModal(false);
            return null;
          }}
        />
      )}

      {/* STICKY BOTTOM: 3 big tap targets + nav row */}
      <BottomBar>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, width: '100%' }}>
          <BigButton color="var(--negative)" label="Issue" onClick={() => mark('issue')} active={activeResult?.status === 'issue'} />
          <BigButton color="var(--ink-4)" label="N/A" onClick={() => mark('na')} active={activeResult?.status === 'na'} />
          <BigButton color="var(--positive)" label="Pass" onClick={() => mark('pass')} active={activeResult?.status === 'pass'} />
        </div>
        <div style={{ display: 'flex', gap: 8, width: '100%', marginTop: 8 }}>
          <button type="button" onClick={goPrev} disabled={activeIdx === 0} style={navBtn()}>
            ← {activeIdx === 0 ? 'Start' : 'Prev'}
          </button>
          <div
            style={{
              flex: 1,
              fontSize: 11,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              color: 'var(--ink-4)',
              alignSelf: 'center',
              textAlign: 'center',
            }}
          >
            {activeIdx + 1} of {total}
          </div>
          <button type="button" onClick={goNext} style={navBtn()}>
            Skip →
          </button>
        </div>
      </BottomBar>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function TopBar({
  markedCount,
  total,
  currentIdx,
  onExit,
}: {
  markedCount: number;
  total: number;
  currentIdx?: number;
  onExit: () => void;
}) {
  const pct = total > 0 ? Math.round((markedCount / total) * 100) : 0;
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        background: 'var(--paper)',
        borderBottom: '1px solid var(--ink)',
      }}
    >
      <div className="max-w-[760px] mx-auto px-6 sm:px-10 flex items-center justify-between" style={{ padding: '12px 24px' }}>
        <Link
          href="/inspections"
          onClick={(e) => {
            e.preventDefault();
            onExit();
          }}
          style={{
            fontSize: 11,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            textDecoration: 'none',
          }}
        >
          ← Exit
        </Link>
        <span
          style={{
            fontSize: 11,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            fontWeight: 500,
          }}
        >
          {currentIdx != null ? `${currentIdx + 1} / ${total}` : `${markedCount} / ${total} marked`}
        </span>
      </div>
      <div style={{ height: 2, background: 'var(--rule-soft)' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: 'var(--signal)',
            transition: 'width 0.2s ease',
          }}
        />
      </div>
    </header>
  );
}

function BottomBar({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'var(--paper)',
        borderTop: '1px solid var(--ink)',
        zIndex: 20,
      }}
    >
      <div
        className="max-w-[760px] mx-auto px-6 sm:px-10"
        style={{
          padding: '12px 24px calc(12px + env(safe-area-inset-bottom, 0px))',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function BigButton({ color, label, onClick, active }: { color: string; label: string; onClick: () => void; active: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? color : 'transparent',
        color: active ? 'var(--paper)' : color,
        border: `2px solid ${color}`,
        padding: '18px 0',
        fontSize: 13,
        letterSpacing: '.2em',
        textTransform: 'uppercase',
        fontWeight: 700,
        cursor: 'pointer',
        minHeight: 56,
      }}
    >
      {label}
    </button>
  );
}

function navBtn(): React.CSSProperties {
  return {
    background: 'transparent',
    border: '1px solid var(--rule)',
    padding: '8px 14px',
    fontSize: 11,
    letterSpacing: '.16em',
    textTransform: 'uppercase',
    color: 'var(--ink-3)',
    cursor: 'pointer',
  };
}

function ghostBtn(): React.CSSProperties {
  return {
    background: 'transparent',
    border: '1px solid var(--rule)',
    padding: '14px 20px',
    fontSize: 12,
    letterSpacing: '.18em',
    textTransform: 'uppercase',
    color: 'var(--ink-3)',
    cursor: 'pointer',
    minHeight: 48,
  };
}

function primaryBtn(): React.CSSProperties {
  return {
    background: 'var(--ink)',
    color: 'var(--paper)',
    border: 'none',
    padding: '14px 20px',
    fontSize: 12,
    letterSpacing: '.18em',
    textTransform: 'uppercase',
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: 48,
    flex: 1,
  };
}

function StatusBadge({ status }: { status: InspectionStatus | null }) {
  if (!status) {
    return (
      <span
        style={{
          fontSize: 10,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
        }}
      >
        Unmarked
      </span>
    );
  }
  const color =
    status === 'pass' ? 'var(--positive)' :
    status === 'issue' ? 'var(--negative)' :
    'var(--ink-4)';
  const label = status.toUpperCase();
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 10px',
        border: `1px solid ${color}`,
        color,
        fontSize: 10,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  );
}

function NoteModal({
  itemTitle,
  inspectionId,
  onClose,
  onSubmit,
}: {
  itemTitle: string;
  inspectionId: string;
  onClose: () => void;
  onSubmit: (text: string, asProperty: boolean, photoUrls: string[]) => Promise<string | null>;
}) {
  const [text, setText] = useState('');
  const [asProperty, setAsProperty] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = text.trim().length > 0 || photos.length > 0;

  async function handleSubmit() {
    if (!canSubmit) return;
    setErr(null);
    setSubmitting(true);
    const e = await onSubmit(text, asProperty, photos);
    setSubmitting(false);
    if (e) setErr(e);
  }

  return (
    <ModalShell onClose={onClose} title="Add a Note" subtitle={`Re: ${itemTitle}`}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>Note</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
        rows={4}
        placeholder="e.g., Owner prefers thermostat at 68°F in winter…"
        style={modalTextareaStyle()}
      />
      <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
        {text.length} / 1000
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Photos</div>
        <PhotoUploader
          value={photos}
          onChange={setPhotos}
          folder={`inspections/${inspectionId.slice(0, 8)}/notes`}
          disabled={submitting}
        />
      </div>

      <label
        style={{
          marginTop: 16,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: '12px 14px',
          border: '1px solid var(--rule)',
          background: asProperty ? 'var(--paper-2)' : 'transparent',
          cursor: 'pointer',
          transition: 'background 0.15s ease',
        }}
      >
        <input
          type="checkbox"
          checked={asProperty}
          onChange={(e) => setAsProperty(e.target.checked)}
          style={{ marginTop: 2, accentColor: 'var(--tide-deep)' }}
        />
        <div>
          <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
            Pin to property folder
          </div>
          <div style={{ marginTop: 2, fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.4 }}>
            Visible on the property folder, persists across inspections so the next inspector sees it on arrival.
          </div>
        </div>
      </label>

      <div
        style={{
          marginTop: 14,
          padding: '8px 12px',
          background: 'var(--paper-2)',
          fontSize: 11,
          color: 'var(--ink-3)',
          lineHeight: 1.5,
        }}
      >
        Notes are observations only — no action required. They won&apos;t appear in work queues or affect scoring.
      </div>

      {err && <ErrorBlock error={err} />}

      <ModalActions
        onCancel={onClose}
        onSubmit={handleSubmit}
        submitLabel={submitting ? 'Saving…' : 'Save Note'}
        submitDisabled={submitting || !canSubmit}
      />
    </ModalShell>
  );
}

function WorkSlipModal({
  itemTitle,
  inspectionId,
  onClose,
  onSubmit,
}: {
  itemTitle: string;
  inspectionId: string;
  onClose: () => void;
  onSubmit: (input: {
    title: string;
    description: string;
    location: string;
    category: WorkSlipCategory;
    priority: WorkSlipPriority;
    photoUrls: string[];
  }) => Promise<string | null>;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState<WorkSlipCategory>('maintenance');
  const [priority, setPriority] = useState<WorkSlipPriority>('normal');
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit() {
    if (!title.trim()) return;
    setErr(null);
    setSubmitting(true);
    const e = await onSubmit({ title, description, location, category, priority, photoUrls: photos });
    setSubmitting(false);
    if (e) setErr(e);
  }

  return (
    <ModalShell onClose={onClose} title="New Work Slip" subtitle={`From: ${itemTitle}`}>
      <FieldLabel>Title</FieldLabel>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
        placeholder="Brief description of the issue"
        style={modalInputStyle()}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
        <div>
          <FieldLabel>Category</FieldLabel>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as WorkSlipCategory)}
            style={modalSelectStyle()}
          >
            <option value="maintenance">Maintenance</option>
            <option value="owner">Owner</option>
            <option value="vendor">Vendor</option>
            <option value="rising_tide">Rising Tide</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <FieldLabel>Priority</FieldLabel>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as WorkSlipPriority)}
            style={modalSelectStyle()}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <FieldLabel>Location / Area (optional)</FieldLabel>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g., Kitchen, Primary Bath"
          style={modalInputStyle()}
        />
      </div>

      <div style={{ marginTop: 14 }}>
        <FieldLabel>Description / Notes</FieldLabel>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Additional details about the issue…"
          style={modalTextareaStyle()}
        />
      </div>

      <div style={{ marginTop: 14 }}>
        <FieldLabel>Photos (optional)</FieldLabel>
        <PhotoUploader
          value={photos}
          onChange={setPhotos}
          folder={`inspections/${inspectionId.slice(0, 8)}/work_slips`}
          disabled={submitting}
        />
      </div>

      {err && <ErrorBlock error={err} />}

      <ModalActions
        onCancel={onClose}
        onSubmit={handleSubmit}
        submitLabel={submitting ? 'Creating…' : 'Create Work Slip'}
        submitDisabled={submitting || !title.trim()}
      />
    </ModalShell>
  );
}

// ─── Modal primitives ─────────────────────────────────────────────

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Stop scroll on body while modal is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(30, 46, 52, 0.55)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        padding: 0,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          background: 'var(--paper)',
          borderTop: '1px solid var(--ink)',
          padding: '24px 24px calc(24px + env(safe-area-inset-bottom, 0px))',
          maxHeight: '92vh',
          overflowY: 'auto',
        }}
      >
        <div className="flex items-start justify-between" style={{ marginBottom: 14 }}>
          <div>
            <h2
              className="font-serif"
              style={{
                fontSize: 22,
                fontWeight: 400,
                letterSpacing: '-0.01em',
                color: 'var(--ink)',
                margin: 0,
              }}
            >
              {title}
            </h2>
            {subtitle && (
              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)' }}>{subtitle}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              fontSize: 22,
              color: 'var(--ink-3)',
              cursor: 'pointer',
              lineHeight: 1,
              padding: '0 4px',
            }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({
  onCancel,
  onSubmit,
  submitLabel,
  submitDisabled,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
  submitDisabled: boolean;
}) {
  return (
    <div
      style={{
        marginTop: 22,
        display: 'flex',
        gap: 10,
        justifyContent: 'flex-end',
        borderTop: '1px solid var(--rule)',
        paddingTop: 16,
      }}
    >
      <button
        type="button"
        onClick={onCancel}
        style={{
          background: 'transparent',
          border: '1px solid var(--rule)',
          padding: '12px 18px',
          fontSize: 11,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
          cursor: 'pointer',
        }}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={submitDisabled}
        style={{
          background: submitDisabled ? 'var(--ink-4)' : 'var(--ink)',
          color: 'var(--paper)',
          border: 'none',
          padding: '12px 22px',
          fontSize: 11,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          fontWeight: 600,
          cursor: submitDisabled ? 'not-allowed' : 'pointer',
        }}
      >
        {submitLabel}
      </button>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="eyebrow" style={{ marginBottom: 6 }}>{children}</div>
  );
}

function modalInputStyle(): React.CSSProperties {
  return {
    width: '100%',
    background: 'transparent',
    border: '1px solid var(--rule)',
    padding: '10px 12px',
    fontSize: 14,
    color: 'var(--ink)',
    outline: 'none',
    fontFamily: 'inherit',
  };
}

function modalSelectStyle(): React.CSSProperties {
  return {
    ...modalInputStyle(),
    cursor: 'pointer',
  };
}

function modalTextareaStyle(): React.CSSProperties {
  return {
    ...modalInputStyle(),
    resize: 'vertical' as const,
    minHeight: 80,
  };
}

function ErrorBlock({ error }: { error: string }) {
  return (
    <div
      style={{
        marginTop: 24,
        padding: '10px 14px',
        borderLeft: '3px solid var(--negative)',
        background: 'var(--paper-2)',
        fontSize: 12,
        color: 'var(--negative)',
      }}
    >
      {error}
    </div>
  );
}

/**
 * One-shot camera/photo button. Tapping opens the device camera (or the
 * file picker on desktop), uploads the chosen image to /api/upload, then
 * fires `onPhoto(url)` so the parent can persist it.
 *
 * Used on the inspection card as a frictionless "just snap it" shortcut
 * — no modal, no text required. The parent attaches the URL to a
 * photo-only inspection note via the existing addInspectionNote action.
 */
function QuickPhotoButton({
  onPhoto,
  folder,
  disabled,
}: {
  onPhoto: (url: string) => Promise<string | null>;
  folder?: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleFile(rawFile: File) {
    setErr(null);
    setUploading(true);
    try {
      const file = await compressImage(rawFile);
      const fd = new FormData();
      fd.append('file', file);
      if (folder) fd.append('folder', folder);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const body = (await res.json()) as { ok?: boolean; url?: string; error?: string };
      if (!res.ok || !body.url) {
        setErr(body.error || `Upload failed (HTTP ${res.status})`);
      } else {
        const persistErr = await onPhoto(body.url);
        if (persistErr) setErr(persistErr);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        disabled={disabled || uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading}
        style={{
          background: 'none',
          border: '1px solid var(--tide-deep)',
          color: 'var(--tide-deep)',
          padding: '10px 16px',
          fontSize: 11,
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          cursor: uploading ? 'wait' : 'pointer',
          fontWeight: 600,
        }}
      >
        {uploading ? 'Uploading…' : '+ Photo'}
      </button>
      {err && (
        <div
          role="alert"
          style={{
            flexBasis: '100%',
            marginTop: 8,
            padding: '8px 12px',
            borderLeft: '3px solid var(--negative)',
            background: 'var(--paper-2)',
            fontSize: 12,
            color: 'var(--negative)',
          }}
        >
          {err}
        </div>
      )}
    </>
  );
}
