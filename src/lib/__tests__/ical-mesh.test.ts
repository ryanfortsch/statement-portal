/**
 * The whole iCal mesh, simulated: three OTAs importing Helm's export, Helm
 * importing theirs, round after round, with the real export gate
 * (exportableBooking) and the real cancel policy (planCancelPass).
 *
 * Two properties are asserted, over hand-written scenarios and a few hundred
 * seeded random ones:
 *
 *   safety       a night a real guest holds on one channel (or Helm holds)
 *                is closed on every other OTA once the mesh has had a round
 *                to carry it: nobody can sell it twice.
 *   convergence  once every real cause is gone (guests cancelled, blocks
 *                lifted), every calendar reopens within a bounded number of
 *                rounds: no closure keeps itself alive by travelling around
 *                the mesh.
 *
 * The model is deliberately the WORST case for loops. Each OTA publishes one
 * event per closed night whose UID depends only on the channel and the night,
 * so when a reservation cancels while the OTA still shows the night closed
 * because Helm's import said so, the event carries the same UID and Helm
 * cannot see the change. Booking.com publishes every closed night as a
 * closure (its reservations included); Airbnb and VRBO publish reservations
 * as stays and every other closed night as a closure.
 *
 * The last test runs the same mesh with every OTA closure forwarded (the
 * rule before this one) and shows it deadlock, so the simulation has teeth.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { exportableBooking, type ExportCandidate } from '../ical-export.ts';
import { planCancelPass } from '../ical-cancel-policy.ts';

type Ota = 'airbnb' | 'vrbo' | 'booking_com';
const OTAS: readonly Ota[] = ['airbnb', 'vrbo', 'booking_com'];
const NIGHTS = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'];
const next = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

type HelmRow = ExportCandidate & { id: string; uid: string | null; missing_since: string | null; raw_summary: string | null };

type OtaState = {
  /** Real guests on this OTA's own calendar. */
  reserved: Set<string>;
  /** Nights the host closed in this OTA's own app (owner blocks, leftovers). */
  blocked: Set<string>;
  /** Nights closed because the OTA imported Helm's feed on its last pull. */
  imported: Set<string>;
};

type Forward = (row: HelmRow, audience: Ota) => boolean;

/** The rule under test. */
const realGate: Forward = (row, audience) => exportableBooking(row, { channel: audience, listingId: null });

/** The rule before this one: every live OTA closure goes to every other OTA. */
const forwardEverything: Forward = (row, audience) =>
  row.hold_kind === 'ota' && row.status === 'block' ? row.channel !== audience : exportableBooking(row, { channel: audience, listingId: null });

class Mesh {
  ota: Record<Ota, OtaState> = {
    airbnb: { reserved: new Set(), blocked: new Set(), imported: new Set() },
    vrbo: { reserved: new Set(), blocked: new Set(), imported: new Set() },
    booking_com: { reserved: new Set(), blocked: new Set(), imported: new Set() },
  };
  /** Helm-native rows by id: stays (channel direct) and blocks. */
  native = new Map<string, HelmRow>();
  /** Helm's imported rows, keyed by channel + uid. */
  rows = new Map<string, HelmRow>();
  clock = Date.parse('2026-09-26T00:00:00Z');
  forward: Forward;
  constructor(forward: Forward = realGate) {
    this.forward = forward;
  }

  closed(o: Ota): Set<string> {
    const s = this.ota[o];
    return new Set([...s.reserved, ...s.blocked, ...s.imported]);
  }

  /** What OTA `o` publishes in its own iCal export. */
  published(o: Ota): Array<{ uid: string; night: string; kind: 'stay' | 'block' }> {
    const s = this.ota[o];
    const out: Array<{ uid: string; night: string; kind: 'stay' | 'block' }> = [];
    for (const n of this.closed(o)) {
      const isStay = o !== 'booking_com' && s.reserved.has(n);
      out.push({ uid: `${o}:${isStay ? 'res' : 'closed'}:${n}`, night: n, kind: isStay ? 'stay' : 'block' });
    }
    return out;
  }

  /** Helm reads OTA `o`'s feed (ical-sync), with the real cancel policy. */
  sync(o: Ota) {
    const now = new Date(this.clock);
    const events = this.published(o);
    const incoming = new Set(events.map((e) => e.uid));
    for (const e of events) {
      const key = `${o}|${e.uid}`;
      const prior = this.rows.get(key);
      const row: HelmRow = {
        id: prior?.id ?? key,
        uid: e.uid,
        status: e.kind === 'stay' ? 'confirmed' : 'block',
        hold_kind: e.kind === 'stay' ? null : 'ota',
        channel: o,
        channel_listing_id: `L-${o}`,
        duplicate_of: null,
        check_in: e.night,
        check_out: next(e.night),
        missing_since: null,
        raw_summary: e.kind === 'stay' ? 'Reserved' : 'CLOSED - Not available',
      };
      this.rows.set(key, row);
    }
    const existing = [...this.rows.values()].filter((r) => r.channel === o);
    const plan = planCancelPass({
      existing: existing.map((r) => ({ id: r.id, status: r.status, check_in: r.check_in!, check_out: r.check_out!, missing_since: r.missing_since, raw_summary: r.raw_summary })),
      incomingUids: incoming,
      uidOf: (c) => this.rows.get(c.id)?.uid ?? null,
      now,
      todayIso: '2026-09-26',
      isBlockSummary: (raw) => raw === 'CLOSED - Not available',
      holdsAreReservations: o === 'booking_com',
      // The guard is not what is under test; in a real mesh a lifted block
      // is one event, well under its threshold.
      allowMassCancel: true,
    });
    for (const id of plan.stampMissing) this.rows.get(id)!.missing_since = now.toISOString();
    for (const id of plan.cancelNow) this.rows.get(id)!.status = 'cancelled';
  }

  /** OTA `o` pulls its own line of Helm's export. */
  pull(o: Ota) {
    const imported = new Set<string>();
    for (const r of [...this.native.values(), ...this.rows.values()]) {
      if (!this.forward(r, o)) continue;
      for (let n = r.check_in!; n < r.check_out!; n = next(n)) imported.add(n);
    }
    this.ota[o].imported = imported;
  }

  /** One beat: Helm reads every OTA, then every OTA pulls. 31 minutes pass. */
  round(order: readonly Ota[] = OTAS) {
    for (const o of order) this.sync(o);
    for (const o of order) this.pull(o);
    this.clock += 31 * 60_000;
  }

  helmBlock(id: string, night: string) {
    this.native.set(id, { id, uid: null, status: 'block', hold_kind: 'owner', channel: 'block', channel_listing_id: null, duplicate_of: null, check_in: night, check_out: next(night), missing_since: null, raw_summary: null });
  }
  helmStay(id: string, night: string) {
    this.native.set(id, { id, uid: null, status: 'confirmed', hold_kind: null, channel: 'direct', channel_listing_id: null, duplicate_of: null, check_in: night, check_out: next(night), missing_since: null, raw_summary: null });
  }
  lift(id: string) {
    this.native.get(id)!.status = 'cancelled';
  }

  /** Every night some real guest or some block holds, and who holds it. */
  realHolds(): Array<{ night: string; holder: Ota | 'helm' }> {
    const out: Array<{ night: string; holder: Ota | 'helm' }> = [];
    for (const o of OTAS) for (const n of this.ota[o].reserved) out.push({ night: n, holder: o });
    for (const r of this.native.values()) if (r.status !== 'cancelled') out.push({ night: r.check_in!, holder: 'helm' });
    return out;
  }

  allOpen(): boolean {
    return OTAS.every((o) => this.closed(o).size === 0);
  }
}

/** Safety: every real hold is closed on every OTA other than its own. */
function assertNoDoubleSell(m: Mesh, label: string) {
  for (const { night, holder } of m.realHolds()) {
    for (const o of OTAS) {
      if (o === holder) continue;
      assert.ok(m.closed(o).has(night), `${label}: ${holder}'s ${night} is open on ${o}`);
    }
  }
}

function settle(m: Mesh, rounds = 8) {
  for (let i = 0; i < rounds; i++) m.round();
}

describe('the mesh under the real rule', () => {
  test('a Booking.com reservation closes Airbnb and VRBO; cancelled, everything reopens', () => {
    const m = new Mesh();
    m.ota.booking_com.reserved.add(NIGHTS[0]);
    m.round();
    assertNoDoubleSell(m, 'after one round');
    settle(m);
    assertNoDoubleSell(m, 'settled');
    m.ota.booking_com.reserved.delete(NIGHTS[0]);
    settle(m);
    assert.ok(m.allOpen(), 'a cancelled Booking.com reservation must not keep its nights shut');
  });

  test('a VRBO stay closes Airbnb and Booking.com; Booking.com re-publishing it cannot keep it alive', () => {
    const m = new Mesh();
    m.ota.vrbo.reserved.add(NIGHTS[1]);
    settle(m);
    assertNoDoubleSell(m, 'settled');
    // Booking.com's closure of the VRBO stay is forwarded to Airbnb (it may
    // be a guest, nobody can tell): the one hop the rule allows.
    m.ota.vrbo.reserved.delete(NIGHTS[1]);
    settle(m);
    assert.ok(m.allOpen());
  });

  test('a Helm block closes every OTA; lifted, every OTA reopens', () => {
    const m = new Mesh();
    m.helmBlock('H', NIGHTS[2]);
    settle(m);
    assertNoDoubleSell(m, 'settled');
    m.lift('H');
    settle(m);
    assert.ok(m.allOpen());
  });

  test('an owner block set in the Airbnb app stays on Airbnb, and lifts cleanly', () => {
    const m = new Mesh();
    m.ota.airbnb.blocked.add(NIGHTS[3]);
    settle(m);
    assert.equal(m.closed('vrbo').has(NIGHTS[3]), false, 'not forwarded: owner blocks belong in Helm');
    assert.equal(m.closed('booking_com').has(NIGHTS[3]), false);
    m.ota.airbnb.blocked.delete(NIGHTS[3]);
    settle(m);
    assert.ok(m.allOpen());
  });

  test('a leftover closure in the Booking.com extranet is forwarded until someone opens it, then everything reopens', () => {
    const m = new Mesh();
    m.ota.booking_com.blocked.add(NIGHTS[0]);
    settle(m);
    assert.ok(m.closed('airbnb').has(NIGHTS[0]), 'a Booking.com closure may be a guest');
    m.ota.booking_com.blocked.delete(NIGHTS[0]);
    settle(m);
    assert.ok(m.allOpen());
  });

  test('seeded random histories: never double-sold, always converges', () => {
    let seed = 20260926;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    for (let trial = 0; trial < 300; trial++) {
      const m = new Mesh();
      let helmIds = 0;
      // A real guest is never double-booked in the model: an OTA only takes
      // a reservation on a night its own calendar shows open.
      for (let step = 0; step < 14; step++) {
        const night = pick(NIGHTS);
        const o = pick(OTAS);
        const action = rand();
        if (action < 0.3) {
          if (!m.closed(o).has(night)) m.ota[o].reserved.add(night);
        } else if (action < 0.45) {
          m.ota[o].reserved.delete(night);
        } else if (action < 0.55) {
          m.ota[o].blocked.add(night);
        } else if (action < 0.65) {
          m.ota[o].blocked.delete(night);
        } else if (action < 0.75) {
          m.helmBlock(`H${helmIds++}`, night);
        } else if (action < 0.85) {
          const live = [...m.native.values()].filter((r) => r.status !== 'cancelled');
          if (live.length > 0) m.lift(pick(live).id);
        }
        const order = rand() < 0.5 ? OTAS : [...OTAS].reverse();
        m.round(order);
      }
      settle(m, 3);
      assertNoDoubleSell(m, `trial ${trial} settled`);
      for (const o of OTAS) {
        m.ota[o].reserved.clear();
        m.ota[o].blocked.clear();
      }
      for (const r of m.native.values()) r.status = 'cancelled';
      settle(m, 10);
      assert.ok(m.allOpen(), `trial ${trial}: nights stayed shut with every cause gone`);
    }
  });
});

describe('the simulation has teeth', () => {
  test('forwarding every OTA closure (the old rule) deadlocks: a lifted block stays shut forever', () => {
    const m = new Mesh(forwardEverything);
    m.ota.airbnb.blocked.add(NIGHTS[0]);
    settle(m);
    m.ota.airbnb.blocked.delete(NIGHTS[0]);
    settle(m, 20);
    assert.equal(m.allOpen(), false, 'the old rule should loop; if it converges, the model lost its worst case');
  });
});
