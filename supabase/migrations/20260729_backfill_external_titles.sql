-- Backfill external-facing listing titles (properties.title) from Stay Cape Ann.
-- Guest deliverables (home guide "We're glad you're here at ...") prefer
-- properties.title and only fall back to the internal name when it's null;
-- these five SCA-listed properties were missing theirs.
-- Names verified against staycapeann.com stay pages on 2026-07-29:
--   17 Beach Rd  -> Good Harbor Beach (stays/695d5c8afb0a0500153d5d1c)
--   84 Thatcher  -> Good Harbor Beach (stays/6a426ea57c49910013b37ea0)
--   4 Brier Neck -> Good Harbor Beach (stays/668c635d25b8180012fd30b7)
--   36 Granite   -> Back Beach       (stays/6a15c44dcfc6510014964e06)
--   79 Main      -> Front Beach      (stays/6a15a22e15ed3c002357cdd2)
-- title is display-only in Helm (no matching keys on it), so the three
-- identical Good Harbor Beach titles are fine.

update properties set title = 'Stay at Good Harbor Beach'
  where id in ('17_beach_rd', '84_thatcher', '4_brier_neck') and title is null;

update properties set title = 'Stay at Back Beach'
  where id = '36_granite' and title is null;

update properties set title = 'Stay at Front Beach'
  where id = '79_main' and title is null;
