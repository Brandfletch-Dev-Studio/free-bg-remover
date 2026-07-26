import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://cxfebvtsuzcbkpzezqom.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN4ZmVidnRzdXpjYmtwemV6cW9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwMTk2NzQsImV4cCI6MjA5NzU5NTY3NH0.sGKXAZJayUx4IQ8pwnEPANA3rWW1NJa1x-pbRLgU5IQ';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
