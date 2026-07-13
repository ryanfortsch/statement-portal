-- Core Kitchen Supplies: card subtext also covers the coffee pod holder.
UPDATE inspection_items
SET description = 'Confirm presence of trash bags, sponges, dish soap or dishwasher detergent, and paper towels. Confirm the coffee pod holder is stocked.'
WHERE title = 'Core Kitchen Supplies'
  AND property_id IS NULL;
