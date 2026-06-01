import React from 'react';
import Link from 'next/link';

/**
 * A small, dependency-free markdown renderer styled in Helm's design language.
 * Supports the subset we need for Playbook entries: headings, ordered "step"
 * lists, bullet lists, blockquote callouts, fenced + inline code, links, bold,
 * italic, and horizontal rules. It parses to React elements (no raw HTML
 * injection), so it is safe to render author-supplied content.
 *
 * Pure and hook-free, so it works in both Server and Client components (the
 * detail page renders it on the server; the editor uses it for live preview).
 */

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'ordered'; items: string[] }
  | { type: 'bullet'; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'code'; text: string }
  | { type: 'hr' };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  const isBlank = (s: string) => s.trim() === '';

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      i++;
      continue;
    }

    // Fenced code block
    const fence = line.match(/^```/);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // consume closing fence
      blocks.push({ type: 'code', text: buf.join('\n') });
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Heading
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      i++;
      continue;
    }

    // Blockquote (consecutive > lines)
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', text: buf.join('\n') });
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ordered', items });
      continue;
    }

    // Bullet list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'bullet', items });
      continue;
    }

    // Paragraph (gather until blank line or a line that starts a new block)
    const buf: string[] = [];
    while (i < lines.length && !isBlank(lines[i]) && !startsNewBlock(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', text: buf.join('\n') });
  }

  return blocks;
}

function startsNewBlock(line: string): boolean {
  return (
    /^```/.test(line) ||
    /^(#{1,6})\s+/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*([-*_])\1{2,}\s*$/.test(line)
  );
}

// ── Inline parsing ───────────────────────────────────────────────────────────

const INLINE_PATTERNS: { name: 'code' | 'link' | 'bold' | 'italic'; re: RegExp }[] = [
  { name: 'code', re: /`([^`]+)`/ },
  { name: 'link', re: /\[([^\]]+)\]\(([^)\s]+)\)/ },
  { name: 'bold', re: /(\*\*|__)([\s\S]+?)\1/ },
  { name: 'italic', re: /(\*|_)([\s\S]+?)\1/ },
];

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let counter = 0;

  while (remaining.length > 0) {
    let best: { idx: number; name: string; m: RegExpMatchArray } | null = null;
    for (const p of INLINE_PATTERNS) {
      const m = remaining.match(p.re);
      if (m && m.index !== undefined && (best === null || m.index < best.idx)) {
        best = { idx: m.index, name: p.name, m };
      }
    }

    if (!best) {
      nodes.push(remaining);
      break;
    }

    if (best.idx > 0) nodes.push(remaining.slice(0, best.idx));
    const m = best.m;
    const key = `${keyBase}-${counter++}`;

    if (best.name === 'code') {
      nodes.push(
        <code
          key={key}
          style={{
            fontFamily: 'var(--font-mono-dash), monospace',
            fontSize: '0.85em',
            background: 'var(--paper-2)',
            border: '1px solid var(--rule-soft)',
            borderRadius: 3,
            padding: '1px 5px',
          }}
        >
          {m[1]}
        </code>,
      );
    } else if (best.name === 'link') {
      const href = m[2];
      const inner = renderInline(m[1], key);
      const linkStyle: React.CSSProperties = {
        color: 'var(--tide-deep)',
        textDecoration: 'underline',
        textUnderlineOffset: 2,
      };
      if (href.startsWith('/')) {
        nodes.push(
          <Link key={key} href={href} style={linkStyle}>
            {inner}
          </Link>,
        );
      } else {
        nodes.push(
          <a key={key} href={href} target="_blank" rel="noreferrer" style={linkStyle}>
            {inner}
          </a>,
        );
      }
    } else if (best.name === 'bold') {
      nodes.push(
        <strong key={key} style={{ fontWeight: 600, color: 'var(--ink)' }}>
          {renderInline(m[2], key)}
        </strong>,
      );
    } else if (best.name === 'italic') {
      nodes.push(
        <em key={key} style={{ fontStyle: 'italic' }}>
          {renderInline(m[2], key)}
        </em>,
      );
    }

    remaining = remaining.slice(best.idx + m[0].length);
  }

  return nodes;
}

/** Render inline text that may contain soft line breaks, as nodes with <br/>. */
function renderMultiline(text: string, keyBase: string): React.ReactNode[] {
  const segments = text.split('\n');
  const out: React.ReactNode[] = [];
  segments.forEach((seg, idx) => {
    if (idx > 0) out.push(<br key={`${keyBase}-br-${idx}`} />);
    out.push(...renderInline(seg, `${keyBase}-l${idx}`));
  });
  return out;
}

// ── Block rendering ──────────────────────────────────────────────────────────

const HEADING_STYLES: Record<number, React.CSSProperties> = {
  1: { fontFamily: 'var(--font-fraunces), serif', fontSize: 26, fontWeight: 400, color: 'var(--ink)', margin: '28px 0 12px' },
  2: { fontFamily: 'var(--font-fraunces), serif', fontSize: 20, fontWeight: 500, color: 'var(--ink)', margin: '30px 0 10px' },
  3: { fontFamily: 'var(--font-inter), sans-serif', fontSize: 14, fontWeight: 600, letterSpacing: '.02em', color: 'var(--ink)', margin: '22px 0 8px' },
  4: { fontFamily: 'var(--font-inter), sans-serif', fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', margin: '18px 0 6px' },
};

function renderBlock(block: Block, key: string): React.ReactNode {
  switch (block.type) {
    case 'heading': {
      const style = HEADING_STYLES[block.level] ?? HEADING_STYLES[4];
      const Tag = (`h${Math.min(block.level, 6)}`) as keyof React.JSX.IntrinsicElements;
      return (
        <Tag key={key} style={style}>
          {renderInline(block.text, key)}
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p key={key} style={{ fontSize: 15, lineHeight: 1.72, color: 'var(--ink)', margin: '0 0 14px' }}>
          {renderMultiline(block.text, key)}
        </p>
      );
    case 'ordered':
      return (
        <ol key={key} style={{ listStyle: 'none', margin: '0 0 18px', padding: 0, counterReset: 'step' }}>
          {block.items.map((item, idx) => (
            <li
              key={`${key}-${idx}`}
              style={{ display: 'flex', gap: 14, alignItems: 'baseline', marginBottom: 10 }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-fraunces), serif',
                  fontSize: 16,
                  fontWeight: 500,
                  color: 'var(--signal)',
                  minWidth: 20,
                  textAlign: 'right',
                  flexShrink: 0,
                }}
              >
                {idx + 1}
              </span>
              <span style={{ fontSize: 15, lineHeight: 1.65, color: 'var(--ink)' }}>
                {renderMultiline(item, `${key}-${idx}`)}
              </span>
            </li>
          ))}
        </ol>
      );
    case 'bullet':
      return (
        <ul key={key} style={{ listStyle: 'none', margin: '0 0 18px', padding: 0 }}>
          {block.items.map((item, idx) => (
            <li
              key={`${key}-${idx}`}
              style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 8 }}
            >
              <span style={{ color: 'var(--tide)', flexShrink: 0, fontSize: 15, lineHeight: 1.65 }}>—</span>
              <span style={{ fontSize: 15, lineHeight: 1.65, color: 'var(--ink)' }}>
                {renderMultiline(item, `${key}-${idx}`)}
              </span>
            </li>
          ))}
        </ul>
      );
    case 'quote':
      return (
        <blockquote
          key={key}
          style={{
            borderLeft: '3px solid var(--signal)',
            background: 'var(--paper-2)',
            padding: '12px 16px',
            margin: '0 0 18px',
            borderRadius: '0 4px 4px 0',
          }}
        >
          <div style={{ fontSize: 14.5, lineHeight: 1.62, color: 'var(--ink-2)' }}>
            {renderMultiline(block.text, key)}
          </div>
        </blockquote>
      );
    case 'code':
      return (
        <pre
          key={key}
          style={{
            fontFamily: 'var(--font-mono-dash), monospace',
            fontSize: 13,
            lineHeight: 1.55,
            background: 'var(--paper-2)',
            border: '1px solid var(--rule)',
            borderRadius: 4,
            padding: '12px 14px',
            margin: '0 0 18px',
            overflowX: 'auto',
            color: 'var(--ink)',
          }}
        >
          <code>{block.text}</code>
        </pre>
      );
    case 'hr':
      return <hr key={key} style={{ border: 'none', borderTop: '1px solid var(--rule)', margin: '24px 0' }} />;
  }
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseBlocks(source ?? '');
  if (blocks.length === 0) {
    return (
      <p className={className} style={{ fontSize: 15, color: 'var(--ink-4)', fontStyle: 'italic' }}>
        Nothing written yet.
      </p>
    );
  }
  return <div className={className}>{blocks.map((b, idx) => renderBlock(b, `b${idx}`))}</div>;
}
