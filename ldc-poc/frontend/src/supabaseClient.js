import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn('UEZ Supabase environment variables are not configured yet.');
}

const supabase = createClient(url || 'https://example.supabase.co', anonKey || 'placeholder');
export { supabase };
export default supabase;
