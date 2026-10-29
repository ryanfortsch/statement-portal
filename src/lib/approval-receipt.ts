/** Evidence returned by a completed action, separate from the next inbox read. */
export type ApprovalReceipt = {
  title?: string;
  occurredAt?: string;
  items: { key: string; state: 'confirmed' | 'pending' | 'attention'; label: string; href?: string }[];
};

export function parseReceipt(value: unknown): ApprovalReceipt | undefined {
  if (!value || typeof value !== 'object' || !('items' in value) || !Array.isArray(value.items)) return;
  const items: ApprovalReceipt['items'] = [];
  for (const item of value.items.slice(0, 12)) {
    if (!item || typeof item !== 'object' || typeof item.key !== 'string' || typeof item.label !== 'string' || !['confirmed', 'pending', 'attention'].includes(item.state)) continue;
    const href = typeof item.href === 'string' && item.href.startsWith('/') && !item.href.startsWith('//') && !item.href.includes('\\') && !/[\u0000-\u001f]/.test(item.href) ? item.href : undefined;
    items.push({ key: item.key, label: item.label, state: item.state, href });
  }
  if (!items.length) return;
  return { items, title: 'title' in value && typeof value.title === 'string' ? value.title : undefined,
    occurredAt: 'occurredAt' in value && typeof value.occurredAt === 'string' ? value.occurredAt : undefined };
}

/** Only the service's approved status is evidence of a completed send. */
export function sentReceipt(result: { status: string; receipt?: unknown; slip?: { id: string } | null; followup_warning?: string }, label = 'Reply sent'): ApprovalReceipt | undefined {
  if (result.status !== 'approved') return;
  const explicit = parseReceipt(result.receipt);
  if (explicit) return explicit;
  const items: ApprovalReceipt['items'] = [{ key: 'reply', state: 'confirmed', label }];
  if (result.slip?.id) items.push({ key: 'slip', state: 'confirmed', label: 'Work slip filed', href: `/work/${encodeURIComponent(result.slip.id)}` });
  if (result.followup_warning) items.push({ key: 'followup', state: 'attention', label: result.followup_warning });
  return { items };
}
