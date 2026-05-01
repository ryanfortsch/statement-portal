/**
 * Minimal types for the slice of the Perfection (Lovable) schema that Helm
 * reads. This is intentionally NOT a copy of Perfection's auto-generated
 * types.ts (which is ~2000 lines for 38 tables). We add to this as we port
 * more modules.
 */

export type PerfectionProperty = {
  id: string;
  name: string | null;
  nickname: string | null;
  address: string;
  code: string | null;
  title: string | null;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
  activated_at: string | null;
  deactivated_at: string | null;
  deactivated_reason: string | null;
  management_fee_pct: number | null;
  cleaning_cost_estimate: number | null;
  is_rising_tide_owned: boolean;
  guesty_listing_id: string | null;
  tags: string | null;
  type_of_unit: string | null;
  timezone: string | null;
  created_at: string | null;
  last_synced_at: string | null;
};
