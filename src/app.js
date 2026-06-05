import { signOut } from "./auth.js";
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
      await signOut();
      const isSubFolder = window.location.pathname.includes("/admin/") || window.location.pathname.includes("/founder/") || window.location.pathname.includes("/auth/");
      window.location.href = isSubFolder ? "../auth/login.html" : "auth/login.html";
    });
  });
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
