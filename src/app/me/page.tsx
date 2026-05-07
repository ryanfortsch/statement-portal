import Link from 'next/link';
import { redirect } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { auth } from '@/auth';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import type { WorkSlipRow, TaskRow } from '@/lib/work-types';
import { ACTIVE_WORK_SLIP_STATUSES, ACTIVE_TASK_STATUSES, WORK_SLIP_CATEGORY_LABELS } from '@/lib/work-types';
import type { ContactTouchRow, TouchChannel } from '@/lib/crm';
import { TOUCH_CHANNEL_LABELS } from '@/lib/crm';
import { displayNameForEmail, getTeamMember } from '@/lib/team';

export const dynamic = 'force-dynamic';

type PropertyMini = { id: string; name: string };

type PlanRow = {
  id: string;
  property_id: string;
  guesty_reservation_id: string;
  checkin_date: string;
  checkout_date: string;
  planned_for_date: string | null;
  notes: string | null;
  properties: PropertyMini | PropertyMini[] | null;
};

type ResolvedPlan = {
  id: string;
  property_id: string;
  property_name: string;
  guesty_reservation_id: string;
  checkin_date: string;
  checkout_date: string;
  planned_for_date: string | null;
  notes: string | null;
};

type ResolvedSlip = WorkSlipRow & { property_name: string };
type ResolvedTask = TaskRow & { property_names: string[] };

type RecentTouch = ContactTouchRow & { contact_name: string };

async function getMineData(myEmail: string): Promise<{
  slips: ResolvedSlip[];
  tasks: ResolvedTask[];
  plans: ResolvedPlan[];
  recentTouches: RecentTouch[];
}> {
  if (!isHelmConfigured) return { slips: [], tasks: [], plans: [], recentTouches: [] };

  // 14-day hot window for touches — recent enough to be useful as
  // "what I've been doing", not so deep that it dominates the page.
  const touchesCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const todayIso = new Date().toISOString().slice(0, 10);
  const [slipRes, taskRes, planRes, propRes, touchesRes] = await Promise.all([
    supabase
      .from('work_slips')
      .select('*')
      .eq('assigned_to_email', myEmail)
      .in('status', ACTIVE_WORK_SLIP_STATUSES)
      .or(`snoozed_until.is.null,snoozed_until.lte.${todayIso}`)
      .order('priority', { ascending: false })
      .order('scheduled_date', { ascending: true }),
    supabase
      .from('tasks')
      .select('*')
      .eq('assigned_to_email', myEmail)
      .in('status', ACTIVE_TASK_STATUSES)
      .order('priority', { ascending: false })
      .order('due_date', { ascending: true }),
    supabase
      .from('inspection_plans')
      .select('id, property_id, guesty_reservation_id, checkin_date, checkout_date, planned_for_date, notes, properties!inner(id, name)')
      .eq('assigned_to_email', myEmail)
      .gte('planned_for_date', new Date().toISOString().slice(0, 10))
      .order('planned_for_date', { ascending: true }),
    supabase.from('properties').select('id, name'),
    supabase
      .from('contact_touches')
      .select('id, contact_id, touched_at, channel, summary, notes, by_email, direction, gmail_message_id, quo_message_id, quo_call_id, created_at, contacts!inner(id, name)')
      .eq('by_email', myEmail)
      .eq('direction', 'outbound')   // /me is "what I did", not inbound replies (those have by_email=system)
      .gte('touched_at', touchesCutoff)
      .order('touched_at', { ascending: false })
      .limit(20),
  ]);

  const propertyMap = new Map<string, string>();
  for (const p of (propRes.data ?? []) as PropertyMini[]) propertyMap.set(p.id, p.name);

  const slips: ResolvedSlip[] = ((slipRes.data ?? []) as WorkSlipRow[]).map((s) => ({
    ...s,
    property_name: propertyMap.get(s.property_id) ?? s.property_id,
  }));

  const tasks: ResolvedTask[] = ((taskRes.data ?? []) as TaskRow[]).map((t) => ({
    ...t,
    property_names: (t.property_ids ?? []).map((pid) => propertyMap.get(pid) ?? pid),
  }));

  const plans: ResolvedPlan[] = ((planRes.data ?? []) as PlanRow[]).map((p) => {
    const prop = Array.isArray(p.properties) ? p.properties[0] : p.properties;
    return {
      id: p.id,
      property_id: p.property_id,
      property_name: prop?.name ?? p.property_id,
      guesty_reservation_id: p.guesty_reservation_id,
      checkin_date: p.checkin_date,
      checkout_date: p.checkout_date,
      planned_for_date: p.planned_for_date,
      notes: p.notes,
    };
  });

  const recentTouches: RecentTouch[] = ((touchesRes.data ?? []) as Array<
    ContactTouchRow & { contacts: { id: string; name: string } | { id: string; name: string }[] | null }
  >).map((t) => {
    const c = Array.isArray(t.contacts) ? t.contacts[0] : t.contacts;
    return {
      id: t.id,
      contact_id: t.contact_id,
      touched_at: t.touched_at,
      channel: t.channel,
      summary: t.summary,
      notes: t.notes,
      by_email: t.by_email,
      direction: t.direction,
      gmail_message_id: t.gmail_message_id,
      quo_message_id: t.quo_message_id,
      quo_call_id: t.quo_call_id,
      created_at: t.created_at,
      contact_name: c?.name ?? '(contact)',
    };
  });

  return { slips, tasks, plans, recentTouches };
}

export default async function MePage() {
  const session = await auth();
  const myEmail = session?.user?.email ?? '';
  if (!myEmail) redirect('/auth/signin?callbackUrl=/me');

  const { slips, tasks, plans, recentTouches } = await getMineData(myEmail);
  const teamMember = getTeamMember(myEmail);
  const greeting = teamMember?.short ?? myEmail.split('@')[0];
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Helm &middot; Yours</div>
        <h1
          className="font-serif"
          style={{ fontSize: 44, lineHeight: 1.05, fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--ink)' }}
        >
          {greeting}, here&rsquo;s what&rsquo;s on for you.
        </h1>
        <p style={{ marginTop: 10, fontSize: 14, color: 'var(--ink-3)' }}>
          {slips.length} slip{slips.length === 1 ? '' : 's'} &middot; {tasks.length} task
          {tasks.length === 1 ? '' : 's'} &middot; {plans.length} planned walk{plans.length === 1 ? '' : 's'}
          {recentTouches.length > 0 && (
            <> &middot; {recentTouches.length} recent touch{recentTouches.length === 1 ? '' : 'es'}</>
          )}
        </p>
      </section>

      {/* PLANNED WALKS */}
      <Section title="Planned Walks" eyebrow={`${plans.length} upcoming`}>
        {plans.length === 0 ? (
          <Empty message="No inspection plans assigned to you. Head to /operations to claim a turnover." />
        ) : (
          <div>
            {plans.map((p) => {
              const isToday = p.planned_for_date === todayIso;
              const isPast = !!p.planned_for_date && p.planned_for_date < todayIso;
              return (
                <Link
                  key={p.id}
                  href="/operations"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '14px 0',
                    borderBottom: '1px solid var(--rule)',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: isPast ? 'var(--negative)' : isToday ? 'var(--signal)' : 'var(--tide-deep)',
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: 'var(--ink)' }}>{p.property_name}</div>
                    <div style={{ marginTop: 3, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.06em' }}>
                      Walk {p.planned_for_date} &middot; check-in {p.checkin_date}
                      {p.notes ? ` · ${p.notes}` : ''}
                    </div>
                  </div>
                  <span style={pillStyle(isPast ? 'var(--negative)' : isToday ? 'var(--signal)' : 'var(--tide-deep)')}>
                    {isPast ? 'overdue' : isToday ? 'today' : 'upcoming'}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </Section>

      {/* WORK SLIPS */}
      <Section title="Your Work Slips" eyebrow={`${slips.length} active`}>
        {slips.length === 0 ? (
          <Empty message="No slips assigned to you. Pick one up on /work." />
        ) : (
          <div>
            {slips.map((s) => {
              const isOverdue = !!s.scheduled_date && s.scheduled_date < todayIso;
              return (
                <Link
                  key={s.id}
                  href={`/work/${s.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '14px 0',
                    borderBottom: '1px solid var(--rule)',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      flexShrink: 0,
                      background:
                        s.priority === 'high' ? 'var(--negative)' :
                        s.priority === 'normal' ? 'var(--ink-3)' :
                        'var(--ink-4)',
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: 'var(--ink)' }}>{s.title}</div>
                    <div style={{ marginTop: 3, fontSize: 11, color: isOverdue ? 'var(--negative)' : 'var(--ink-4)', letterSpacing: '.06em' }}>
                      {isOverdue && <span style={{ fontWeight: 700 }}>OVERDUE · </span>}
                      {s.property_name}
                      {s.location ? ` · ${s.location}` : ''}
                      {s.scheduled_date ? ` · ${s.scheduled_date}` : ''}
                    </div>
                  </div>
                  <span style={pillStyle('var(--ink-4)')}>
                    {WORK_SLIP_CATEGORY_LABELS[s.category] ?? s.category}
                  </span>
                  <span style={pillStyle('var(--ink-3)')}>{s.status.replace('_', ' ')}</span>
                </Link>
              );
            })}
          </div>
        )}
      </Section>

      {/* TASKS */}
      <Section title="Your Tasks" eyebrow={`${tasks.length} active`}>
        {tasks.length === 0 ? (
          <Empty message="No tasks assigned to you. Check /work for the team backlog." />
        ) : (
          <div>
            {tasks.map((t) => {
              const isOverdue = !!t.due_date && t.due_date < todayIso;
              return (
                <Link
                  key={t.id}
                  href={`/work/tasks/${t.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '14px 0',
                    borderBottom: '1px solid var(--rule)',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      flexShrink: 0,
                      background:
                        t.priority === 'high' ? 'var(--negative)' :
                        t.priority === 'medium' ? 'var(--ink-3)' :
                        'var(--ink-4)',
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: 'var(--ink)' }}>{t.title}</div>
                    <div style={{ marginTop: 3, fontSize: 11, color: isOverdue ? 'var(--negative)' : 'var(--ink-4)', letterSpacing: '.06em' }}>
                      {isOverdue && <span style={{ fontWeight: 700 }}>OVERDUE · </span>}
                      {t.scope === 'corporate' ? 'Corporate' : (t.property_names.join(', ') || 'Property')}
                      {t.due_date ? ` · due ${t.due_date}` : ''}
                    </div>
                  </div>
                  <span style={pillStyle('var(--ink-3)')}>{t.status.replace('_', ' ')}</span>
                </Link>
              );
            })}
          </div>
        )}
      </Section>

      {/* RECENT TOUCHES (CRM) */}
      <Section title="Your Recent Touches" eyebrow={`${recentTouches.length} in last 14 days`}>
        {recentTouches.length === 0 ? (
          <Empty message="No CRM touches logged in the last two weeks. Visit /crm to record one." />
        ) : (
          <div>
            {recentTouches.map((t) => (
              <Link
                key={t.id}
                href={`/crm/${t.contact_id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '14px 0',
                  borderBottom: '1px solid var(--rule)',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <span
                  style={{
                    fontSize: 9, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
                    color: 'var(--tide-deep)',
                    border: '1px solid var(--tide-deep)',
                    padding: '2px 7px',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {TOUCH_CHANNEL_LABELS[t.channel as TouchChannel] ?? t.channel}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: 'var(--ink)' }}>{t.summary}</div>
                  <div style={{ marginTop: 3, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.06em' }}>
                    {t.contact_name} &middot; {formatTouchDate(t.touched_at)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <HelmFooter module="You" right={`Signed in as ${displayNameForEmail(myEmail)}`} />
    </div>
  );
}

function Section({ title, eyebrow, children }: { title: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 48, width: '100%' }}>
      <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
        <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
          {title}
        </h2>
        <span className="eyebrow">{eyebrow}</span>
      </div>
      <div style={{ borderTop: '1px solid var(--ink)' }}>{children}</div>
    </section>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
      {message}
    </div>
  );
}

function pillStyle(color: string): React.CSSProperties {
  return {
    fontSize: 9,
    letterSpacing: '.16em',
    textTransform: 'uppercase',
    fontWeight: 600,
    color,
    border: `1px solid ${color}`,
    padding: '2px 8px',
    whiteSpace: 'nowrap',
  };
}

function formatTouchDate(iso: string): string {
  try {
    const then = new Date(iso);
    const diffMs = Date.now() - then.getTime();
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}
