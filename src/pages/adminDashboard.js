import { mountShell, showError, setText } from "../app.js";
import { requireRole } from "../auth.js";
import { approveCompany, getAdminDashboard } from "../api.js";
import { ExpenseTable } from "../components/ExpenseTable.js";
import { escapeHtml, formatCurrency } from "../utils.js";

const approvalText = {
  pending: "승인 대기",
  approved: "승인 완료",
  rejected: "반려",
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
            <th>승인 상태</th>
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
                <td><a href="/admin/company-detail.html?id=${encodeURIComponent(company.id)}">${escapeHtml(company.name)}</a></td>
                <td>${escapeHtml(company.representative_name || "-")}</td>
                <td>${escapeHtml(approvalText[company.approval_status] || company.approval_status || "-")}</td>
                <td>${formatCurrency(company.support_total_amount)}</td>
                <td>${formatCurrency(used)}</td>
                <td>${rate}%</td>
                <td>
                  ${company.approval_status === "pending"
                    ? `<button class="button small" type="button" data-approve-company="${escapeHtml(company.id)}">승인</button>`
                    : `<a href="/admin/company-detail.html?id=${encodeURIComponent(company.id)}">상세 관리</a>`}
                </td>
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
      setText("[data-user-name]", user.profile.name);
      setText("[data-company-count]", companyCount);
      setText("[data-total-support]", formatCurrency(totalSupportAmount));
      setText("[data-total-approved]", formatCurrency(totalApprovedAmount));
      setText("[data-execution-rate]", totalSupportAmount ? `${Math.round((Number(totalApprovedAmount || 0) / Number(totalSupportAmount || 1)) * 100)}%` : "0%");
      setText("[data-submitted-count]", expenses.filter((row) => row.status === "pre_approval_submitted").length);
      setText("[data-revision-count]", expenses.filter((row) => row.status?.includes("revision")).length);
      setText("[data-risk-count]", totalIssueCount ?? expenses.reduce((sum, row) => sum + Number(row.warning_count || 0), 0));
      document.querySelector("[data-company-table]").innerHTML = CompanyMonitorTable(companies);
      document.querySelector("[data-expense-table]").innerHTML = ExpenseTable(expenses, { admin: true });

      document.querySelectorAll("[data-approve-company]").forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.stopPropagation();
          button.disabled = true;
          await approveCompany(button.dataset.approveCompany, user.id);
          dashboard = await getAdminDashboard();
          render();
        });
      });

      document.querySelectorAll("[data-company-row]").forEach((row) => {
        row.addEventListener("click", (event) => {
          if (event.target.closest("a, button")) return;
          window.location.href = `/admin/company-detail.html?id=${encodeURIComponent(row.dataset.companyId)}`;
        });
      });
    };
    render();
  }
} catch (error) {
  showError(error);
}
