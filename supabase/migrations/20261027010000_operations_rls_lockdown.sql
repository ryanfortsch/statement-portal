-- Stage 2: apply only after the companion server-client changes are deployed.
-- Drain older deployments first (production skew protection is 12 hours).
-- A code rollback to an older anonymous-client deployment needs a forward fix;
-- do not restore permissive policies as an automatic rollback.
-- Helm uses Auth.js sessions, not Supabase authenticated-role sessions.
-- Public market_metrics_monthly reads are intentional and remain unchanged.
-- No business rows are read, changed, or deleted by this migration.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'audience_events',
    'cleaner_phones',
    'cleaning_completions',
    'close_tasks',
    'competitor_listing_events',
    'competitor_listing_overrides',
    'competitor_listings_current',
    'email_triage',
    'guesty_listings',
    'home_feed_dismissals',
    'inspection_items',
    'inspection_plans',
    'inspections',
    'lock_events',
    'marketing_conversions_daily',
    'marketing_sites',
    'marketing_speed_insights_daily',
    'marketing_top_pages_daily',
    'marketing_top_sources_daily',
    'marketing_traffic_daily',
    'marketing_unknown_landings_daily',
    'playbook_entries',
    'playbook_revisions',
    'property_documents',
    'property_inspection_cards',
    'property_launch_steps',
    'property_notes',
    'property_notices',
    'quo_events',
    'quo_unknown_numbers',
    'sca_launches',
    'sync_status',
    'task_comments',
    'tasks',
    'turnover_completions',
    'work_slip_comments',
    'work_slips'
  ] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION 'Expected security-audit table public.% is missing', table_name;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', table_name);
    FOR policy_name IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = table_name
        AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_name, table_name);
    END LOOP;
  END LOOP;
END $$;

-- This view otherwise runs with its creator's permissions.
ALTER VIEW public.property_launch_progress SET (security_invoker = true);
REVOKE ALL ON TABLE public.property_launch_progress FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.property_launch_progress TO service_role;
COMMIT;
