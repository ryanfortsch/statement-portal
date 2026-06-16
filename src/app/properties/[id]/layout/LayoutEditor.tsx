'use client';

import { useRef, useState, useTransition } from 'react';
import { saveLayout, createCustomItem } from './actions';

/**
 * Inspection-layout editor. The deck is a per-property ordered list of
 * cards; what's laid out here is exactly what the inspection runs, in this
 * order, every visit. Drag a card by its grip to reorder (or use the up/
 * down arrows on touch), remove cards, add a standard card that isn't in
 * the deck, or write your own. Every change persists immediately via
 * saveLayout — the order on screen is the source of truth.
 */

export type EditorCard = {
  itemId: string;
  title: string;
  description: string | null;
  category: string;
  isCustom: boolean;
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

type Props = {
  propertyId: string;
  initialDeck: EditorCard[];
  initialAddable: EditorCard[];
  isCustomized: boolean;
};

export function LayoutEditor({ propertyId, initialDeck, initialAddable, isCustomized }: Props) {
  const [deck, setDeck] = useState<EditorCard[]>(initialDeck);
  const [addable, setAddable] = useState<EditorCard[]>(initialAddable);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [savingCustom, setSavingCustom] = useState(false);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);
  const deckRef = useRef<EditorCard[]>(initialDeck);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [, startTransition] = useTransition();

  function setDeckBoth(next: EditorCard[]) {
    deckRef.current = next;
    setDeck(next);
  }

  function persist(nextDeck: EditorCard[]) {
    setTouched(true);
    startTransition(async () => {
      setStatus('saving');
      const r = await saveLayout(propertyId, nextDeck.map((c) => c.itemId));
      if (r.ok) {
        setStatus('saved');
        setError(null);
      } else {
        setStatus('error');
        setError(r.error);
      }
    });
  }

  function commit(nextDeck: EditorCard[]) {
    setDeckBoth(nextDeck);
    persist(nextDeck);
  }

  // ── Drag to reorder (desktop). The grip initiates; the card body is the
  //    drop zone. We reflow the list live on dragover and persist on drop.
  function onDragStart(e: React.DragEvent, itemId: string) {
    dragId.current = itemId;
    setDraggingId(itemId);
    e.dataTransfer.effectAllowed = 'move';
    const el = cardRefs.current.get(itemId);
    if (el) e.dataTransfer.setDragImage(el, 24, 24);
  }
  function onDragOverCard(e: React.DragEvent, overId: string) {
    e.preventDefault();
    const fromId = dragId.current;
    if (!fromId || fromId === overId) return;
    const cur = deckRef.current;
    const from = cur.findIndex((c) => c.itemId === fromId);
    const to = cur.findIndex((c) => c.itemId === overId);
    if (from === -1 || to === -1 || from === to) return;
    const next = [...cur];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDeckBoth(next);
  }
  function onDragEnd() {
    if (dragId.current) persist(deckRef.current);
    dragId.current = null;
    setDraggingId(null);
  }

  function moveBy(index: number, dir: 'up' | 'down') {
    const j = dir === 'up' ? index - 1 : index + 1;
    if (j < 0 || j >= deck.length) return;
    const next = [...deck];
    [next[index], next[j]] = [next[j], next[index]];
    commit(next);
  }

  function removeCard(card: EditorCard) {
    if (deck.length <= 1) {
      setStatus('error');
      setError('An inspection needs at least one card.');
      return;
    }
    setAddable((prev) =>
      [...prev, card].sort(
        (a, b) => Number(a.isCustom) - Number(b.isCustom) || a.title.localeCompare(b.title),
      ),
    );
    commit(deck.filter((c) => c.itemId !== card.itemId));
  }

  function addStandard(card: EditorCard) {
    setAddable((prev) => prev.filter((c) => c.itemId !== card.itemId));
    commit([...deck, card]);
  }

  async function addCustom() {
    const title = customTitle.trim();
    if (!title) {
      setStatus('error');
      setError('Give the card a title.');
      return;
    }
    setSavingCustom(true);
    const r = await createCustomItem({
      propertyId,
      title,
      description: customDesc.trim() || null,
    });
    setSavingCustom(false);
    if (!r.ok || !r.data) {
      setStatus('error');
      setError(r.ok ? 'Could not create the card.' : r.error);
      return;
    }
    const card: EditorCard = {
      itemId: r.data.id,
      title: r.data.title,
      description: r.data.description,
      category: r.data.category,
      isCustom: true,
    };
    setCustomTitle('');
    setCustomDesc('');
    commit([...deck, card]);
  }

  const statusLabel =
    status === 'saving'
      ? 'Saving…'
      : status === 'error'
        ? error || 'Couldn’t save'
        : touched || isCustomized
          ? 'All changes saved'
          : 'Standard layout — edit to customize';

  const statusColor =
    status === 'error' ? 'var(--signal)' : status === 'saving' ? 'var(--ink-3)' : 'var(--ink-4)';

  return (
    <section className="max-w-[820px] mx-auto px-10" style={{ paddingBottom: 96, width: '100%' }}>
      {/* Status + count bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 16,
          padding: '12px 0',
          borderBottom: '1px solid var(--ink)',
          marginBottom: 16,
        }}
      >
        <span
          style={{
            fontSize: 11,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            fontWeight: 600,
          }}
        >
          {deck.length} {deck.length === 1 ? 'card' : 'cards'}
        </span>
        <span style={{ fontSize: 11, letterSpacing: '.06em', color: statusColor }}>
          {statusLabel}
        </span>
      </div>

      {/* The deck */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {deck.map((card, i) => (
          <div
            key={card.itemId}
            ref={(el) => {
              if (el) cardRefs.current.set(card.itemId, el);
              else cardRefs.current.delete(card.itemId);
            }}
            className="rt-card"
            onDragOver={(e) => onDragOverCard(e, card.itemId)}
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 28px 1fr auto',
              alignItems: 'center',
              gap: 14,
              border: '1px solid var(--rule)',
              background: 'var(--paper)',
              padding: '12px 14px',
              opacity: draggingId === card.itemId ? 0.4 : 1,
            }}
          >
            {/* Grip — initiates drag */}
            <span
              className="rt-grip"
              draggable
              onDragStart={(e) => onDragStart(e, card.itemId)}
              onDragEnd={onDragEnd}
              title="Drag to reorder"
              aria-label="Drag to reorder"
            >
              ⠿
            </span>

            {/* Position */}
            <span
              className="font-mono"
              style={{ fontSize: 12, color: 'var(--ink-4)', fontWeight: 600, textAlign: 'center' }}
            >
              {i + 1}
            </span>

            {/* Title + description + category */}
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>
                  {card.title}
                </span>
                <span
                  style={{
                    fontSize: 9,
                    letterSpacing: '.16em',
                    textTransform: 'uppercase',
                    fontWeight: 600,
                    color: card.isCustom ? 'var(--tide-deep)' : 'var(--ink-4)',
                  }}
                >
                  {card.isCustom ? 'Custom' : card.category}
                </span>
              </div>
              {card.description && (
                <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                  {card.description}
                </p>
              )}
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                className="rt-mini-btn"
                onClick={() => moveBy(i, 'up')}
                disabled={i === 0}
                title="Move up"
                aria-label="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                className="rt-mini-btn"
                onClick={() => moveBy(i, 'down')}
                disabled={i === deck.length - 1}
                title="Move down"
                aria-label="Move down"
              >
                ↓
              </button>
              <button
                type="button"
                className="rt-mini-btn rt-mini-btn--danger"
                onClick={() => removeCard(card)}
                title="Remove card"
                aria-label={`Remove ${card.title}`}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add a card */}
      <div style={{ marginTop: 18 }}>
        {!showAdd ? (
          <button type="button" className="rt-add-toggle" onClick={() => setShowAdd(true)}>
            + Add a card
          </button>
        ) : (
          <div style={{ border: '1px solid var(--rule)', background: 'var(--paper-2)', padding: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  letterSpacing: '.18em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-3)',
                  fontWeight: 600,
                }}
              >
                Add a card
              </span>
              <button
                type="button"
                className="rt-mini-btn"
                onClick={() => setShowAdd(false)}
                aria-label="Close"
                title="Close"
              >
                ×
              </button>
            </div>

            {/* Standard cards not currently in the deck */}
            {addable.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: 10,
                    letterSpacing: '.14em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-4)',
                    marginBottom: 8,
                  }}
                >
                  From the standard set
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {addable.map((card) => (
                    <button
                      key={card.itemId}
                      type="button"
                      className="rt-chip"
                      onClick={() => addStandard(card)}
                      title={card.description || card.title}
                    >
                      + {card.title}
                      {card.isCustom && <span style={{ color: 'var(--tide-deep)' }}> · custom</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Write your own */}
            <div>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: '.14em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-4)',
                  marginBottom: 8,
                }}
              >
                Write your own
              </div>
              <input
                className="rt-input"
                placeholder="Card title (e.g. “Check hot tub cover”)"
                value={customTitle}
                maxLength={120}
                onChange={(e) => setCustomTitle(e.target.value)}
              />
              <textarea
                className="rt-input"
                placeholder="What should the inspector confirm? (optional)"
                value={customDesc}
                onChange={(e) => setCustomDesc(e.target.value)}
                style={{ marginTop: 8, minHeight: 56, resize: 'vertical' }}
              />
              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="rt-btn-primary"
                  onClick={addCustom}
                  disabled={savingCustom || !customTitle.trim()}
                >
                  {savingCustom ? 'Adding…' : 'Add card'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{editorCss}</style>
    </section>
  );
}

const editorCss = `
  .rt-card { transition: opacity 120ms ease; }
  .rt-grip {
    cursor: grab;
    color: var(--ink-4);
    font-size: 16px;
    line-height: 1;
    user-select: none;
    padding: 0 2px;
  }
  .rt-grip:active { cursor: grabbing; }

  .rt-mini-btn {
    background: var(--paper);
    color: var(--ink);
    border: 1px solid var(--rule);
    width: 28px;
    height: 28px;
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
  }
  .rt-mini-btn:hover:not(:disabled) { border-color: var(--ink); }
  .rt-mini-btn:disabled { color: var(--ink-4); opacity: 0.4; cursor: not-allowed; }
  .rt-mini-btn--danger:hover:not(:disabled) { border-color: var(--signal); color: var(--signal); }

  .rt-add-toggle {
    background: transparent;
    color: var(--ink);
    border: 1px dashed var(--rule);
    width: 100%;
    padding: 12px;
    font-size: 12px;
    letter-spacing: .08em;
    cursor: pointer;
  }
  .rt-add-toggle:hover { border-color: var(--ink); }

  .rt-chip {
    background: var(--paper);
    border: 1px solid var(--rule);
    color: var(--ink);
    font-size: 12px;
    padding: 6px 11px;
    cursor: pointer;
    font-family: var(--font-inter), system-ui, sans-serif;
  }
  .rt-chip:hover { border-color: var(--ink); }

  .rt-input {
    font: inherit;
    font-size: 14px;
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--rule);
    padding: 10px 12px;
    outline: none;
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-inter), system-ui, sans-serif;
  }
  .rt-input:focus { border-color: var(--ink); }

  .rt-btn-primary {
    background: var(--ink);
    color: var(--paper);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    padding: 10px 18px;
    border: none;
    cursor: pointer;
  }
  .rt-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
`;
