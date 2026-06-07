import { CONFIG } from "./config.js";

// CDN에서 Supabase JS SDK를 동적으로 로드하는 헬퍼 함수
function loadSupabaseScript() {
  return new Promise((resolve, reject) => {
    if (window.supabase) {
      resolve(window.supabase);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    script.onload = () => resolve(window.supabase);
    script.onerror = () => reject(new Error("Supabase SDK 로드에 실패했습니다."));
    document.head.appendChild(script);
  });
}

let supabaseInstance = null;
export async function getSupabase() {
  if (supabaseInstance) return supabaseInstance;
  const supabaseLib = await loadSupabaseScript();
  supabaseInstance = supabaseLib.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
  window.supabaseClient = supabaseInstance; // S3 Token provider 등에서 참조할 수 있도록 전역 노출
  return supabaseInstance;
}

export function normalizeLoginId(value) {
  const LOGIN_ALIASES = {
    super: "super@yna.local",
    admin: "admin@yna.local",
    founder: "founder@yna.local",
    user: "founder@yna.local",
    ynarcher: "info@ynarcher.com",
  };
  const trimmed = String(value || "").trim();
  return LOGIN_ALIASES[trimmed] || trimmed;
}

// ----------------------------------------------------
// 실제 Supabase Auth 및 DB 연동 함수들
// ----------------------------------------------------

export async function getCurrentUser() {
  try {
    const supabase = await getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // profiles 테이블에서 권한(role) 및 회사 ID 정보 조회
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (error) throw error;
    return { id: user.id, email: user.email, profile };
  } catch (err) {
    console.error("getCurrentUser 실패:", err);
    return null;
  }
}

export async function signIn(loginId, password, remember = false) {
  const normalized = normalizeLoginId(loginId);
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalized,
    password: password,
  });

  if (error) {
    const messageMap = {
      "Invalid login credentials": "아이디 또는 비밀번호가 잘못되었습니다.",
      "Email not confirmed": "이메일 인증이 완료되지 않았습니다. 가입 시 받은 메일의 인증 링크를 확인해 주세요.",
    };
    throw new Error(messageMap[error.message] || error.message);
  }

  // 창업자의 경우 가입 승인 대기 상태 검증
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profile?.role === "founder") {
      const { data: member } = await supabase
        .from("company_members")
        .select("company_id")
        .eq("user_id", data.user.id)
        .maybeSingle();

      if (member?.company_id) {
        const { data: company } = await supabase
          .from("companies")
          .select("approval_status")
          .eq("id", member.company_id)
          .maybeSingle();

        if (company && company.approval_status !== "approved") {
          await supabase.auth.signOut();
          const blocked = new Error(
            company.approval_status === "rejected"
              ? "가입이 반려되었습니다. 관리자에게 문의해 주세요."
              : "가입 승인 대기 중입니다. 관리자 승인 후 로그인할 수 있습니다."
          );
          blocked.blocked = true;
          throw blocked;
        }
      }
    }
  } catch (profileErr) {
    if (profileErr.blocked) throw profileErr;
    // 일반 오류 발생 시 우선 로그인 허용
  }

  return { user: data.user };
}

export async function signUpFounder(input) {
  const supabase = await getSupabase();
  // Supabase Auth 회원가입.
  // 회사(companies)/소속(company_members) 생성은 클라이언트에서 직접 하지 않는다.
  // companies 에는 founder INSERT RLS 정책이 없으므로, handle_new_user
  // SECURITY DEFINER 트리거가 메타데이터를 받아 프로필+회사+소속을 원자적으로 생성한다.
  // (이메일 확인이 켜져 가입 직후 세션이 없어도 동작)
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        is_founder_signup: "true",
        name: input.founder_name,
        company_name: input.company_name,
        phone: input.phone || "",
        business_number: input.business_number || "",
        support_program_id: input.support_program_id || "",
      }
    }
  });

  if (error) throw error;
  if (!data.user) throw new Error("회원가입에 실패했습니다.");

  return { needsConfirmation: data.session === null, user: data.user };
}

export async function signOut() {
  try {
    const supabase = await getSupabase();
    await supabase.auth.signOut();
  } catch (err) {
    console.error("SignOut 에러:", err);
  }
}

export async function verifyCurrentPassword(password) {
  // Supabase Auth는 클라이언트 측에서 현재 비밀번호 검증 API를 직접 제공하지 않으므로,
  // 로그인 검증을 다시 시도하여 확인합니다.
  const user = await getCurrentUser();
  if (!user) throw new Error("로그인이 필요합니다.");
  const supabase = await getSupabase();
  const { error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: password,
  });
  if (error) throw new Error("비밀번호가 일치하지 않습니다.");
}

export async function changePassword(currentPassword, newPassword) {
  const next = String(newPassword || "");
  if (next.length < 6) throw new Error("새 비밀번호는 6자 이상이어야 합니다.");
  if (next === currentPassword) throw new Error("현재 비밀번호와 다른 비밀번호를 입력해 주세요.");

  await verifyCurrentPassword(currentPassword);
  
  const supabase = await getSupabase();
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) throw error;
  return { ok: true };
}

export async function deleteFounderAccount(password) {
  await verifyCurrentPassword(password);
  
  const user = await getCurrentUser();
  const supabase = await getSupabase();

  // 1. 소속 정보 삭제
  await supabase.from("company_members").delete().eq("user_id", user.id);
  // 2. 프로필 정보 삭제
  await supabase.from("profiles").delete().eq("id", user.id);
  // 3. 탈퇴(Auth 사용자 정보는 관리자 API 또는 Edge Function/Trigger 등으로 완전 처리가 안전하나, 
  //   여기서는 세션 종료와 프로필 정보 삭제로 우선 연동합니다.)
  await signOut();
  return { ok: true };
}

export function redirectByRole(role) {
  const isSubFolder = window.location.pathname.includes("/admin/") || window.location.pathname.includes("/founder/") || window.location.pathname.includes("/auth/");
  const base = isSubFolder ? "../" : "./";
  window.location.href = role === "admin" || role === "super_admin"
    ? `${base}admin/companies.html`
    : `${base}founder/dashboard.html`;
}

export async function requireRole(allowedRoles) {
  const user = await getCurrentUser();
  if (!user) {
    const isSubFolder = window.location.pathname.includes("/admin/") || window.location.pathname.includes("/founder/") || window.location.pathname.includes("/auth/");
    window.location.href = isSubFolder ? "../auth/login.html" : "auth/login.html";
    return null;
  }
  if (!allowedRoles.includes(user.profile.role)) {
    redirectByRole(user.profile.role);
    return null;
  }
  return user;
}

