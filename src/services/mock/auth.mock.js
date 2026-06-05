// Mock 인증: 현재 사용자/로그인/회원가입/로그아웃/비밀번호/탈퇴.
import {
  STORAGE_KEYS,
  load,
  save,
  uuid,
  saveCurrentUser,
  loadCurrentUser,
  clearCurrentUser,
} from "./storage.mock.js";

// ----------------------------------------------------
// Mock Auth Functions
// ----------------------------------------------------
export function mockGetCurrentUser() {
  const user = loadCurrentUser();
  if (!user) return null;
  const profiles = load(STORAGE_KEYS.PROFILES, []);
  const profile = profiles.find((p) => p.user_id === user.id) || { role: "founder", name: "임시" };
  return { ...user, profile };
}

// remember: "로그인 유지" 체크 여부. true 면 localStorage(영구), false 면 sessionStorage(탭 종료 시 만료).
export function mockSignIn(loginId, password, remember = false) {
  const users = load(STORAGE_KEYS.USERS, []);
  const normalized = String(loginId || "").trim();
  const email = normalized === "super" ? "super@yna.local" : normalized === "admin" ? "admin@yna.local" : normalized === "founder" ? "founder@yna.local" : normalized;
  
  const user = users.find((u) => u.email === email && u.password === password);
  if (!user) throw new Error("아이디 또는 비밀번호가 잘못되었습니다.");

  // 창업자는 가입 승인 전/반려 상태에서 로그인을 차단한다. (관리자는 예외)
  const profiles = load(STORAGE_KEYS.PROFILES, []);
  const profile = profiles.find((p) => p.user_id === user.id);
  if (profile?.role === "founder") {
    const members = load(STORAGE_KEYS.MEMBERS, []);
    const member = members.find((m) => m.user_id === user.id);
    const companies = load(STORAGE_KEYS.COMPANIES, []);
    const company = companies.find((c) => c.id === member?.company_id);
    if (company && company.approval_status !== "approved") {
      const blocked = new Error(
        company.approval_status === "rejected"
          ? "가입이 반려되었습니다. 관리자에게 문의해 주세요."
          : "가입 승인 대기 중입니다. 관리자 승인 후 로그인할 수 있습니다."
      );
      blocked.blocked = true; // 로그인 페이지에서 얼럿으로 안내
      throw blocked;
    }
  }

  saveCurrentUser(user, remember);
  return { user };
}

export function mockSignUpFounder(input) {
  const users = load(STORAGE_KEYS.USERS, []);
  if (users.find((u) => u.email === input.email)) {
    throw new Error("이미 사용 중인 이메일 주소입니다.");
  }
  const newUserId = uuid();
  const newUser = { id: newUserId, email: input.email, password: input.password, raw_user_meta_data: input };
  users.push(newUser);
  save(STORAGE_KEYS.USERS, users);

  // Create Company (Pending status)
  const companies = load(STORAGE_KEYS.COMPANIES, []);
  const newCompanyId = uuid();
  companies.push({
    id: newCompanyId,
    name: input.company_name,
    representative_name: input.founder_name,
    business_number: input.business_number || "",
    support_total_amount: 0,
    self_payment_required_amount: 0,
    self_payment_paid: false,
    support_program_id: input.support_program_id,
    created_at: new Date().toISOString(),
    approval_status: "pending", // 가입 승인 대기
    budget_status: "not_submitted", // 예산안 미제출
  });
  save(STORAGE_KEYS.COMPANIES, companies);

  // Create Profile
  const profiles = load(STORAGE_KEYS.PROFILES, []);
  profiles.push({
    id: uuid(),
    user_id: newUserId,
    role: "founder",
    name: input.founder_name,
    company_name: input.company_name,
    phone: input.phone || "",
  });
  save(STORAGE_KEYS.PROFILES, profiles);

  // Create Member
  const members = load(STORAGE_KEYS.MEMBERS, []);
  members.push({ id: uuid(), company_id: newCompanyId, user_id: newUserId, member_role: "owner" });
  save(STORAGE_KEYS.MEMBERS, members);

  return { needsConfirmation: false, user: newUser };
}

export function mockSignOut() {
  clearCurrentUser();
}

export function mockVerifyCurrentPassword(password) {
  const currentUser = mockGetCurrentUser();
  if (!currentUser) throw new Error("로그인이 필요합니다.");
  const users = load(STORAGE_KEYS.USERS, []);
  const user = users.find((u) => u.id === currentUser.id);
  if (!user || user.password !== password) throw new Error("비밀번호가 일치하지 않습니다.");
}

// 현재 비밀번호 확인 후 새 비밀번호로 교체한다.
export function mockChangePassword(currentPassword, newPassword) {
  const currentUser = mockGetCurrentUser();
  if (!currentUser) throw new Error("로그인이 필요합니다.");
  const next = String(newPassword || "");
  if (next.length < 6) throw new Error("새 비밀번호는 6자 이상이어야 합니다.");
  if (next === currentPassword) throw new Error("현재 비밀번호와 다른 비밀번호를 입력해 주세요.");

  const users = load(STORAGE_KEYS.USERS, []);
  const idx = users.findIndex((u) => u.id === currentUser.id);
  if (idx === -1 || users[idx].password !== currentPassword) {
    throw new Error("현재 비밀번호가 일치하지 않습니다.");
  }
  users[idx].password = next;
  save(STORAGE_KEYS.USERS, users);
  return { ok: true };
}

// 회원 탈퇴(창업자). 비밀번호 확인 후 계정·프로필·소속 정보를 제거하고 로그아웃한다.
// 기업 레코드 및 관련 집행 데이터는 보존한다(관리자 정리 대상).
export function mockDeleteFounderAccount(password) {
  const currentUser = mockGetCurrentUser();
  if (!currentUser) throw new Error("로그인이 필요합니다.");

  const users = load(STORAGE_KEYS.USERS, []);
  const user = users.find((u) => u.id === currentUser.id);
  if (!user || user.password !== password) throw new Error("비밀번호가 일치하지 않습니다.");

  save(STORAGE_KEYS.USERS, users.filter((u) => u.id !== currentUser.id));

  const profiles = load(STORAGE_KEYS.PROFILES, []);
  save(STORAGE_KEYS.PROFILES, profiles.filter((p) => p.user_id !== currentUser.id));

  const members = load(STORAGE_KEYS.MEMBERS, []);
  save(STORAGE_KEYS.MEMBERS, members.filter((m) => m.user_id !== currentUser.id));

  mockSignOut();
  return { ok: true };
}
