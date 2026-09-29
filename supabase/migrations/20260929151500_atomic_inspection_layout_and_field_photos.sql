-- Apply before deploying the layout/field-photo actions. Additive functions only.
-- Only authenticated server actions using the service role may execute these.
create or replace function public.helm_save_inspection_layout(p_property_id text, p_item_ids uuid[])
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  perform 1 from public.properties where id = p_property_id for update;
  if not found then raise exception 'Property not found'; end if;
  if coalesce(cardinality(p_item_ids), 0) = 0
     or (select count(distinct id) from unnest(p_item_ids) id) <> cardinality(p_item_ids) then
    raise exception 'Choose at least one valid card, with no duplicates';
  end if;
  if (select count(*) from public.inspection_items
      where id = any(p_item_ids) and (property_id is null or property_id = p_property_id)) <> cardinality(p_item_ids) then
    raise exception 'A card is missing or belongs to another property. Checklist was not changed';
  end if;
  delete from public.property_inspection_cards where property_id = p_property_id;
  insert into public.property_inspection_cards(property_id, inspection_item_id, position)
    select p_property_id, id, (position - 1)::integer from unnest(p_item_ids) with ordinality as cards(id, position);
end;
$$;

create or replace function public.helm_create_inspection_card(
  p_property_id text, p_item_ids uuid[], p_request_id uuid, p_template_id uuid, p_title text, p_description text
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare item public.inspection_items%rowtype; ordered uuid[];
begin
  perform 1 from public.properties where id = p_property_id for update;
  if not found then raise exception 'Property not found'; end if;
  if p_request_id is null or p_title is null or length(btrim(p_title)) not between 1 and 120 then
    raise exception 'Invalid custom card';
  end if;
  insert into public.inspection_items(id, template_id, property_id, category, title, description, sort_order, item_category)
    values(p_request_id, p_template_id, p_property_id, 'Custom', p_title, p_description, 1000, 'EVERY_TIME')
    on conflict(id) do nothing;
  select * into item from public.inspection_items where id = p_request_id;
  if item.property_id is distinct from p_property_id or item.template_id is distinct from p_template_id
     or item.title is distinct from p_title or item.description is distinct from p_description or item.category <> 'Custom' then
    raise exception 'This card request already belongs to different content';
  end if;
  ordered := case when p_request_id = any(p_item_ids) then p_item_ids else p_item_ids || array[p_request_id] end;
  perform public.helm_save_inspection_layout(p_property_id, ordered);
  return jsonb_build_object('id', item.id, 'title', item.title, 'description', item.description, 'category', item.category);
end;
$$;

-- Append photos under the same row lock as the text edit. Retrying an uploaded
-- URL cannot duplicate it, and concurrent additions keep the existing photos.
create or replace function public.helm_edit_field_slip(
  p_slip_id uuid, p_property_id text, p_title text, p_description text, p_photo_urls text[]
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare slip public.work_slips%rowtype; merged text[];
begin
  select * into slip from public.work_slips where id = p_slip_id and property_id = p_property_id for update;
  if not found then raise exception 'Slip not found at this property'; end if;
  if slip.status in ('done', 'dismissed') then raise exception 'Slip is closed'; end if;
  if p_title is null or length(btrim(p_title)) not between 3 and 200 then raise exception 'Invalid title'; end if;
  if coalesce(cardinality(p_photo_urls), 0) > 12 or exists(select 1 from unnest(p_photo_urls) u where u is null or u !~ '^https://' or length(u) > 2000) then
    raise exception 'Invalid photos';
  end if;
  select coalesce(array_agg(url order by first_position), '{}'::text[]) into merged
    from (select url, min(position) first_position
          from unnest(coalesce(slip.photo_urls, '{}'::text[]) || coalesce(p_photo_urls, '{}'::text[])) with ordinality as photos(url, position)
          group by url) unique_photos;
  update public.work_slips set title = p_title, description = p_description, photo_urls = merged, updated_at = now()
    where id = p_slip_id;
  return jsonb_build_object('photo_urls', merged);
end;
$$;

revoke all on function public.helm_save_inspection_layout(text, uuid[]) from public, anon, authenticated;
revoke all on function public.helm_create_inspection_card(text, uuid[], uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.helm_edit_field_slip(uuid, text, text, text, text[]) from public, anon, authenticated;
grant execute on function public.helm_save_inspection_layout(text, uuid[]) to service_role;
grant execute on function public.helm_create_inspection_card(text, uuid[], uuid, uuid, text, text) to service_role;
grant execute on function public.helm_edit_field_slip(uuid, text, text, text, text[]) to service_role;
