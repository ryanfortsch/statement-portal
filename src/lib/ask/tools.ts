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
    search_helm: tool({
      description:
        'Locate anything in Helm by free-text query (a name, address, owner, or house). Searches managed properties, the prospect/deal pipeline, and CRM contacts in one call and returns each match with its type and a link. START HERE for "where are we with X", "who is X", or any lookup where you are not sure whether X is a property, a prospect, or a person; then drill in with the specific tool (get_statements, get_contact_history, list_prospects) using the ids returned.',
      inputSchema: z.object({
        query: z
          .string()
          .describe('Free text: a person, owner, address, or property/house name, e.g. "36 Granite" or "John Gavin".'),
      }),
      execute: async ({ query }: { query: string }) => {
        // Strip characters that are structural in a PostgREST or() filter
        // (commas/parens) plus wildcards, so the value can't break the
        // query or inject a wildcard.
        const safe = (query ?? '').replace(/[,()*%]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!safe) return { error: 'Provide a search query.' };
        const like = `%${safe}%`;
        const matches: Array<Record<string, unknown>> = [];

        // Managed properties.
        const { data: props } = await supabase
          .from('properties')
          .select('id, name, address, city, owner_full, is_active')
          .or(`name.ilike.${like},address.ilike.${like},owner_full.ilike.${like}`)
          .limit(8);
        for (const p of (props ?? []) as Array<{
          id: string;
          name: string;
          address: string | null;
          owner_full: string | null;
          is_active: boolean | null;
        }>) {
          addSource(p.name, `/properties/${p.id}`);
          matches.push({
            kind: 'property',
            id: p.id,
            label: p.name,
            address: p.address,
            owner: p.owner_full,
            isActive: p.is_active,
            href: `/properties/${p.id}`,
          });
        }

        // Prospect / deal pipeline.
        const { data: prospects } = await supabase
          .from('projections')
          .select('id, property_address, property_city, prospect_name, status, presentation_month, contract_signed_at, property_id')
          .or(`property_address.ilike.${like},prospect_name.ilike.${like},property_city.ilike.${like}`)
          .limit(8);
        for (const pr of (prospects ?? []) as Array<{
          id: string;
          property_address: string;
          prospect_name: string | null;
          status: string | null;
        }>) {
          addSource(pr.property_address, `/projections/${pr.id}`);
          matches.push({
            kind: 'prospect',
            id: pr.id,
            label: pr.property_address,
            prospectName: pr.prospect_name,
            status: pr.status,
            href: `/projections/${pr.id}`,
          });
        }

        // CRM contacts.
        const { data: contacts } = await supabase
          .from('contacts')
          .select('id, name, organization, type, linked_property_ids')
          .or(`name.ilike.${like},organization.ilike.${like}`)
          .limit(8);
        for (const c of (contacts ?? []) as Array<{
          id: string;
          name: string;
          organization: string | null;
          type: string;
        }>) {
          addSource(c.name, `/crm/${c.id}`);
          matches.push({
            kind: 'contact',
            id: c.id,
            label: c.name,
            organization: c.organization,
            contactType: c.type,
            href: `/crm/${c.id}`,
          });
        }

        return { query: safe, matchCount: matches.length, matches };
      },
    }),

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
        'Prospect / deal pipeline: each prospective property with its status, contract signing state, and onboarding state. Use for "who has not signed", "which deals are pending", contract or onboarding status, projected new revenue, or to look up where a specific prospective property or address stands (e.g. "where are we with 36 Granite") by matching the address or prospect name against the returned list.',
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

    get_contact_history: tool({
      description:
        'Conversation / communication history with a person (owner, vendor, lead, or other contact): every logged email, text, and call between Rising Tide and that contact. Use for ANY question about what was said, when someone was last contacted, what a person asked for, or "what conversations have we had with X". Search by contact name (partial is fine, e.g. "Jane Armstrong" or "Armstrong") or by a property id to get everyone linked to that property. Touches come from Gmail (email), Quo (text/call), and manual logs.',
      inputSchema: z.object({
        name: z
          .string()
          .optional()
          .describe('Full or partial contact name, e.g. "Jane Armstrong".'),
        propertyId: z
          .string()
          .optional()
          .describe('Property id like "4_brier_neck" to get every contact linked to it. Resolve names via list_properties first if needed.'),
      }),
      execute: async ({ name, propertyId }: { name?: string; propertyId?: string }) => {
        if (!name && !propertyId) {
          return { error: 'Provide a contact name or a property id.' };
        }
        type ContactRow = {
          id: string;
          type: string;
          name: string;
          emails: string[] | null;
          phone: string | null;
          organization: string | null;
          linked_property_ids?: string[] | null;
        };

        let contacts: ContactRow[];
        if (propertyId) {
          const { data, error } = await supabase
            .from('contacts')
            .select('id, type, name, emails, phone, organization, linked_property_ids')
            .contains('linked_property_ids', [propertyId])
            .limit(8);
          if (error) return { error: error.message };
          contacts = (data ?? []) as ContactRow[];
        } else {
          // Token-based fuzzy match instead of a literal substring ilike.
          // A contact's `name` is often the household ("The Armstrong
          // Family") while the question uses a person's name ("Jane
          // Armstrong") whose first name only appears in the email
          // (jane@...). A `name ilike '%Jane Armstrong%'` can't match
          // that. The CRM is tiny (dozens of rows), so fetch all and
          // score by how many query tokens land in name + emails +
          // organization. Requiring every token (length >= 2) to appear
          // somewhere matches "Jane Armstrong" -> "The Armstrong Family"
          // (armstrong in name, jane in email) without false positives.
          const { data, error } = await supabase
            .from('contacts')
            .select('id, type, name, emails, phone, organization, linked_property_ids');
          if (error) return { error: error.message };
          const all = (data ?? []) as ContactRow[];
          const tokens = (name ?? '')
            .toLowerCase()
            .split(/\s+/)
            .map((t) => t.replace(/[^a-z0-9@.]/g, ''))
            .filter((t) => t.length >= 2);
          const scored = all
            .map((c) => {
              const hay = `${c.name} ${(c.emails ?? []).join(' ')} ${c.organization ?? ''}`.toLowerCase();
              const hits = tokens.filter((t) => hay.includes(t)).length;
              return { c, hits };
            })
            // Require every token to appear (all tokens matched), else
            // fall back to "at least one" so a single-word search ("Jane")
            // still works.
            .filter((x) => (tokens.length > 1 ? x.hits === tokens.length : x.hits > 0))
            .sort((a, b) => b.hits - a.hits);
          contacts = scored.slice(0, 8).map((x) => x.c);
        }

        if (contacts.length === 0) {
          return {
            contacts: [],
            note:
              'No matching contact found in the CRM. The person may not have a contact record yet (owners are also reachable via list_properties).',
          };
        }

        // Pull recent touches for the matched contacts in one query, then
        // group by contact. Newest first; cap so a chatty contact doesn't
        // blow the context.
        const ids = contacts.map((c) => c.id);
        const { data: touchRows, error: touchErr } = await supabase
          .from('contact_touches')
          .select('contact_id, touched_at, channel, direction, summary, by_email, gmail_message_id, quo_message_id, quo_call_id')
          .in('contact_id', ids)
          .order('touched_at', { ascending: false })
          .limit(80);
        if (touchErr) return { error: touchErr.message };

        type TouchRow = {
          contact_id: string;
          touched_at: string;
          channel: string;
          direction: string;
          summary: string;
          by_email: string;
          gmail_message_id: string | null;
          quo_message_id: string | null;
          quo_call_id: string | null;
        };
        const byContact = new Map<string, Array<Record<string, unknown>>>();
        for (const t of (touchRows ?? []) as TouchRow[]) {
          const source = t.quo_message_id || t.quo_call_id ? 'quo' : t.gmail_message_id ? 'gmail' : 'manual';
          const list = byContact.get(t.contact_id) ?? [];
          // Keep up to 20 most recent per contact.
          if (list.length < 20) {
            list.push({
              date: t.touched_at,
              channel: t.channel,
              direction: t.direction,
              summary: t.summary,
              by: t.by_email,
              source,
            });
          }
          byContact.set(t.contact_id, list);
        }

        for (const c of contacts) addSource(c.name, `/crm/${c.id}`);
        return {
          contacts: contacts.map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            emails: c.emails,
            phone: c.phone,
            organization: c.organization,
            touches: byContact.get(c.id) ?? [],
            touchCount: (byContact.get(c.id) ?? []).length,
          })),
        };
      },
    }),
  };

  return { tools, getSources: () => sources };
}
