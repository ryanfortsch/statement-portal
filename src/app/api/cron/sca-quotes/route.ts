import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { authorizeCron } from '@/lib/cron-auth';
import { sendBalanceReminderEmail, sendBalanceReminderSms } from '@/lib/sca-quote-email';
import { shiftIsoDay, todayInEastern, type ScaQuoteRow } from '@/lib/sca-quotes-types';

export const maxDuration = 120;

/**
 * GET /api/cron/sca-quotes
 *
 * Daily housekeeping for Stay Cape Ann custom quotes (13:00 UTC, 9 AM
 * Eastern, when a reminder text lands at a civil hour):
 *
 *   (a) Stamp status 'expired' on drafts and sent quotes whose expires_at
 *       has passed. The bridge and the operator pages already derive
 *       expiry at read time; the column is for list filters and for the
 *       operator's eye.
 *   (b) Balance reminders for accepted split quotes: one reminder when the
 *       balance comes due within 7 days, then one more each week it stays
 *       overdue. Email always, a text when we have a phone.
 *
 * Idempotent. Tolerates the table not existing yet (migration not applied)
 * the way channels-backfill does.
 */
export async function GET(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  try {
    const nowIso = new Date().toISOString();
    const today = todayInEastern();

    // (a) expiry
    const { data: expiredRows, error: expireErr } = await supabaseAdmin
      .from('sca_quotes')
      .update({ status: 'expired' })
      .in('status', ['draft', 'sent'])
      .lte('expires_at', nowIso)
      .select('id');
    if (expireErr) throw new Error(expireErr.message);
    const expired = expiredRows?.length ?? 0;

    // (b) balance reminders
    const { data: dueRows, error: dueErr } = await supabaseAdmin
      .from('sca_quotes')
      .select('*')
      .eq('status', 'accepted')
      .eq('payment_plan', 'split')
      .is('balance_paid_at', null)
      .not('balance_due_on', 'is', null)
      .lte('balance_due_on', shiftIsoDay(today, 7))
      .order('balance_due_on', { ascending: true })
      .limit(200);
    if (dueErr) throw new Error(dueErr.message);

    const weekAgo = Date.now() - 7 * 86_400_000;
    let reminded = 0;
    let reminderFailures = 0;
    for (const raw of (dueRows ?? []) as ScaQuoteRow[]) {
      const q: ScaQuoteRow = { ...raw, extra_lines: Array.isArray(raw.extra_lines) ? raw.extra_lines : [], sent_via: raw.sent_via ?? [] };
      if (!q.balance_due_on || (q.balance_cents ?? 0) <= 0) continue;
      if (!q.guest_email && !q.guest_phone) continue;
      const lastSent = q.balance_reminder_sent_at ? Date.parse(q.balance_reminder_sent_at) : null;
      const overdue = q.balance_due_on < today;
      const due = lastSent == null || (overdue && lastSent < weekAgo);
      if (!due) continue;

      const results: { ok: boolean; reason?: string }[] = [];
      if (q.guest_email) results.push(await sendBalanceReminderEmail({ quote: q }));
      if (q.guest_phone) results.push(await sendBalanceReminderSms({ quote: q }));
      if (results.some((r) => r.ok)) {
        // The stamp is what stops tomorrow's run from sending the same
        // reminder again; a failed write must be visible, not silent.
        const { error: stampErr } = await supabaseAdmin
          .from('sca_quotes')
          .update({ balance_reminder_sent_at: nowIso })
          .eq('id', q.id);
        if (stampErr) {
          reminderFailures++;
          console.error('[cron/sca-quotes] reminder sent but the stamp failed for', q.id, stampErr.message);
        } else {
          reminded++;
        }
      } else {
        reminderFailures++;
        console.warn('[cron/sca-quotes] reminder failed for', q.id, results.map((r) => r.reason).join('; '));
      }
    }

    return NextResponse.json({ ok: true, expired, reminded, reminder_failures: reminderFailures });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/does not exist|relation .* does not exist|schema cache/i.test(msg)) {
      return NextResponse.json({ ok: true, skipped: 'migration_not_applied' });
    }
    console.error('[cron/sca-quotes]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
