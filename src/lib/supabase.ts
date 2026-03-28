import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabaseUrl.startsWith('https://') && supabaseAnonKey,
)

let _client: SupabaseClient | null = null
if (isSupabaseConfigured) {
  try {
    _client = createClient(supabaseUrl!, supabaseAnonKey!)
  } catch (err) {
    console.error('Supabase init failed:', err)
  }
}

export const supabase = _client
