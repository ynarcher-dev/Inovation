import { mountShell, showError, setText } from "../app.js";
import { requireRole } from "../auth.js";
import { getFounderDashboard } from "../api.js";
import { ExpenseTable } from "../components/ExpenseTable.js";
import { escapeHtml, formatCurrency, formatDate } from "../utils.js";

function BudgetSummaryTable(rows) {
  if (!rows?.length) return `<p class="empty">등록된 사업계획서 예산 항목이 없습니다.</p>`;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>사업계획서 항목</th>
            <th>비목</th>
            <th>배정 금액</th>
            <th>승인/제출 금액</th>
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
              <td>${formatCurrency(Number(row.approved_amount || 0) + Number(row.pending_amount || 0))}</td>
              <td class="${Number(row.remaining_amount) < 0 ? "danger" : "success"}">${formatCurrency(row.remaining_amount)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function ManualLinks(links) {
  if (!links?.length) return `<p class="empty">등록된 매뉴얼이 없습니다.</p>`;
  return `
    <div class="manual-list">
      ${links.map((item) => {
        const title = escapeHtml(item.title || item.label || "-");
        const content = item.content ? `<span class="muted block">${escapeHtml(item.content)}</span>` : "";
        return item.link_url || item.href
          ? `<a class="manual-link" href="${encodeURI(item.link_url || item.href)}" target="_blank" rel="noreferrer"><strong>${title}</strong>${content}</a>`
          : `<div class="manual-link"><strong>${title}</strong>${content}</div>`;
      }).join("")}
    </div>
  `;
}

try {
  mountShell();
  const user = await requireRole(["founder"]);
  if (user) {
    const { budgetSummary, company, expenses, manualLinks } = await getFounderDashboard();
    const approvalNotice = document.querySelector("[data-approval-notice]");
    const newExpenseLink = document.querySelector("[data-new-expense-link]");
    if (company?.approval_status && company.approval_status !== "approved") {
      approvalNotice.hidden = false;
      approvalNotice.textContent = company.approval_status === "pending"
        ? "기업 가입 신청이 관리자 승인 대기 중입니다. 승인 완료 후 지출 신청을 생성할 수 있습니다."
        : "기업 가입 신청이 승인되지 않아 지출 신청을 생성할 수 없습니다.";
      newExpenseLink.classList.add("disabled");
      newExpenseLink.setAttribute("aria-disabled", "true");
      newExpenseLink.addEventListener("click", (event) => event.preventDefault());
    }
    setText("[data-user-name]", user.profile.name);
    setText("[data-company-name]", company?.name || "-");
    setText("[data-representative]", company?.representative_name || "-");
    setText("[data-agreement]", `${formatDate(company?.agreement_start_date)} - ${formatDate(company?.agreement_end_date)}`);
    setText("[data-support-total]", formatCurrency(company?.support_total_amount));
    setText("[data-business-plan-version]", company?.business_plan?.version || "-");
    setText("[data-business-plan-approved]", formatDate(company?.business_plan?.approved_at));
    setText("[data-business-plan-file]", company?.business_plan?.original_filename || "-");
    setText("[data-approved-total]", formatCurrency(expenses.filter((row) => row.status === "pre_approved").reduce((sum, row) => sum + Number(row.amount_supply || 0), 0)));
    setText("[data-pending-count]", expenses.filter((row) => row.status?.includes("submitted")).length);
    setText("[data-revision-count]", expenses.filter((row) => row.status?.includes("revision")).length);
    document.querySelector("[data-budget-summary]").innerHTML = BudgetSummaryTable(budgetSummary);
    document.querySelector("[data-manual-links]").innerHTML = ManualLinks(manualLinks);
    document.querySelector("[data-expense-table]").innerHTML = ExpenseTable(expenses);
  }
} catch (error) {
  showError(error);
}
