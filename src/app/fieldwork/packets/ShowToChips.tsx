'use client';

/** The bundle bars' "Show to" chips (the inspection calendar's and the
 *  handymen's). Picking names limits who SEES the packet and gets the text;
 *  they still claim it themselves, first come. None picked = everyone on the
 *  trade. The parent owns the picks and sends them as one comma list. */
export function ShowToChips({
  people,
  picked,
  onToggle,
  onClear,
  noun,
}: {
  people: { id: string; name: string }[];
  picked: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  /** Plural, for the tooltip: "inspectors", "handymen". */
  noun: string;
}) {
  if (people.length === 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Who can see this">
      <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>Show to</span>
      {people.map((c) => {
        const on = picked.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onToggle(c.id)}
            aria-pressed={on}
            title={on ? `Only these ${noun} will see it` : `Limit this packet to ${c.name}`}
            style={{
              font: 'inherit',
              fontSize: 12.5,
              cursor: 'pointer',
              borderRadius: 999,
              padding: '6px 11px',
              border: `1px solid ${on ? 'var(--tide-deep)' : 'var(--rule)'}`,
              background: on ? 'rgba(58,107,138,0.12)' : 'var(--paper-2, #fff)',
              color: on ? 'var(--tide-deep)' : 'var(--ink-3)',
              fontWeight: on ? 600 : 400,
              whiteSpace: 'nowrap',
            }}
          >
            {on ? '✓ ' : ''}{c.name.split(' ')[0]}
          </button>
        );
      })}
      {picked.length > 0 && (
        <button
          type="button"
          onClick={onClear}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 11.5, textDecoration: 'underline', textUnderlineOffset: 3, padding: 0 }}
        >
          everyone
        </button>
      )}
    </div>
  );
}
