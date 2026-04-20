import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase: SupabaseClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder'
);

export const isConfigured = !!supabaseUrl && !!supabaseAnonKey;
export const debugInfo = { url: supabaseUrl, keyPrefix: supabaseAnonKey?.substring(0, 10) || 'empty' };
