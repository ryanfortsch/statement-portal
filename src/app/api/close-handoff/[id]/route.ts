import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isOwnerSession } from '@/lib/helm-access-server';
import { deleteHandoffItem, loadHandoffItem, removeHandoffFile, updateHandoffItem } from '@/lib/close-handoff-db';

/**
 * One handoff item.
 *
 * PATCH /api/close-handoff/:id  { action, note?, receipt_id? }
 *   sent     open -> sent          the creator or an owner
 *   reopen   sent -> open          the creator or an owner
 *   dismiss  open|sent -> dismissed   OWNERS ONLY, with a note
 *   filed    open|sent -> filed       OWNERS ONLY, carrying the receipt id
 *            the owner got back from /api/receipts (or a note, for a
 *            cleaning issue noted on the period)
 * DELETE /api/close-handoff/:id   an open or sent item, the creator or an owner
 *
 * Filing and dismissing decide what reaches an owner's statement, so they
 * are owner moves even though the page is open to staff; a staff login gets
 * a 403 here whatever the page showed. Nothing in this route writes a
 * statement, a receipt or a payout.
 */

const OWNER_ACTIONS = new Set(['dismiss', 'filed']);
const ACTIONS = new Set(['sent', 'reopen', 'dismiss', 'filed']);

async function who(): Promise<{ email: string; owner: boolean } | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  return { email, owner: await isOwnerSession() };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const me = await who();
  if (!me) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const action = String(body.action || '');
  if (!ACTIONS.has(action)) return NextResponse.json({ error: 'action must be sent, reopen, dismiss or filed' }, { status: 400 });
  if (OWNER_ACTIONS.has(action) && !me.owner) return NextResponse.json({ error: 'owners only' }, { status: 403 });

  try {
    const item = await loadHandoffItem(id);
    if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const mine = item.created_by.toLowerCase() === me.email.toLowerCase();
    if (!mine && !me.owner) return NextResponse.json({ error: 'not yours' }, { status: 403 });
    const now = new Date().toISOString();
    const note = String(body.note || '').trim().slice(0, 300) || null;

    if (action === 'sent') {
      if (item.status !== 'open') return NextResponse.json({ error: `already ${item.status}` }, { status: 409 });
      const next = await updateHandoffItem(id, { status: 'sent', sent_at: now });
      return NextResponse.json({ ok: true, item: next });
    }
    if (action === 'reopen') {
      if (item.status !== 'sent') return NextResponse.json({ error: `cannot reopen a ${item.status} item` }, { status: 409 });
      const next = await updateHandoffItem(id, { status: 'open', sent_at: null });
      return NextResponse.json({ ok: true, item: next });
    }
    if (item.status === 'filed' || item.status === 'dismissed') {
      return NextResponse.json({ error: `already ${item.status}` }, { status: 409 });
    }
    if (action === 'dismiss') {
      const next = await updateHandoffItem(id, { status: 'dismissed', resolved_at: now, resolved_by: me.email, resolution_note: note });
      return NextResponse.json({ ok: true, item: next });
    }
    // filed
    const receiptId = typeof body.receipt_id === 'string' && body.receipt_id.trim() ? body.receipt_id.trim() : null;
    if (!receiptId && !note) return NextResponse.json({ error: 'filed needs the receipt id or a note' }, { status: 400 });
    const next = await updateHandoffItem(id, {
      status: 'filed',
      resolved_at: now,
      resolved_by: me.email,
      resolution_note: note,
      receipt_id: receiptId,
    });
    return NextResponse.json({ ok: true, item: next });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const me = await who();
  if (!me) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { id } = await params;
  try {
    const item = await loadHandoffItem(id);
    if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const mine = item.created_by.toLowerCase() === me.email.toLowerCase();
    if (!mine && !me.owner) return NextResponse.json({ error: 'not yours' }, { status: 403 });
    if (item.status === 'filed' || item.status === 'dismissed') {
      return NextResponse.json({ error: `a ${item.status} item stays on the record` }, { status: 409 });
    }
    await deleteHandoffItem(id);
    if (item.file_path) await removeHandoffFile(item.file_path);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
