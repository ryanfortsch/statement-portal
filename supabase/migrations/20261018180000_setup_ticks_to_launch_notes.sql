-- The Setup catalog's hand ticks move into Launch step notes.
--
-- A home carried two lists: Launch (26 steps, property_launch_steps) and the
-- 108-item Setup catalog (property_onboarding_items), under five names that
-- all said "onboarding". Launch is now the one list and the Setup tab is gone
-- (UI/UX audit 2026-10-17, Properties Phase 3). The catalog's derived items
-- were never stored, so nothing is lost by not rendering them; each derives
-- from a fact the record already shows. Its HAND ticks are the one thing only
-- the catalog knew: 45 rows, all 'done', none with a note, across 7 homes, on
-- 16 items. None is dropped. Each becomes a line on the Launch step it
-- belongs with, so "Owner Reserve check received" is still on the record:
--
--   management agreement signed, owner reserve check,
--   Guesty business model                       -> fee_and_terms
--   intake form sent, intake form submitted     -> owner_contact_confirmed
--   statement CC list                           -> statement_template
--   monthly rhythm walkthrough                  -> owner_welcome
--   go-live target                              -> activated
--   Chase account opened, Chase signers         -> bank_last4
--   Stripe account, restricted key, Stripe in
--   Guesty                                      -> stripe_auto_payouts
--   SCA test booking                            -> sca_page_live
--   MassTaxConnect registration                 -> tax_cert
--   cleaning cost estimate                      -> cape_ann_invoice_route
--
-- A note never changes a step's status: a row inserted here is 'todo', which
-- the resolver treats exactly like no row (src/lib/launch-checklist.ts), and
-- every one of the 7 homes already carries Launch rows, so none changes its
-- Coming online group. Idempotent: a line already present is not appended
-- twice. property_onboarding_items is left as it is.

with mapping(item_key, step_key, title) as (
  values
    ('owner_deal.management_agreement_signed', 'fee_and_terms', 'Management agreement signed'),
    ('owner_deal.owner_reserve_check', 'fee_and_terms', 'Owner Reserve check received'),
    ('financial.guesty_business_model', 'fee_and_terms', 'Guesty Business model configured'),
    ('owner_deal.intake_form_sent', 'owner_contact_confirmed', 'Owner intake form sent'),
    ('owner_deal.intake_form_submitted', 'owner_contact_confirmed', 'Owner intake form submitted'),
    ('owner_deal.statement_cc_list', 'statement_template', 'Statement recipients confirmed'),
    ('owner_deal.monthly_rhythm_walkthrough', 'owner_welcome', 'Owner walked through the monthly rhythm'),
    ('owner_deal.go_live_target', 'activated', 'Target go-live date set'),
    ('financial.chase_account_opened', 'bank_last4', 'Dedicated Chase account opened'),
    ('financial.chase_signers_named', 'bank_last4', 'Chase naming and signers settled'),
    ('financial.stripe_account_created', 'stripe_auto_payouts', 'Property Stripe account created'),
    ('financial.stripe_restricted_key', 'stripe_auto_payouts', 'Stripe key wired into Helm'),
    ('financial.stripe_linked_in_guesty', 'stripe_auto_payouts', 'Stripe linked in Guesty'),
    ('financial.sca_test_booking', 'sca_page_live', 'Direct booking tested end to end'),
    ('financial.masstax_registration', 'tax_cert', 'Registered on MassTaxConnect'),
    ('financial.cleaning_cost_estimate', 'cape_ann_invoice_route', 'Cleaning cost estimate set')
),
lines as (
  select
    i.property_id,
    m.step_key,
    'From Setup: ' || m.title
      || case when i.status = 'n_a' then ' (marked does not apply' else ' (ticked' end
      || ' ' || to_char(i.updated_at at time zone 'America/New_York', 'Mon FMDD, YYYY')
      || coalesce(' by ' || nullif(split_part(i.updated_by_email, '@', 1), ''), '')
      || coalesce('; ' || nullif(btrim(i.note), ''), '')
      || ').' as line
  from public.property_onboarding_items i
  join mapping m using (item_key)
  where i.status <> 'todo'
),
merged as (
  select property_id, step_key, string_agg(line, E'\n' order by line) as text
  from lines
  group by property_id, step_key
)
insert into public.property_launch_steps (property_id, step_key, status, notes)
select property_id, step_key, 'todo', text from merged
on conflict (property_id, step_key) do update
set notes = case
      when public.property_launch_steps.notes is null or btrim(public.property_launch_steps.notes) = ''
        then excluded.notes
      when position(excluded.notes in public.property_launch_steps.notes) > 0
        then public.property_launch_steps.notes
      else public.property_launch_steps.notes || E'\n' || excluded.notes
    end,
    updated_at = now();
