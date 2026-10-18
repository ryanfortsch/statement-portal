'use client';

/**
 * The one "Receipt total" field on the contractor portal: the packet stop's
 * Add a receipt, Flag something, and the property board's Mark done. Same
 * words, same cap, stated on the field. The server still clamps every rail
 * at RECEIPT_CAP_CENTS (src/lib/field-receipts.ts); this keeps a contractor
 * from typing $612.40 and silently being paid $500.
 *
 * Kept free of server imports so the field smoke harnesses can bundle it.
 */

/** RECEIPT_CAP_CENTS / 100. field-receipt-rail.test.ts keeps the two equal. */
export const RECEIPT_CAP_DOLLARS = 500;

export function ReceiptAmountField({
  value,
  onChange,
  disabled,
  required = false,
  where,
}: {
  /** Controlled when the caller keeps a draft; uncontrolled otherwise. */
  value?: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
  required?: boolean;
  /** Where the money goes, in a few words: "added to this trip's payout". */
  where: string;
}) {
  return (
    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
      Receipt total ${' '}
      <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>
        ({required ? '' : 'optional, '}up to ${RECEIPT_CAP_DOLLARS}; {where})
      </span>
      <input
        name="expense_dollars"
        type="number"
        min={0}
        max={RECEIPT_CAP_DOLLARS}
        step="0.01"
        inputMode="decimal"
        placeholder="e.g. 27.60"
        required={required}
        disabled={disabled}
        {...(onChange ? { value: value ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value) } : {})}
        style={{ display: 'block', width: 140, font: 'inherit', fontSize: 16, fontWeight: 400, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 8, padding: '10px 12px', marginTop: 6 }}
      />
    </label>
  );
}
