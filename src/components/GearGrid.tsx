'use client';

import { useState, useTransition } from 'react';

type Item = { key: string; label: string };
type Row = { propertyId: string; propertyName: string; cells: Record<string, string> };

/**
 * The guest-gear matrix (per Ryan: "very simple grid... clean, simple"):
 * homes down the side, gear across the top, each cell the item's location.
 * Blank cell = the home doesn't have one. Cells save on click-away; clearing
 * a cell removes the item. Shared by the office (/work/gear) and the field
 * property-work board, each passing its own gated save action.
 */
export function GearGrid({
  items,
  rows,
  save,
  readOnly = false,
}: {
  items: Item[];
  rows: Row[];
  save: (propertyId: string, itemKey: string, location: string) => Promise<{ ok: boolean }>;
  readOnly?: boolean;
}) {
  const [pending, start] = useTransition();
  // Optimistic local copy so a save never snaps the text back while in flight.
  const [cells, setCells] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const r of rows) for (const i of items) m[`${r.propertyId}|${i.key}`] = r.cells[i.key] ?? '';
    return m;
  });
  // A save that did not land: the cell keeps what was typed, is outlined,
  // and the line under the grid says so. The stored copy reverts so the
  // next click-away on the same text retries instead of reading as "no
  // change". A failure used to be swallowed and the cell looked saved.
  const [failed, setFailed] = useState<Record<string, string>>({});

  function commit(propertyId: string, itemKey: string, value: string) {
    const key = `${propertyId}|${itemKey}`;
    const clean = value.trim();
    if ((cells[key] ?? '') === clean) return;
    const previous = cells[key] ?? '';
    setCells((prev) => ({ ...prev, [key]: clean }));
    setFailed((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    start(async () => {
      let ok = false;
      try {
        ok = (await save(propertyId, itemKey, clean)).ok;
      } catch {
        ok = false;
      }
      if (ok) return;
      setCells((prev) => ({ ...prev, [key]: previous }));
      const home = rows.find((r) => r.propertyId === propertyId)?.propertyName ?? propertyId;
      const item = items.find((i) => i.key === itemKey)?.label ?? itemKey;
      setFailed((prev) => ({ ...prev, [key]: `${home} · ${item}` }));
    });
  }

  const failures = Object.values(failed);

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, padding: '6px 10px 6px 2px', borderBottom: '1px solid var(--ink)' }}>
                Home
              </th>
              {items.map((i) => (
                <th key={i.key} style={{ textAlign: 'left', fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, padding: '6px 10px', borderBottom: '1px solid var(--ink)', minWidth: 170 }}>
                  {i.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.propertyId}>
                <td className="font-serif" style={{ padding: '9px 10px 9px 2px', borderBottom: '1px solid var(--rule)', whiteSpace: 'nowrap', fontSize: 15 }}>
                  {r.propertyName}
                </td>
                {items.map((i) => {
                  const key = `${r.propertyId}|${i.key}`;
                  const val = cells[key] ?? '';
                  return (
                    <td key={i.key} style={{ padding: '4px 10px', borderBottom: '1px solid var(--rule)' }}>
                      {readOnly ? (
                        <span style={{ color: val ? 'var(--ink)' : 'var(--ink-4)' }}>{val || '–'}</span>
                      ) : (
                        <input
                          defaultValue={val}
                          placeholder="none"
                          aria-invalid={key in failed || undefined}
                          onBlur={(e) => commit(r.propertyId, i.key, e.target.value)}
                          style={{ width: '100%', font: 'inherit', fontSize: 13.5, color: val ? 'var(--ink)' : 'var(--ink-3)', background: 'transparent', border: 'none', borderBottom: key in failed ? '1px solid var(--negative)' : 'none', outline: 'none', padding: '6px 0', minHeight: 34 }}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 8 }}>
          {pending ? 'Saving…' : 'Tap a cell to edit; saves when you click away. Clear a cell if the home no longer has one.'}
        </div>
      )}
      {!readOnly && failures.length > 0 && (
        <div role="alert" style={{ fontSize: 11.5, color: 'var(--negative)', marginTop: 6 }}>
          Could not save {failures.join(', ')}. The cell shows what you typed; click away from it again to retry.
        </div>
      )}
    </div>
  );
}
