-- Field: above-and-beyond bonus on a packet.
--
-- When an inspector does something extra at a property (or a stop runs far
-- longer than priced), the office can add a bonus on top of the agreed
-- posted_price_cents. Kept as its OWN columns rather than mutating the posted
-- price: the claim-time price stays the honest record of what was agreed, and
-- the bonus is the discretionary extra, with a reason the contractor sees.
--
-- Set from the review/approve flow (or any time before paid_at). Flows into
-- owed/paid rollups (getContractorPayStats), the paid receipt, and the
-- contractor's approved view. Helm still never moves money.

alter table public.inspection_packets
  add column if not exists bonus_cents    int  not null default 0,
  add column if not exists bonus_reason   text,
  add column if not exists bonus_by_email text;
