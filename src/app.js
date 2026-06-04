import { signOut } from "./auth.js";
import { qsa } from "./utils.js";

export function mountShell() {
  const sidebar = document.querySelector("aside.sidebar");
  if (sidebar) {
    const path = window.location.pathname;
    const filename = path.split("/").pop() || "dashboard.html";
    
    if (path.includes("/admin/")) {
      sidebar.innerHTML = `
        <div class="brand">관리자</div>
        <nav class="nav">
          <div class="nav-category">실무관리</div>
          <a class="${filename === "dashboard.html" ? "active" : ""}" href="./dashboard.html">대시보드</a>
          <a class="${filename === "companies.html" || filename === "company-detail.html" ? "active" : ""}" href="./companies.html">기업 목록</a>
          <a class="${filename === "signup-requests.html" ? "active" : ""}" href="./signup-requests.html">가입 신청 관리</a>
          <a class="${filename === "expense-requests.html" || filename === "expense-detail.html" ? "active" : ""}" href="./expense-requests.html">예산사용 승인</a>
          <a class="${filename === "budget-approvals.html" ? "active" : ""}" href="./budget-approvals.html">예산 승인/변경</a>

          <div class="nav-category" style="margin-top: 8px;">운영관리</div>
          <a class="${filename === "support-programs.html" ? "active" : ""}" href="./support-programs.html">신규사업 관리</a>
          <a class="${filename === "program-management.html" ? "active" : ""}" href="./program-management.html">운영사업 관리</a>
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

