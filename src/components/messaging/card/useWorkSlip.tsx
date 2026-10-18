'use client';

import { useState } from 'react';
import type { ProposedWorkSlip } from '@/lib/stay-concierge';
import { OutlineChip } from './buttons';
import type { AlsoItem } from './types';

type PropertyOption = { id: string; name: string };

// Teal for the work-slip tick box: an operational side effect, distinct from
// the draft (ink) and error or stale (signal).
const SLIP_TONE = '#1f5e6b';

/**
 * The work slip a crew text implies ("the dryer vent is loose"), as one line
 * of Also on approve. The operator picks the property and can untick it; the
 * choice rides on approve. A slip with no property blocks approve rather than
 * filing nowhere, and a queued send would file with the mined defaults, so a
 * slip card sends now only.
 */
export function useWorkSlip({
  id,
  slip,
  properties,
  initialPropertyId,
  runProperties,
  alreadyFiled,
}: {
  id: string;
  slip: ProposedWorkSlip | null;
  properties: PropertyOption[];
  initialPropertyId: string;
  /** The homes on a contractor's run today, offered first. */
  runProperties?: PropertyOption[];
  /** Slips they already filed today during an inspection. */
  alreadyFiled?: { title: string; name: string }[];
}): {
  item: AlsoItem | null;
  /** What approve carries; undefined for a card with no slip. */
  opts: { fileSlip: boolean; slipPropertyId?: string } | undefined;
  blocked: string | undefined;
  scheduleBlocked: string | undefined;
} {
  const [propertyId, setPropertyId] = useState(initialPropertyId);
  const [file, setFile] = useState(true);
  if (!slip) return { item: null, opts: undefined, blocked: undefined, scheduleBlocked: undefined };
  const blocked = file && !propertyId ? 'Pick a property for the work slip, or untick it.' : undefined;
  const home = properties.find((p) => p.id === propertyId)?.name;
  const filed = alreadyFiled ?? [];
  const run = runProperties ?? [];
  const item: AlsoItem = {
    key: 'work-slip',
    line: file
      ? <>Files work slip “{slip.title}”{home ? ` at ${home}` : ''}</>
      : <>Work slip “{slip.title}” will not be filed</>,
    status: blocked ? 'Select property' : file ? 'Create when approved' : 'Skip',
    attention: !!blocked || filed.length > 0,
    body: (
      <>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <OutlineChip>{slip.category}</OutlineChip>
          <OutlineChip tone={slip.priority === 'high' ? 'var(--signal)' : undefined}>{slip.priority} priority</OutlineChip>
        </div>
        {slip.note && (
          <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{slip.note}</p>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
          <select
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            aria-label="Property for the work slip"
            style={{ fontSize: 13, padding: '6px 8px', background: 'var(--paper)', color: 'var(--ink)', border: '1px solid var(--rule)', outline: 'none' }}
          >
            <option value="">Select property…</option>
            {run.length > 0 && (
              <optgroup label="On their run today">
                {run.map((p) => (
                  <option key={`run-${p.id}`} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            )}
            <optgroup label={run.length > 0 ? 'Other properties' : 'Properties'}>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
          </select>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={file}
              onChange={(e) => setFile(e.target.checked)}
              style={{ accentColor: SLIP_TONE, width: 14, height: 14 }}
              name={`file-slip-${id}`}
            />
            File this slip when I approve
          </label>
        </div>
        {filed.length > 0 && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--signal)', lineHeight: 1.5 }}>
            Heads up: they already filed {filed.map((f) => `"${f.title}" at ${f.name}`).join(' and ')} during today&apos;s inspection. Filing here may duplicate it; untick if so.
          </p>
        )}
      </>
    ),
  };
  return {
    item,
    opts: { fileSlip: file, slipPropertyId: propertyId || undefined },
    blocked,
    scheduleBlocked: 'This card files a work slip, so it sends immediately (your slip choices ride along on approve).',
  };
}
