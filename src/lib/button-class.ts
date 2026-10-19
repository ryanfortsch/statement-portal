/**
 * The house button's class list (the faces live in globals.css, .rt-btn).
 * Pure and outside the 'use client' Button module, so a server page can put
 * the same face on a SubmitButton or a link styled as a button.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra?: string): string {
  const face = variant === 'quiet' ? 'rt-quiet-btn' : `rt-btn rt-btn--${variant}${size === 'md' ? '' : ` rt-btn--${size}`}`;
  return extra ? `${face} ${extra}` : face;
}
