#!/usr/bin/env python3
"""
Receipts parity harness -- READ-ONLY proof that the property_receipts fold
leaves every existing owner statement untouched.

What it proves
  1. AUDIT (default): with zero active receipts, the new fold contributes
     exactly $0.00 to every statement's repairs_total, so every stored
     owner_payout is unchanged under the new formula. Any active receipts
     that DO exist are printed with the exact statements they WOULD change
     (and by how much) once the next ingest / recompute folds them in.
     The one hard failure: a statement whose receipt mirror rows
     (repair_events.source='receipt') disagree with the active receipts for
     its (property, month) -- that would be a double-count or a stale fold.
  2. SNAPSHOT / DIFF: byte-identical money columns across a deploy.
       pre-merge:   python3 scripts/receipts_parity.py --mode snapshot --out before.json
       post-deploy: python3 scripts/receipts_parity.py --mode snapshot --diff before.json
     Fails (exit 1) on any money-column drift on a pre-existing row.

Pre-existing canonical-formula drift (the 5 legacy recompute sites that omit
add_ons_revenue / attributed_debits_total) is REPORTED, never failed -- it
predates receipts and is out of scope here.

Connection: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) plus
SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY -- every table
this script touches is anon-SELECTable). Only ever issues GETs.

Merge gate (per the ship rules):
  npx tsc --noEmit && python3 scripts/receipts_parity.py
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

PAGE = 1000

MONEY_COLS = [
    "rental_revenue",
    "add_ons_revenue",
    "management_fee",
    "cleaning_total",
    "repairs_total",
    "attributed_debits_total",
    "reserve_holdback",
    "owner_payout",
]


def round2(n):
    return round((n or 0) + 1e-9, 2)


def env_creds():
    base = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    )
    if not base or not key:
        print(
            "ERROR: set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and "
            "SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)",
            file=sys.stderr,
        )
        sys.exit(2)
    return base.rstrip("/"), key


def fetch_all(base, key, table, select, filters=None):
    """Paginated GET. Returns None when the table doesn't exist yet."""
    rows, offset = [], 0
    while True:
        params = [("select", select), ("limit", str(PAGE)), ("offset", str(offset))]
        if filters:
            params.extend(filters)
        url = f"{base}/rest/v1/{table}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(
            url, headers={"apikey": key, "Authorization": f"Bearer {key}"}
        )
        try:
            with urllib.request.urlopen(req) as r:
                page = json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            if e.code in (404, 406) or "PGRST205" in body or "does not exist" in body or "Could not find the table" in body:
                return None
            print(f"ERROR: GET {table} -> {e.code}: {body[:300]}", file=sys.stderr)
            sys.exit(2)
        rows.extend(page)
        if len(page) < PAGE:
            return rows
        offset += PAGE


def load_state(base, key):
    periods = fetch_all(base, key, "statement_periods", "id,month") or []
    month_by_period = {p["id"]: p["month"] for p in periods}

    stmts = fetch_all(
        base,
        key,
        "property_statements",
        "id,period_id,property_id," + ",".join(MONEY_COLS),
    ) or []
    for s in stmts:
        s["month"] = month_by_period.get(s.get("period_id"))

    repair_rows = fetch_all(
        base, key, "repair_events", "id,property_statement_id,bank_charge_amount,source,receipt_id"
    )
    repairs_by_stmt = {}
    if repair_rows is not None:
        for r in repair_rows:
            agg = repairs_by_stmt.setdefault(
                r["property_statement_id"],
                {"count": 0, "sum": 0.0, "by_source": {}},
            )
            amt = float(r.get("bank_charge_amount") or 0)
            src = r.get("source") or "unknown"
            agg["count"] += 1
            agg["sum"] = round2(agg["sum"] + amt)
            by = agg["by_source"].setdefault(src, {"count": 0, "sum": 0.0})
            by["count"] += 1
            by["sum"] = round2(by["sum"] + amt)

    receipts = fetch_all(
        base,
        key,
        "property_receipts",
        "id,property_id,month,amount,status,vendor_name,description",
    )
    return stmts, repairs_by_stmt, (repair_rows is not None), receipts


def canonical_payout(s):
    return round2(
        float(s.get("rental_revenue") or 0)
        + float(s.get("add_ons_revenue") or 0)
        - float(s.get("management_fee") or 0)
        - float(s.get("cleaning_total") or 0)
        - float(s.get("repairs_total") or 0)
        - float(s.get("attributed_debits_total") or 0)
        - float(s.get("reserve_holdback") or 0)
    )


def build_snapshot(base, key):
    stmts, repairs_by_stmt, repairs_table_exists, receipts = load_state(base, key)
    snap = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "repair_events_table_exists": repairs_table_exists,
        "receipts_table_exists": receipts is not None,
        "active_receipt_count": len([r for r in receipts or [] if r.get("status") == "active"]),
        "statements": {},
    }
    for s in stmts:
        snap["statements"][s["id"]] = {
            "property_id": s.get("property_id"),
            "month": s.get("month"),
            "money": {c: round2(float(s.get(c) or 0)) for c in MONEY_COLS},
            "repair_events": repairs_by_stmt.get(s["id"], {"count": 0, "sum": 0.0, "by_source": {}}),
            "canonical_drift": round2(float(s.get("owner_payout") or 0) - canonical_payout(s)),
        }
    return snap


def mode_snapshot(args, base, key):
    snap = build_snapshot(base, key)
    if args.out:
        with open(args.out, "w") as f:
            json.dump(snap, f, indent=2, sort_keys=True)
        print(f"snapshot written: {args.out} ({len(snap['statements'])} statements)")
        return 0
    if args.diff:
        with open(args.diff) as f:
            before = json.load(f)
        failures = []
        for sid, prev in before.get("statements", {}).items():
            cur = snap["statements"].get(sid)
            if cur is None:
                failures.append((sid, prev, "statement row DELETED since the before-snapshot"))
                continue
            for col, val in prev["money"].items():
                if cur["money"].get(col) != val:
                    failures.append(
                        (sid, prev, f"{col}: {val} -> {cur['money'].get(col)}")
                    )
            # New canonical-drift is a regression even when a legacy row was
            # already off before the deploy (allowlist = the before value).
            if abs(cur["canonical_drift"]) > 0.011 and abs(cur["canonical_drift"] - prev.get("canonical_drift", 0)) > 0.011:
                failures.append(
                    (sid, prev, f"NEW canonical-invariant violation: drift {prev.get('canonical_drift', 0)} -> {cur['canonical_drift']}")
                )
        new_rows = set(snap["statements"]) - set(before.get("statements", {}))
        if new_rows:
            print(f"note: {len(new_rows)} statement(s) created since the before-snapshot (not compared)")
        if failures:
            print(f"FAIL: {len(failures)} drift(s) on pre-existing statements:")
            for sid, prev, msg in failures:
                print(f"  {prev.get('property_id')} {prev.get('month')} ({sid}): {msg}")
            return 1
        print(f"PASS: {len(before.get('statements', {}))} pre-existing statements byte-identical on {', '.join(MONEY_COLS)}")
        return 0
    print("snapshot mode needs --out FILE or --diff FILE", file=sys.stderr)
    return 2


def mode_audit(base, key):
    stmts, repairs_by_stmt, repairs_table_exists, receipts = load_state(base, key)
    print(f"statements: {len(stmts)}")
    exit_code = 0

    # ── Core assertion: zero active receipts => the fold is inert ──
    if receipts is None:
        print("property_receipts table: ABSENT (migration unapplied). The fold is inert by construction;")
        print("PASS: every owner_payout is unchanged under the new formula.")
        active = []
    else:
        active = [r for r in receipts if r.get("status") == "active"]
        voided = [r for r in receipts if r.get("status") == "void"]
        print(f"property_receipts: {len(active)} active, {len(voided)} void")
        if not active:
            print("PASS: zero active receipts -- the fold contributes $0.00 to every statement;")
            print("      every stored owner_payout is unchanged under the new formula.")

    # ── Receipts that exist: which statements WOULD change, and mirror sanity ──
    if active:
        stmt_by_prop_month = {(s.get("property_id"), s.get("month")): s for s in stmts}
        sums = {}
        for r in active:
            k = (r.get("property_id"), r.get("month"))
            sums[k] = round2(sums.get(k, 0.0) + float(r.get("amount") or 0))
        for (pid, month), receipts_sum in sorted(sums.items()):
            s = stmt_by_prop_month.get((pid, month))
            if s is None:
                print(f"  {pid} {month}: ${receipts_sum:.2f} in receipts, NO statement yet -- next ingest deducts it.")
                continue
            mirror = repairs_by_stmt.get(s["id"], {"by_source": {}})["by_source"].get("receipt", {"count": 0, "sum": 0.0})
            if abs(mirror["sum"] - receipts_sum) <= 0.011:
                print(f"  {pid} {month}: ${receipts_sum:.2f} in receipts already folded ({mirror['count']} mirror row(s)) -- consistent.")
            elif mirror["count"] == 0 and not repairs_table_exists:
                print(f"  {pid} {month}: ${receipts_sum:.2f} in receipts; repair_events table absent -- totals fold on next ingest.")
            elif mirror["count"] == 0:
                new_repairs = round2(float(s.get("repairs_total") or 0) + receipts_sum)
                new_payout = round2(float(s.get("owner_payout") or 0) - receipts_sum)
                print(
                    f"  WOULD CHANGE  {pid} {month}: next ingest/recompute folds ${receipts_sum:.2f} -> "
                    f"repairs_total {round2(float(s.get('repairs_total') or 0)):.2f} -> {new_repairs:.2f}, "
                    f"owner_payout {round2(float(s.get('owner_payout') or 0)):.2f} -> {new_payout:.2f}"
                )
            else:
                exit_code = 1
                print(
                    f"  FAIL  {pid} {month}: mirror rows sum ${mirror['sum']:.2f} != active receipts ${receipts_sum:.2f} "
                    f"(double-count or stale fold -- re-ingest this month and re-run)"
                )
        # Orphan mirrors: receipt-sourced repair rows on statements with no active receipts.
        active_keys = set(sums.keys())
        for s in stmts:
            mirror = repairs_by_stmt.get(s["id"], {"by_source": {}})["by_source"].get("receipt")
            if mirror and (s.get("property_id"), s.get("month")) not in active_keys:
                exit_code = 1
                print(
                    f"  FAIL  {s.get('property_id')} {s.get('month')}: {mirror['count']} receipt mirror row(s) "
                    f"(${mirror['sum']:.2f}) but no active receipts -- stale mirror inflating repairs_total"
                )

    # ── Report-only: pre-existing canonical-formula drift ──
    drifted = [(s, round2(float(s.get("owner_payout") or 0) - canonical_payout(s))) for s in stmts]
    drifted = [(s, d) for s, d in drifted if abs(d) > 0.011]
    if drifted:
        print(f"\nreport-only: {len(drifted)} statement(s) with pre-existing canonical-formula drift")
        print("(legacy recompute sites omit add_ons/attributed_debits; predates receipts, not a failure):")
        for s, d in sorted(drifted, key=lambda x: (x[0].get("month") or "", x[0].get("property_id") or "")):
            print(f"  {s.get('property_id')} {s.get('month')}: stored owner_payout off canonical by {d:+.2f}")
    else:
        print("\ncanonical invariant: every stored owner_payout matches the canonical formula.")

    print("\n" + ("FAIL" if exit_code else "PASS"))
    return exit_code


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["audit", "snapshot"], default="audit")
    ap.add_argument("--out", help="snapshot mode: write the before-snapshot here")
    ap.add_argument("--diff", help="snapshot mode: compare current state against this before-snapshot")
    args = ap.parse_args()
    base, key = env_creds()
    if args.mode == "snapshot":
        sys.exit(mode_snapshot(args, base, key))
    sys.exit(mode_audit(base, key))


if __name__ == "__main__":
    main()
