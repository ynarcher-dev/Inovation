import { mountShell, runWithErrorBoundary, showError } from "../app.js";
import { approveCompany, getAdminDashboard, rejectCompany } from "../api.js";
import { requireRole } from "../auth.js";
import { escapeHtml, formatDate } from "../utils.js";

const approvalText = {
  pending: "승인 대기",
  approved: "승인 완료",
  rejected: "반려",
};

function SignupTable(companies, options = {}) {
  if (!companies?.length) return `<p class="empty">표시할 가입 신청이 없습니다.</p>`;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>기업명</th>
            <th>대표자</th>
            <th>사업자등록번호</th>
            <th>참가 사업</th>
            <th>승인 상태</th>
            <th>가입일</th>
            ${options.actions ? "<th>관리</th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${companies.map((company) => `
            <tr>
              <td><a href="company-detail.html?id=${encodeURIComponent(company.id)}">${escapeHtml(company.name)}</a></td>
              <td>${escapeHtml(company.representative_name || "-")}</td>
              <td>${escapeHtml(company.business_number || "-")}</td>
              <td>${escapeHtml(company.support_programs?.name || "-")}</td>
              <td>${escapeHtml(approvalText[company.approval_status] || company.approval_status || "-")}</td>
              <td>${formatDate(company.created_at)}</td>
              ${options.actions ? `
                <td>
                  <div class="actions">
                    <button class="button small" type="button" data-approve-company="${escapeHtml(company.id)}">승인</button>
                    <button class="button small danger" type="button" data-reject-company="${escapeHtml(company.id)}">반려</button>
                  </div>
                </td>
              ` : ""}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function matchesSearch(company, term) {
  if (!term) return true;
  const haystack = [
    company.name,
    company.representative_name,
    company.business_number,
    company.support_programs?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(term);
}

function inDateRange(company, from, to) {
  if (!from && !to) return true;
  const created = (company.created_at || "").slice(0, 10);
  if (!created) return false;
  if (from && created < from) return false;
  if (to && created > to) return false;
  return true;
}

try {
  mountShell();
  const user = await requireRole(["admin", "super_admin"]);
  if (user) {
    let dashboard = await getAdminDashboard();
    const searchInput = document.querySelector("[data-signup-search]");
    const statusFilter = document.querySelector("[data-signup-status]");
    const programFilter = document.querySelector("[data-signup-program]");
    const dateFromInput = document.querySelector("[data-signup-date-from]");
    const dateToInput = document.querySelector("[data-signup-date-to]");

    if (programFilter) {
      programFilter.insertAdjacentHTML(
        "beforeend",
        (dashboard.supportPrograms || [])
          .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`)
          .join("")
      );
    }

    const renderAll = () => {
      const term = (searchInput?.value || "").trim().toLowerCase();
      const status = statusFilter?.value || "all";
      const program = programFilter?.value || "all";
      const dateFrom = dateFromInput?.value || "";
      const dateTo = dateToInput?.value || "";
      const filtered = dashboard.companies.filter((company) =>
        (status === "all" || company.approval_status === status)
        && (program === "all" || company.support_program_id === program)
        && inDateRange(company, dateFrom, dateTo)
        && matchesSearch(company, term)
      );
      document.querySelector("[data-all-signups]").innerHTML = SignupTable(filtered);
    };

    const render = () => {
      const pending = dashboard.companies.filter((company) => company.approval_status === "pending");
      document.querySelector("[data-pending-signups]").innerHTML = SignupTable(pending, { actions: true });
      renderAll();

      document.querySelectorAll("[data-approve-company]").forEach((button) => {
        button.addEventListener("click", async () => {
          await runWithErrorBoundary(async () => {
            await approveCompany(button.dataset.approveCompany, user.id);
            dashboard = await getAdminDashboard();
            render();
          }, { button });
        });
      });

      document.querySelectorAll("[data-reject-company]").forEach((button) => {
        button.addEventListener("click", async () => {
          await runWithErrorBoundary(async () => {
            await rejectCompany(button.dataset.rejectCompany);
            dashboard = await getAdminDashboard();
            render();
          }, { button });
        });
      });
    };

    searchInput?.addEventListener("input", renderAll);
    statusFilter?.addEventListener("change", renderAll);
    programFilter?.addEventListener("change", renderAll);
    dateFromInput?.addEventListener("change", renderAll);
    dateToInput?.addEventListener("change", renderAll);

    render();
  }
} catch (error) {
  showError(error);
}

