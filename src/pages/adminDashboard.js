import { mountShell, runWithErrorBoundary, showError, setText } from "../app.js";
import { requireRole } from "../auth.js";
import {
  approveCompany,
  getAdminDashboard,
} from "../api.js";
import { ExpenseTable } from "../components/ExpenseTable.js";
import { getBudgetStatusLabel } from "../budgetStatus.js";
import { escapeHtml, formatCurrency, formatDate } from "../utils.js";

const approvalText = {
  pending: "가입 승인 대기",
  approved: "가입 승인 완료",
  rejected: "가입 반려",
};

function CompanyMonitorTable(companies) {
  if (!companies?.length) return `<p class="empty">표시할 기업이 없습니다.</p>`;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>기업</th>
            <th>대표자</th>
            <th>가입 상태</th>
            <th>예산안 상태</th>
            <th>총 지원금</th>
            <th>승인/제출 금액</th>
            <th>진행률</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          ${companies.map((company) => {
            const used = (company.budgetSummary || []).reduce((sum, row) => sum + Number(row.approved_amount || 0) + Number(row.pending_amount || 0), 0);
            const rate = company.support_total_amount ? Math.round((used / Number(company.support_total_amount)) * 100) : 0;
            return `
              <tr data-company-row data-company-id="${escapeHtml(company.id)}">
                <td><a href="company-detail.html?id=${encodeURIComponent(company.id)}">${escapeHtml(company.name)}</a></td>
                <td>${escapeHtml(company.representative_name || "-")}</td>
                <td>${escapeHtml(approvalText[company.approval_status] || company.approval_status || "-")}</td>
                <td>${escapeHtml(getBudgetStatusLabel(company.budget_status))}</td>
                <td>${formatCurrency(company.support_total_amount)}</td>
                <td>${formatCurrency(used)}</td>
                <td>${rate}%</td>
                <td>
                  ${company.approval_status === "pending"
                    ? `<button class="button small" type="button" data-approve-company="${escapeHtml(company.id)}">가입 승인</button>`
                    : `<a href="company-detail.html?id=${encodeURIComponent(company.id)}">상세 관리</a>`}
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// 업무 큐 요약 카드
function QueueCards(queues) {
  const cards = [
    { key: "signup", label: "가입 승인 대기", count: queues.signup.length, target: "queue-signup" },
    { key: "budgetInitial", label: "최초 예산안 승인 대기", count: queues.budgetInitial.length, target: "queue-budget" },
    { key: "budgetChange", label: "예산 변경 승인 대기", count: queues.budgetChange.length, target: "queue-budget" },
    { key: "expense", label: "지출 사용 승인 검토 대기", count: queues.expense.length, target: "queue-expense" },
  ];
  return cards.map((card) => `
    <a class="card metric" href="#${card.target}" style="text-decoration:none; ${card.count > 0 ? "border-left:4px solid var(--primary);" : ""}">
      <span>${escapeHtml(card.label)}</span>
      <strong style="${card.count > 0 ? "color:var(--primary);" : ""}">${card.count}</strong>
    </a>
  `).join("");
}

// 가입 승인 대기 목록
function SignupQueueTable(companies) {
  if (!companies.length) return `<p class="empty">가입 승인 대기 중인 기업이 없습니다.</p>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>기업</th><th>대표자</th><th>참가 사업</th><th>처리</th></tr></thead>
        <tbody>
          ${companies.map((c) => `
            <tr>
              <td>${escapeHtml(c.name)}</td>
              <td>${escapeHtml(c.representative_name || "-")}</td>
              <td>${escapeHtml(c.support_programs?.name || "-")}</td>
              <td><button class="button small" type="button" data-approve-company="${escapeHtml(c.id)}">가입 승인</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// 예산안/변경 승인 대기 목록
function BudgetQueueTable(companies) {
  if (!companies.length) return `<p class="empty">검토 대기 중인 예산 제출안이 없습니다.</p>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>기업</th><th>유형</th><th>상태</th><th>제출일</th><th>심사</th></tr></thead>
        <tbody>
          ${companies.map((c) => {
            const isChange = String(c.budget_status || "").startsWith("change");
            const submittedAt = c.pendingBudgetSubmission?.submitted_at;
            return `
              <tr>
                <td>${escapeHtml(c.name)}</td>
                <td>${isChange ? "예산 변경" : "최초 예산안"}</td>
                <td>${escapeHtml(getBudgetStatusLabel(c.budget_status))}</td>
                <td>${submittedAt ? formatDate(submittedAt) : "-"}</td>
                <td><a class="button small" href="company-detail.html?id=${encodeURIComponent(c.id)}">심사하기</a></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

try {
  mountShell();
  const user = await requireRole(["admin", "super_admin"]);
  if (user) {
    let dashboard = await getAdminDashboard();
    const render = () => {
      const { companies, companyCount, expenses, totalApprovedAmount, totalIssueCount, totalSupportAmount } = dashboard;

      // 업무 큐 계산 (가입/예산 상태와 지출 상태를 분리)
      const queues = {
        signup: companies.filter((c) => c.approval_status === "pending"),
        budgetInitial: companies.filter((c) => c.budget_status === "budget_submitted"),
        budgetChange: companies.filter((c) => c.budget_status === "change_submitted"),
        expense: expenses.filter((e) => e.status === "pre_approval_submitted"),
      };
      const budgetQueue = companies.filter((c) => ["budget_submitted", "change_submitted"].includes(c.budget_status));

      setText("[data-user-name]", user.profile.name);
      setText("[data-company-count]", companyCount);
      setText("[data-total-support]", formatCurrency(totalSupportAmount));
      setText("[data-total-approved]", formatCurrency(totalApprovedAmount));
      setText("[data-execution-rate]", totalSupportAmount ? `${Math.round((Number(totalApprovedAmount || 0) / Number(totalSupportAmount || 1)) * 100)}%` : "0%");
      setText("[data-submitted-count]", queues.expense.length);
      setText("[data-revision-count]", expenses.filter((row) => row.status?.includes("revision")).length);
      setText("[data-risk-count]", totalIssueCount ?? expenses.reduce((sum, row) => sum + Number(row.warning_count || 0), 0));

      document.querySelector("[data-queue-cards]").innerHTML = QueueCards(queues);
      document.querySelector("[data-queue-signup]").innerHTML = SignupQueueTable(queues.signup);
      document.querySelector("[data-queue-budget]").innerHTML = BudgetQueueTable(budgetQueue);
      document.querySelector("[data-queue-expense]").innerHTML = ExpenseTable(queues.expense, { admin: true });

      document.querySelector("[data-company-table]").innerHTML = CompanyMonitorTable(companies);
      document.querySelector("[data-expense-table]").innerHTML = ExpenseTable(expenses, { admin: true });

      document.querySelectorAll("[data-approve-company]").forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.stopPropagation();
          await runWithErrorBoundary(async () => {
            await approveCompany(button.dataset.approveCompany, user.id);
            dashboard = await getAdminDashboard();
            render();
          }, { button });
        });
      });

      document.querySelectorAll("[data-company-row]").forEach((row) => {
        row.addEventListener("click", (event) => {
          if (event.target.closest("a, button")) return;
          window.location.href = `company-detail.html?id=${encodeURIComponent(row.dataset.companyId)}`;
        });
      });
    };

    render();
  }
} catch (error) {
  showError(error);
}
