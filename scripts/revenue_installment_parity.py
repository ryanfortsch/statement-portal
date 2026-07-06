#!/usr/bin/env python3
"""
Revenue-page installment parity harness.

READ-ONLY. For every reservation_installments booking, prints what the
/revenue snapshot will attribute to each month after the installment-aware
allocation, so the operator can verify e.g. 3 South July shows Hancock's
$20,853.63 / 31 nights instead of "No bookings in range".

Also prints what the OLD checkout-attribution would have shown (full
booking value in the checkout month) so the delta is explicit.
"""
import json
import os
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


def resolve_gross_payout(g, mgmt_pct):
    """Mirror revenue-snapshot's resolveGrossPayout for the OLD-behavior line."""
    hp = float(g.get('host_payout') or 0)
    if hp > 0:
        return hp
    onr = float(g.get('owner_net_revenue_guesty') or 0)
    frac = (mgmt_pct or 0) / 100.0
    if onr > 0 and frac < 1:
        return onr / (1 - frac)
    tp = float(g.get('total_paid') or 0)
    return tp if tp > 0 else 0.0


def main():
    installments = q('reservation_installments?select=confirmation_code,property_id,month,installment_revenue,installment_nights,is_final_month&order=confirmation_code,month')
    if not installments:
        print('No reservation_installments rows. Nothing to check.')
        return

    by_code = {}
    for i in installments:
        by_code.setdefault(i['confirmation_code'], []).append(i)

    props = {p['id']: p for p in q('properties?select=id,name,management_fee_pct')}

    print('Installment bookings -> /revenue monthly attribution (new behavior):\n')
    for code, slices in by_code.items():
        g_rows = q(f'guesty_reservations?select=guest_name,property_id,check_in,check_out,host_payout,owner_net_revenue_guesty,total_paid&confirmation_code=eq.{code}')
        g = g_rows[0] if g_rows else {}
        pid = slices[0]['property_id']
        prop = props.get(pid, {})
        mgmt_pct = float(prop.get('management_fee_pct') or 0)
        old_value = resolve_gross_payout(g, mgmt_pct)
        co_month = (g.get('check_out') or '?')[:7]

        print(f'{g.get("guest_name", "?")} ({code}) -- {prop.get("name", pid)}, '
              f'{g.get("check_in", "?")} -> {g.get("check_out", "?")}')
        print(f'  OLD checkout attribution: ${old_value:,.2f} entirely in {co_month}, other months $0')
        total = 0.0
        for s in slices:
            rev = float(s['installment_revenue'] or 0)
            nts = int(s['installment_nights'] or 0)
            total += rev
            fin = '  (stay + cleaning counted here)' if s['is_final_month'] else ''
            print(f'  NEW  {s["month"]}: ${rev:,.2f} / {nts} nights{fin}')
        print(f'  NEW total across months: ${total:,.2f}\n')

    print('Note: closed months are still overridden by the actual property_statements'
          '\nvalues in applyStatementsAndPacing -- the slices above are what open/'
          '\nfuture months show.')


if __name__ == '__main__':
    main()
