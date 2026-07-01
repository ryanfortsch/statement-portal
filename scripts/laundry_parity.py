#!/usr/bin/env python3
"""
Laundry Plus parity harness.

READ-ONLY. Shows the delta each property_statement's cleaning_total +
owner_payout would move if Laundry Plus rows were folded in.

Run AFTER the code fix ships and BEFORE re-ingesting historical
statements. The output is the operator's per-property go/no-go: does
each property's owner statement recompute look right with laundry
folded in?

Does not touch the DB. Estimates by reading existing cleaning_events
rows (source='bank-laundry') against property_statements. If no laundry
rows exist yet for a property (never re-ingested since the fix), the
delta shows as $0 -- meaning re-uploading that property's bank CSV is
the next step.
"""
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = {}
for line in open(os.path.join(ROOT, '.env.local')):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        ENV[k.strip()] = v.strip().strip('"').strip("'")

URL = ENV['NEXT_PUBLIC_SUPABASE_URL']
KEY = ENV['SUPABASE_SERVICE_ROLE_KEY']


def q(path):
    req = urllib.request.Request(
        f'{URL}/rest/v1/{path}',
        headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}'},
    )
    return json.load(urllib.request.urlopen(req))


def round2(n):
    return round(n * 100) / 100


def main():
    periods = q('statement_periods?select=id,month')
    month_by_id = {p['id']: p['month'] for p in periods}

    stmts = q(
        'property_statements?select=id,property_id,period_id,rental_revenue,'
        'management_fee,cleaning_total,repairs_total,owner_payout'
    )
    props = q('properties?select=id,management_fee_pct')
    mgmt_by_prop = {p['id']: p.get('management_fee_pct') or 25 for p in props}

    events = q(
        'cleaning_events?select=property_statement_id,amount,source,vendor'
    )

    laundry_by_stmt = {}
    for e in events:
        source = (e.get('source') or '').lower()
        vendor = (e.get('vendor') or '').lower()
        is_laundry = source == 'bank-laundry' or 'laundry plus' in vendor
        if not is_laundry:
            continue
        sid = e['property_statement_id']
        laundry_by_stmt[sid] = laundry_by_stmt.get(sid, 0) + (float(e['amount']) or 0)

    rows = []
    for s in stmts:
        laundry = round2(laundry_by_stmt.get(s['id'], 0))
        if laundry == 0:
            continue
        month = month_by_id.get(s['period_id'], '?')
        rows.append({
            'property_id': s['property_id'],
            'month': month,
            'cleaning_total_current': round2(float(s.get('cleaning_total') or 0)),
            'laundry_included': laundry,
            'owner_payout_current': round2(float(s.get('owner_payout') or 0)),
        })

    rows.sort(key=lambda r: (r['month'], r['property_id']))

    if not rows:
        print(
            'No cleaning_events rows tagged bank-laundry / Laundry Plus yet.\n'
            'Re-upload a property month via /statements/upload to trigger the\n'
            'new laundry-inclusive ingest, then re-run this harness.'
        )
        return

    total_laundry = sum(r['laundry_included'] for r in rows)
    header = f'{"PROPERTY":<15} {"MONTH":<10} {"CLEANING":>12} {"LAUNDRY IN":>12} {"OWNER PAYOUT":>14}'
    print(header)
    print('-' * len(header))
    for r in rows:
        print(
            f'  {r["property_id"]:<15} {r["month"]:<10} '
            f'${r["cleaning_total_current"]:>10.2f} '
            f'${r["laundry_included"]:>10.2f} '
            f'${r["owner_payout_current"]:>12.2f}'
        )

    print(f'\nFleet total laundry now folded into cleaning_total: ${total_laundry:.2f}')
    print(f'Statements affected: {len(rows)}')


if __name__ == '__main__':
    main()
