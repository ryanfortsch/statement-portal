/**
 * Which parser should read what the operator just said.
 *
 * The property page used to carry two capture boxes one tab apart, sharing
 * the same keep-alive and the same apply action, so the operator had to pick
 * a parser before knowing what they were about to say. There is one box now:
 * they say the thing, and this decides.
 *
 * Deliberately crude, and deliberately biased toward the quick path. A long
 * walk misread as a single note is recoverable in one click; a one-line fact
 * sent to the room-by-room parser comes back as rooms nobody asked for. So
 * this demands both length and real evidence of moving between rooms, and
 * the UI offers the override either way.
 */
/**
 * Room NOUNS only. "primary", "master", "upstairs" and the like are
 * modifiers, not rooms: counting them made the single phrase "primary
 * bedroom" look like two distinct rooms, which routed a long note about one
 * bedroom into the room-by-room parser.
 */
const ROOM_NOUNS =
  /\b(bedroom|bathroom|kitchen|living room|dining room|dining|basement|attic|garage|hallway|closet|porch|deck|patio|laundry|den|office|nursery)\b/gi;

/** An explicit move between rooms: "now the kitchen", "we're in the den". */
const ROOM_MOVE = /\bnow (the|in the|we're in|i'm in)\b/i;

/** Below this, it is a note however many rooms it names. */
const WALK_MIN_CHARS = 160;

export function looksLikeWalkthrough(text: string): boolean {
  const t = (text ?? '').trim();
  if (t.length < WALK_MIN_CHARS) return false;
  // A fresh regex per call: ROOM_NOUNS is /g, and a shared /g regex carries
  // lastIndex between calls, so .test() on it would alternate true/false.
  const hits = new Set(
    (t.match(new RegExp(ROOM_NOUNS.source, 'gi')) ?? []).map((w) => w.toLowerCase()),
  );
  if (hits.size === 0) return false;
  // Two DISTINCT rooms, or one room plus an explicit move. Naming one room
  // four times in a paragraph is a note about that room.
  return hits.size >= 2 || ROOM_MOVE.test(t);
}
