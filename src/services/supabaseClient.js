import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

let supabase = null

export const isCloudConfigured = () => {
  return Boolean(supabaseUrl && supabaseAnonKey)
}

export const getSupabaseClient = () => {
  if (!isCloudConfigured()) return null
  if (!supabase) {
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    })
  }
  return supabase
}
