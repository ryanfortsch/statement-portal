-- Recategorize auto-created restock slips to 'inventory'. Every slip
-- with a from_supply_key came from the inspection Supplies Check and is
-- unambiguously inventory; before this they carried 'rising_tide', so
-- their category badge read "Rising Tide" on the detail page. They
-- already behaved as supplies via from_supply_key — this just makes the
-- stored category honest. Manually-titled "Restock: …" slips without a
-- from_supply_key are left alone (the board's isSupplySlip fallback
-- still surfaces them; we don't want to reclassify hand-entered rows).

update public.work_slips
  set category = 'inventory'
  where from_supply_key is not null
    and category = 'rising_tide';
