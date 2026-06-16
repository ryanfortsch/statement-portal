-- Write policies for inspection_items.
--
-- The layout editor's "write your own" card mints a property-scoped
-- inspection_items row via the anon client (createCustomItem). But the
-- table only ever had a SELECT policy — at seed time items were inserted
-- by migrations (which bypass RLS), and nothing inserted at runtime until
-- custom cards existed. So the insert was silently denied by RLS and the
-- Add Card button appeared to do nothing.
--
-- Add insert/update/delete, consistent with the rest of the (permissive,
-- route-gated) inspection schema — see the RLS note in
-- 20260430_create_inspections.sql.

create policy "anyone can insert inspection_items"
  on public.inspection_items for insert with check (true);
create policy "anyone can update inspection_items"
  on public.inspection_items for update using (true);
create policy "anyone can delete inspection_items"
  on public.inspection_items for delete using (true);
