// 유휴(비활성) 자동 로그아웃.
// 일정 시간 동안 사용자 활동(마우스/키보드/터치/스크롤)이 없으면 자동으로 로그아웃한다.
//  - 관리자/슈퍼관리자: 30분, 창업자: 60분 (역할별 차등)
//  - 만료 2분 전 경고 모달을 띄워 "계속 이용" 기회를 준다.
//
// 현재는 mock(localStorage) 환경용이다. Supabase 전환 시:
//  - "절대 세션 만료"는 Supabase Auth(Time-box user sessions)가 담당한다.
//  - 이 "유휴 타임아웃"은 그대로 재사용한다. autoRefreshToken 이 백그라운드에서
//    토큰을 갱신하므로 '실제 사용자 활동' 기반 유휴 감지는 프론트에서만 가능하다.

import { getCurrentUser, signOut } from "../auth.js";
import { showConfirm, setPendingToast } from "../app.js";

const MINUTE = 60 * 1000;

// 역할별 유휴 제한 시간
const IDLE_LIMIT_BY_ROLE = {
  super_admin: 30 * MINUTE,
  admin: 30 * MINUTE,
  founder: 60 * MINUTE,
};
// 알 수 없는 역할은 보수적으로 가장 짧게 잡는다.
const DEFAULT_IDLE_LIMIT = 30 * MINUTE;
// 만료 N분 전에 경고 모달을 띄운다(= 경고 후 응답 대기 시간).
const WARNING_BEFORE = 2 * MINUTE;

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];

let warnTimerId = null; // 경고 모달까지의 타이머
let logoutTimerId = null; // 경고 후 강제 로그아웃까지의 타이머
let warningActive = false; // 경고 모달이 떠 있는 동안 활동에 의한 타이머 리셋을 막는다.
let started = false;

function idleLimitFor(role) {
  return IDLE_LIMIT_BY_ROLE[role] || DEFAULT_IDLE_LIMIT;
}

function clearTimers() {
  if (warnTimerId) {
    clearTimeout(warnTimerId);
    warnTimerId = null;
  }
  if (logoutTimerId) {
    clearTimeout(logoutTimerId);
    logoutTimerId = null;
  }
}

// 활동 발생 시 호출: 유휴 타이머를 처음부터 다시 건다.
// 경고 모달이 떠 있는 동안에는 무시한다(응답은 모달 버튼으로만 받는다).
function resetTimer() {
  if (warningActive) return;
  clearTimers();
  const user = getCurrentUser();
  if (!user) return; // 로그인 상태가 아니면 타이머 불필요
  const limit = idleLimitFor(user.profile?.role);
  warnTimerId = setTimeout(showIdleWarning, Math.max(0, limit - WARNING_BEFORE));
}

async function showIdleWarning() {
  warningActive = true;
  // 경고가 떠 있는 동안 응답이 없으면 WARNING_BEFORE 후 강제 로그아웃한다.
  logoutTimerId = setTimeout(() => performLogout(true), WARNING_BEFORE);

  const stay = await showConfirm(
    "장시간 활동이 없어 곧 자동으로 로그아웃됩니다. 계속 이용하시겠어요?",
    { title: "자동 로그아웃 안내", confirmText: "계속 이용", cancelText: "로그아웃" }
  );

  warningActive = false;
  if (logoutTimerId) {
    clearTimeout(logoutTimerId);
    logoutTimerId = null;
  }

  if (stay) {
    resetTimer(); // 다시 처음부터 카운트
  } else {
    performLogout(false); // 사용자가 직접 로그아웃 선택
  }
}

function performLogout(byTimeout) {
  stop(); // 리스너/타이머 정리
  signOut();
  if (byTimeout) {
    // 다음 페이지(로그인) 로드 시 안내 토스트를 표시한다.
    setPendingToast("장시간 활동이 없어 자동으로 로그아웃되었습니다.", "info");
  }
  const p = window.location.pathname;
  const isSubFolder = p.includes("/admin/") || p.includes("/founder/") || p.includes("/auth/");
  window.location.href = isSubFolder ? "../auth/login.html" : "auth/login.html";
}

// 보호 페이지 진입 시 호출(mountShell 에서). 로그인 상태일 때만 타이머를 시작한다.
// 중복 호출에 안전하다.
export function startIdleLogout() {
  if (started) return;
  if (!getCurrentUser()) return;
  started = true;
  ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, resetTimer, { passive: true }));
  resetTimer();
}

// 리스너와 타이머를 모두 제거한다(로그아웃 시 호출).
export function stop() {
  if (!started) {
    clearTimers();
    return;
  }
  started = false;
  warningActive = false;
  ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, resetTimer));
  clearTimers();
}
