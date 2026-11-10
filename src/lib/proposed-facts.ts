import type { ProposedPropertyUpdate } from '@/lib/stay-concierge';
import type { FactSource } from '@/lib/property-facts-to-file';

/**
 * The one proposed-facts list on /messaging/quality (UX audit 2026-11-07,
 * slice 3). Facts from every audience (the operator's own guest replies,
 * cleaners, contractors, and for an owner login owners) render as one list,
 * a block per home, each row saying whose words it came from.
 *
 * Merging the designs did not merge the review paths, and must not. Two
 * paths file a fact, and each row keeps the one it had:
 *
 *  - A guest-reply fact that stay-concierge's kb_triage pass has already
 *    read against the home's knowledge base arrives as a triaged statement.
 *    Rows sharing a group_id are one statement, filed with
 *    fileTriagedGroup(s) or dismissed with dismissTriagedGroup.
 *  - Every other fact (cleaner, contractor, owner, and a guest-reply fact
 *    the sweep has not reached) is one candidate, reviewed through
 *    parseProposedUpdate, applyProposedUpdate or dismissProposedUpdate.
 *
 * Triage is read only on a guest row, exactly as before the merge: the
 * cleaner, contractor and owner cards never read it, so a triage block on
 * one of those rows still goes through the one-at-a-time review.
 *
 * Pure, so the test runner can hold the split.
 */

export type FactAudience = FactSource;

export type AudienceUpdate = ProposedPropertyUpdate & { audience: FactAudience };

/** The word a row carries for whose words it came from. */
export const AUDIENCE_LABEL: Record<FactAudience, string> = {
  guest: 'Your reply',
  cleaner: 'Cleaner',
  contractor: 'Contractor',
  owner: 'Owner',
};

/** The filter chip's plural. */
export const AUDIENCE_PLURAL: Record<FactAudience, string> = {
  guest: 'Your replies',
  cleaner: 'Cleaners',
  contractor: 'Contractors',
  owner: 'Owners',
};

/** One triaged statement, with every candidate merged into it. */
export type FactGroup = {
  groupId: string;
  propertyId: string;
  propertyName: string;
  candidateIds: string[];
  statement: string;
  section: string;
  evidence: string;
  quotes: string[];
  reason: string;
  verdict: string;
  confidence: string;
  needsRuling: boolean;
  category: string;
  /** How many mined messages this was written from. */
  mined: number;
  audience: 'guest';
};

/** One home: its triaged statements and its one-at-a-time candidates. */
export type FactBlock = {
  propertyId: string;
  propertyName: string;
  groups: FactGroup[];
  candidates: AudienceUpdate[];
};

const UNASSIGNED = '(unassigned)';

function needsRuling(t: NonNullable<ProposedPropertyUpdate['triage']>): boolean {
  return t.needs_ruling || t.verdict === 'conflict' || t.confidence !== 'high';
}

/** True when this row files through the triaged path. */
export function isTriaged(u: AudienceUpdate): boolean {
  return u.audience === 'guest' && !!u.triage && !!u.triage.statement;
}

export function buildFactBlocks(rows: AudienceUpdate[]): FactBlock[] {
  const groups = new Map<string, FactGroup>();
  const blocks = new Map<string, FactBlock>();
  const blockFor = (propertyId: string, propertyName: string): FactBlock => {
    const key = propertyId || UNASSIGNED;
    let b = blocks.get(key);
    if (!b) {
      b = { propertyId: key, propertyName: propertyName || key, groups: [], candidates: [] };
      blocks.set(key, b);
    }
    return b;
  };

  for (const u of rows) {
    if (!isTriaged(u)) {
      blockFor(u.property_id, u.property_name).candidates.push(u);
      continue;
    }
    const t = u.triage!;
    const existing = groups.get(t.group_id);
    if (existing) {
      if (!existing.candidateIds.includes(u.id)) existing.candidateIds.push(u.id);
      existing.mined = existing.candidateIds.length;
      existing.needsRuling ||= needsRuling(t);
      if (u.raw_quote && !existing.quotes.includes(u.raw_quote)) existing.quotes.push(u.raw_quote);
      continue;
    }
    const propertyId = t.property_id || u.property_id;
    const g: FactGroup = {
      groupId: t.group_id,
      propertyId,
      propertyName: u.property_name || t.property_id || u.property_id,
      candidateIds: [u.id],
      statement: t.statement,
      section: t.kb_section,
      evidence: t.evidence,
      quotes: u.raw_quote ? [u.raw_quote] : [],
      reason: t.reason,
      verdict: t.verdict,
      confidence: t.confidence,
      needsRuling: needsRuling(t),
      category: u.category,
      mined: 1,
      audience: 'guest',
    };
    groups.set(t.group_id, g);
    blockFor(propertyId, g.propertyName).groups.push(g);
  }

  // Homes with a ruling waiting come first; then the biggest piles.
  return [...blocks.values()].sort((a, b) => {
    const ra = a.groups.filter((g) => g.needsRuling).length;
    const rb = b.groups.filter((g) => g.needsRuling).length;
    if (ra !== rb) return rb - ra;
    return b.groups.length + b.candidates.length - (a.groups.length + a.candidates.length);
  });
}

/** The audiences present, in the house order, with how many rows each. */
export function audienceCounts(rows: AudienceUpdate[]): { audience: FactAudience; count: number }[] {
  const order: FactAudience[] = ['guest', 'cleaner', 'contractor', 'owner'];
  return order
    .map((audience) => ({ audience, count: rows.filter((r) => r.audience === audience).length }))
    .filter((a) => a.count > 0);
}

/** The concierge's list call for an audience: no-audience is the owner bucket. */
export function listAudienceArg(audience: FactAudience): 'cleaner' | 'contractor' | 'guest' | undefined {
  return audience === 'owner' ? undefined : audience;
}
