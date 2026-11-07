import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://pjypexeylwnaymenjfhm.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_-Hz6vp8vIfUPDNWz-bpaog_kzvASTHi'

export const isSupabaseConfigured = () => {
  return Boolean(supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('placeholder'))
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

