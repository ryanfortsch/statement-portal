/**
 * AI walkthrough capture for property onboarding.
 *
 * The operator walks the house dictating everything they see, room by room
 * ("okay primary bedroom, king bed, TV on the dresser is a Roku, the left
 * nightstand lamp flickers... now the main bath, tub shower combo, water
 * takes a minute to run hot..."). Claude splits the transcript into rooms
 * and routes every fragment to one of four destinations:
 *
 *   1. a ROOM record (property_rooms) — beds, TV, amenities, quirks per space
 *   2. a structured COLUMN on public.properties (same catalog as quick capture)
 *   3. a guest-facing property NOTE (the guest-messaging knowledge base)
 *   4. an internal-ops property NOTE
 *
 * Nothing writes automatically: the parse returns a reviewable proposal
 * (grouped by room), the operator edits + approves, the apply step writes.
 * Same trust model as quick capture, including the high-stakes entry-field
 * rules — a walkthrough mentions door codes constantly.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import {
  CAPTURE_COLUMNS,
  CAPTURE_COLUMN_KEYS,
} from '@/lib/property-capture-catalog';
import { ROOM_TYPES, type RoomType } from '@/lib/property-rooms-shared';

export type WalkthroughRoomItem = {
  /** Which room this belongs to, matching a `rooms[].name` in the proposal. */
  roomName: string;
  kind: 'bed' | 'tv' | 'amenity' | 'quirk' | 'note';
  /** e.g. "king" for a bed, "55in Roku" for a tv, the sentence for a quirk. */
  value: string;
  /** True when a guest would benefit from knowing this (feeds guest_summary). */
  guestFacing: boolean;
  sourceText: string;
  confidence: 'high' | 'medium' | 'low';
};

export type WalkthroughColumnItem = {
  column: string;
  value: string;
  sourceText: string;
  confidence: 'high' | 'medium' | 'low';
};

export type WalkthroughNoteItem = {
  noteTitle: string;
  noteBody: string;
  noteTag: string | null;
  guestFacing: boolean;
  sourceText: string;
  confidence: 'high' | 'medium' | 'low';
};

export type WalkthroughRoom = {
  name: string;
  roomType: RoomType;
};

export type WalkthroughProposal = {
  rooms: WalkthroughRoom[];
  roomItems: WalkthroughRoomItem[];
  columnItems: WalkthroughColumnItem[];
  noteItems: WalkthroughNoteItem[];
  unrouted: string | null;
};

const ROOM_TYPE_IDS = ROOM_TYPES.map((r) => r.id) as [RoomType, ...RoomType[]];

const RoomSchema = z.object({
  name: z.string().describe('short display name, e.g. "Primary bedroom", "Main bath", "Kitchen", "Back deck"'),
  roomType: z.enum(ROOM_TYPE_IDS),
});

const RoomItemSchema = z.object({
  roomName: z.string().describe('must exactly match one rooms[].name'),
  kind: z.enum(['bed', 'tv', 'amenity', 'quirk', 'note']),
  value: z.string().describe('bed: the size (king/queen/full/twin/bunk, with count if >1 like "2x twin"); tv: short description; amenity: short name; quirk/note: one clean sentence'),
  guestFacing: z.boolean().describe('true if a guest would be told this (how to use the room, a quirk that affects their stay)'),
  sourceText: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
});

const ColumnItemSchema = z.object({
  column: z.string().describe('EXACT column key from the catalog, verbatim'),
  value: z.string().describe('just the cleaned value'),
  sourceText: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
});

const NoteItemSchema = z.object({
  noteTitle: z.string().describe('<= 80 chars'),
  noteBody: z.string().describe('1-3 sentences'),
  noteTag: z.string().nullable().describe('one-word lowercase tag or null'),
  guestFacing: z.boolean(),
  sourceText: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
});

const WalkthroughSchema = z.object({
  rooms: z.array(RoomSchema).describe('every distinct physical space the walkthrough visits, in the order visited'),
  roomItems: z.array(RoomItemSchema),
  columnItems: z.array(ColumnItemSchema),
  noteItems: z.array(NoteItemSchema).describe('whole-property facts that are not room-specific and not catalog columns'),
  unrouted: z.string().nullable(),
});

function buildSystemPrompt(existingRooms: WalkthroughRoom[]): string {
  const catalog = CAPTURE_COLUMNS
    .map((c) => `- ${c.key} (${c.section} · ${c.label}, ${c.type})${c.highStakes ? ' [HIGH-STAKES ENTRY FIELD]' : ''}: ${c.hints}`)
    .join('\n');
  const highStakesKeys = CAPTURE_COLUMNS.filter((c) => c.highStakes).map((c) => c.key).join(', ');
  const existing = existingRooms.length
    ? existingRooms.map((r) => `- ${r.name} (${r.roomType})`).join('\n')
    : '(none yet)';
  return [
    'You process a property manager\'s WALKTHROUGH dictation of ONE vacation rental. They walk the house speaking continuously, so expect speech-to-text artifacts, run-ons, filler, and mid-sentence room changes.',
    '',
    'FIRST, segment the transcript into the physical spaces visited. Phrases like "okay, moving to...", "now the...", "in the primary bedroom", "out on the deck" mark room changes. Everything after a room marker belongs to that room until the next marker. Facts spoken before any room marker are whole-property facts.',
    '',
    'Rooms already on file for this property (REUSE these exact names when the dictation clearly means the same space; only create a new room for a space not listed):',
    existing,
    '',
    'Route every discrete fact to exactly ONE destination:',
    '',
    '1. A ROOM ITEM, when the fact describes that specific space:',
    '   - kind=bed: each bed with its size ("king", "2x twin", "queen sleeper sofa").',
    '   - kind=tv: a TV and how it works ("55in Roku, guest logs into own apps").',
    '   - kind=amenity: a notable feature ("ceiling fan", "blackout shades", "gas fireplace", "outdoor shower").',
    '   - kind=quirk: something that behaves unexpectedly ("window sticks, lift while sliding", "shower takes a minute to run hot"). Quirks are gold: capture every single one.',
    '   - kind=note: room detail that is none of the above.',
    '2. A structured COLUMN, when the fact is a whole-property attribute matching a catalog key below (wifi, providers, trash day, shutoffs, parking...). Value only, no label.',
    '3. A property NOTE (noteItems), when it is a whole-property fact with no catalog column: vendor mentions, neighbor context, owner preferences, seasonal instructions.',
    '',
    'guestFacing: true when a guest would be told it (how to use the home, quirks affecting a stay, local tips); false for internal ops (vendors, owner preferences, maintenance history).',
    '',
    'Rules:',
    '- One fact = one item. Split aggressively.',
    '- Keep values terse and clean; fix obvious dictation typos.',
    '- No em dashes anywhere.',
    '- Too vague to route: leave it in `unrouted` verbatim.',
    '',
    `HIGH-STAKES ENTRY FIELDS (${highStakesKeys}): route ONLY the plainly primary, current way into the home. Spare/backup/emergency access mentions go to an INTERNAL note, never a column. Unsure: internal note, confidence low.`,
    '',
    'CATALOG OF COLUMN KEYS:',
    catalog,
  ].join('\n');
}

function stripEmDashes(s: string): string {
  return s.replace(/\s*—\s*/g, '. ').replace(/\.\s+\./g, '.');
}

/** Parse a walkthrough dictation into a reviewable, room-grouped proposal.
 *  Hallucinated column keys demote to internal notes; room items pointing
 *  at a room the model never declared get the room added implicitly. */
export async function parsePropertyWalkthrough(args: {
  rawText: string;
  propertyName: string;
  existingRooms: WalkthroughRoom[];
}): Promise<WalkthroughProposal> {
  const { object } = await generateObject({
    model: 'anthropic/claude-sonnet-4.5',
    schema: WalkthroughSchema,
    system: buildSystemPrompt(args.existingRooms),
    prompt: `Property: ${args.propertyName}\n\nWalkthrough dictation:\n${args.rawText}`,
  });

  const rooms: WalkthroughRoom[] = object.rooms.map((r) => ({
    name: stripEmDashes(r.name.trim()).slice(0, 60),
    roomType: r.roomType,
  }));
  const roomNames = new Set(rooms.map((r) => r.name));

  const roomItems: WalkthroughRoomItem[] = [];
  for (const raw of object.roomItems) {
    const roomName = stripEmDashes(raw.roomName.trim()).slice(0, 60);
    // A room item whose room the model forgot to declare still lands: add
    // the room as 'other' rather than dropping dictated content.
    if (!roomNames.has(roomName)) {
      rooms.push({ name: roomName, roomType: 'other' });
      roomNames.add(roomName);
    }
    roomItems.push({
      roomName,
      kind: raw.kind,
      value: stripEmDashes(raw.value.trim()),
      guestFacing: raw.guestFacing,
      sourceText: raw.sourceText,
      confidence: raw.confidence,
    });
  }

  const columnItems: WalkthroughColumnItem[] = [];
  const noteItems: WalkthroughNoteItem[] = object.noteItems.map((raw) => ({
    noteTitle: stripEmDashes(raw.noteTitle.trim()).slice(0, 80),
    noteBody: stripEmDashes(raw.noteBody.trim()),
    noteTag: raw.noteTag ? raw.noteTag.trim().toLowerCase() : null,
    guestFacing: raw.guestFacing,
    sourceText: raw.sourceText,
    confidence: raw.confidence,
  }));
  for (const raw of object.columnItems) {
    if (!raw.column || !CAPTURE_COLUMN_KEYS.has(raw.column)) {
      // Unknown key: demote to an internal note, never a blind column write.
      noteItems.push({
        noteTitle: stripEmDashes((raw.value || raw.sourceText || 'Walkthrough note').slice(0, 80)),
        noteBody: stripEmDashes(raw.value || raw.sourceText || ''),
        noteTag: null,
        guestFacing: false,
        sourceText: raw.sourceText,
        confidence: 'low',
      });
      continue;
    }
    columnItems.push({
      column: raw.column,
      value: stripEmDashes(raw.value.trim()),
      sourceText: raw.sourceText,
      confidence: raw.confidence,
    });
  }

  return {
    rooms,
    roomItems,
    columnItems,
    noteItems,
    unrouted: object.unrouted ? object.unrouted.trim() : null,
  };
}
