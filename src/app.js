import { signOut } from "./auth.js";
import { startIdleLogout, stop as stopIdleLogout } from "./services/session.js";
import { qsa } from "./utils.js";
import { getAdminDashboard } from "./api.js";
import { ADMIN_REVIEW_STATUSES } from "./domains/status.js";
import { isBudgetPendingReview } from "./domains/budget/budget-status.js";

// 관리자 사이드바에 노출할 메뉴별 "대기" 건수. 관리자 권한 범위(getAdminDashboard 스코프)를 그대로 따른다.
//  - 가입신청: 가입 승인 대기 기업
//  - 예산사용: 사전/최종 승인 검토 대기 지출
//  - 예산승인: 예산안/변경 검토 대기 기업
function getAdminPendingCounts() {
  try {
    const { companies = [], expenses = [] } = getAdminDashboard();
    return {
      signup: companies.filter((c) => c.approval_status === "pending").length,
      expense: expenses.filter((e) => ADMIN_REVIEW_STATUSES.includes(e.status)).length,
      budget: companies.filter((c) => isBudgetPendingReview(c.budget_status)).length,
    };
  } catch {
    return { signup: 0, expense: 0, budget: 0 };
  }
}

// 대기 건수 배지. 0건이면 표시하지 않는다(간격은 .nav a 의 flex gap 이 담당).
function navBadge(count) {
  return count > 0 ? `<span class="nav-badge" aria-label="${count}건 대기">${count}</span>` : "";
}

// 승인/반려 등으로 대기 건수가 바뀐 뒤 사이드바 배지를 다시 그린다(페이지 이동 없이 갱신).
export function updateAdminNavBadges() {
  const nav = document.querySelector("aside.sidebar .nav");
  if (!nav) return;
  const pending = getAdminPendingCounts();
  const targets = [
    ["signup-requests.html", pending.signup],
    ["expense-requests.html", pending.expense],
    ["budget-approvals.html", pending.budget],
  ];
  targets.forEach(([file, count]) => {
    const link = nav.querySelector(`a[href$="${file}"]`);
    if (!link) return;
    link.querySelector(".nav-badge")?.remove();
    link.insertAdjacentHTML("beforeend", navBadge(count));
  });
}

export function mountShell() {
  const sidebar = document.querySelector("aside.sidebar");
  if (sidebar) {
    const path = window.location.pathname;
    const filename = path.split("/").pop() || "dashboard.html";
    
    if (path.includes("/admin/")) {
      const pending = getAdminPendingCounts();
      sidebar.innerHTML = `
        <div class="brand">관리자</div>
        <nav class="nav">
          <div class="nav-category">실무관리</div>
          <a class="${filename === "companies.html" || filename === "company-detail.html" || filename === "dashboard.html" ? "active" : ""}" href="./companies.html">기업 목록</a>
          <a class="${filename === "signup-requests.html" ? "active" : ""}" href="./signup-requests.html">가입 신청 관리${navBadge(pending.signup)}</a>
          <a class="${filename === "expense-requests.html" || filename === "expense-detail.html" ? "active" : ""}" href="./expense-requests.html">예산사용 승인${navBadge(pending.expense)}</a>
          <a class="${filename === "budget-approvals.html" ? "active" : ""}" href="./budget-approvals.html">예산 승인/변경${navBadge(pending.budget)}</a>

          <div class="nav-category" style="margin-top: 8px;">운영관리</div>
          <a class="${filename === "support-programs.html" ? "active" : ""}" href="./support-programs.html">신규사업 관리</a>
          <a class="${filename === "program-management.html" ? "active" : ""}" href="./program-management.html">운영사업 관리</a>
          <a class="${filename === "ai-management.html" ? "active" : ""}" href="./ai-management.html">AI 관리</a>
          <a class="${filename === "admins.html" ? "active" : ""}" href="./admins.html">관리자 계정 관리</a>
          <button data-logout type="button">로그아웃</button>
        </nav>
      `;
    } else if (path.includes("/founder/")) {
      sidebar.innerHTML = `
        <div class="brand">사업비 집행 도우미</div>
        <nav class="nav">
          <a class="${filename === "dashboard.html" || filename === "expense-new.html" || filename === "expense-detail.html" ? "active" : ""}" href="./dashboard.html">대시보드</a>
          <a class="${filename === "profile.html" ? "active" : ""}" href="./profile.html">프로필</a>
          <button data-logout type="button">로그아웃</button>
        </nav>
      `;
    }
  }

  qsa("[data-logout]").forEach((button) => {
    button.addEventListener("click", async () => {
      stopIdleLogout(); // 유휴 타이머 정리
      await signOut();
      const isSubFolder = window.location.pathname.includes("/admin/") || window.location.pathname.includes("/founder/") || window.location.pathname.includes("/auth/");
      window.location.href = isSubFolder ? "../auth/login.html" : "auth/login.html";
    });
  });

  // reload 후 예약된 토스트가 있으면 표시한다(§6.2).
  consumePendingToast();

  // 로그인 상태라면 유휴 자동 로그아웃 타이머를 시작한다(전 보호 페이지 공통).
  startIdleLogout();
}

export function showError(error) {
  console.error(error);
  const target = document.querySelector("[data-error]");
  if (target) {
    target.hidden = false;
    target.textContent = error?.message || "처리 중 오류가 발생했습니다.";
  }
}

export function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

export async function runWithErrorBoundary(action, options = {}) {
  const button = options.button;
  try {
    if (button) button.disabled = true;
    return await action();
  } catch (error) {
    showError(error);
    return null;
  } finally {
    if (button) button.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// 공통 UX 헬퍼: 토스트 / 확인 모달 (ux-action-feedback-improvement-guide §4)
// 페이지마다 HTML 을 추가하지 않도록 컨테이너를 동적으로 만들어 재사용한다.
// ---------------------------------------------------------------------------

// 토스트 컨테이너(최초 1회 생성). aria-live=polite 로 스크린리더에 순차 안내한다.
function getToastContainer() {
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    container.setAttribute("aria-live", "polite");
    container.setAttribute("aria-atomic", "false");
    document.body.appendChild(container);
  }
  return container;
}

// 화면 우상단에 자동 소멸 토스트를 띄운다. 여러 개가 순차로 쌓인다.
//  - options.type: "success" | "info" | "warning" | "danger" (기본 info)
//  - options.duration: 표시 시간(ms, 기본 3000)
export function showToast(message, options = {}) {
  if (!message) return;
  const { type = "info", duration = 3000 } = options;
  const container = getToastContainer();
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", type === "danger" || type === "warning" ? "alert" : "status");
  toast.textContent = message;
  container.appendChild(toast);

  // 진입 애니메이션을 위해 다음 프레임에 표시 클래스를 부여한다.
  requestAnimationFrame(() => toast.classList.add("toast-show"));

  const remove = () => {
    toast.classList.remove("toast-show");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    // transition 이 동작하지 않는 환경 대비 안전 제거.
    setTimeout(() => toast.remove(), 400);
  };
  if (duration > 0) setTimeout(remove, duration);
  return toast;
}

// 확인 모달. window.confirm 을 대체하며 Promise<boolean> 을 돌려준다.
//  - options.title: 제목
//  - options.confirmText / cancelText: 버튼 라벨
//  - options.tone: "danger" 면 확인 버튼을 위험(빨강) 톤으로
export function showConfirm(message, options = {}) {
  const {
    title = "확인",
    confirmText = "확인",
    cancelText = "취소",
    tone = "default",
  } = options;

  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop ux-confirm-backdrop";

    const confirmBtnClass = tone === "danger" ? "button modal-danger" : "button";
    backdrop.innerHTML = `
      <div class="modal ux-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="ux-confirm-title">
        <h3 class="modal-title" id="ux-confirm-title"></h3>
        <p class="ux-confirm-message"></p>
        <div class="modal-actions">
          <button type="button" class="button secondary" data-confirm-cancel></button>
          <button type="button" class="${confirmBtnClass}" data-confirm-ok></button>
        </div>
      </div>`;

    // 사용자 입력값은 textContent 로 넣어 XSS 를 방지한다.
    backdrop.querySelector(".modal-title").textContent = title;
    backdrop.querySelector(".ux-confirm-message").textContent = message;
    const okBtn = backdrop.querySelector("[data-confirm-ok]");
    const cancelBtn = backdrop.querySelector("[data-confirm-cancel]");
    okBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;

    document.body.appendChild(backdrop);
    okBtn.focus();

    const cleanup = (result) => {
      document.removeEventListener("keydown", onKeydown, true);
      backdrop.remove();
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
      resolve(result);
    };

    // 모달 안에 포커스를 가둔다(간단한 focus trap). Escape 로 취소, Enter 로 확인.
    const onKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cleanup(false);
      } else if (event.key === "Tab") {
        const focusable = [cancelBtn, okBtn];
        const idx = focusable.indexOf(document.activeElement);
        event.preventDefault();
        const dir = event.shiftKey ? -1 : 1;
        const next = focusable[(idx + dir + focusable.length) % focusable.length];
        next.focus();
      }
    };
    document.addEventListener("keydown", onKeydown, true);

    okBtn.addEventListener("click", () => cleanup(true));
    cancelBtn.addEventListener("click", () => cleanup(false));
    // 배경(backdrop) 클릭 시 취소.
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) cleanup(false);
    });
  });
}

// 페이지 reload 후 직전에 예약해 둔 토스트를 소비한다(§6.2).
// sessionStorage 에 "toast:next"(메시지) / "toast:next:type"(유형)을 담아두면 다음 로드에서 표시한다.
export function consumePendingToast() {
  const message = sessionStorage.getItem("toast:next");
  if (!message) return;
  const type = sessionStorage.getItem("toast:next:type") || "success";
  sessionStorage.removeItem("toast:next");
  sessionStorage.removeItem("toast:next:type");
  showToast(message, { type });
}

// reload 직전에 다음 토스트를 예약한다.
export function setPendingToast(message, type = "success") {
  sessionStorage.setItem("toast:next", message);
  sessionStorage.setItem("toast:next:type", type);
}
