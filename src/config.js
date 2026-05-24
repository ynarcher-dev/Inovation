export const CONFIG = {
  supabaseUrl: window.APP_CONFIG?.supabaseUrl || "https://vqdftooqzpmkqboztasc.supabase.co",
  supabaseAnonKey: window.APP_CONFIG?.supabaseAnonKey || "sb_publishable_621F6vVLGX6dMZ4utkrwCg_h81iwhYJ",
  apiBaseUrl: window.APP_CONFIG?.apiBaseUrl || "/api",
};

export const hasSupabaseConfig = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
