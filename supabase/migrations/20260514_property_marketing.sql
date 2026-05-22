-- Property marketing memory.
--
-- Durable per-property selling points the campaign AI reads on every
-- draft so it writes specific, accurate copy in the real Stay Cape Ann
-- voice instead of inventing fragments like "quiet inlet views".
--
-- Seeded from staycapeann.com's canonical listing copy (taglines +
-- descriptions, written by Dotti). Editable in Helm going forward: this
-- IS the marketing memory. When the staycapeann copy and this table
-- diverge, this table wins for campaign drafting.
--
-- on_water is called out as its own flag because waterfront is a primary
-- selling point Dotti flagged explicitly (Rocky Neck and Smith Cove are
-- directly on the water and the AI must lead with that).

create table public.property_marketing (
  property_id text primary key references public.properties(id) on delete cascade,

  -- The guest-facing one-liner positioning (verbatim staycapeann tagline).
  tagline text,

  -- The single most important hook. The AI leads with this.
  primary_selling_point text,

  -- Bullet facts the AI can pull from. Specific and true.
  selling_points text[] not null default '{}',

  -- Waterfront is a headline selling point; flag it explicitly.
  on_water boolean not null default false,

  bedrooms integer,
  sleeps integer,

  -- Who the home is best suited to ("reunions and big groups", "couples").
  best_for text,

  -- Freeform marketing memory Dotti grows over time.
  notes text,

  updated_at timestamptz default now()
);

alter table public.property_marketing enable row level security;
create policy "anyone can read property_marketing" on public.property_marketing for select using (true);
create policy "anyone can insert property_marketing" on public.property_marketing for insert with check (true);
create policy "anyone can update property_marketing" on public.property_marketing for update using (true);

create trigger property_marketing_updated_at
  before update on public.property_marketing
  for each row execute function public.update_updated_at_column();

-- ─── Seed from staycapeann.com canonical copy ────────────────────────────
insert into public.property_marketing
  (property_id, tagline, primary_selling_point, selling_points, on_water, bedrooms, sleeps, best_for)
values
  (
    '21_horton',
    'Rocky Neck, harbor-side, with a 30-foot dock and the boats going by.',
    'Right on the harbor with a private 30-foot dock',
    array['On the harbor in the Rocky Neck art colony', 'Private 30-foot dock', 'Wall-to-wall windows pull the water into every room', 'Deck looks straight at the boats coming in', 'Main house plus an attached guest house'],
    true, 3, 7, 'families and groups who want to be on the water'
  ),
  (
    '30_woodward',
    'On Little River, with a private dock and the tide for company.',
    'On the water with a private dock you can swim and kayak off',
    array['Private dock on Little River', 'Swim off it in summer, drop a kayak in at dawn', 'Fully renovated, bright and open', 'Kitchen built for big dinners'],
    true, 4, 7, 'families who want the water at the door'
  ),
  (
    '73_rocky_neck',
    'Above Smith Cove, in the middle of the Rocky Neck art colony.',
    'On Smith Cove in the heart of the Rocky Neck art colony',
    array['On the water at Smith Cove', 'Walk to the galleries, the marina, and the seafood spots', 'Art colony that has been here since the 1850s', 'Loft-style primary suite with its own bath'],
    true, 2, 7, 'couples and small families who want the art-colony feel'
  ),
  (
    '53_rocky_neck',
    'On Rocky Neck above Smith Cove, with a sailor''s-cabin interior and two decks.',
    'A one-of-a-kind sailor''s-cabin home on Rocky Neck',
    array['Built around a sailboat by the previous owner', 'Porthole doors between rooms and a real mast through the house', 'Handcrafted trim throughout', 'Primary suite plus a bunk room', 'Two decks'],
    false, 3, 7, 'families who want something unlike a standard rental'
  ),
  (
    '3_locust',
    'A short walk from Niles Beach, on Eastern Point.',
    'A three-minute walk to Niles Beach on Eastern Point',
    array['Niles Beach is three minutes on foot', 'Granite ledges and calm harbor water', 'Windows up top catch the water', 'Big yard for the whole group'],
    false, 3, 7, 'families who want a quiet beach within walking distance'
  ),
  (
    '17_beach_rd',
    'Steps from Good Harbor Beach, with a guest house off the main.',
    'Built for the reunion week, sleeps eighteen, steps from Good Harbor Beach',
    array['Steps from Good Harbor Beach', 'Main house plus an attached guest house with its own kitchen and porch', 'Four bedrooms, a bunk room, and two laundry rooms', 'Two families can keep their own routines'],
    false, 6, 18, 'reunions and large groups'
  ),
  (
    '4_brier_neck',
    'On the Brier Neck peninsula, four minutes from Good Harbor.',
    'On the Brier Neck peninsula, four minutes from Good Harbor Beach',
    array['Brier Neck peninsula juts into the water on the south side of Cape Ann', 'The sea breeze does most of the cooling in summer', 'Chef''s kitchen handles dinner for the whole house', 'Big deck'],
    false, 5, 13, 'big groups who want sea air and space'
  ),
  (
    '3_south_st',
    'Between downtown Rockport and Old Garden Beach, on a quiet block.',
    'A quiet Rockport block, walk to downtown, the harbor, and Old Garden Beach',
    array['Walk to Main Street, the harbor, and Old Garden Beach', 'Newly built but reads like a classic Rockport cottage', 'On a quiet block'],
    false, 3, 8, 'couples and families who want walkable Rockport'
  ),
  (
    '20_hammond',
    'A quiet East Gloucester block, fifteen minutes on foot to Good Harbor.',
    'A quiet East Gloucester neighborhood with walks in every direction',
    array['Neighborhood house in East Gloucester', 'Niles Beach down the road, Good Harbor over the hill', 'Patio out back', 'Table that holds the whole group'],
    false, 4, 7, 'families who want a real neighborhood'
  ),
  (
    '20_enon',
    'In North Beverly, with the Boston commuter rail at the corner.',
    'The easy edge of Cape Ann, commuter rail at the corner, forty minutes to Boston',
    array['Commuter rail station at the corner of the block', 'Forty minutes to Boston, twenty to Gloucester', 'Salem and Manchester in between', 'Oversized deck and a fenced yard'],
    false, 3, 5, 'visitors who want easy access to Boston and the North Shore'
  )
on conflict (property_id) do nothing;
