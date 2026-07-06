#!/usr/bin/env python3
"""
Cancel-parity harness.

One-shot READ-ONLY scan. For every reservation currently on a Helm owner
statement, cross-reference the local guesty_reservations.status field.
For any row where status is NOT 'confirmed' or 'closed', print:

  property_id . month . confirmation_code . guest_name . status . adjusted_revenue . bank_match_status . statement owner_payout

Run AFTER refreshing the cache (Sync ▾ → Sync Bookings), so guesty_reservations
reflects current Guesty truth. Without the refresh, this prints all-clean
(false negative).

Phase 1 of the cancel-leak fix only freshens the cache and adds this
harness. It does NOT change recognition math. The output here is what
operator review against Phase 2 will be calibrated to.
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


def main():
    reservations = q(
        'reservations?select='
        'id,confirmation_code,guest_name,platform,check_in,check_out,'
        'adjusted_revenue,guesty_rental_income,bank_match_status,property_statement_id'
        '&order=check_out.desc'
    )
    gr_rows = q('guesty_reservations?select=confirmation_code,status,synced_at')
    by_code = {g['confirmation_code']: g for g in gr_rows}

    ps_rows = q(
        'property_statements?select=id,property_id,month,owner_payout,rental_revenue,num_stays'
    )
    by_ps = {p['id']: p for p in ps_rows}

    suspicious = []
    for r in reservations:
        g = by_code.get(r['confirmation_code'])
        if not g:
            continue
        status = (g.get('status') or '').lower()
        if status in ('confirmed', 'closed', ''):
            continue
        ps = by_ps.get(r['property_statement_id']) or {}
        suspicious.append({
            'property': ps.get('property_id', '?'),
            'month': ps.get('month', '?'),
            'code': r['confirmation_code'],
            'guest': r['guest_name'],
            'status': status,
            'platform': r['platform'],
            'adjusted_revenue': float(r['adjusted_revenue'] or 0),
            'bank_match_status': r.get('bank_match_status'),
            'statement_owner_payout': float(ps.get('owner_payout') or 0),
            'statement_num_stays': ps.get('num_stays'),
            'synced_at': g.get('synced_at'),
        })

    if not suspicious:
        print('Clean: every reservation on a Helm statement has guesty_reservations.status in (confirmed, closed, null).')
        return

    print(f'Found {len(suspicious)} suspicious reservation(s) with non-confirmed Guesty status:\n')
    header = (
        f'{"PROPERTY":<15} {"MONTH":<10} {"CODE":<14} {"GUEST":<22} '
        f'{"STATUS":<10} {"PLATFORM":<10} {"REV":>10} {"BANK":<12} {"STMT_PAYOUT":>12}'
    )
    print(header)
    print('-' * len(header))
    total_delta = 0.0
    for s in suspicious:
        print(
            f'  {s["property"]:<15} {s["month"]:<10} {s["code"]:<14} {(s["guest"] or "")[:22]:<22} '
            f'{s["status"]:<10} {s["platform"]:<10} ${s["adjusted_revenue"]:>8.2f} '
            f'{str(s["bank_match_status"] or ""):<12} ${s["statement_owner_payout"]:>10.2f}'
        )
        total_delta += s['adjusted_revenue']

    print(
        f'\nIf every suspicious row were treated as cancelled-no-fee and dropped:'
    )
    print(f'  total rental_revenue delta: -${total_delta:.2f}')
    print(f'  (mgmt_fee + owner_payout will shift proportionally; statement-level recompute required)')


if __name__ == '__main__':
    main()
