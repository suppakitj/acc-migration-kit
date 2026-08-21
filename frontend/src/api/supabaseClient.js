import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client เดียวของแอป
 * ค่า env มาจาก .env.local:
 *   VITE_SUPABASE_URL=https://acc.example.co.th
 *   VITE_SUPABASE_ANON_KEY=eyJ...
 */
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,  // จำเป็นสำหรับลิงก์ recovery/invite (ตั้งรหัสผ่าน)
      flowType: 'pkce',
      storageKey: 'acc-auth',
    },
    global: {
      headers: { 'x-client-info': 'acc-operation-system' },
    },
  }
);
