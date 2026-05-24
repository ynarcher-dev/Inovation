import { getSupabase } from "./supabaseClient.js";

const LOGIN_ALIASES = {
  admin: "admin@yna.local",
  founder: "founder@yna.local",
  user: "founder@yna.local",
};

export function normalizeLoginId(value) {
  const trimmed = String(value || "").trim();
  return LOGIN_ALIASES[trimmed] || trimmed;
}

export async function getCurrentUser() {
  const supabase = await getSupabase();
  if (!supabase) return null;

  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData.session?.user;
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (error) throw error;
  return { ...user, profile };
}

async function ensureFounderRegistration(supabase, user) {
  const { data: existingProfile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (existingProfile) return;

  const metadata = user.user_metadata || {};
  if (!metadata.company_name || !metadata.founder_name) return;

  const { error } = await supabase.rpc("register_founder_company", {
    founder_name: metadata.founder_name,
    company_name: metadata.company_name,
    business_number: metadata.business_number || null,
    phone: metadata.phone || null,
  });
  if (error) throw error;
}

export async function signIn(loginId, password) {
  const supabase = await getSupabase();
  if (!supabase) throw new Error("Supabase 설정이 필요합니다.");
  const email = normalizeLoginId(loginId);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (data.user) await ensureFounderRegistration(supabase, data.user);
  return data;
}

export async function signUpFounder(input) {
  const supabase = await getSupabase();
  if (!supabase) throw new Error("Supabase 설정이 필요합니다.");

  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        founder_name: input.founder_name,
        company_name: input.company_name,
        business_number: input.business_number || "",
        phone: input.phone || "",
      },
    },
  });
  if (error) throw error;

  if (!data.session) {
    return {
      needsConfirmation: true,
      message: "가입 확인 메일을 확인한 뒤 로그인해 주세요.",
    };
  }

  const { error: registerError } = await supabase.rpc("register_founder_company", {
    founder_name: input.founder_name,
    company_name: input.company_name,
    business_number: input.business_number || null,
    phone: input.phone || null,
  });
  if (registerError) throw registerError;

  return { needsConfirmation: false };
}

export async function signOut() {
  const supabase = await getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
}

export function redirectByRole(role) {
  window.location.href = role === "admin" || role === "super_admin"
    ? "/admin/dashboard.html"
    : "/founder/dashboard.html";
}

export async function requireRole(allowedRoles) {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = "/login.html";
    return null;
  }
  if (!allowedRoles.includes(user.profile.role)) {
    redirectByRole(user.profile.role);
    return null;
  }
  return user;
}
