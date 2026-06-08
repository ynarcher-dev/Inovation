import { mountShell, setText, showError } from "../../app.js";
import { getAdminDashboard } from "../../api.js";
import { requireRole } from "../../auth.js";
import { getRound1StatusLabel, getRound2StatusLabel, isChangeStatus } from "../../domains/budget/budget-status.js";
import { escapeHtml, formatCurrency } from "../../utils.js";
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

// 열 고정 너비(%). '승인 대기'(처리 열 有)와 '전체 현황'(처리 열 빈칸)이 동일한 너비로 정렬되도록
//   두 표 모두 같은 colgroup 을 쓰고, 전체 현황은 처리 열 자리를 비워 둔다.
const BUDGET_COL_WIDTHS = [22, 18, 15, 15, 18, 12]; // 기업·참가사업·1차·2차·확정총예산·처리

// 승인 대기와 전체 현황이 공유하는 예산 현황 표. options.action 이 있으면 마지막에 '처리' 버튼을,
//   options.reserveActionColumn 이면 같은 너비의 빈 열을 둔다.
function BudgetTable(companies, options = {}) {
  if (!companies?.length) {
    return `<p class="empty">${escapeHtml(options.emptyText || "표시할 기업이 없습니다.")}</p>`;
  }
  const hasAction = typeof options.action === "function";
  const showActionColumn = hasAction || options.reserveActionColumn === true;
  const colgroup = `<colgroup>${BUDGET_COL_WIDTHS.map((w) => `<col style="width:${w}%" />`).join("")}</colgroup>`;
  return `
    <div class="table-wrap">
      <table class="fixed-table">
        ${colgroup}
        <thead>
          <tr>
            <th>기업명</th>
            <th>참가 사업</th>
            <th>1차 예산</th>
            <th>2차 예산</th>
            <th>확정 총 예산</th>
            ${showActionColumn ? `<th>${hasAction ? "처리" : ""}</th>` : ""}
          </tr>
        </thead>
        <tbody>
          ${companies.map((c) => `
            <tr data-href="${companyDetailHref(c.id)}">
              <td><a href="${companyDetailHref(c.id)}">${escapeHtml(c.name)}</a></td>
              <td>${escapeHtml(c.support_programs?.name || "-")}</td>
              <td>${escapeHtml(getRound1StatusLabel(c.budget_status))}</td>
              <td>${escapeHtml(getRound2StatusLabel(c.round2Status))}</td>
              <td>${formatCurrency(c.support_total_amount)}</td>
              ${showActionColumn ? `<td>${hasAction ? options.action(c) : ""}</td>` : ""}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function bindRowNavigation(container) {
  container.querySelectorAll("tr[data-href]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) return;
      window.location.href = row.dataset.href;
    });
  });
}

// 상단: 예산 승인/변경 (최초 예산안 · 변경 요청 검토 대기 목록) — 전체 현황과 동일 구조 + '처리' 열.
function renderBudgetApprovalSection(companies) {
  const pending = companies.filter((c) => BUDGET_PENDING_STATUSES.includes(c.budget_status));
  const target = document.querySelector("[data-budget-approval-section]");
  target.innerHTML = BudgetTable(pending, {
    emptyText: "검토 대기 중인 예산 요청이 없습니다.",
    action: (c) => `<a class="button small" href="${companyDetailHref(c.id)}">검토하기</a>`,
  });
  bindRowNavigation(target);
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
      listTarget.innerHTML = BudgetTable(filtered, { reserveActionColumn: true });
      bindRowNavigation(listTarget);
    };

    bindFilters(toolbar, renderAll);
    renderAll();
  }
} catch (error) {
  showError(error);
}
