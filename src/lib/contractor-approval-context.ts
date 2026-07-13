import 'server-only';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

/**
 * Field context for a contractor-message approval, so the office isn't handed a
 * blank property dropdown when the sender is plainly mid-run.
 *
 * stay-concierge drafts these replies + mines the work slip, but it has no Field
 * data — it can't know Delaney was on an inspection run when she texted "I
 * marked the one propane tank to be refilled." Helm does. This resolves the
 * contractor by phone, then infers the property from their run:
 *  - runProperties: the homes on their live packet (narrow the dropdown to these)
 *  - suggested: the home they'd most recently finished BEFORE the message (you
 *    can only be talking about a home you've already been to) — and, when the
 *    slip keyword-matches something they already flagged in an inspection, the
 *    matching home wins.
 *  - alreadyFiled: matching slips they already filed IN the inspection, so the
 *    office is warned this may be a duplicate.
 */
export type ApprovalContext = {
  suggestedPropertyId: string | null;
  runProperties: { id: string; name: string }[];
  alreadyFiled: { name: string; title: string }[];
};

type ApprovalLite = {
  id: string;
  contractor_contact: string;
  created_at: string;
  proposed_slip: { title?: string | null } | null;
};

const last10 = (s: string | null | undefined) => (s || '').replace(/\D/g, '').slice(-10);
const STOP = new Set(['refill', 'swap', 'replace', 'with', 'the', 'and', 'for', 'off', 'out', 'cap', 'fix', 'repair']);
function tokens(title: string | null | undefined): string[] {
  return [...new Set((title || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4 && !STOP.has(w)))];
}

export async function loadContractorApprovalContext(
  approvals: ApprovalLite[],
  propertyNames: Map<string, string>,
): Promise<Record<string, ApprovalContext>> {
  const out: Record<string, ApprovalContext> = {};
  const withSlip = approvals.filter((a) => a.proposed_slip && a.contractor_contact);
  if (withSlip.length === 0) return out;

  // Resolve each approval's contractor by phone (last 10 digits, format-agnostic).
  const { data: cRows } = await supabase.from('contractors').select('id, phone');
  const idByPhone = new Map<string, string>();
  for (const c of ((cRows ?? []) as { id: string; phone: string | null }[])) {
    const k = last10(c.phone);
    if (k) idByPhone.set(k, c.id);
  }
  const contractorByApproval = new Map<string, string>();
  for (const a of withSlip) {
    const cid = idByPhone.get(last10(a.contractor_contact));
    if (cid) contractorByApproval.set(a.id, cid);
  }
  const contractorIds = [...new Set(contractorByApproval.values())];
  if (contractorIds.length === 0) return out;

  // Every stop on their live packets — includes homes they've already finished
  // today (completed stops on an in-progress packet), which is exactly the set
  // a "what I found" message refers to.
  const { data: stopRows } = await supabase
    .from('packet_stops')
    .select('property_id, inspection_id, inspection_packets!inner(awarded_contractor_id, status)')
    .in('inspection_packets.awarded_contractor_id', contractorIds)
    .in('inspection_packets.status', ['claimed', 'in_progress', 'submitted']);
  const stops = ((stopRows ?? []) as unknown as {
    property_id: string | null;
    inspection_id: string | null;
    inspection_packets: { awarded_contractor_id: string };
  }[]);

  const runByContractor = new Map<string, Set<string>>();
  const inspToProp = new Map<string, string>();
  const inspIds: string[] = [];
  for (const s of stops) {
    if (!s.property_id) continue;
    const set = runByContractor.get(s.inspection_packets.awarded_contractor_id) ?? new Set<string>();
    set.add(s.property_id);
    runByContractor.set(s.inspection_packets.awarded_contractor_id, set);
    if (s.inspection_id) {
      inspToProp.set(s.inspection_id, s.property_id);
      inspIds.push(s.inspection_id);
    }
  }

  // When each of those inspections finished, and what slips they filed in it.
  const [{ data: inspRows }, { data: slipRows }] = await Promise.all([
    inspIds.length ? supabase.from('inspections').select('id, completed_at').in('id', inspIds) : Promise.resolve({ data: [] }),
    inspIds.length ? supabase.from('work_slips').select('title, inspection_id').in('inspection_id', inspIds) : Promise.resolve({ data: [] }),
  ]);
  const completedAt = new Map<string, string | null>();
  for (const r of ((inspRows ?? []) as { id: string; completed_at: string | null }[])) completedAt.set(r.id, r.completed_at);
  const slipsByInsp = new Map<string, string[]>();
  for (const w of ((slipRows ?? []) as { title: string | null; inspection_id: string | null }[])) {
    if (!w.inspection_id) continue;
    const arr = slipsByInsp.get(w.inspection_id) ?? [];
    arr.push(w.title || '');
    slipsByInsp.set(w.inspection_id, arr);
  }

  for (const a of withSlip) {
    const cid = contractorByApproval.get(a.id);
    if (!cid) continue;
    const runIds = [...(runByContractor.get(cid) ?? new Set<string>())];
    const runProperties = runIds
      .map((id) => ({ id, name: propertyNames.get(id) ?? id }))
      .sort((x, y) => x.name.localeCompare(y.name));

    // This contractor's inspections, with property + finish time, only those
    // finished by the time the message came in (you can't report a home you
    // haven't reached yet — this is what excludes 19 Rackliffe below).
    const msgTime = Date.parse(a.created_at) || Date.now();
    const done = inspIds
      .filter((iid) => inspToProp.get(iid) && runByContractor.get(cid)?.has(inspToProp.get(iid) as string))
      .map((iid) => ({ iid, propertyId: inspToProp.get(iid) as string, at: completedAt.get(iid) }))
      .filter((d) => d.at && Date.parse(d.at as string) <= msgTime)
      .sort((x, y) => Date.parse(y.at as string) - Date.parse(x.at as string)); // newest finished first

    const wantTokens = tokens(a.proposed_slip?.title);
    // Homes where they already filed a slip whose title overlaps this one.
    const matches = done.filter((d) =>
      (slipsByInsp.get(d.iid) ?? []).some((t) => tokens(t).some((w) => wantTokens.includes(w))),
    );
    const alreadyFiled = matches.map((d) => ({
      name: propertyNames.get(d.propertyId) ?? d.propertyId,
      title: (slipsByInsp.get(d.iid) ?? []).find((t) => tokens(t).some((w) => wantTokens.includes(w))) || 'a slip',
    }));

    // Best guess: the matching home (most recent), else the last home they
    // finished before texting. Null if we truly can't tell.
    const suggestedPropertyId = matches[0]?.propertyId ?? done[0]?.propertyId ?? (runIds.length === 1 ? runIds[0] : null);

    out[a.id] = { suggestedPropertyId, runProperties, alreadyFiled };
  }
  return out;
}
