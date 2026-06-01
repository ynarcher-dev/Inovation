export const CONFIG = {
  supabaseUrl: window.APP_CONFIG?.supabaseUrl || "https://kbyuumrgmovngaahycmk.supabase.co",
  supabaseAnonKey: window.APP_CONFIG?.supabaseAnonKey || "sb_publishable_IWbWxOxtH_89WfyHPWzN2w_KMVkjVKN",
  apiBaseUrl: window.APP_CONFIG?.apiBaseUrl || "/api",
};

export const hasSupabaseConfig = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
