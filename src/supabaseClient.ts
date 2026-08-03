import { createClient } from '@supabase/supabase-js';

// Lấy biến môi trường khai báo từ Railway
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Thiếu cấu hình VITE_SUPABASE_URL hoặc VITE_SUPABASE_ANON_KEY trong môi trường!");
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');
