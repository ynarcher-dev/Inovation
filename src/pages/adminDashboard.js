import { mountShell, runWithErrorBoundary, showError, setText } from "../app.js";
import { requireRole } from "../auth.js";
import { approveCompany, getAdminDashboard, rejectCompany } from "../api.js";
import { getBudgetStatusLabel } from "../budgetStatus.js";
import { escapeHtml, formatCurrency, formatDate } from "../utils.js";

// 가입 승인 상태 라벨
const approvalText = {
  pending: "가입 승인 대기",
  approved: "가입 승인 완료",
  rejected: "가입 반려",
};

// 예산 승인 완료로 보는 상태
const BUDGET_APPROVED_STATUSES = ["budget_approved", "change_approved"];
// 예산(예산안/변경) 검토 대기 상태
const BUDGET_PENDING_STATUSES = ["budget_submitted", "change_submitted"];
// 예산 사용(지출 사전승인) 검토 대기 상태
const EXPENSE_PENDING_STATUSES = ["pre_approval_submitted"];

const companyDetailHref = (id) => `company-detail.html?id=${encodeURIComponent(id)}`;
const expenseDetailHref = (id) => `expense-detail.html?id=${encodeURIComponent(id)}`;

// ── 1. 전체 통계 ─────────────────────────────────────
function renderStatsSection({ companies, supportPrograms, companyCount }) {
  const activePrograms = (supportPrograms || []).filter((p) => p.active !== false).length;
  const signupApproved = companies.filter((c) => c.approval_status === "approved").length;
  const budgetApproved = companies.filter((c) => BUDGET_APPROVED_STATUSES.includes(c.budget_status)).length;

  const cards = [
    { label: "전체 기업 수", value: companyCount ?? companies.length },
    { label: "진행 중인 사업 수", value: activePrograms },
    { label: "가입 승인 완료 기업 수", value: signupApproved },
    { label: "예산 승인 완료 기업 수", value: budgetApproved },
  ];

  document.querySelector("[data-stats-section]").innerHTML = cards
    .map((card) => `<div class="card metric"><span>${escapeHtml(card.label)}</span><strong>${card.value}</strong></div>`)
    .join("");
}

// ── 2. 가입 승인 ─────────────────────────────────────
function renderSignupApprovalSection(companies) {
  const pending = companies.filter((c) => c.approval_status === "pending");
  const target = document.querySelector("[data-signup-approval-section]");

  if (!pending.length) {
    target.innerHTML = `<p class="empty">가입 승인 대기 중인 기업이 없습니다.</p>`;
    return;
  }

  target.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>기업명</th><th>대표자</th><th>참가 사업</th><th>신청일</th><th>상태</th><th>처리</th></tr>
        </thead>
        <tbody>
          ${pending.map((c) => `
            <tr>
              <td><a href="${companyDetailHref(c.id)}">${escapeHtml(c.name)}</a></td>
              <td>${escapeHtml(c.representative_name || "-")}</td>
              <td>${escapeHtml(c.support_programs?.name || "-")}</td>
              <td>${formatDate(c.created_at)}</td>
              <td>${escapeHtml(approvalText[c.approval_status] || c.approval_status || "-")}</td>
              <td>
                <div class="actions">
                  <button class="button small" type="button" data-approve-company="${escapeHtml(c.id)}">승인</button>
                  <button class="button small danger" type="button" data-reject-company="${escapeHtml(c.id)}">반려</button>
                  <a class="button small secondary" href="${companyDetailHref(c.id)}">상세 보기</a>
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ── 3. 예산 승인 ─────────────────────────────────────
function renderBudgetApprovalSection(companies) {
  const pending = companies.filter((c) => BUDGET_PENDING_STATUSES.includes(c.budget_status));
  const target = document.querySelector("[data-budget-approval-section]");

  if (!pending.length) {
    target.innerHTML = `<p class="empty">검토 대기 중인 예산 요청이 없습니다.</p>`;
    return;
  }

  target.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>기업명</th><th>참가 사업</th><th>요청 유형</th><th>제출일</th><th>요청 사유</th><th>상태</th><th>처리</th></tr>
        </thead>
        <tbody>
          ${pending.map((c) => {
            const isChange = c.budget_status === "change_submitted";
            const submission = c.pendingBudgetSubmission;
            return `
              <tr>
                <td>${escapeHtml(c.name)}</td>
                <td>${escapeHtml(c.support_programs?.name || "-")}</td>
                <td>${isChange ? "예산 변경" : "최초 예산안"}</td>
                <td>${submission?.submitted_at ? formatDate(submission.submitted_at) : "-"}</td>
                <td>${escapeHtml(submission?.reason || "-")}</td>
                <td>${escapeHtml(getBudgetStatusLabel(c.budget_status))}</td>
                <td><a class="button small" href="${companyDetailHref(c.id)}">검토하기</a></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ── 4. 예산 사용 승인 (지출 사전승인) ────────────────
function renderExpenseApprovalSection(expenses) {
  const pending = (expenses || []).filter((e) => EXPENSE_PENDING_STATUSES.includes(e.status));
  const target = document.querySelector("[data-expense-approval-section]");

  if (!pending.length) {
    target.innerHTML = `<p class="empty">검토 대기 중인 예산 사용 신청이 없습니다.</p>`;
    return;
  }

  target.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>기업명</th><th>신청 제목</th><th>비목</th><th>공급가액</th><th>제출일</th><th>처리</th></tr>
        </thead>
        <tbody>
          ${pending.map((e) => `
            <tr>
              <td>${escapeHtml(e.company_name || "-")}</td>
              <td>${escapeHtml(e.title || "-")}</td>
              <td>${escapeHtml(e.budget_category || "-")}</td>
              <td>${formatCurrency(e.amount_supply)}</td>
              <td>${e.submitted_at ? formatDate(e.submitted_at) : "-"}</td>
              <td><a class="button small" href="${expenseDetailHref(e.id)}">검토하기</a></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// 가입 승인/반려 처리 동작 바인딩
function bindSignupActions(user, reload) {
  document.querySelectorAll("[data-approve-company]").forEach((button) => {
    button.addEventListener("click", async () => {
      await runWithErrorBoundary(async () => {
        await approveCompany(button.dataset.approveCompany, user.id);
        await reload();
      }, { button });
    });
  });

  document.querySelectorAll("[data-reject-company]").forEach((button) => {
    button.addEventListener("click", async () => {
      const reason = window.prompt("반려 사유를 입력하세요. (선택)") ?? "";
      await runWithErrorBoundary(async () => {
        await rejectCompany(button.dataset.rejectCompany, reason);
        await reload();
      }, { button });
    });
  });
}

try {
  mountShell();
  const user = await requireRole(["admin", "super_admin"]);
  if (user) {
    let dashboard = await getAdminDashboard();

    const render = () => {
      const { companies, supportPrograms, companyCount, expenses } = dashboard;

      setText("[data-user-name]", user.profile.name);

      renderStatsSection({ companies, supportPrograms, companyCount });
      renderSignupApprovalSection(companies);
      renderExpenseApprovalSection(expenses);
      renderBudgetApprovalSection(companies);

      bindSignupActions(user, async () => {
        dashboard = await getAdminDashboard();
        render();
      });
    };

    render();
  }
} catch (error) {
  showError(error);
}
