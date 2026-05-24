import { CONFIG, hasSupabaseConfig } from "./config.js";

let clientPromise;

export async function getSupabase() {
  if (!hasSupabaseConfig) return null;
  if (!clientPromise) {
    clientPromise = import("https://esm.sh/@supabase/supabase-js@2").then(({ createClient }) =>
      createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey)
    );
  }
  return clientPromise;
}

