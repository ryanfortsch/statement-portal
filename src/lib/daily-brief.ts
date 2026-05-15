/**
 * Daily Brief — Dotti's morning rundown across Helm + email.
 *
 * One async loader pulls the day's signals from Supabase (work slips,
 * tasks, data gaps, inbound CRM touches awaiting reply, today's
 * turnovers) and Stay Concierge (pending message approvals). The
 * /today page and the daily-brief cron both consume the same shape.
 *
 * Volumes are small: 12 properties, dozens of active items at most. A
 * handful of unindexed selects is fine.
 */

import { supabase } from '@/lib/supabase';
import {
  isStayConciergeConfigured,
  listApprovals,
  type Approval,
} from '@/lib/stay-concierge';
import type { TaskRow, WorkSlipRow } from '@/lib/work-types';
import {
  ACTIVE_TASK_STATUSES,
  ACTIVE_WORK_SLIP_STATUSES,
} from '@/lib/work-types';

export type BriefStay = {
  propertyId: string;
  propertyName: string;
  guestName: string | null;
  channel: string | null;
  checkIn: string;
  checkOut: string;
};

export type BriefInboundTouch = {
  contactId: string;
  contactName: string | null;
  channel: string;
  summary: string;
  touchedAt: string;
  daysWaiting: number;
};

export type BriefDataGap = {
  id: string;
  propertyId: string | null;
  propertyName: string | null;
  month: string | null;
  gapType: string;
  description: string | null;
  severity: string | null;
};

export type BriefInspection = {
  id: string;
  propertyId: string;
  propertyName: string;
  completedAt: string | null;
  startedAt: string | null;
};

export type BriefProspect = {
  id: string;
  prospectName: string;
  propertyAddress: string;
  propertyCity: string | null;
  status: 'draft' | 'sent';
  sentAt: string | null;
  closeLikelihoodPct: number | null;
  daysSinceSent: number | null;
};

export type DailyBrief = {
  date: string;
  checkoutsToday: BriefStay[];
  checkinsToday: BriefStay[];
  inspectionsCompletedToday: BriefInspection[];
  highPrioritySlips: WorkSlipRow[];
  ownerActionSlips: WorkSlipRow[];
  dueTasks: TaskRow[];
  inboundWaiting: BriefInboundTouch[];
  unresolvedDataGaps: BriefDataGap[];
  pendingApprovals: Approval[];
  activeProspects: BriefProspect[];
  stayConciergeConfigured: boolean;
  lastGmailSyncAt: string | null;
  totals: {
    activeSlips: number;
    activeTasks: number;
    waitingReplies: number;
    dataGaps: number;
    approvals: number;
    inspectionsToday: number;
    activeProspects: number;
  };
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${toIso.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export async function loadDailyBrief(): Promise<DailyBrief> {
  const todayIso = today();

  type ContactPick = { id: string; first_name: string | null; last_name: string | null; name: string | null };
  type InboundTouchPick = {
    id: string;
    contact_id: string;
    channel: string;
    summary: string;
    touched_at: string;
    direction: 'inbound' | 'outbound';
  };
  type ReservationPick = {
    property_id: string;
    guest_name: string | null;
    channel: string | null;
    check_in: string;
    check_out: string;
  };
  type PropertyPick = { id: string; name: string };
  type StatementJoin = { property_id: string; property_name: string | null; month: string | null };
  type DataGapPick = {
    id: string;
    gap_type: string;
    description: string | null;
    severity: string | null;
    resolved: boolean | null;
    property_statement_id: string | null;
    // Supabase infers FK joins as arrays even when 1:1; we read the
    // first row in case the type lands either way.
    property_statements: StatementJoin | StatementJoin[] | null;
  };

  type InspectionPick = { id: string; property_id: string; started_at: string | null; completed_at: string | null };
  type ProspectPick = {
    id: string;
    prospect_name: string;
    property_address: string;
    property_city: string | null;
    status: 'draft' | 'sent';
    sent_at: string | null;
    close_likelihood_pct: number | null;
    created_at: string;
  };
  type SyncStatusPick = { source: string; last_synced_at: string | null };

  // 30-day cutoff for "recently sent" prospects still awaiting response.
  const prospectCutoffIso = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [
    { data: properties },
    { data: slips },
    { data: tasks },
    { data: checkouts },
    { data: checkins },
    { data: touches },
    { data: contacts },
    { data: gaps },
    { data: inspectionsToday },
    { data: prospects },
    { data: syncRows },
  ] = await Promise.all([
    supabase.from('properties').select('id, name').eq('is_active', true),
    supabase
      .from('work_slips')
      .select('*')
      .in('status', ACTIVE_WORK_SLIP_STATUSES)
      .or(`snoozed_until.is.null,snoozed_until.lte.${todayIso}`)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('tasks')
      .select('*')
      .in('status', ACTIVE_TASK_STATUSES)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('guesty_reservations')
      .select('property_id, guest_name, channel, check_in, check_out')
      .eq('check_out', todayIso),
    supabase
      .from('guesty_reservations')
      .select('property_id, guest_name, channel, check_in, check_out')
      .eq('check_in', todayIso),
    // Last 14 days of inbound + outbound touches; we resolve "still
    // waiting" by checking if any outbound touch exists for the same
    // contact after the inbound timestamp.
    supabase
      .from('contact_touches')
      .select('id, contact_id, channel, summary, touched_at, direction')
      .gte('touched_at', new Date(Date.now() - 14 * 86_400_000).toISOString())
      .order('touched_at', { ascending: false }),
    supabase.from('contacts').select('id, first_name, last_name, name'),
    // Pull recent unresolved gaps with statement context joined in.
    supabase
      .from('data_gaps')
      .select(
        'id, gap_type, description, severity, resolved, property_statement_id, property_statements(property_id, property_name, month)',
      )
      .eq('resolved', false)
      .order('id', { ascending: false })
      .limit(50),
    supabase
      .from('inspections')
      .select('id, property_id, started_at, completed_at')
      .gte('completed_at', `${todayIso}T00:00:00`)
      .lte('completed_at', `${todayIso}T23:59:59.999`)
      .order('completed_at', { ascending: false }),
    // Drafts (need-to-send) + recently-sent (awaiting response). Older
    // sent prospects are still in the funnel but don't surface in the
    // morning brief.
    supabase
      .from('projections')
      .select('id, prospect_name, property_address, property_city, status, sent_at, close_likelihood_pct, created_at')
      .or(`status.eq.draft,and(status.eq.sent,sent_at.gte.${prospectCutoffIso})`)
      .order('created_at', { ascending: false }),
    supabase.from('sync_status').select('source, last_synced_at'),
  ]);

  const propertyById = new Map<string, string>();
  for (const p of (properties ?? []) as PropertyPick[]) {
    propertyById.set(p.id, p.name);
  }

  const contactById = new Map<string, ContactPick>();
  for (const c of (contacts ?? []) as ContactPick[]) {
    contactById.set(c.id, c);
  }

  const toStay = (r: ReservationPick): BriefStay => ({
    propertyId: r.property_id,
    propertyName: propertyById.get(r.property_id) ?? r.property_id,
    guestName: r.guest_name,
    channel: r.channel,
    checkIn: r.check_in,
    checkOut: r.check_out,
  });

  const allSlips = (slips ?? []) as WorkSlipRow[];
  const highPrioritySlips = allSlips.filter(s => s.priority === 'high');
  const ownerActionSlips = allSlips.filter(
    s => s.owner_action_required && (s.owner_status ?? 'not_sent') !== 'approved',
  );

  const allTasks = (tasks ?? []) as TaskRow[];
  const dueTasks = allTasks.filter(t => {
    if (t.priority === 'high') return true;
    if (!t.due_date) return false;
    return t.due_date <= todayIso;
  });

  // Reply-needed: most-recent inbound per contact with no outbound
  // touch newer than that inbound.
  const allTouches = (touches ?? []) as InboundTouchPick[];
  const latestInboundByContact = new Map<string, InboundTouchPick>();
  const latestOutboundByContact = new Map<string, string>();
  for (const t of allTouches) {
    if (t.direction === 'inbound') {
      const existing = latestInboundByContact.get(t.contact_id);
      if (!existing || t.touched_at > existing.touched_at) {
        latestInboundByContact.set(t.contact_id, t);
      }
    } else {
      const existing = latestOutboundByContact.get(t.contact_id);
      if (!existing || t.touched_at > existing) {
        latestOutboundByContact.set(t.contact_id, t.touched_at);
      }
    }
  }
  const inboundWaiting: BriefInboundTouch[] = [];
  for (const [contactId, inbound] of latestInboundByContact) {
    const lastOut = latestOutboundByContact.get(contactId);
    if (lastOut && lastOut >= inbound.touched_at) continue;
    const contact = contactById.get(contactId);
    const name = contact
      ? contact.name ||
        [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim() ||
        null
      : null;
    inboundWaiting.push({
      contactId,
      contactName: name,
      channel: inbound.channel,
      summary: inbound.summary,
      touchedAt: inbound.touched_at,
      daysWaiting: daysBetween(inbound.touched_at, new Date().toISOString()),
    });
  }
  inboundWaiting.sort((a, b) => (a.touchedAt < b.touchedAt ? 1 : -1));

  const unresolvedDataGaps: BriefDataGap[] = ((gaps ?? []) as unknown as DataGapPick[]).map(g => {
    const stmt: StatementJoin | null = Array.isArray(g.property_statements)
      ? g.property_statements[0] ?? null
      : g.property_statements;
    return {
      id: g.id,
      propertyId: stmt?.property_id ?? null,
      propertyName:
        stmt?.property_name ??
        (stmt?.property_id ? propertyById.get(stmt.property_id) ?? null : null),
      month: stmt?.month ?? null,
      gapType: g.gap_type,
      description: g.description,
      severity: g.severity,
    };
  });

  let pendingApprovals: Approval[] = [];
  const scConfigured = isStayConciergeConfigured();
  if (scConfigured) {
    try {
      const res = await listApprovals();
      if (res.ok) pendingApprovals = res.data.approvals;
    } catch {
      // Stay Concierge is best-effort; the brief still renders without it.
    }
  }

  const inspectionsCompletedToday: BriefInspection[] = ((inspectionsToday ?? []) as InspectionPick[]).map(i => ({
    id: i.id,
    propertyId: i.property_id,
    propertyName: propertyById.get(i.property_id) ?? i.property_id,
    completedAt: i.completed_at,
    startedAt: i.started_at,
  }));

  const activeProspects: BriefProspect[] = ((prospects ?? []) as ProspectPick[]).map(p => {
    const daysSinceSent = p.sent_at
      ? daysBetween(p.sent_at, new Date().toISOString())
      : null;
    return {
      id: p.id,
      prospectName: p.prospect_name,
      propertyAddress: p.property_address,
      propertyCity: p.property_city,
      status: p.status,
      sentAt: p.sent_at,
      closeLikelihoodPct: p.close_likelihood_pct,
      daysSinceSent,
    };
  });
  // Drafts first (most actionable), then most-recently-sent.
  activeProspects.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'draft' ? -1 : 1;
    const aKey = a.sentAt ?? '';
    const bKey = b.sentAt ?? '';
    return aKey < bKey ? 1 : -1;
  });

  const syncBySource = new Map<string, string | null>();
  for (const r of (syncRows ?? []) as SyncStatusPick[]) {
    syncBySource.set(r.source, r.last_synced_at);
  }
  const lastGmailSyncAt = syncBySource.get('gmail-replies') ?? null;

  return {
    date: todayIso,
    checkoutsToday: ((checkouts ?? []) as ReservationPick[]).map(toStay),
    checkinsToday: ((checkins ?? []) as ReservationPick[]).map(toStay),
    inspectionsCompletedToday,
    highPrioritySlips,
    ownerActionSlips,
    dueTasks,
    inboundWaiting,
    unresolvedDataGaps,
    pendingApprovals,
    activeProspects,
    stayConciergeConfigured: scConfigured,
    lastGmailSyncAt,
    totals: {
      activeSlips: allSlips.length,
      activeTasks: allTasks.length,
      waitingReplies: inboundWaiting.length,
      dataGaps: unresolvedDataGaps.length,
      approvals: pendingApprovals.length,
      inspectionsToday: inspectionsCompletedToday.length,
      activeProspects: activeProspects.length,
    },
  };
}

export function briefHeadline(brief: DailyBrief): string {
  const draftProspects = brief.activeProspects.filter(p => p.status === 'draft').length;
  const bits: string[] = [];
  if (brief.totals.waitingReplies) bits.push(`${brief.totals.waitingReplies} reply needed`);
  if (brief.totals.approvals) bits.push(`${brief.totals.approvals} draft${brief.totals.approvals === 1 ? '' : 's'} to review`);
  if (brief.checkoutsToday.length) bits.push(`${brief.checkoutsToday.length} checkout${brief.checkoutsToday.length === 1 ? '' : 's'}`);
  if (brief.checkinsToday.length) bits.push(`${brief.checkinsToday.length} check-in${brief.checkinsToday.length === 1 ? '' : 's'}`);
  if (draftProspects) bits.push(`${draftProspects} prospect draft${draftProspects === 1 ? '' : 's'}`);
  if (!bits.length) return 'Clear deck. Have a great day.';
  return bits.join(', ');
}

export function helmBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_HELM_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://statements.risingtidestr.com'
  );
}
