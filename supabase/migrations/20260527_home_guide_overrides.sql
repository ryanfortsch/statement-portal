-- Per-property free-form overrides for the Stay Cape Ann "Welcome Home"
-- guide. The renderer at /properties/<id>/home-guide auto-populates the
-- six cells (Wi-Fi, Climate, Bathrooms, Parking, Kitchen, Trash) from
-- structured columns + civic defaults, but some sections need real
-- variability per property (e.g. Bathrooms and Kitchen are currently
-- hardcoded prose that applies uniformly to every home). This column
-- holds an optional plain-text override per cell; when present, the
-- renderer drops the auto-populated cell body and prints the override
-- prose (paragraphs split on blank lines).
--
-- Shape:
--   {
--     "wifi":      "...",   -- optional override for cell 01
--     "climate":   "...",   -- optional override for cell 02
--     "bathrooms": "...",   -- optional override for cell 03
--     "parking":   "...",   -- optional override for cell 04
--     "kitchen":   "...",   -- optional override for cell 05
--     "trash":     "..."    -- optional override for cell 06
--   }
--
-- Empty / missing keys fall back to the auto-populated default.

alter table public.properties
  add column if not exists home_guide_overrides jsonb;

comment on column public.properties.home_guide_overrides is
  'Per-cell plain-text overrides for the Stay Cape Ann home guide. Keys: wifi, climate, bathrooms, parking, kitchen, trash. Each value replaces the corresponding cell body in the rendered guide.';
