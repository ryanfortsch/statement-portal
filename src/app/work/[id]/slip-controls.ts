import type { CSSProperties } from 'react';

/**
 * One idiom for every chip row on the slip page (Lane, Who does this, The
 * ask, Owner's answer): tap a chip to set it, tap the lit one again to clear
 * it where the field can be empty, and read the hint printed under the row.
 * Nothing load-bearing lives in a tooltip, which a phone never shows.
 */
export function chipStyle(active: boolean, pending: boolean): CSSProperties {
  return {
    background: active ? 'var(--ink)' : 'none',
    color: active ? 'var(--paper)' : 'var(--ink)',
    border: `1px solid ${active ? 'var(--ink)' : 'var(--rule)'}`,
    padding: '5px 12px',
    fontSize: 10,
    letterSpacing: '.16em',
    textTransform: 'uppercase',
    fontWeight: 700,
    cursor: pending ? 'default' : 'pointer',
    opacity: pending ? 0.6 : 1,
  };
}

/** The hint line under a chip row. */
export const chipHintStyle: CSSProperties = { fontSize: 11, color: 'var(--ink-3)', marginTop: 8, marginBottom: 0 };

/** "Tap again to clear." rides on the hint whenever a clearable chip is lit. */
export function withClearHint(hint: string, clearable: boolean): string {
  if (!clearable) return hint;
  const sentence = hint.trim().replace(/[.\s]*$/, '.');
  return `${sentence} Tap again to clear.`;
}

/** The small ghost button a failed save offers (Retry, Dismiss): the same
 *  face as every other quiet control on the page, not the browser default. */
export const smallGhostButton: CSSProperties = {
  background: 'none',
  border: '1px solid var(--rule)',
  padding: '4px 10px',
  fontSize: 10,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  cursor: 'pointer',
};
