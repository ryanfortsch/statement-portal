'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { saveResult, completeInspection } from '../actions';
import type { InspectionStatus } from '@/lib/inspections-types';

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

type Props = {
  inspectionId: string;
  propertyName: string;
  inspectorName: string;
  items: StepperItem[];
  initialResults: StepperResult[];
};

export function Stepper({ inspectionId, propertyName, inspectorName, items, initialResults }: Props) {
  const router = useRouter();
  const [results, setResults] = useState<Map<string, StepperResult>>(
    () => new Map(initialResults.map((r) => [r.item_id, r]))
  );
  const [activeIdx, setActiveIdx] = useState<number>(() => {
    const firstUnmarked = items.findIndex((i) => !initialResults.find((r) => r.item_id === i.id));
    return firstUnmarked === -1 ? items.length : firstUnmarked;
  });
  const [, startTransition] = useTransition();
  const [isCompleting, setIsCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);

  const total = items.length;
  const markedCount = results.size;
  const showReview = activeIdx >= total;
  const activeItem = !showReview ? items[activeIdx] : null;
  const activeResult = activeItem ? results.get(activeItem.id) : null;

  // Reset notes panel when switching cards
  useEffect(() => {
    setShowNotes(!!activeResult?.notes);
  }, [activeIdx, activeResult?.notes]);

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

  function setNotes(text: string) {
    if (!activeItem) return;
    const trimmed = text.trim();
    const cur = results.get(activeItem.id);
    if (!cur) {
      // Notes typed before status — keep locally only
      const next: StepperResult = {
        item_id: activeItem.id,
        status: 'pass' as InspectionStatus,
        notes: trimmed || null,
      };
      // Do NOT auto-mark as pass; just hold the note locally until status is chosen
      setResults((prev) => {
        const m = new Map(prev);
        m.set(activeItem.id, { ...next, status: 'pass' });
        // Remove the entry if there's no status decision and no notes — sentinel
        if (!trimmed) m.delete(activeItem.id);
        return m;
      });
      return;
    }
    const next: StepperResult = { ...cur, notes: trimmed || null };
    applyOptimistic(next);
    persist(next);
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
          {(activeItem.item_category || 'EVERY_TIME').replace('_', ' ')} &middot; {activeItem.category}
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

        {/* Notes (collapsible) */}
        <div style={{ marginTop: 28 }}>
          {!showNotes ? (
            <button
              type="button"
              onClick={() => setShowNotes(true)}
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
          ) : (
            <NotesField
              defaultValue={activeResult?.notes ?? ''}
              onCommit={(t) => setNotes(t)}
            />
          )}
        </div>

        {error && <ErrorBlock error={error} />}
      </section>

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
        — Unmarked
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

function NotesField({ defaultValue, onCommit }: { defaultValue: string; onCommit: (text: string) => void }) {
  const [value, setValue] = useState(defaultValue);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 6 }}>Note</div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onCommit(value)}
        placeholder="Anything worth flagging on this card…"
        rows={3}
        style={{
          width: '100%',
          background: 'transparent',
          border: '1px solid var(--rule)',
          padding: '12px 14px',
          fontSize: 14,
          color: 'var(--ink)',
          outline: 'none',
          fontFamily: 'inherit',
          resize: 'vertical',
        }}
      />
      <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-4)' }}>Saves when you tap away.</div>
    </div>
  );
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
