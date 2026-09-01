-- VRBO folio-basis commission parity harness (READ-ONLY).
--
-- WHY. stripLegacyCommissionKludge (canonical copy in /api/ingest, twins in
-- /api/refresh-statement and /api/fill-gap) decides whether a Guesty
-- CHANNEL COMMISSION carries the legacy 4.4% gross-up by testing
--
--     ratio = channel_commission / (total_paid - total_taxes) > 0.07
--
-- channel_commission is a BOOKING-level figure. total_paid is a PAYMENT-level
-- figure, and since July 2026 Guesty has recorded only one leg of a guest's
-- 50/50 split (the same defect lib/remittance.ts was written to route around).
-- total_taxes stays booking-level throughout, so a halved total_paid shrinks
-- the denominator by MORE than half: a genuine 5% VRBO commission reads as
-- 11.3% and gets cut to 5% of the halved base. Confirmed on HA-XlpeL8K
-- (Evan Friese, 4 Brier Neck, Aug 2026): real $597.05, stripped to $263.60.
--
-- THE FIX UNDER TEST. Take both the ratio denominator and the cleaned 5% base
-- from the booking's pre-tax folio, and recognize revenue on the folio gross
-- when total_paid is materially short of it. That is the same conclusion
-- lib/stripe-sync.ts's gross reconstruction already reaches from the real
-- Stripe charges -- which is why the stored rows already hold the proposed
-- value and nothing moves.
--
-- WHAT PARITY MEANS HERE. Section 1 replays both the current and the proposed
-- commission/gross rules over every VRBO reservation sitting on a statement,
-- holding reservations.stripe_fee CONSTANT so the comparison isolates the
-- commission and gross basis rather than estimate-vs-synced-actual fee noise.
-- PASS = every proposed_adj equals the stored adjusted_revenue to the cent,
-- i.e. no owner payout moves. Section 2 is the go/no-go rollup.
--
-- Run: supabase db query --linked --file scripts/vrbo_folio_basis_parity.sql
--
-- Sections are UNIONed into one result set (the CLI prints only the last
-- statement of a multi-statement file). Read the `section` column.

with folio as (
  select
    g.confirmation_code,
    g.property_id,
    g.guest_name,
    g.check_in,
    coalesce(g.channel, g.guesty_channel_id, '')            as chan,
    coalesce(g.total_paid, 0)                               as tp,
    coalesce(g.total_taxes, 0)                              as tt,
    coalesce(g.channel_commission, 0)                       as comm,
    -- splitFolio() in lib/remittance.ts: TAX-typed lines are tax, every other
    -- line (fare, cleaning, extra-person, channel markup, negative discounts)
    -- is the guest's pre-tax total. Keyed on "is it tax", never an allowlist.
    (select round(coalesce(sum((i->>'amount')::numeric), 0), 2)
       from jsonb_array_elements(g.folio_items) i
      where coalesce(i->>'type', '') <> 'TAX'
        and (i->>'amount') ~ '^-?[0-9.]+$')                 as pretax,
    (select round(coalesce(sum((i->>'amount')::numeric), 0), 2)
       from jsonb_array_elements(g.folio_items) i
      where (i->>'amount') ~ '^-?[0-9.]+$')                 as folio_gross
  from guesty_reservations g
  where jsonb_typeof(g.folio_items) = 'array'
    and jsonb_array_length(g.folio_items) > 0
),
vrbo as (
  select * from folio
  where (upper(chan) like '%HOMEAWAY%' or upper(chan) = 'VRBO')
    and tp > 0
),
-- Effective commission under each rule, then the net each rule writes.
priced as (
  select
    v.*,
    ps.id                                                   as stmt_id,
    sp.month,
    r.id                                                    as res_id,
    r.adjusted_revenue                                      as stored_adj,
    r.stripe_fee                                            as fee,
    r.bank_match_status,
    case when v.comm / nullif(v.pretax, 0) > 0.07
         then round(v.pretax * 0.05, 2) else v.comm end     as comm_proposed,
    case when v.comm / nullif(v.tp - v.tt, 0) > 0.07
         then round(greatest(v.tp - v.tt, 0) * 0.05, 2)
         else v.comm end                                    as comm_current
  from vrbo v
  left join reservations r         on r.confirmation_code = v.confirmation_code
  left join property_statements ps on ps.id = r.property_statement_id
  left join statement_periods sp   on sp.id = ps.period_id
),
onstmt as (
  select
    p.*,
    round(p.folio_gross - p.tt - p.comm_proposed - p.fee, 2) as proposed_adj,
    round(p.tp          - p.tt - p.comm_current  - p.fee, 2) as current_adj
  from priced p
  where p.res_id is not null and p.stmt_id is not null
)

-- 1. PARITY: proposed rule vs stored adjusted_revenue, fee held constant.
select
  1                                                    as ord,
  'parity'                                             as section,
  o.month,
  o.property_id,
  o.confirmation_code,
  o.guest_name,
  round(o.tp / nullif(o.folio_gross, 0), 3)            as paid_over_folio,
  round(o.comm / nullif(o.pretax, 0), 4)               as ratio_on_folio,
  o.stored_adj,
  o.proposed_adj,
  o.current_adj,
  round(o.proposed_adj - o.stored_adj, 2)              as proposed_delta,
  case when abs(o.proposed_adj - o.stored_adj) <= 0.01
       then 'PASS' else 'FAIL -- REVIEW BEFORE SHIP' end as note
from onstmt o

union all

-- 2. VERDICT ROLLUP. rows_moved (in proposed_delta) must be 0 and
--    stored_adj -- the summed proposed delta -- must be 0.00.
--    current_adj holds what the CURRENT code would now write against live
--    guesty_reservations: the understatement the fix prevents.
select
  2, 'ROLLUP', null, null, null,
  'rows_checked=' || count(*)::text,
  null, null, null,
  round(sum(o.proposed_adj - o.stored_adj), 2),
  round(sum(o.current_adj  - o.stored_adj), 2),
  count(*) filter (where abs(o.proposed_adj - o.stored_adj) > 0.01)::numeric,
  case when count(*) filter (where abs(o.proposed_adj - o.stored_adj) > 0.01) = 0
       then 'PASS -- no owner payout moves'
       else 'FAIL -- REVIEW BEFORE SHIP' end
from onstmt o

union all

-- 3. FORWARD EXPOSURE. VRBO bookings with a partial total_paid not yet on a
--    statement: what the current code would understate on their first ingest
--    (current_adj) versus what the proposed rule writes (proposed_adj). Both
--    use the 3.9% + $0.40 fee estimate, since no synced actual exists yet.
select
  3, 'forward-exposure', null, p.property_id, p.confirmation_code, p.guest_name,
  round(p.tp / nullif(p.folio_gross, 0), 3),
  round(p.comm / nullif(p.pretax, 0), 4),
  null,
  round(p.folio_gross - p.tt - p.comm_proposed - round(p.folio_gross * 0.039 + 0.40, 2), 2),
  round(p.tp          - p.tt - p.comm_current  - round(p.tp          * 0.039 + 0.40, 2), 2),
  null,
  'not yet ingested'
from priced p
where p.res_id is null and p.tp < p.folio_gross - 1

union all

-- 4. HEAL COVERAGE. stripe-sync's gross reconstruction is what has silently
--    repaired these rows post-ingest, which is why the damage has been latent.
--    It cannot run on a row that is frozen (paid_off_stripe) or
--    installment-split -- those are where a latent strip becomes a real
--    payout error. HA-XlpeL8K is paid_off_stripe, which is exactly why it
--    had to be repaired by hand.
select
  4, 'heal-coverage', o.month, o.property_id, o.confirmation_code, o.guest_name,
  null, null, null, null, null, null,
  case when o.bank_match_status = 'paid_off_stripe'
         or exists (select 1 from reservation_installments ri
                     where ri.confirmation_code = o.confirmation_code)
       then 'HEAL BLOCKED -- ingest must be right on the first pass'
       else 'heal available (stripe-sync would repair)' end
from onstmt o
where o.tp < o.folio_gross - 1

order by ord, month nulls last, property_id, confirmation_code;
