'use client';

import { useState } from 'react';
import type { AlsoItem } from './types';
import { Button } from '@/components/Button';

/**
 * Everything approving this card will also do, one line each, behind one
 * disclosure (2026-10-18). The guest card used to stack a quote block, an
 * add-on block, a work-slip block and a handoff block between the reply and
 * its buttons, each with its own colour and its own explainer, which is how
 * one card grew more than thirty visible states. Now the face of the card is
 * who wrote, the reply and the verbs; what else happens on approve reads as a
 * short list ("Texts the $40 pet fee link to +1 978…", "Drafts a note to Rosa
 * for your approval"), and the controls behind each line open on request, or
 * by themselves when a line needs an answer before the card can go.
 */
export function AlsoOnApprove({ items }: { items: AlsoItem[] }) {
  const hasBodies = items.some((i) => i.body);
  const [open, setOpen] = useState(false);
  return (
    <section className="rt-also" aria-label="Also on approve">
      <div className="rt-also-head">
        <span className="eyebrow" style={{ color: 'var(--ink-3)' }}>Also on approve</span>
        {hasBodies && (
          <Button variant="quiet" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide details' : 'Details'}
          </Button>
        )}
      </div>
      <ul className="rt-also-list">
        {items.map((item) => (
          <li key={item.key} className="rt-also-item">
            <div className="rt-also-line">
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{item.line}</span>
              {item.status && (
                <span className="rt-also-status" data-attention={item.attention || undefined}>
                  {item.status}
                </span>
              )}
            </div>
            {(open || item.attention) && item.body && <div className="rt-also-body">{item.body}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
