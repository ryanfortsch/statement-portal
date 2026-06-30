'use client';

import { useState } from 'react';

/**
 * Payout fields that adapt to the chosen method. App-based methods
 * (Venmo/Zelle/PayPal/Cash App) take a single handle/email; ACH takes a real
 * routing + account number + account type; Check takes nothing (mailed to the
 * W-9 address). Whatever the method, the pieces are assembled into one hidden
 * `payment_details` value so the server action + savePayment stay unchanged
 * (one encrypted blob, masked to last-4 for the office hint).
 */
const HANDLE: Record<string, { label: string; placeholder: string }> = {
  Venmo: { label: 'Venmo username', placeholder: '@username' },
  Zelle: { label: 'Zelle email or phone', placeholder: 'email or phone number' },
  PayPal: { label: 'PayPal email', placeholder: 'email@example.com' },
  'Cash App': { label: 'Cash App cashtag', placeholder: '$cashtag' },
};

export function PaymentFields({
  methods,
  inputStyle,
  labelStyle,
}: {
  methods: readonly string[];
  inputStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
}) {
  const [method, setMethod] = useState('');
  const [handle, setHandle] = useState('');
  const [routing, setRouting] = useState('');
  const [account, setAccount] = useState('');
  const [acctType, setAcctType] = useState('checking');

  const isACH = method === 'Direct deposit (ACH)';
  const isCheck = method === 'Check';
  const isHandle = !!method && !isACH && !isCheck;

  const details = isACH
    ? routing || account
      ? `Routing ${routing} · Acct ${account} (${acctType})`
      : ''
    : isHandle
      ? handle
      : '';

  return (
    <>
      <input type="hidden" name="payment_details" value={details} />

      <div>
        <label style={labelStyle}>Method</label>
        <select name="payment_method" required value={method} onChange={(e) => setMethod(e.target.value)} style={inputStyle}>
          <option value="" disabled>Select…</option>
          {methods.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      {isHandle && (
        <div>
          <label style={labelStyle}>{HANDLE[method]?.label ?? 'Details'}</label>
          <input
            type="text"
            required
            autoComplete="off"
            placeholder={HANDLE[method]?.placeholder}
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            style={inputStyle}
          />
        </div>
      )}

      {isACH && (
        <>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Routing number</label>
              <input
                type="text"
                required
                inputMode="numeric"
                autoComplete="off"
                placeholder="9 digits"
                value={routing}
                onChange={(e) => setRouting(e.target.value.replace(/\D/g, '').slice(0, 9))}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Account number</label>
              <input
                type="text"
                required
                inputMode="numeric"
                autoComplete="off"
                value={account}
                onChange={(e) => setAccount(e.target.value.replace(/\D/g, '').slice(0, 17))}
                style={inputStyle}
              />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Account type</label>
            <select value={acctType} onChange={(e) => setAcctType(e.target.value)} style={inputStyle}>
              <option value="checking">Checking</option>
              <option value="savings">Savings</option>
            </select>
          </div>
        </>
      )}

      {isCheck && (
        <div style={{ fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.5 }}>
          We&apos;ll mail your checks to the address on your W-9 above.
        </div>
      )}
    </>
  );
}
