import { mountShell, runWithErrorBoundary, setText, showError } from "../app.js";
import { approveCompany, getAdminDashboard } from "../api.js";
import { requireRole } from "../auth.js";
import { escapeHtml, formatCurrency, formatDate } from "../utils.js";
import { getBudgetStatusLabel } from "../budgetStatus.js";

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
            <th>사업자등록번호</th>
            <th>참가 사업</th>
            <th>가입 상태</th>
            <th>예산안 상태</th>
            <th>가입일</th>
            <th>총 지원금</th>
            <th>승인/제출 금액</th>
            <th>진행률</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          ${companies.map((company) => {
            const used = (company.budgetSummary || []).reduce(
              (sum, row) => sum + Number(row.approved_amount || 0) + Number(row.pending_amount || 0),
              0,
            );
            const rate = company.support_total_amount
              ? Math.round((used / Number(company.support_total_amount)) * 100)
              : 0;
            const programName = company.support_programs?.name || "-";
            return `
              <tr data-company-row data-company-id="${escapeHtml(company.id)}">
                <td><a href="company-detail.html?id=${encodeURIComponent(company.id)}">${escapeHtml(company.name)}</a></td>
                <td>${escapeHtml(company.representative_name || "-")}</td>
                <td>${escapeHtml(company.business_number || "-")}</td>
                <td>${escapeHtml(programName)}</td>
                <td>${escapeHtml(approvalText[company.approval_status] || company.approval_status || "-")}</td>
                <td>${escapeHtml(getBudgetStatusLabel(company.budget_status))}</td>
                <td>${formatDate(company.created_at)}</td>
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

try {
  mountShell();
  const user = await requireRole(["admin", "super_admin"]);
  if (user) {
    let dashboard = await getAdminDashboard();
    const container = document.querySelector("[data-company-table]");

    const render = () => {
      setText("[data-user-name]", user.profile.name);
      container.innerHTML = CompanyMonitorTable(dashboard.companies);

      container.querySelectorAll("[data-approve-company]").forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.stopPropagation();
          await runWithErrorBoundary(async () => {
            await approveCompany(button.dataset.approveCompany, user.id);
            dashboard = await getAdminDashboard();
            render();
          }, { button });
        });
      });

      container.querySelectorAll("[data-company-row]").forEach((row) => {
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
