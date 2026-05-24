import { mountShell, showError, setText } from "../app.js";
import { requireRole } from "../auth.js";
import { getAdminCompanyDetail } from "../api.js";
import { ExpenseTable } from "../components/ExpenseTable.js";
import { escapeHtml, formatCurrency, formatDate, getQueryParam } from "../utils.js";

const approvalText = {
  pending: "승인 대기",
  approved: "승인 완료",
  rejected: "반려",
};

function BudgetTable(rows) {
  if (!rows?.length) return `<p class="empty">사업계획서 예산 항목이 없습니다.</p>`;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>사업계획서 항목</th>
            <th>비목</th>
            <th>배정 금액</th>
            <th>승인 금액</th>
            <th>제출 대기</th>
            <th>잔액</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>
                <strong>${escapeHtml(row.title)}</strong>
                <span class="muted block">${escapeHtml(row.description || "")}</span>
              </td>
              <td>${escapeHtml(row.budget_category)}</td>
              <td>${formatCurrency(row.allocated_amount)}</td>
              <td>${formatCurrency(row.approved_amount)}</td>
              <td>${formatCurrency(row.pending_amount)}</td>
              <td class="${Number(row.remaining_amount) < 0 ? "danger" : "success"}">${formatCurrency(row.remaining_amount)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function ReviewHistory(rows) {
  if (!rows?.length) return `<p class="empty">보완/반려 히스토리가 없습니다.</p>`;
  return `
    <div class="checklist">
      ${rows.map((row) => `
        <div class="checklist-row">
          <div>
            <strong>${escapeHtml(row.title)}</strong>
            <span>${formatDate(row.created_at)}</span>
          </div>
          <p class="muted">${escapeHtml(row.comment)}</p>
        </div>
      `).join("")}
    </div>
  `;
}

try {
  mountShell();
  const user = await requireRole(["admin", "super_admin"]);
  if (user) {
    const id = getQueryParam("id") || "00000000-0000-0000-0000-000000000001";
    const { budgetSummary, company, expenses, reviewHistory } = await getAdminCompanyDetail(id);
    setText("[data-company-name]", company.name);
    setText("[data-representative]", company.representative_name || "-");
    setText("[data-business-number]", company.business_number || "-");
    setText("[data-approval-status]", approvalText[company.approval_status] || company.approval_status || "-");
    setText("[data-support-total]", formatCurrency(company.support_total_amount));
    setText("[data-business-plan-version]", company.business_plan?.version || "-");
    setText("[data-business-plan-file]", company.business_plan?.original_filename || "-");
    setText("[data-business-plan-approved]", formatDate(company.business_plan?.approved_at));
    document.querySelector("[data-budget-table]").innerHTML = BudgetTable(budgetSummary);
    document.querySelector("[data-expense-table]").innerHTML = ExpenseTable(expenses, { admin: true });
    document.querySelector("[data-review-history]").innerHTML = ReviewHistory(reviewHistory);
  }
} catch (error) {
  showError(error);
}
