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
import { INSPECTION_SUPPLIES } from '@/lib/inspection-supplies';

/**
 * One deck card. For zone-mapped properties the same template item can
 * appear multiple times with different zoneIds (e.g. three bathrooms);
 * `cardKey` is a stable composite ID used for React state.
 */
type StepperCard = {
  cardKey: string;
  itemId: string;
  zoneId: string | null;
  title: string;
  description: string | null;
  category: string;
  item_category: string | null;
  zoneName: string | null;
  zoneFloorLabel: string | null;
  walkOrder: number | null;
};

type StepperResult = {
  item_id: string;
  zone_id: string | null;
  status: InspectionStatus;
  notes: string | null;
};

function cardKeyOf(itemId: string, zoneId: string | null): string {
  return `${itemId}::${zoneId ?? '_'}`;
}

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
  cards: StepperCard[];
  initialResults: StepperResult[];
  initialNotes?: StepperNote[];
  initialWorkSlips?: StepperWorkSlip[];
};

export function Stepper({
  inspectionId,
  propertyId,
  propertyName,
  inspectorName,
  cards,
  initialResults,
  initialNotes = [],
  initialWorkSlips = [],
}: Props) {
  const router = useRouter();
  const [results, setResults] = useState<Map<string, StepperResult>>(
    () => new Map(initialResults.map((r) => [cardKeyOf(r.item_id, r.zone_id), r]))
  );
  const [notes, setNotesList] = useState<StepperNote[]>(initialNotes);
  const [workSlips, setWorkSlips] = useState<StepperWorkSlip[]>(initialWorkSlips);
  const [activeIdx, setActiveIdx] = useState<number>(() => {
    const firstUnmarked = cards.findIndex(
      (c) => !initialResults.find((r) => r.item_id === c.itemId && r.zone_id === c.zoneId),
    );
    return firstUnmarked === -1 ? cards.length : firstUnmarked;
  });
  const [, startTransition] = useTransition();
  const [isCompleting, setIsCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showWorkSlipModal, setShowWorkSlipModal] = useState(false);

  // Supplies Check (shown on the review screen). Each toggle defaults to
  // OK; flipping it ON marks that supply as low, which becomes a restock
  // work slip on Complete Inspection. State holds the keys currently low.
  const [suppliesLow, setSuppliesLow] = useState<Set<string>>(() => new Set());
  function toggleSupply(key: string) {
    setSuppliesLow((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const total = cards.length;
  const markedCount = results.size;
  const showReview = activeIdx >= total;
  const activeCard = !showReview ? cards[activeIdx] : null;
  const activeResult = activeCard ? results.get(activeCard.cardKey) : null;

  // Notes / work slips for the active card. Keyed by inspection_item_id
  // for now — if the same template item is on multiple zone cards, notes
  // attached to it will surface on all of them. Per-zone scoping is a
  // follow-up; the current behavior is conservative (more visibility,
  // never less).
  const activeNotes = activeCard
    ? notes.filter((n) => n.inspection_item_id === activeCard.itemId)
    : [];
  const activeWorkSlips = activeCard
    ? workSlips.filter((ws) => ws.inspection_item_id === activeCard.itemId)
    : [];

  function applyOptimistic(card: StepperCard, next: StepperResult) {
    setResults((prev) => {
      const m = new Map(prev);
      m.set(card.cardKey, next);
      return m;
    });
  }

  function persist(card: StepperCard, next: StepperResult) {
    startTransition(async () => {
      const res = await saveResult({
        inspectionId,
        itemId: card.itemId,
        zoneId: card.zoneId,
        status: next.status,
        notes: next.notes,
      });
      if (!res.ok) setError(res.error);
    });
  }

  function mark(status: InspectionStatus) {
    if (!activeCard) return;
    setError(null);
    const next: StepperResult = {
      item_id: activeCard.itemId,
      zone_id: activeCard.zoneId,
      status,
      notes: activeResult?.notes ?? null,
    };
    applyOptimistic(activeCard, next);
    persist(activeCard, next);
    // Advance after a beat so the user sees their mark register
    setTimeout(() => setActiveIdx((i) => Math.min(i + 1, total)), 180);
  }

  async function submitNote(text: string, asProperty: boolean, photoUrls: string[]): Promise<string | null> {
    if (!activeCard) return 'No active card';
    const res = await addInspectionNote({
      inspectionId,
      propertyId,
      itemId: activeCard.itemId,
      text,
      noteType: asProperty ? 'PROPERTY_NOTE' : 'INSPECTION_NOTE',
      photoUrls,
    });
    if (!res.ok) return res.error;
    setNotesList((prev) => [
      ...prev,
      {
        id: res.id,
        inspection_item_id: activeCard.itemId,
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
    // activeCard is optional: the inspector can open the work-slip modal
    // from the inspection top bar to flag something they noticed while
    // walking that isn't tied to the card they're currently on. In that
    // case inspection_item_id stays null so the slip is filed against the
    // inspection (and via inspection -> property) without lying about
    // which checklist item caused it.
    const itemId = activeCard?.itemId ?? null;
    const res = await createWorkSlipFromInspection({
      inspectionId,
      propertyId,
      itemId,
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
        inspection_item_id: itemId,
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
      await completeInspection(inspectionId, { suppliesLow: Array.from(suppliesLow) });
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
        <TopBar
          markedCount={markedCount}
          total={total}
          onExit={() => router.push('/inspections')}
          onAddSlip={() => setShowWorkSlipModal(true)}
        />

        <section className="max-w-[760px] mx-auto px-6 sm:px-10" style={{ paddingTop: 24, paddingBottom: 120, width: '100%', flex: 1 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>{propertyName} · {inspectorName}</div>
          <h1 className="font-serif" style={{ fontSize: 36, lineHeight: 1.05, fontWeight: 300, letterSpacing: '-0.02em' }}>
            All {total} cards. <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>Ready to wrap?</em>
          </h1>
          <p style={{ marginTop: 12, color: 'var(--ink-3)', fontSize: 14 }}>
            Tap any card to revisit. {markedCount} of {total} marked.
          </p>

          <div style={{ marginTop: 28, borderTop: '1px solid var(--ink)' }}>
            {cards.map((card, idx) => {
              const r = results.get(card.cardKey);
              return (
                <button
                  key={card.cardKey}
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
                    {card.zoneName && (
                      <div
                        style={{
                          fontSize: 10,
                          letterSpacing: '.18em',
                          textTransform: 'uppercase',
                          color: 'var(--tide-deep)',
                          fontWeight: 600,
                          marginBottom: 2,
                        }}
                      >
                        {card.zoneName}
                        {card.zoneFloorLabel && (
                          <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>
                            {' · '}
                            {card.zoneFloorLabel}
                          </span>
                        )}
                      </div>
                    )}
                    <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}>{card.title}</div>
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

          {/* SUPPLIES CHECK — defaults to all OK; flipped toggles become
              one Rising Tide restock work slip per supply on Complete. */}
          <SuppliesCheck low={suppliesLow} onToggle={toggleSupply} />

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
  if (!activeCard) return null;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <TopBar
        markedCount={markedCount}
        total={total}
        currentIdx={activeIdx}
        onExit={() => router.push('/inspections')}
        onAddSlip={() => setShowWorkSlipModal(true)}
      />

      {/* CARD */}
      <section
        className="max-w-[760px] mx-auto px-6 sm:px-10"
        style={{ paddingTop: 32, paddingBottom: 200, width: '100%', flex: 1 }}
      >
        {activeCard.zoneName && (
          <div
            style={{
              marginBottom: 16,
              paddingBottom: 12,
              borderBottom: '1px solid var(--rule-soft)',
            }}
          >
            <div
              style={{
                fontSize: 10,
                letterSpacing: '.22em',
                textTransform: 'uppercase',
                color: 'var(--ink-4)',
                fontWeight: 500,
                marginBottom: 4,
              }}
            >
              {activeCard.walkOrder != null ? `Stop ${activeCard.walkOrder}` : 'Zone'}
              {activeCard.zoneFloorLabel && ` · ${activeCard.zoneFloorLabel}`}
            </div>
            <div
              className="font-serif"
              style={{
                fontSize: 22,
                fontWeight: 400,
                letterSpacing: '-0.01em',
                color: 'var(--tide-deep)',
              }}
            >
              {activeCard.zoneName}
            </div>
          </div>
        )}
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          {(activeCard.item_category || 'EVERY_TIME').replaceAll('_', ' ')} &middot; {activeCard.category}
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
          {activeCard.title}
        </h1>
        {activeCard.description && (
          <p style={{ marginTop: 14, fontSize: 16, lineHeight: 1.5, color: 'var(--ink-3)' }}>
            {activeCard.description}
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
        <div className="rt-stepper-actions" style={{ marginTop: 24, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
      {showNoteModal && activeCard && (
        <NoteModal
          itemTitle={activeCard.title}
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
      {showWorkSlipModal && (
        <WorkSlipModal
          // Card-scoped when there's an active card (per-item slip from
          // the action row), otherwise property-scoped (top-bar quick
          // slip for stuff spotted between cards). Subtitle reflects
          // which mode the operator is in.
          itemTitle={activeCard ? activeCard.title : propertyName}
          scope={activeCard ? 'card' : 'property'}
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
  onAddSlip,
}: {
  markedCount: number;
  total: number;
  currentIdx?: number;
  onExit: () => void;
  /**
   * Optional: when provided, the top bar shows a "+ Slip" affordance so
   * the inspector can capture a property-level work slip the moment they
   * spot something mid-walk that isn't tied to the active card.
   */
  onAddSlip?: () => void;
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
      <div className="max-w-[760px] mx-auto px-6 sm:px-10 flex items-center justify-between" style={{ padding: '12px 24px', gap: 12 }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {onAddSlip && (
            <button
              type="button"
              onClick={onAddSlip}
              style={{
                background: 'transparent',
                border: '1px solid var(--rule)',
                padding: '6px 10px',
                fontSize: 10,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                color: 'var(--ink-2)',
                cursor: 'pointer',
                fontWeight: 500,
              }}
              title="Capture a property-level work slip without leaving the inspection"
            >
              + Slip
            </button>
          )}
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

function SuppliesCheck({
  low,
  onToggle,
}: {
  low: Set<string>;
  onToggle: (key: string) => void;
}) {
  const lowCount = low.size;
  return (
    <div style={{ marginTop: 40 }}>
      <div className="flex items-baseline justify-between" style={{ marginBottom: 6 }}>
        <h2
          className="font-serif"
          style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}
        >
          Supplies Check
        </h2>
        <span
          className="eyebrow"
          style={{ color: lowCount > 0 ? 'var(--signal)' : 'var(--ink-4)' }}
        >
          {lowCount === 0 ? 'all stocked' : `${lowCount} low — restock slip${lowCount === 1 ? '' : 's'} on complete`}
        </span>
      </div>
      <p style={{ marginTop: 0, marginBottom: 12, fontSize: 13, color: 'var(--ink-3)' }}>
        Mark anything we&rsquo;re low on so we can restock. Each flagged item creates a work slip on this property.
      </p>
      <div style={{ borderTop: '1px solid var(--ink)' }}>
        {INSPECTION_SUPPLIES.map((s) => {
          const isLow = low.has(s.key);
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onToggle(s.key)}
              aria-pressed={isLow}
              style={{
                width: '100%',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '14px 0',
                borderBottom: '1px solid var(--rule)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}>
                {s.label}
              </span>
              <SupplyToggle isLow={isLow} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SupplyToggle({ isLow }: { isLow: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        userSelect: 'none',
      }}
    >
      <span
        style={{
          fontSize: 10,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          fontWeight: 600,
          color: isLow ? 'var(--signal)' : 'var(--ink-4)',
          minWidth: 26,
          textAlign: 'right',
        }}
      >
        {isLow ? 'Low' : 'OK'}
      </span>
      <span
        style={{
          position: 'relative',
          width: 38,
          height: 22,
          borderRadius: 11,
          background: isLow ? 'var(--signal)' : 'var(--rule)',
          transition: 'background 120ms',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: isLow ? 18 : 2,
            width: 18,
            height: 18,
            borderRadius: 9,
            background: 'var(--paper)',
            transition: 'left 120ms',
            boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
          }}
        />
      </span>
    </span>
  );
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
  scope = 'card',
  inspectionId,
  onClose,
  onSubmit,
}: {
  itemTitle: string;
  /**
   * 'card' = filed against a specific checklist card (default, "From: <card>").
   * 'property' = a free-floating slip spotted mid-walk, not tied to a card
   * ("On: <property>").
   */
  scope?: 'card' | 'property';
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
  // Defaults (category=maintenance, priority=normal) are right for the
  // vast majority of inspection-driven slips, so we hide all three of
  // Category / Priority / Location behind one "More details" toggle.
  // Default visible form becomes just Title + Description, which fits
  // on a phone with the keyboard up. Auto-expand if the operator already
  // changed any of them away from their defaults (e.g. they opened the
  // panel, set High priority, then closed and reopened the panel — we
  // shouldn't pretend the change isn't there).
  const [moreOpen, setMoreOpen] = useState(false);
  // Same pattern for photos: deferred until needed. Auto-expand if any
  // photo is already attached so reopening mid-flow doesn't hide it.
  const [photosOpen, setPhotosOpen] = useState(false);

  async function handleSubmit() {
    if (!title.trim()) return;
    setErr(null);
    setSubmitting(true);
    const e = await onSubmit({ title, description, location, category, priority, photoUrls: photos });
    setSubmitting(false);
    if (e) setErr(e);
  }

  // "More details" auto-expands if any of its fields drifted off defaults,
  // so a half-filled panel never gets hidden behind the toggle.
  const showMore = moreOpen || !!location.trim() || category !== 'maintenance' || priority !== 'normal';

  return (
    <ModalShell
      onClose={onClose}
      title="New Work Slip"
      subtitle={scope === 'property' ? `On: ${itemTitle}` : `From: ${itemTitle}`}
    >
      {/* No explicit field labels for the two everyday fields - the
          placeholders carry the meaning, the modal title carries the
          intent, and stripping the labels saves two label-rows of
          vertical chrome which is what was making the form feel busy. */}
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
        placeholder="Title — what's the issue?"
        style={modalInputStyle()}
      />

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="More details (optional)"
        style={{ ...modalTextareaStyle(), marginTop: 10 }}
      />

      {/* Optional sections. Defaults to a row of two small inline text
          links - dramatically lighter than the previous full-width
          dashed buttons, but still clear and tappable. Each link
          expands its section inline when tapped. */}
      {!showMore && !(photosOpen || photos.length > 0) && (
        <div
          style={{
            display: 'flex',
            gap: 18,
            marginTop: 12,
            fontSize: 12,
            color: 'var(--ink-3)',
          }}
        >
          <button type="button" onClick={() => setMoreOpen(true)} style={inlineLinkStyle}>
            + Details
          </button>
          <button type="button" onClick={() => setPhotosOpen(true)} style={inlineLinkStyle}>
            + Photo
          </button>
        </div>
      )}

      {showMore && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <FieldLabel>Category</FieldLabel>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as WorkSlipCategory)}
                style={modalSelectStyle()}
              >
                <option value="maintenance">Maintenance</option>
                <option value="inventory">Inventory</option>
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
          <div style={{ marginTop: 10 }}>
            <FieldLabel>Location (optional)</FieldLabel>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g., Kitchen, Primary Bath"
              style={modalInputStyle()}
            />
          </div>
          {!photosOpen && photos.length === 0 && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-3)' }}>
              <button type="button" onClick={() => setPhotosOpen(true)} style={inlineLinkStyle}>
                + Photo
              </button>
            </div>
          )}
        </div>
      )}

      {(photosOpen || photos.length > 0) && (
        <div style={{ marginTop: 14 }}>
          <FieldLabel>Photos</FieldLabel>
          <PhotoUploader
            value={photos}
            onChange={setPhotos}
            folder={`inspections/${inspectionId.slice(0, 8)}/work_slips`}
            disabled={submitting}
          />
          {!showMore && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-3)' }}>
              <button type="button" onClick={() => setMoreOpen(true)} style={inlineLinkStyle}>
                + Details
              </button>
            </div>
          )}
        </div>
      )}

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
  const sheetRef = useRef<HTMLDivElement | null>(null);

  // Stop scroll on body while modal is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // When an input inside the modal gains focus, slide it into the middle
  // of the visible scroll area. iOS won't reliably do this on its own
  // once the soft keyboard takes over the bottom of the screen, which is
  // why typing into the Description box used to drift it off-screen and
  // make scrolling feel broken (Dotti's "very hard to scroll up or down"
  // complaint). The setTimeout gives the keyboard a beat to come up so
  // we measure against the shrunken viewport, not the pre-keyboard one.
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    function onFocusIn(e: FocusEvent) {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const tag = t.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return;
      setTimeout(() => {
        try {
          t.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } catch {
          // Older Safari can throw on smooth scroll inside contained
          // overflow; the fallthrough is fine, the input is at worst
          // where iOS originally placed it.
        }
      }, 240);
    }
    el.addEventListener('focusin', onFocusIn);
    return () => el.removeEventListener('focusin', onFocusIn);
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
        // 12px breathing room on left/right/bottom so the sheet reads as
        // a contained card with visible dimmed margin on every side
        // ("bleed area" was the complaint), not as a slab pulled up over
        // the whole bottom of the screen. Top is left to the alignItems +
        // maxHeight combo so a much larger background tap zone shows
        // above the sheet on phones.
        padding: '0 12px 12px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        style={{
          width: '100%',
          // Narrower (was 520) so the modal feels like a card on tablets
          // and desktop, not a full document. On a phone the screen is
          // narrower than this anyway so the overlay's 12px side padding
          // is what creates the visible bleed there.
          maxWidth: 440,
          background: 'var(--paper)',
          // Floating card shape: all four corners rounded, drop shadow
          // for elevation off the dimmed backdrop. No more borderTop —
          // the card floats above the bottom edge now, so there is no
          // "shared edge" with the viewport to brace against.
          borderRadius: 14,
          boxShadow: '0 12px 36px rgba(30, 46, 52, 0.22)',
          // Inner padding tightened (was 20) so the card itself is
          // smaller and the dimmed margin reads as more generous by
          // contrast.
          padding: '16px 16px calc(16px + env(safe-area-inset-bottom, 0px))',
          // Caps: 480px absolute (form fits comfortably on a phone with
          // the keyboard up) AND 72dvh (so on a small viewport it still
          // leaves visible background above). The smaller wins.
          maxHeight: 'min(480px, 72dvh)',
          overflowY: 'auto',
          // Keep scroll touches inside the modal — otherwise iOS Safari
          // sometimes propagates the touch to the page underneath and
          // the modal stops scrolling mid-gesture. Pair with -webkit
          // momentum scroll so the gesture feels native.
          overscrollBehavior: 'contain',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <div className="flex items-start justify-between" style={{ marginBottom: 14 }}>
          <div>
            <h2
              className="font-serif"
              style={{
                // Was 22 / weight 400 (display size). Dropped to 18 / 500
                // so the heading reads as form chrome rather than as the
                // first paragraph of a magazine spread, which is what was
                // making the modal feel heavy even before any content.
                fontSize: 18,
                fontWeight: 500,
                letterSpacing: '-0.01em',
                color: 'var(--ink)',
                margin: 0,
              }}
            >
              {title}
            </h2>
            {subtitle && (
              <div style={{ marginTop: 2, fontSize: 11, color: 'var(--ink-4)' }}>{subtitle}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              // 40x40 touch target — the old 22px font with 0/4 padding
              // gave a sub-30px tap zone that was easy to miss on a phone
              // (and the keyboard chrome sat right next to it).
              background: 'none',
              border: 'none',
              fontSize: 24,
              color: 'var(--ink-3)',
              cursor: 'pointer',
              lineHeight: 1,
              width: 40,
              height: 40,
              marginRight: -8,
              marginTop: -8,
              padding: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
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
        // Stuck to the bottom of the scrolling modal sheet. Negative
        // side-margins cancel the sheet's 16px padding so the bar runs
        // edge-to-edge and the opaque background hides content scrolling
        // underneath it. Negative bottom margin (and bottom: 0) pin the
        // bar's bottom edge flush with the scroll container's bottom,
        // counteracting the sheet's bottom padding so it sits right at
        // the visible edge — including when iOS shrinks the viewport for
        // the keyboard (dvh on the sheet does the rest). The radius
        // matches the sheet so the bar tucks cleanly inside the rounded
        // bottom corners of the card.
        position: 'sticky',
        bottom: 0,
        marginTop: 16,
        marginLeft: -16,
        marginRight: -16,
        marginBottom: 'calc(-16px - env(safe-area-inset-bottom, 0px))',
        display: 'flex',
        gap: 10,
        justifyContent: 'flex-end',
        background: 'var(--paper)',
        borderTop: '1px solid var(--rule)',
        borderBottomLeftRadius: 14,
        borderBottomRightRadius: 14,
        padding: '12px 16px calc(12px + env(safe-area-inset-bottom, 0px))',
        zIndex: 1,
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

// Lightweight text-only "+ Details" / "+ Photo" links the work-slip modal
// uses to open optional sections. Way less visual weight than the
// previous full-width dashed buttons, but still obvious and tappable.
const inlineLinkStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 12,
  color: 'var(--tide-deep)',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
};

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
