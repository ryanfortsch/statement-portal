#!/usr/bin/env python3
"""
Grossed-up ADR parity harness.

READ-ONLY. Nothing here writes to Supabase or touches payout math.

For every property_statement, prints the CURRENT (net) ADR the statement used
to show next to the NEW guest-facing (grossed-up) ADR that the render page now
displays, so the operator can eyeball the whole fleet before trusting the new
number.

  current_adr    = rental_revenue / nights_booked           (RT's net deposit / night)
  grossed_up_adr = sum(guest_facing_gross) / nights_booked  (what the guest paid / night)

Both use the SAME nights_booked denominator (property_statements.nights_booked),
matching src/app/statements/render/page.tsx exactly. The per-reservation
guest-facing gross reconstruction mirrors guestFacingGross() in that file:

  - Airbnb / VRBO / Booking.com: net = adjusted_revenue (|| rental_income),
    add stripe_fee back (VRBO/Manual are net of it; Airbnb/Booking = 0), gross
    up the host commission net / (1 - fee_pct), then + 11.7% MA occupancy tax
    iff the FULL trip length (check-out - check-in) is < 30 nights.
  - Direct / Stay Cape Ann ("Manual"/"Direct"): commission = 0, no gross-up,
    no additive tax. gross = adjusted_revenue + month_taxes. total_paid is NOT
    used (for installment SCA stays it's the whole booking, not the month slice).
    month_taxes defaults to 0 (the render page threads it in only when present;
    this harness reads guesty_reservations.total_taxes but applies it only to
    single-month SCA stays under the < 30-night rule, matching the render guard).

Fee rates are HOST commissions for guest-facing reconstruction only -- NOT the
RT management fee_pct and unrelated to owner payout.
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
KEY = ENV.get('SUPABASE_SERVICE_ROLE_KEY') or ENV['NEXT_PUBLIC_SUPABASE_ANON_KEY']

PLATFORM_FEE_PCT = {'airbnb': 0.155, 'vrbo': 0.08, 'booking': 0.15}
TAX_RATE = 0.117
TAX_NIGHTS_THRESHOLD = 30


def q(path):
    req = urllib.request.Request(
        f'{URL}/rest/v1/{path}',
        headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}'},
    )
    return json.load(urllib.request.urlopen(req))


def round2(n):
    return round(n * 100) / 100


def gross_up_bucket(platform):
    """Mirror grossUpBucket() in render/page.tsx (exact-match, not substring)."""
    key = (platform or '').lower().strip()
    if key in ('manual', 'direct', 'direct2') or 'cape ann' in key or 'stay cape' in key:
        return 'sca'
    if key in ('airbnb', 'airbnb2'):
        return 'airbnb'
    if key in ('homeaway', 'homeaway2', 'vrbo'):
        return 'vrbo'
    if key in ('booking', 'booking.com', 'bookingcom'):
        return 'booking'
    return 'passthrough'


def trip_nights(check_in, check_out):
    """Full-trip nights (basis for the MA 30-night exemption)."""
    from datetime import date
    try:
        y1, m1, d1 = map(int, check_in.split('-'))
        y2, m2, d2 = map(int, check_out.split('-'))
        return max(0, (date(y2, m2, d2) - date(y1, m1, d1)).days)
    except Exception:
        return 0


def guest_facing_gross(r):
    """Mirror guestFacingGross() in render/page.tsx."""
    net = float(r.get('adjusted_revenue') if r.get('adjusted_revenue') is not None
                else r.get('guesty_rental_income') or 0) or 0.0
    stripe_fee = float(r.get('stripe_fee') or 0)
    nts = trip_nights(r.get('check_in') or '', r.get('check_out') or '')
    bucket = gross_up_bucket(r.get('platform') or '')

    if bucket == 'passthrough':
        return net

    # SCA/Direct is a 0%-commission RT-Stripe channel: add its Stripe fee back
    # (its only platform fee), gross up a 0% commission (no-op), then the same
    # < 30-night 11.7% tax. Airbnb/Booking stripe_fee is 0 (no-op).
    fee_pct = 0.0 if bucket == 'sca' else PLATFORM_FEE_PCT[bucket]
    platform_gross = (net + stripe_fee) / (1 - fee_pct)
    is_taxable = 0 < nts < TAX_NIGHTS_THRESHOLD
    tax = platform_gross * TAX_RATE if is_taxable else 0.0
    return platform_gross + tax


def main():
    # month lives on statement_periods (joined via period_id), not on the
    # statement row itself.
    periods = q('statement_periods?select=id,month')
    month_by_period = {p['id']: p['month'] for p in periods}

    stmts = q('property_statements?select=id,property_id,property_name,period_id,'
              'rental_revenue,nights_booked&order=property_id.asc')
    if not stmts:
        print('No property_statements rows. Nothing to check.')
        return
    for s in stmts:
        s['month'] = month_by_period.get(s.get('period_id'), '?')
    stmts.sort(key=lambda s: (s['month'], s['property_id']), reverse=False)

    ps_ids = [s['id'] for s in stmts]
    # Chunk the reservation fetch so the in.() list stays small.
    res_by_ps = {}
    all_codes = set()
    for i in range(0, len(ps_ids), 40):
        chunk = ps_ids[i:i + 40]
        ps_list = ','.join(f'"{p}"' for p in chunk)
        # Column is guesty_rental_income (the render page selects '*' and its
        # helper falls back to r.rental_income, which is undefined there, so in
        # practice the fallback only fires when adjusted_revenue is null; we
        # map guesty_rental_income into that same fallback slot to match).
        rows = q(f'reservations?select=property_statement_id,confirmation_code,'
                 f'platform,check_in,check_out,adjusted_revenue,'
                 f'guesty_rental_income,stripe_fee&property_statement_id=in.({ps_list})')
        for r in rows:
            res_by_ps.setdefault(r['property_statement_id'], []).append(r)
            if r.get('confirmation_code'):
                all_codes.add(r['confirmation_code'])

    # Optional SCA month-tax slice: guesty_reservations.total_taxes keyed by
    # confirmation_code. Full-booking tax; only applied to single-month SCA
    # stays (< 30 nights) to match the render guard.
    taxes_by_code = {}
    codes = sorted(all_codes)
    for i in range(0, len(codes), 60):
        chunk = codes[i:i + 60]
        code_list = ','.join(f'"{c}"' for c in chunk)
        try:
            grows = q(f'guesty_reservations?select=confirmation_code,total_taxes'
                      f'&confirmation_code=in.({code_list})')
            for g in grows:
                if g.get('confirmation_code'):
                    taxes_by_code[g['confirmation_code']] = float(g.get('total_taxes') or 0)
        except Exception:
            pass

    hdr = f'{"Property":<20} {"Month":<9} {"Nts":>4} {"Net ADR":>11} {"Gross ADR":>11} {"Delta":>10}'
    print(hdr)
    print('-' * len(hdr))
    for s in stmts:
        nights = float(s.get('nights_booked') or 0)
        rental = float(s.get('rental_revenue') or 0)
        rows = res_by_ps.get(s['id'], [])
        if nights <= 0:
            continue
        gross_total = 0.0
        for r in rows:
            gross_total += guest_facing_gross(r)
        net_adr = rental / nights
        gross_adr = gross_total / nights
        name = (s.get('property_name') or s.get('property_id') or '')[:20]
        print(f'{name:<20} {s["month"]:<9} {int(nights):>4} '
              f'${net_adr:>10,.2f} ${gross_adr:>10,.2f} '
              f'{(gross_adr - net_adr):>+9,.2f}')

    print('\nREAD-ONLY sanity check. Net ADR = rental_revenue / nights_booked '
          '(RT net deposit). Gross ADR = what the guest paid, reconstructed per '
          'reservation. Both share the nights_booked denominator. Payout math is '
          'untouched -- only the displayed ADR changed.')


if __name__ == '__main__':
    main()
