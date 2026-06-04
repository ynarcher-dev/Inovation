// Mock 관리자 계정 관리: 관리자(admin/super_admin) 계정 목록·추가·삭제·비밀번호 초기화·사업 권한 배정.
// USERS + PROFILES 테이블을 함께 다룬다. 권한(누가 무엇을 할 수 있는지)은 페이지에서 가드한다.
// 사업 권한: 일반관리자(admin)는 프로필의 program_ids 에 배정된 참가 사업만 보고 관리한다(1:n).
//            슈퍼관리자(super_admin)는 program_ids 와 무관하게 전체 사업에 접근한다.
import { STORAGE_KEYS, load, save, uuid } from "./storage.mock.js";
import { mockGetCurrentUser } from "./auth.mock.js";

const ADMIN_ROLES = ["admin", "super_admin"];

// 관리자 계정 목록(프로필 + 로그인 이메일). 슈퍼관리자 → 관리자 순으로 정렬한다.
export function mockGetAdminAccounts() {
  const profiles = load(STORAGE_KEYS.PROFILES, []);
  const users = load(STORAGE_KEYS.USERS, []);
  return profiles
    .filter((p) => ADMIN_ROLES.includes(p.role))
    .map((p) => {
      const user = users.find((u) => u.id === p.user_id);
      return {
        user_id: p.user_id,
        profile_id: p.id,
        name: p.name || user?.raw_user_meta_data?.name || "",
        email: user?.email || "",
        role: p.role,
        program_ids: Array.isArray(p.program_ids) ? p.program_ids : [],
      };
    })
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === "super_admin" ? -1 : 1;
      return a.name.localeCompare(b.name, "ko");
    });
}

// 새 관리자 계정 생성. 생성되는 계정의 역할은 항상 "admin"이다.
export function mockCreateAdminAccount(input) {
  const name = String(input?.name || "").trim();
  const email = String(input?.email || "").trim().toLowerCase();
  const password = String(input?.password || "");

  if (!name) throw new Error("관리자 이름을 입력해 주세요.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("올바른 로그인 이메일을 입력해 주세요.");
  if (password.length < 6) throw new Error("비밀번호는 6자 이상이어야 합니다.");

  const users = load(STORAGE_KEYS.USERS, []);
  if (users.some((u) => u.email === email)) throw new Error("이미 사용 중인 이메일 주소입니다.");

  const newUserId = uuid();
  users.push({ id: newUserId, email, password, raw_user_meta_data: { name } });
  save(STORAGE_KEYS.USERS, users);

  const profiles = load(STORAGE_KEYS.PROFILES, []);
  profiles.push({ id: uuid(), user_id: newUserId, role: "admin", name, program_ids: [] });
  save(STORAGE_KEYS.PROFILES, profiles);

  return { ok: true, user_id: newUserId };
}

// 일반관리자에게 관리할 참가 사업(program_ids)을 배정한다(슈퍼관리자 전용 동작).
export function mockUpdateAdminPrograms(targetUserId, programIds) {
  const ids = Array.isArray(programIds) ? [...new Set(programIds.filter(Boolean))] : [];
  const profiles = load(STORAGE_KEYS.PROFILES, []);
  const idx = profiles.findIndex((p) => p.user_id === targetUserId);
  if (idx === -1 || !ADMIN_ROLES.includes(profiles[idx].role)) throw new Error("관리자 계정을 찾을 수 없습니다.");
  if (profiles[idx].role === "super_admin") throw new Error("슈퍼관리자는 모든 사업에 접근하므로 배정이 필요 없습니다.");
  profiles[idx].program_ids = ids;
  save(STORAGE_KEYS.PROFILES, profiles);
  return { ok: true };
}

// 현재 로그인한 관리자가 접근 가능한 사업 범위.
//  - 일반관리자(admin)  → 배정된 program_ids 배열(미배정이면 빈 배열 = 접근 사업 없음)
//  - 그 외(super_admin/founder/비로그인) → null(범위 제한 없음)
export function mockGetCurrentAdminProgramScope() {
  const user = mockGetCurrentUser();
  if (user?.profile?.role === "admin") {
    return Array.isArray(user.profile.program_ids) ? user.profile.program_ids : [];
  }
  return null;
}

// 현재 관리자가 특정 사업에 접근 가능한지 여부.
export function mockAdminCanAccessProgram(programId) {
  const scope = mockGetCurrentAdminProgramScope();
  return scope === null || scope.includes(programId);
}

// 관리자 계정 삭제(슈퍼관리자 전용 동작). 본인 계정과 마지막 슈퍼관리자는 삭제할 수 없다.
export function mockDeleteAdminAccount(actorUserId, targetUserId) {
  if (actorUserId === targetUserId) throw new Error("본인 계정은 삭제할 수 없습니다.");

  const profiles = load(STORAGE_KEYS.PROFILES, []);
  const target = profiles.find((p) => p.user_id === targetUserId);
  if (!target || !ADMIN_ROLES.includes(target.role)) throw new Error("관리자 계정을 찾을 수 없습니다.");

  if (target.role === "super_admin") {
    const superCount = profiles.filter((p) => p.role === "super_admin").length;
    if (superCount <= 1) throw new Error("마지막 슈퍼관리자 계정은 삭제할 수 없습니다.");
  }

  const users = load(STORAGE_KEYS.USERS, []);
  save(STORAGE_KEYS.USERS, users.filter((u) => u.id !== targetUserId));
  save(STORAGE_KEYS.PROFILES, profiles.filter((p) => p.user_id !== targetUserId));
  return { ok: true };
}

// 관리자 비밀번호 초기화(슈퍼관리자 전용 동작).
export function mockResetAdminPassword(targetUserId, newPassword) {
  const next = String(newPassword || "");
  if (next.length < 6) throw new Error("새 비밀번호는 6자 이상이어야 합니다.");

  const users = load(STORAGE_KEYS.USERS, []);
  const idx = users.findIndex((u) => u.id === targetUserId);
  if (idx === -1) throw new Error("관리자 계정을 찾을 수 없습니다.");

  users[idx].password = next;
  save(STORAGE_KEYS.USERS, users);
  return { ok: true };
}
