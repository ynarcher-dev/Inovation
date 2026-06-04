import { mountShell, setText, showError } from "../../app.js";
import { getAdminDashboard } from "../../api.js";
import { requireRole } from "../../auth.js";
import { getBudgetStatusLabel, getRound1StatusLabel, getRound2StatusLabel, isChangeStatus } from "../../domains/budget/budget-status.js";
import { escapeHtml, formatCurrency, formatDate } from "../../utils.js";
import { FilterToolbar, bindFilters, fillFilterSelect, readFilters } from "../../components/admin/FilterToolbar.js";

// 예산(예산안/변경) 검토 대기 상태
const BUDGET_PENDING_STATUSES = ["budget_submitted", "change_submitted"];
const companyDetailHref = (id) => `company-detail.html?id=${encodeURIComponent(id)}`;

// 1차 예산 필터 키: change_* 단계는 1차가 이미 승인된 이후이므로 budget_approved 로 묶는다(기업목록과 동일 규칙).
const round1KeyOf = (company) =>
  isChangeStatus(company.budget_status) ? "budget_approved" : (company.budget_status || "not_submitted");

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

// 상단: 예산 승인/변경 (최초 예산안 · 변경 요청 검토 대기 목록)
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
                <td>${isChange ? "2차 예산 배정" : "최초 예산안"}</td>
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

// 하단: 전체 기업 예산 현황 (1차/2차 처리 상태 + 확정 예산 추적)
function BudgetStatusTable(companies) {
  if (!companies?.length) return `<p class="empty">표시할 기업이 없습니다.</p>`;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>기업명</th><th>참가 사업</th><th>1차 예산</th><th>2차 예산</th><th>확정 총 예산</th></tr>
        </thead>
        <tbody>
          ${companies.map((c) => `
            <tr data-company-row data-company-id="${escapeHtml(c.id)}">
              <td><a href="${companyDetailHref(c.id)}">${escapeHtml(c.name)}</a></td>
              <td>${escapeHtml(c.support_programs?.name || "-")}</td>
              <td>${escapeHtml(getRound1StatusLabel(c.budget_status))}</td>
              <td>${escapeHtml(getRound2StatusLabel(c.round2Status))}</td>
              <td>${formatCurrency(c.support_total_amount)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function matchesSearch(company, term) {
  if (!term) return true;
  return [company.name, company.representative_name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(term);
}

try {
  mountShell();
  const user = await requireRole(["admin", "super_admin"]);
  if (user) {
    const { companies, supportPrograms } = await getAdminDashboard();
    setText("[data-user-name]", user.profile.name);
    renderBudgetApprovalSection(companies);

    const toolbar = document.querySelector("[data-budget-toolbar]");
    const listTarget = document.querySelector("[data-budget-all]");
    toolbar.innerHTML = FilterToolbar({
      search: { placeholder: "기업명 · 대표자 검색", ariaLabel: "기업 검색" },
      selects: [
        { key: "round1", ariaLabel: "1차 예산 상태 필터", options: ROUND1_OPTIONS },
        { key: "round2", ariaLabel: "2차 예산 상태 필터", options: ROUND2_OPTIONS },
        { key: "program", ariaLabel: "참가 사업 필터", options: [{ value: "all", label: "전체 참가 사업" }] },
      ],
    });
    fillFilterSelect(toolbar, "program", (supportPrograms || []).map((p) => ({ value: p.id, label: p.name })));

    const renderAll = () => {
      const { term, selects } = readFilters(toolbar);
      const filtered = (companies || []).filter((c) =>
        (selects.round1 === "all" || round1KeyOf(c) === selects.round1)
        && (selects.round2 === "all" || (c.round2Status || "none") === selects.round2)
        && (selects.program === "all" || c.support_program_id === selects.program)
        && matchesSearch(c, term)
      );
      listTarget.innerHTML = BudgetStatusTable(filtered);
      listTarget.querySelectorAll("[data-company-row]").forEach((row) => {
        row.addEventListener("click", (event) => {
          if (event.target.closest("a, button")) return;
          window.location.href = companyDetailHref(row.dataset.companyId);
        });
      });
    };

    bindFilters(toolbar, renderAll);
    renderAll();
  }
} catch (error) {
  showError(error);
}
