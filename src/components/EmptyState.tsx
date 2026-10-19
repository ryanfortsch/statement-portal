import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonClass } from '@/lib/button-class';

/**
 * What an empty list says: one sentence in the reader's words, and at most
 * one verb that gets them somewhere (audit 2026-10-17, Phase 4). Never a
 * table, a migration, an env var or a sync job's name: if the list is empty
 * because something is not set up, say "Ask Ryan: ..." the way the rest of
 * Helm does.
 *
 *   <EmptyState>No office to-dos match this filter.</EmptyState>
 *   <EmptyState action={{ label: 'Open the board', href: '/turnovers' }}>Nothing to walk today.</EmptyState>
 *   <EmptyState center action={<Button size="sm" onClick={showAll}>Show all</Button>}>...</EmptyState>
 *
 * `action` is a link ({ label, href }) or, from a client component, any
 * node (a Button with an onClick). `center` is the board-level face: a
 * whole list with nothing in it. The ink rule above matches a Section's
 * head; `rule={false}` drops it inside a box that already has an edge.
 *
 * Section's `emptyMessage` renders through this, so every section empty
 * line is one of these. No hooks and no 'use client': server pages use it
 * as they are.
 */
export function EmptyState({
  children,
  action,
  center = false,
  rule = true,
}: {
  children: ReactNode;
  action?: { label: string; href: string } | ReactNode;
  center?: boolean;
  rule?: boolean;
}) {
  const verb =
    action && typeof action === 'object' && 'href' in action && 'label' in action ? (
      <Link href={action.href} className={buttonClass('secondary', 'sm')}>
        {action.label}
      </Link>
    ) : (
      (action as ReactNode)
    );
  return (
    <div
      data-empty-state=""
      style={{
        borderTop: rule ? '1px solid var(--ink)' : undefined,
        padding: center ? '40px 0' : '20px 0',
        textAlign: center ? 'center' : undefined,
      }}
    >
      <p style={{ margin: 0, fontSize: center ? 14 : 13, lineHeight: 1.5, color: 'var(--ink-3)' }}>{children}</p>
      {verb && <div style={{ marginTop: 12 }}>{verb}</div>}
    </div>
  );
}
