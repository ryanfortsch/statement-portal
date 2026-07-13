'use client';

import { useRef, useState, useTransition } from 'react';
import { reorderPacketStops } from '../actions';

/**
 * The packet's stop list with grab-to-reorder. The old ▲▼ buttons were server
 * round-trips with no pending state — the row "suddenly moved" seconds later.
 * Here the row moves the instant you drag it (optimistic local order), and the
 * new order persists in the background; on a failed save we snap back.
 *
 * Rows are server-rendered nodes passed in by id; this component owns only the
 * ORDER and the number/grip column, so all the heavy row content (attachments,
 * live-visit ledger, links) stays on the server.
 *
 * Drag is pointer-events on the grip (touch-action:none so it works on phones).
 * While dragging, the target index is "how many other rows' midpoints sit above
 * the pointer" — the classic midpoint rule, robust for variable-height rows.
 */

type Item = { id: string; node: React.ReactNode };

export function StopList({ packetId, items, canReorder }: { packetId: string; items: Item[]; canReorder: boolean }) {
  const byId = new Map(items.map((it) => [it.id, it]));
  // Props are the server truth; local `order` is the optimistic view. When the
  // server sends a different sequence (our own save landing, another operator,
  // a stop added/removed), adopt it — the derived-state-reset pattern.
  const idsKey = items.map((it) => it.id).join('|');
  const [syncedKey, setSyncedKey] = useState(idsKey);
  const [order, setOrder] = useState<string[]>(() => items.map((it) => it.id));
  if (syncedKey !== idsKey) {
    setSyncedKey(idsKey);
    setOrder(items.map((it) => it.id));
  }

  const [dragId, setDragId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const orderRef = useRef(order);
  orderRef.current = order;

  const draggable = canReorder && items.length > 1;

  function onGripDown(e: React.PointerEvent, id: string) {
    if (!draggable) return;
    e.preventDefault();
    const startOrder = [...orderRef.current];
    setDragId(id);

    const move = (ev: PointerEvent) => {
      const cur = orderRef.current;
      const fromIdx = cur.indexOf(id);
      if (fromIdx < 0) return;
      // Target = count of OTHER rows whose midpoint is above the pointer.
      let to = 0;
      for (const rid of cur) {
        if (rid === id) continue;
        const el = rowRefs.current.get(rid);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (ev.clientY > r.top + r.height / 2) to++;
      }
      if (to !== fromIdx) {
        const next = cur.filter((rid) => rid !== id);
        next.splice(to, 0, id);
        setOrder(next);
      }
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDragId(null);
      const finalOrder = orderRef.current;
      if (finalOrder.join('|') === startOrder.join('|')) return; // no change
      startTransition(async () => {
        try {
          await reorderPacketStops(packetId, finalOrder);
        } catch {
          setOrder(startOrder); // save failed — snap back so the screen never lies
        }
      });
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  return (
    <div style={{ userSelect: dragId ? 'none' : undefined }}>
      {draggable && (
        <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 2 }}>
          Drag <span style={{ letterSpacing: '-0.12em' }}>⋮⋮</span> to set the visit order — 1 is first.
        </div>
      )}
      {order.map((id, i) => {
        const it = byId.get(id);
        if (!it) return null;
        const dragging = dragId === id;
        return (
          <div
            key={id}
            ref={(el) => {
              if (el) rowRefs.current.set(id, el);
              else rowRefs.current.delete(id);
            }}
            style={{
              borderBottom: '1px solid var(--rule)',
              padding: '14px 0',
              display: 'flex',
              gap: 14,
              alignItems: 'flex-start',
              position: 'relative',
              zIndex: dragging ? 2 : undefined,
              background: dragging ? 'var(--paper-2, #fff)' : undefined,
              boxShadow: dragging ? '0 6px 20px rgba(11,37,69,0.14)' : undefined,
              opacity: dragging ? 0.95 : undefined,
            }}
          >
            <div style={{ width: 22, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, paddingTop: 1 }}>
              <span style={{ color: 'var(--ink-4)', fontSize: 13 }}>{i + 1}</span>
              {draggable && (
                <span
                  onPointerDown={(e) => onGripDown(e, id)}
                  title="Drag to reorder"
                  style={{
                    touchAction: 'none',
                    cursor: dragging ? 'grabbing' : 'grab',
                    color: 'var(--ink-4)',
                    fontSize: 13,
                    letterSpacing: '-0.12em',
                    lineHeight: 1,
                    padding: '2px 4px',
                  }}
                >
                  ⋮⋮
                </span>
              )}
            </div>
            {it.node}
          </div>
        );
      })}
      {isPending && (
        <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 6 }}>Saving order…</div>
      )}
    </div>
  );
}
