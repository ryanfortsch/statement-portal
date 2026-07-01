/**
 * Pure conversation-shaping logic for the owner-messaging views. No React.
 *
 * The owner history arrives as a flat chronological list of events. A chatty
 * owner produces a wall of them. This module reshapes that flat list into the
 * transcript the UI renders:
 *
 *   1. attach reactions  - iMessage tapbacks ("Liked "..."") are pulled out of
 *      the stream and hung as a glyph on the message they reacted to, never
 *      rendered as their own wall-of-text bubble.
 *   2. group into sessions - split by conversation gaps (time / day / topic /
 *      escalation) so a morning burst about the washer and an evening burst
 *      about the spigots read as two dated chapters.
 *   3. cluster into runs - consecutive same-side messages collapse into one
 *      keylined block under a single timestamp.
 *
 * The pending queue reuses splitOwnerText + the same run vocabulary so a
 * stacked multi-message draft renders identically to the history.
 */
import type { OwnerHistoryEvent } from '@/lib/stay-concierge';

export const SESSION_GAP_MIN = 360; // 6h: same sitting vs came-back-later
export const TOPIC_SPLIT_MIN = 45; // topic can only re-split after a quiet gap
export const RUN_GAP_MIN = 20; // same-side follow-up past this starts a new run
export const REACTION_BACK_WINDOW = 8; // events scanned backward for a tapback target
export const TAPBACK_MIN_QUOTE = 8; // reject `Liked "it"` false positives
export const TAPBACK_MATCH_PREFIX = 24; // chars of the quote used to locate the target
export const SESSIONS_OPEN_DEFAULT = 2;

export type Side = 'owner' | 'ours';

export type Reaction = { glyph: string; verb: string; at: string; quoted: string };
export type OrphanReaction = Reaction & { side: Side };

export type Run = {
  side: Side;
  kind: OwnerHistoryEvent['kind'];
  events: OwnerHistoryEvent[];
  reactions: Reaction[];
  startAt: string;
  endAt: string;
  channel: string;
};

export type SessionBlock =
  | { kind: 'run'; at: string; run: Run }
  | { kind: 'orphan'; at: string; reaction: OrphanReaction };

export type Session = {
  id: string;
  startAt: string;
  endAt: string;
  topic?: string;
  inbound: number;
  sent: number;
  channel: string;
  messageCount: number;
  blocks: SessionBlock[];
};

// Anchored: only fires when the WHOLE body is a tapback (so `Loved "Gatsby"`
// mid-sentence never matches). `s` flag: tapbacks quote the entire original,
// which is often multi-line. Accepts straight + curly quotes (Apple vs RCS).
const TAPBACK_RE =
  /^(?:(Liked|Loved|Laughed at|Emphasized|Questioned|Disliked)|Reacted\s+(\S+)\s+to)\s+["“”](.+?)["”“]\s*$/su;

const GLYPH: Record<string, string> = {
  Liked: '\u{1F44D}',
  Loved: '❤️',
  'Laughed at': '\u{1F602}',
  Emphasized: '‼️',
  Questioned: '❓',
  Disliked: '\u{1F44E}',
};

/** Detect an iMessage tapback. Returns the glyph + quoted target, or null. */
export function parseTapback(text: string): Omit<Reaction, 'at'> | null {
  const m = TAPBACK_RE.exec((text || '').trim());
  if (!m) return null;
  const quoted = m[3] ?? '';
  if (quoted.trim().length < TAPBACK_MIN_QUOTE) return null; // reject `Liked "it"`
  const verb = m[1] ?? 'Reacted';
  const glyph = m[1] ? GLYPH[m[1]] : m[2] || '•';
  return { glyph, verb, quoted };
}

function sideOf(kind: OwnerHistoryEvent['kind']): Side {
  return kind === 'inbound' ? 'owner' : 'ours';
}

function gapMin(a: string, b: string): number {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Infinity;
  return Math.abs(tb - ta) / 60_000;
}

const DAY_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
function localDay(iso: string): string {
  try {
    return DAY_FMT.format(new Date(iso));
  } catch {
    return (iso || '').slice(0, 10);
  }
}

function norm(s: string): string {
  return (s || '')
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

type Ev = { ev: OwnerHistoryEvent; reactions: Reaction[] };

function clusterRuns(evs: Ev[]): Run[] {
  const runs: Run[] = [];
  for (const e of evs) {
    const side = sideOf(e.ev.kind);
    const last = runs[runs.length - 1];
    const sameRun =
      last &&
      last.side === side &&
      last.kind === e.ev.kind &&
      e.ev.kind !== 'escalated' &&
      gapMin(last.endAt, e.ev.at) < RUN_GAP_MIN;
    if (sameRun) {
      last.events.push(e.ev);
      last.reactions.push(...e.reactions);
      last.endAt = e.ev.at;
    } else {
      runs.push({
        side,
        kind: e.ev.kind,
        events: [e.ev],
        reactions: [...e.reactions],
        startAt: e.ev.at,
        endAt: e.ev.at,
        channel: e.ev.channel,
      });
    }
  }
  return runs;
}

function finalizeSession(evs: Ev[]): Session {
  const runs = clusterRuns(evs);
  let inbound = 0;
  let sent = 0;
  const chCount: Record<string, number> = {};
  for (const e of evs) {
    if (e.ev.kind === 'inbound') inbound += 1;
    if (e.ev.kind === 'sent' || e.ev.kind === 'sent_outside') sent += 1;
    const ch = e.ev.channel || '';
    chCount[ch] = (chCount[ch] || 0) + 1;
  }
  const topic = evs.find((e) => e.ev.kind === 'inbound' && e.ev.topic)?.ev.topic;
  const channel = Object.entries(chCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const startAt = evs[0].ev.at;
  const endAt = evs[evs.length - 1].ev.at;
  const blocks: SessionBlock[] = runs.map((r) => ({ kind: 'run' as const, at: r.startAt, run: r }));
  return {
    id: startAt,
    startAt,
    endAt,
    topic,
    inbound,
    sent,
    channel,
    messageCount: evs.length,
    blocks,
  };
}

/**
 * Turn a flat chronological event list into dated sessions of clustered runs,
 * with reactions attached to their targets. Returned oldest-first; the UI
 * reverses for newest-first display.
 */
export function buildSessions(messages: OwnerHistoryEvent[]): Session[] {
  // 1. Split reactions out, attaching each to the message it reacted to.
  const reals: Ev[] = [];
  const orphans: OrphanReaction[] = [];
  for (const m of messages) {
    const tb = m.kind === 'inbound' ? parseTapback(m.text || '') : null;
    if (tb) {
      const prefix = norm(tb.quoted).slice(0, TAPBACK_MATCH_PREFIX);
      let target: Ev | null = null;
      for (let j = reals.length - 1; j >= 0 && reals.length - j <= REACTION_BACK_WINDOW; j -= 1) {
        if (prefix && norm(reals[j].ev.text || '').startsWith(prefix)) {
          target = reals[j];
          break;
        }
      }
      const reaction: Reaction = { ...tb, at: m.at };
      if (target) target.reactions.push(reaction);
      else orphans.push({ ...reaction, side: 'ours' }); // owners tapback our replies
      continue;
    }
    reals.push({ ev: m, reactions: [] });
  }

  // 2. Group the reaction-stripped stream into sessions.
  const sessions: Session[] = [];
  let cur: { evs: Ev[]; topic?: string } | null = null;
  const flush = () => {
    if (cur && cur.evs.length > 0) sessions.push(finalizeSession(cur.evs));
    cur = null;
  };
  for (const e of reals) {
    if (!cur) {
      cur = { evs: [e], topic: e.ev.kind === 'inbound' ? e.ev.topic : undefined };
      continue;
    }
    const prev = cur.evs[cur.evs.length - 1];
    const g = gapMin(prev.ev.at, e.ev.at);
    const timeBreak = g >= SESSION_GAP_MIN;
    const dayBreak = localDay(prev.ev.at) !== localDay(e.ev.at);
    const escalationBreak = e.ev.kind === 'escalated' || prev.ev.kind === 'escalated';
    const topicBreak =
      e.ev.kind === 'inbound' &&
      !!e.ev.topic &&
      !!cur.topic &&
      e.ev.topic !== cur.topic &&
      g >= TOPIC_SPLIT_MIN;
    if (timeBreak || dayBreak || escalationBreak || topicBreak) {
      flush();
      cur = { evs: [e], topic: e.ev.kind === 'inbound' ? e.ev.topic : undefined };
    } else {
      cur.evs.push(e);
      if (!cur.topic && e.ev.kind === 'inbound' && e.ev.topic) cur.topic = e.ev.topic;
    }
  }
  flush();

  // 3. Place orphan reactions (target older than the window) into the session
  //    that contains their timestamp, else the nearest one.
  for (const orphan of orphans) {
    let target = sessions.find((s) => orphan.at >= s.startAt && orphan.at <= s.endAt);
    if (!target && sessions.length > 0) {
      target = sessions.reduce((best, s) => {
        const ds = Math.abs(new Date(s.startAt).getTime() - new Date(orphan.at).getTime());
        const db = Math.abs(new Date(best.startAt).getTime() - new Date(orphan.at).getTime());
        return ds < db ? s : best;
      }, sessions[0]);
    }
    if (target) {
      target.blocks.push({ kind: 'orphan', at: orphan.at, reaction: orphan });
      target.blocks.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    } else {
      // All messages were reactions with no targets: a lone orphan session.
      sessions.push({
        id: orphan.at,
        startAt: orphan.at,
        endAt: orphan.at,
        inbound: 0,
        sent: 0,
        channel: '',
        messageCount: 0,
        blocks: [{ kind: 'orphan', at: orphan.at, reaction: orphan }],
      });
    }
  }

  return sessions;
}

/**
 * The pending-queue owner_text is a blob joined by "[Then they followed up:]".
 * Split it back into the individual messages so the queue can render the burst
 * as one keylined run instead of a wall.
 */
export function splitOwnerText(raw: string): string[] {
  return (raw || '')
    .split(/\n*\[\s*Then they followed up:\s*\]\n*/gi)
    .map((s) => s.trim())
    .filter(Boolean);
}
