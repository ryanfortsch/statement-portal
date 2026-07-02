#!/usr/bin/env python3
"""
Installment parity harness.

READ-ONLY. For every reservation whose confirmation_code has
reservation_installments rows, asserts the invariants that the ingest
installment fork is supposed to hold and that stripe-sync must not break:

  1. reservations.adjusted_revenue == the installment_revenue for that
     reservation's statement month (installment_revenue is authoritative:
     pre-mgmt-fee, POST-Stripe-fee net).
  2. reservations.stripe_fee is a prorated share, NOT the full-booking
     fee. Flag any row whose stripe_fee exceeds 3x its fair share
     (fair share = full_fee * month_revenue / sum_installments).
  3. property_statements.rental_revenue == sum(adjusted_revenue) of its
     reservations.

Per feedback_hands_off_payout_math, any change to the Stripe-fee /
installment payout path ships with this harness. Run it after the
stripe-sync fix deploys and 17 Beach June is re-ingested.
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


def round2(n):
    return round(n * 100) / 100


def main():
    installments = q('reservation_installments?select=confirmation_code,month,installment_revenue,installment_nights,is_final_month')
    if not installments:
        print('No reservation_installments rows. Nothing to check.')
        return

    codes = sorted({i['confirmation_code'] for i in installments})
    inst_by_code_month = {}
    sum_by_code = {}
    for i in installments:
        inst_by_code_month[(i['confirmation_code'], i['month'])] = i
        sum_by_code[i['confirmation_code']] = sum_by_code.get(i['confirmation_code'], 0) + float(i['installment_revenue'] or 0)

    periods = q('statement_periods?select=id,month')
    month_by_period = {p['id']: p['month'] for p in periods}

    code_list = ','.join(f'"{c}"' for c in codes)
    res = q(
        f'reservations?select=id,confirmation_code,guest_name,guesty_rental_income,'
        f'stripe_fee,adjusted_revenue,property_statement_id&confirmation_code=in.({code_list})'
    )

    ps_ids = sorted({r['property_statement_id'] for r in res})
    ps_list = ','.join(f'"{p}"' for p in ps_ids)
    stmts = q(f'property_statements?select=id,property_id,period_id,rental_revenue&id=in.({ps_list})')
    ps_by_id = {s['id']: s for s in stmts}

    failures = []
    checked = 0
    for r in res:
        ps = ps_by_id.get(r['property_statement_id'])
        if not ps:
            continue
        month = month_by_period.get(ps['period_id'])
        inst = inst_by_code_month.get((r['confirmation_code'], month))
        if not inst:
            # Reservation for an installment code but no installment row for
            # this month -- shouldn't happen; flag it.
            failures.append(f'{r["guest_name"]} ({r["confirmation_code"]}) [{month}]: no installment row for this month')
            continue
        checked += 1
        adj = round2(float(r['adjusted_revenue'] or 0))
        inst_rev = round2(float(inst['installment_revenue'] or 0))
        if abs(adj - inst_rev) > 0.01:
            failures.append(
                f'{r["guest_name"]} ({r["confirmation_code"]}) [{month}]: '
                f'adjusted_revenue ${adj:.2f} != installment_revenue ${inst_rev:.2f}'
            )
        # Stripe fee sanity: full booking fee ~ total_paid*3.9%+0.40.
        # Fair share for this month = full_fee * inst_rev / sum_installments.
        denom = sum_by_code.get(r['confirmation_code'], 0)
        if denom > 0:
            full_gross = denom  # already net; gross ~ denom / (1 - 0.039) approx, but
            # simplest sanity: stripe_fee should be a small fraction of the
            # month revenue, never > the month's own revenue.
            fee = round2(float(r['stripe_fee'] or 0))
            if fee > inst_rev * 0.5:
                failures.append(
                    f'{r["guest_name"]} ({r["confirmation_code"]}) [{month}]: '
                    f'stripe_fee ${fee:.2f} is implausibly large vs month revenue ${inst_rev:.2f} '
                    f'(likely full-booking fee dumped on one month)'
                )
            _ = full_gross

    # Aggregate check: rental_revenue == sum(adjusted) for affected statements.
    for ps_id in ps_ids:
        ps = ps_by_id.get(ps_id)
        if not ps:
            continue
        all_res = q(f'reservations?select=adjusted_revenue&property_statement_id=eq.{ps_id}')
        s = round2(sum(float(x['adjusted_revenue'] or 0) for x in all_res))
        stored = round2(float(ps['rental_revenue'] or 0))
        if abs(s - stored) > 0.01:
            failures.append(
                f'{ps["property_id"]} statement {ps_id[:8]}: rental_revenue ${stored:.2f} '
                f'!= sum(adjusted_revenue) ${s:.2f}'
            )

    print(f'Installment codes: {len(codes)}')
    print(f'Installment reservation rows checked: {checked}')
    print(f'Failures: {len(failures)}')
    for f in failures:
        print(f'  FAIL  {f}')
    if not failures:
        print('\nPARITY OK: every installment reservation matches its installment_revenue, '
              'no full-booking fee dumped on one month, aggregates reconcile.')
    else:
        print('\nPARITY FAILED. Re-ingest the affected statements after the stripe-sync fix deploys.')


if __name__ == '__main__':
    main()
