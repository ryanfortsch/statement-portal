/**
 * Ask Helm — read-only query tools for the Claude-powered Q&A engine.
 *
 * Each tool wraps a vetted Supabase query (the same data the modules
 * render) so the model never does free-form SQL or guesses numbers: it
 * picks a tool, gets real rows back, and narrates them. Financial
 * answers (payouts, revenue) therefore come straight from
 * property_statements, not the model's arithmetic.
 *
 * createAskTools() returns the tool set plus a getSources() accessor.
 * Every tool that touches a linkable record pushes a {label, href} into
 * a per-request sources list; the /api/ask route reads it after the run
 * and returns it so the palette can show "Sources" links the operator
 * can click to verify the answer.
 *
 * Read-only by construction: no tool issues a write. Uses the anon
 * `supabase` client (read RLS is permissive on these tables).
 */

import { tool } from 'ai';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { loadOperationsData, type Range } from '@/lib/operations';
import { ACTIVE_WORK_SLIP_STATUSES, ACTIVE_TASK_STATUSES } from '@/lib/work-types';

export type AskSource = { label: string; href: string };

export function createAskTools() {
  const sources: AskSource[] = [];
  const addSource = (label: string, href: string) => {
    if (label && href && !sources.some((s) => s.href === href)) {
      sources.push({ label, href });
    }
  };

  const tools = {
    list_properties: tool({
      description:
        'List Rising Tide managed properties with owner, address, city, and management fee. Use for questions about the portfolio, who owns what, management fees, or to resolve a property name to its id.',
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await supabase
          .from('properties')
          .select('id, name, address, city, owner_full, owner_emails, mgmt_fee_pct, is_active')
          .eq('is_active', true)
          .order('name');
        if (error) return { error: error.message };
        const rows = data ?? [];
        for (const p of rows as Array<{ id: string; name: string }>) {
          addSource(p.name, `/properties/${p.id}`);
        }
        return { count: rows.length, properties: rows };
      },
    }),

    get_statements: tool({
      description:
        'Owner statement figures per property per month: rental revenue, management fee, cleaning total, repairs, owner payout, stays, and nights booked. THIS is the source of truth for any revenue or payout question. Filter by property and/or month ("2026-04" format). Omit both to get the most recent month across all properties.',
      inputSchema: z.object({
        propertyId: z
          .string()
          .optional()
          .describe('Property id like "53_rocky_neck". Resolve names via list_properties first if unsure.'),
        month: z.string().optional().describe('Month in YYYY-MM, e.g. "2026-04".'),
      }),
      execute: async ({ propertyId, month }: { propertyId?: string; month?: string }) => {
        let q = supabase
          .from('property_statements')
          .select(
            'id, property_id, property_name, owner_name, month, num_stays, nights_booked, rental_revenue, management_fee, cleaning_total, repairs_total, owner_payout',
          );
        if (propertyId) q = q.eq('property_id', propertyId);
        if (month) q = q.eq('month', month);
        // No month filter + no property: default to the latest month so we
        // don't dump every statement ever. Pull the newest month first.
        if (!month) q = q.order('month', { ascending: false }).limit(propertyId ? 24 : 60);
        const { data, error } = await q;
        if (error) return { error: error.message };
        const rows = (data ?? []) as Array<{ id: string; property_name: string; month: string }>;
        for (const s of rows) addSource(`${s.property_name} (${s.month})`, '/statements');
        return { count: rows.length, statements: rows };
      },
    }),

    list_work: tool({
      description:
        'Active work slips (per-property maintenance / owner-action items) and team tasks. Use for "what needs attention", high-priority work, owner-action backlog, or work on a specific property. Returns only active items (open / in progress / scheduled).',
      inputSchema: z.object({
        propertyId: z.string().optional().describe('Limit work slips to one property id.'),
        highPriorityOnly: z.boolean().optional().describe('Only high-priority items.'),
        ownerActionOnly: z.boolean().optional().describe('Only work slips flagged as needing owner action.'),
      }),
      execute: async ({
        propertyId,
        highPriorityOnly,
        ownerActionOnly,
      }: {
        propertyId?: string;
        highPriorityOnly?: boolean;
        ownerActionOnly?: boolean;
      }) => {
        const today = new Date().toISOString().slice(0, 10);
        let sq = supabase
          .from('work_slips')
          .select('id, property_id, title, category, priority, status, owner_action_required, scheduled_date, snoozed_until')
          .in('status', ACTIVE_WORK_SLIP_STATUSES)
          .or(`snoozed_until.is.null,snoozed_until.lte.${today}`);
        if (propertyId) sq = sq.eq('property_id', propertyId);
        if (highPriorityOnly) sq = sq.eq('priority', 'high');
        if (ownerActionOnly) sq = sq.eq('owner_action_required', true);
        const { data: slips, error: slipErr } = await sq.order('priority', { ascending: false });
        if (slipErr) return { error: slipErr.message };

        // Tasks are portfolio-wide (not per-property), so only include them
        // when the question isn't scoped to a single property.
        let tasks: unknown[] = [];
        if (!propertyId) {
          let tq = supabase
            .from('tasks')
            .select('id, title, scope, priority, status, due_date, assigned_to_email')
            .in('status', ACTIVE_TASK_STATUSES);
          if (highPriorityOnly) tq = tq.eq('priority', 'high');
          const { data: taskData } = await tq.order('priority', { ascending: false });
          tasks = taskData ?? [];
        }
        if ((slips ?? []).length > 0 || tasks.length > 0) addSource('Work board', '/work');
        return { workSlips: slips ?? [], tasks };
      },
    }),

    list_prospects: tool({
      description:
        'Prospect / deal pipeline: each prospective property with its status, contract signing state, and onboarding state. Use for "who has not signed", "which deals are pending", contract or onboarding status, or projected new revenue.',
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await supabase
          .from('projections')
          .select(
            'id, property_address, property_city, prospect_name, market, bedrooms, mgmt_fee_pct, presentation_month, status, contract_signed_at, contract_signed_name, contract_countersigned_at, onboarding_submitted_at, property_id',
          )
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) return { error: error.message };
        const rows = (data ?? []) as Array<{ id: string; property_address: string }>;
        for (const p of rows) addSource(p.property_address, `/projections/${p.id}`);
        return { count: rows.length, prospects: rows };
      },
    }),

    get_turnovers: tool({
      description:
        'Upcoming check-ins / turnover pipeline from Guesty joined with Helm inspections: who is checking in, when, prep status (cleaning done, inspection done), and same-day turnaround flags. Use for "what is checking in", "what needs an inspection", or schedule questions.',
      inputSchema: z.object({
        range: z
          .enum(['today', '3d', '7d', '14d', '30d'])
          .optional()
          .describe('Look-ahead window. Defaults to 7d.'),
      }),
      execute: async ({ range }: { range?: 'today' | '3d' | '7d' | '14d' | '30d' }) => {
        const data = await loadOperationsData((range ?? '7d') as Range);
        const turnovers = data.turnovers.map((t) => ({
          property: t.propertyName,
          guest: t.guestName,
          channel: t.channel,
          checkIn: t.checkIn,
          checkOut: t.checkOut,
          nights: t.nights,
          sameDayTurnover: t.isSameDayTurnover,
          cleaningDone: t.cleaning !== null,
          inspectionDone: t.inspectionStatus === 'complete',
          openWorkSlips: t.openWorkSlipsCount,
        }));
        if (turnovers.length > 0) addSource('Turnover pipeline', '/operations');
        return {
          checkInsInWindow: data.totalCount,
          inspectionsDone: data.inspectionDoneCount,
          turnovers,
        };
      },
    }),
  };

  return { tools, getSources: () => sources };
}
