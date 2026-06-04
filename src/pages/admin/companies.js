import { mountShell, setText, showError } from "../../app.js";
import { getAdminDashboard } from "../../api.js";
import { requireRole } from "../../auth.js";
import { escapeHtml, formatCurrency, formatDate } from "../../utils.js";
import { getRound1StatusLabel, getRound2StatusLabel, isChangeStatus } from "../../domains/budget/budget-status.js";
import { FilterToolbar, bindFilters, fillFilterSelect, readFilters } from "../../components/admin/FilterToolbar.js";

// 1차 예산 필터 키: change_* 단계는 1차가 이미 승인된 이후이므로 budget_approved 로 묶는다.
const round1KeyOf = (company) =>
  isChangeStatus(company.budget_status) ? "budget_approved" : (company.budget_status || "not_submitted");

const APPROVAL_STATUS_OPTIONS = [
  { value: "all", label: "전체 가입 상태" },
  { value: "pending", label: "가입 승인 대기" },
  { value: "approved", label: "가입 승인 완료" },
  { value: "rejected", label: "가입 반려" },
];
const ROUND1_OPTIONS = [
  { value: "all", label: "전체 1차 예산" },
  { value: "not_submitted", label: "1차 미제출" },
  { value: "budget_submitted", label: "1차 검토 대기" },
  { value: "budget_revision_requested", label: "1차 보완 요청" },
  { value: "budget_approved", label: "1차 승인 완료" },
];
const ROUND2_OPTIONS = [
  { value: "all", label: "전체 2차 예산" },
  { value: "none", label: "2차 미신청" },
  { value: "pending", label: "2차 검토 대기" },
  { value: "revision", label: "2차 보완 요청" },
  { value: "approved", label: "2차 승인 완료" },
];

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
            <th>1차 예산</th>
            <th>2차 예산</th>
            <th>가입일</th>
            <th>총 지원금</th>
            <th>승인/제출 금액</th>
            <th>진행률</th>
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
                <td>${escapeHtml(getRound1StatusLabel(company.budget_status))}</td>
                <td>${escapeHtml(getRound2StatusLabel(company.round2Status))}</td>
                <td>${formatDate(company.created_at)}</td>
                <td>${formatCurrency(company.support_total_amount)}</td>
                <td>${formatCurrency(used)}</td>
                <td>${rate}%</td>
              </tr>
            `;
          }).join("")}
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

try {
  mountShell();
  const user = await requireRole(["admin", "super_admin"]);
  if (user) {
    let dashboard = await getAdminDashboard();
    const container = document.querySelector("[data-company-table]");
    const toolbar = document.querySelector("[data-company-toolbar]");
    toolbar.innerHTML = FilterToolbar({
      search: { placeholder: "기업명 · 대표자 · 사업자등록번호 검색", ariaLabel: "기업 검색" },
      selects: [
        { key: "status", ariaLabel: "가입 상태 필터", options: APPROVAL_STATUS_OPTIONS },
        { key: "round1", ariaLabel: "1차 예산 상태 필터", options: ROUND1_OPTIONS },
        { key: "round2", ariaLabel: "2차 예산 상태 필터", options: ROUND2_OPTIONS },
        { key: "program", ariaLabel: "참가 사업 필터", options: [{ value: "all", label: "전체 참가 사업" }] },
      ],
    });
    fillFilterSelect(
      toolbar,
      "program",
      (dashboard.supportPrograms || []).map((p) => ({ value: p.id, label: p.name }))
    );

    const render = () => {
      setText("[data-user-name]", user.profile.name);
      const { term, selects } = readFilters(toolbar);
      const filtered = dashboard.companies.filter((company) =>
        (selects.status === "all" || company.approval_status === selects.status)
        && (selects.round1 === "all" || round1KeyOf(company) === selects.round1)
        && (selects.round2 === "all" || (company.round2Status || "none") === selects.round2)
        && (selects.program === "all" || company.support_program_id === selects.program)
        && matchesSearch(company, term)
      );
      container.innerHTML = CompanyMonitorTable(filtered);

      container.querySelectorAll("[data-company-row]").forEach((row) => {
        row.addEventListener("click", (event) => {
          if (event.target.closest("a, button")) return;
          window.location.href = `company-detail.html?id=${encodeURIComponent(row.dataset.companyId)}`;
        });
      });
    };

    bindFilters(toolbar, render);

    render();
  }
} catch (error) {
  showError(error);
}
