import { NextRequest, NextResponse } from 'next/server';
import { isServiceConfigured } from '@/lib/supabase-admin';
import { authorizeCron } from '@/lib/cron-auth';
import { sendTransactionalViaResend } from '@/lib/resend';
import { weeklyBriefEmails } from '@/lib/team-recipients';
import { loadWeeklyBrief } from '@/lib/weekly-brief-server';
import { esc, weeklyBriefHtml } from '@/lib/weekly-brief-html';
import { renderWeeklyBriefPdf } from '@/lib/weekly-brief-pdf';
import { briefFilename, briefSubject, isSendHour, shortDay, type WeeklyBrief } from '@/lib/weekly-brief';

/** One line on what guests told us, for the email body. */
function feedbackLine(b: WeeklyBrief): string {
  const f = b.feedback;
  if (f.unreadable) return 'The reviews could not be read this morning.';
  const below = f.belowFive.length + f.moreBelowFive;
  const notes = f.notes.length + f.moreNotes;
  const parts = [`${f.total} review${f.total === 1 ? '' : 's'} last week`];
  parts.push(below ? `${below} below five stars` : 'none below five stars');
  if (notes) parts.push(`${notes} five-star with a note to us`);
  return `${parts.join(', ')}. Page 2 has them.`;
}

/**
 * GET /api/cron/weekly-brief
 *
 * The Tuesday brief (lib/weekly-brief.ts): a printable PDF of Delaney's
 * three goals, the week's check-ins by day, what guests told us in the
 * week before (page two), and one page per home with its
 * open work in priority order, emailed to whoever holds the `weekly_brief`
 * duty in team.ts (Dotti).
 *
 * Vercel crons are UTC-only, so vercel.json fires at 10:00 and 11:00 UTC
 * on Tuesdays and only the run that lands at 6 AM Eastern sends (10:00 in
 * daylight time, 11:00 in standard time). The other run answers `skipped`.
 *
 * Manual runs (a signed-in Helm session or the cron bearer):
 *   ?format=pdf    the PDF in the browser, nothing sent
 *   ?format=html   the same document as a page, nothing sent
 *   ?force=1       send now, whatever the hour
 */

export const maxDuration = 300;

const FROM_NAME = 'Helm';
const FROM_EMAIL = process.env.WEEKLY_BRIEF_FROM_EMAIL || 'helm@risingtidestr.com';

function emailHtml(b: WeeklyBrief): string {
  const total = b.days.reduce((n, d) => n + d.checkIns.length, 0);
  const high = b.pages.reduce((n, p) => n + p.highCount, 0);
  const goals = (b.scorecard ?? [])
    .map((t) => `<li><strong>${esc(t.label)}</strong>: ${esc(t.value)} <span style="color:#7a878c">(${esc(t.goal)})</span></li>`)
    .join('');
  const days = b.days
    .filter((d) => d.checkIns.length)
    .map((d) => `${esc(shortDay(d.date))}: ${d.checkIns.map((c) => esc(c.home)).join(', ')}`)
    .join('<br/>');
  return `<div style="font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:1.5;color:#1e2e34;max-width:560px">
    <p>The week of ${esc(shortDay(b.window.from))} is attached, ready to print.</p>
    ${goals ? `<p style="margin-bottom:4px"><strong>Operations goals</strong></p><ul style="margin-top:0;padding-left:18px">${goals}</ul>` : ''}
    <p style="margin-bottom:4px"><strong>${total} check-in${total === 1 ? '' : 's'} this week</strong></p>
    <p style="margin-top:0">${days || 'None.'}</p>
    <p>${esc(feedbackLine(b))}</p>
    <p>${b.pages.length} home${b.pages.length === 1 ? '' : 's'} with open work${high ? `, ${high} high-priority item${high === 1 ? '' : 's'}` : ''}. One page each, in priority order.</p>
  </div>`;
}

function emailText(b: WeeklyBrief): string {
  const total = b.days.reduce((n, d) => n + d.checkIns.length, 0);
  const goals = (b.scorecard ?? []).map((t) => `${t.label}: ${t.value} (${t.goal})`).join('\n');
  const days = b.days
    .filter((d) => d.checkIns.length)
    .map((d) => `${shortDay(d.date)}: ${d.checkIns.map((c) => c.home).join(', ')}`)
    .join('\n');
  return `The week of ${shortDay(b.window.from)} is attached, ready to print.\n\n${goals ? `Operations goals\n${goals}\n\n` : ''}${total} check-ins this week\n${days || 'None.'}\n\n${feedbackLine(b)}\n`;
}

export async function GET(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;
  if (!isServiceConfigured) {
    return NextResponse.json({ error: 'supabase service role not configured' }, { status: 500 });
  }

  const params = request.nextUrl.searchParams;
  const format = params.get('format');
  const force = params.get('force') === '1';
  if (!format && !force && !isSendHour(new Date())) {
    return NextResponse.json({ ok: true, skipped: 'not 6 AM Tuesday Eastern' });
  }

  try {
    const brief = await loadWeeklyBrief();
    const html = weeklyBriefHtml(brief);
    if (format === 'html') {
      return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }

    const { pdf, overflowed } = await renderWeeklyBriefPdf(html);
    if (overflowed) console.warn(`[cron/weekly-brief] ${overflowed} page(s) ran past one sheet at the smallest size`);
    if (format === 'pdf') {
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `inline; filename="${briefFilename(brief.today)}"`,
          'cache-control': 'no-store',
        },
      });
    }

    const [to, ...cc] = weeklyBriefEmails();
    if (!to) return NextResponse.json({ ok: false, error: 'no one holds the weekly_brief duty' }, { status: 500 });
    const sent = await sendTransactionalViaResend({
      to,
      cc: cc.length ? cc : undefined,
      fromName: FROM_NAME,
      fromEmail: FROM_EMAIL,
      subject: briefSubject(brief.today),
      html: emailHtml(brief),
      text: emailText(brief),
      attachments: [{ filename: briefFilename(brief.today), content: pdf.toString('base64') }],
      timeoutMs: 30_000,
      // One brief per Tuesday: a second cron delivery the same day is
      // dropped by Resend. A forced run is a deliberate resend.
      idempotencyKey: force ? `weekly-brief-${brief.today}-${Date.now()}` : `weekly-brief-${brief.today}`,
    });
    if (!sent) return NextResponse.json({ ok: false, error: 'email send failed' }, { status: 502 });
    return NextResponse.json({
      ok: true,
      sent: true,
      today: brief.today,
      pages: brief.pages.length + 1,
      checkIns: brief.days.reduce((n, d) => n + d.checkIns.length, 0),
      overflowed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/weekly-brief]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
