'use client';

/**
 * The dispute reason, on the hero line. Picking one reloads the packet for
 * that reason (a GET, nothing is written anywhere), carrying the other
 * payments already typed so they are not lost. The select is the one place
 * the reason reads; the section heading under it no longer repeats it.
 */
export function ReasonSelect({
  kind,
  paid,
  options,
}: {
  kind: string;
  paid: string;
  options: Array<{ kind: string; title: string }>;
}) {
  return (
    <form method="get" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {paid && <input type="hidden" name="paid" value={paid} />}
      <label htmlFor="dispute-reason" className="eyebrow" style={{ color: 'var(--ink-3)' }}>
        Reason
      </label>
      <select
        id="dispute-reason"
        name="kind"
        defaultValue={kind}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        style={{ padding: '5px 8px', fontSize: 13, background: 'var(--paper)', border: '1px solid var(--rule)', color: 'var(--ink)' }}
      >
        {options.map((o) => (
          <option key={o.kind} value={o.kind}>
            {o.title}
          </option>
        ))}
      </select>
    </form>
  );
}
