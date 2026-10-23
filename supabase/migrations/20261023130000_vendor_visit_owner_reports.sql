-- Owner-reported work becomes the same hold card (2026-10-23).
--
-- Claudia Kittredge texted the Owners line that 21 Horton's roof would be done
-- Monday to Thursday next week. The reply pointed her at the owner portal to
-- log the dates, and nothing in Helm checked the calendar, so Monday to
-- Wednesday nights stayed on sale. Dotti: "why can't this check for a block
-- and create one if she doesn't?"
--
-- An owner's report now files a row here when the owner card is approved or
-- handled (POST /api/owner-work-holds, from the stay-concierge), and the Team
-- inbox shows it as the same hold card a trade vendor's text makes: the
-- nights that are open, booked or already blocked, and Approve as the only
-- write. A night the owner already blocked in the portal is left as it is.
--
-- Additive and safe before the deploy: existing rows are all trade vendor
-- rows with a vendor id, so they satisfy the new checks; the deployed code
-- never writes `source` and gets the 'vendor' default.

alter table public.vendor_visit_proposals alter column trade_vendor_id drop not null;

alter table public.vendor_visit_proposals add column if not exists source text not null default 'vendor';
alter table public.vendor_visit_proposals add column if not exists reported_by text;   -- the owner who wrote
alter table public.vendor_visit_proposals add column if not exists owner_card_id text; -- the owner card it came from

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vendor_visit_source_known') then
    alter table public.vendor_visit_proposals
      add constraint vendor_visit_source_known check (source in ('vendor', 'owner'));
  end if;
  -- A vendor row names its vendor; an owner's report has none.
  if not exists (select 1 from pg_constraint where conname = 'vendor_visit_source_vendor_id') then
    alter table public.vendor_visit_proposals
      add constraint vendor_visit_source_vendor_id check ((source = 'vendor') = (trade_vendor_id is not null));
  end if;
end $$;

comment on column public.vendor_visit_proposals.source is
  '''vendor'': a trade vendor''s text (Quo ingest). ''owner'': work an owner told us about, filed from the approved owner card (src/lib/owner-work-holds.ts).';
