/**
 * Render a campaign body (Markdown) into a finished email: HTML + plain
 * text. Intentionally tiny: we don't need full CommonMark, just the
 * subset that fits an editorial newsletter.
 *
 * Supported Markdown:
 *   # H1, ## H2, ### H3
 *   **bold**, *italic*
 *   [link text](https://url)
 *   - bullet lists
 *   > blockquotes
 *   --- horizontal rule
 *   blank-line-separated paragraphs
 *
 * Anything more elaborate (tables, code blocks, images) gets passed
 * through as text. We can grow into a real renderer (marked, remark)
 * later if the editorial needs it; today the constraint is keeping the
 * email visual quiet and not letting markdown surprises wreck the layout.
 *
 * The HTML is wrapped in an inline-styled editorial template (cream
 * background, Georgia headlines, system sans body) sized to render
 * cleanly in Gmail / Apple Mail / Outlook. CAN-SPAM footer with
 * Rising Tide's address and a one-click unsubscribe token URL.
 */

const PHYSICAL_ADDRESS = '85 Eastern Ave, Gloucester, MA 01930';

export type RenderedEmail = {
  html: string;
  text: string;
};

export function renderEmail(args: {
  subject: string;
  preheader?: string;
  bodyMarkdown: string;
  unsubscribeUrl: string;
  fromName?: string;
}): RenderedEmail {
  const html = renderHtml(args);
  const text = renderText(args);
  return { html, text };
}

function renderHtml(args: {
  subject: string;
  preheader?: string;
  bodyMarkdown: string;
  unsubscribeUrl: string;
  fromName?: string;
}): string {
  const fromName = args.fromName || 'Stay Cape Ann';
  const preheader = args.preheader || '';
  const bodyHtml = markdownToHtml(args.bodyMarkdown);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(args.subject)}</title>
  </head>
  <body style="margin:0; padding:0; background:#faf7f1; color:#1e2e34; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; line-height:1.6;">
    ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#faf7f1;opacity:0;">${escapeHtml(preheader)}</div>` : ''}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#faf7f1;">
      <tr>
        <td align="center" style="padding:40px 16px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; width:100%;">
            <tr>
              <td style="padding:8px 32px 24px; font-family: Georgia, 'Times New Roman', serif; font-size:13px; letter-spacing:0.18em; text-transform:uppercase; color:#506068; font-weight:500;">
                ${escapeHtml(fromName)}
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 16px; border-bottom:1px solid #1e2e34;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:32px 32px 8px; font-size:16px; line-height:1.65; color:#1e2e34;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:48px 32px 24px; border-top:1px solid #d8d2c2;"></td>
            </tr>
            <tr>
              <td style="padding:0 32px 32px; font-size:12px; line-height:1.6; color:#506068;">
                <p style="margin:0 0 8px;">
                  Stay Cape Ann &middot; ${escapeHtml(PHYSICAL_ADDRESS)}
                </p>
                <p style="margin:0;">
                  <a href="${escapeAttr(args.unsubscribeUrl)}" style="color:#506068; text-decoration:underline;">Unsubscribe</a>
                  &nbsp;&middot;&nbsp;
                  <a href="https://staycapeann.com" style="color:#506068; text-decoration:underline;">staycapeann.com</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderText(args: {
  subject: string;
  bodyMarkdown: string;
  unsubscribeUrl: string;
  fromName?: string;
}): string {
  const fromName = args.fromName || 'Stay Cape Ann';
  const lines: string[] = [];
  lines.push(fromName.toUpperCase());
  lines.push('');
  lines.push(stripMarkdown(args.bodyMarkdown).trim());
  lines.push('');
  lines.push('-- ');
  lines.push(`Stay Cape Ann · ${PHYSICAL_ADDRESS}`);
  lines.push(`Unsubscribe: ${args.unsubscribeUrl}`);
  return lines.join('\n');
}

/**
 * Tiny Markdown → HTML. Block-level: paragraphs, headings, lists, hr,
 * blockquote. Inline: bold, italic, links. Anything else goes through
 * as paragraph text with HTML escaped.
 */
function markdownToHtml(md: string): string {
  const blocks = md.replace(/\r\n/g, '\n').split(/\n{2,}/);
  const parts: string[] = [];

  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;

    // Horizontal rule
    if (/^---+$/.test(block)) {
      parts.push('<hr style="border:none; border-top:1px solid #d8d2c2; margin:24px 0;" />');
      continue;
    }

    // Heading
    const h = block.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const text = renderInline(h[2]);
      const sizes = { 1: 30, 2: 22, 3: 17 } as const;
      const margins = { 1: '0 0 16px', 2: '24px 0 12px', 3: '20px 0 8px' } as const;
      parts.push(
        `<h${level} style="font-family: Georgia, 'Times New Roman', serif; font-weight:400; font-size:${sizes[level as 1 | 2 | 3]}px; line-height:1.2; letter-spacing:-0.01em; color:#1e2e34; margin:${margins[level as 1 | 2 | 3]};">${text}</h${level}>`
      );
      continue;
    }

    // Blockquote
    if (block.startsWith('>')) {
      const inner = block
        .split('\n')
        .map((l) => l.replace(/^>\s?/, ''))
        .join(' ');
      parts.push(
        `<blockquote style="margin:16px 0; padding:8px 16px; border-left:3px solid #c85a3a; color:#1e2e34; font-style:italic;">${renderInline(inner)}</blockquote>`
      );
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(block)) {
      const items = block
        .split('\n')
        .map((l) => l.replace(/^[-*]\s+/, ''))
        .filter(Boolean);
      const lis = items.map((i) => `<li style="margin:4px 0;">${renderInline(i)}</li>`).join('');
      parts.push(
        `<ul style="margin:12px 0; padding-left:22px; color:#1e2e34;">${lis}</ul>`
      );
      continue;
    }

    // Plain paragraph
    parts.push(`<p style="margin:0 0 16px;">${renderInline(block)}</p>`);
  }

  return parts.join('\n');
}

function renderInline(text: string): string {
  // Escape first, then re-introduce known patterns.
  let out = escapeHtml(text);
  // Links: [text](url)
  out = out.replace(
    /\[([^\]]+)\]\((https?:[^\s)]+)\)/g,
    (_m, label: string, url: string) =>
      `<a href="${escapeAttr(url)}" style="color:#c85a3a; text-decoration:underline;">${label}</a>`
  );
  // Bold: **text**
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic: *text* (avoid touching bold)
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  // Line breaks within a paragraph: trailing two-space line.
  out = out.replace(/  \n/g, '<br />');
  return out;
}

function stripMarkdown(md: string): string {
  return md
    .replace(/\r\n/g, '\n')
    .replace(/^(#{1,6})\s+/gm, '')
    .replace(/\[([^\]]+)\]\((https?:[^\s)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^---+$/gm, '----')
    .replace(/^[-*]\s+/gm, '• ');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
