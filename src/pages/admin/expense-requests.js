import { mountShell, setText, showError } from "../../app.js";
import { getAdminDashboard } from "../../api.js";
import { requireRole } from "../../auth.js";
import { ADMIN_REVIEW_STATUSES, EXPENSE_SEGMENTS, getExpenseSegment } from "../../domains/status.js";
import { ExpenseTable } from "../../components/ExpenseTable.js";
import { FilterToolbar, bindFilters, fillFilterSelect, readFilters } from "../../components/admin/FilterToolbar.js";

// 예산 사용(지출) 검토 대기 상태 — 사전승인 검토 + 최종승인 검토
const EXPENSE_PENDING_STATUSES = ADMIN_REVIEW_STATUSES;
const expenseDetailHref = (id) => `expense-detail.html?id=${encodeURIComponent(id)}`;

// 결재 구간 필터 옵션(EXPENSE_SEGMENTS 기준). 라벨/순서는 도메인 상수를 단일 출처로 쓴다.
// 단, draft(작성 중)는 아직 관리자에게 제출되지 않은 창업자 로컬 상태이므로 관리자 현황에서 제외한다.
const SEGMENT_OPTIONS = EXPENSE_SEGMENTS
  .filter((s) => s.key !== "draft")
  .map((s) => ({ value: s.key, label: s.label }));

// 관리자에게 제출된 적이 있는(=현황 추적 대상) 지출인지. draft 는 제출 전이므로 제외.
const isSubmittedToAdmin = (expense) => expense.status !== "draft";

// 상단: 예산 사용 승인 (지출 사전/최종 승인 검토 대기 목록)
//   하단 '전체 지출 현황'과 동일한 ExpenseTable 구조를 공유하고, 여기에만 '처리' 열을 덧붙인다.
function renderExpenseApprovalSection(expenses) {
  const pending = (expenses || []).filter((e) => EXPENSE_PENDING_STATUSES.includes(e.status));
  const target = document.querySelector("[data-expense-approval-section]");

  target.innerHTML = ExpenseTable(pending, {
    admin: true,
    hideChecklist: true,
    emptyText: "검토 대기 중인 예산 사용 신청이 없습니다.",
    action: (row) => `<a class="button small" href="${expenseDetailHref(row.id)}">검토하기</a>`,
  });

  target.querySelectorAll("tr[data-href]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) return;
      window.location.href = row.dataset.href;
    });
  });
}

function matchesSearch(expense, term) {
  if (!term) return true;
  return [expense.company_name, expense.title, expense.business_plan_item_label, expense.budget_category]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(term);
}

function inDateRange(expense, from, to) {
  if (!from && !to) return true;
  const submitted = (expense.submitted_at || expense.final_submitted_at || "").slice(0, 10);
  if (!submitted) return false;
  if (from && submitted < from) return false;
  if (to && submitted > to) return false;
  return true;
}

try {
  mountShell();
  const user = await requireRole(["admin", "super_admin"]);
  if (user) {
    const { expenses, companies, supportPrograms } = await getAdminDashboard();
    setText("[data-user-name]", user.profile.name);
    renderExpenseApprovalSection(expenses);

    // 지출에는 참가 사업 id 가 직접 없으므로 기업 → 사업 매핑으로 보정한다.
    const programByCompany = new Map((companies || []).map((c) => [c.id, c.support_program_id]));
    const programIdOf = (expense) => expense.support_program_id || programByCompany.get(expense.company_id) || null;

    // 하단: 전체 지출 신청 현황 (처리 이력 추적)
    const toolbar = document.querySelector("[data-expense-toolbar]");
    const listTarget = document.querySelector("[data-expense-all]");
    toolbar.innerHTML = FilterToolbar({
      search: { placeholder: "기업명 · 신청 제목 · 예산 항목 검색", ariaLabel: "지출 신청 검색" },
      selects: [
        { key: "segment", ariaLabel: "결재 구간 필터", options: SEGMENT_OPTIONS },
        { key: "program", ariaLabel: "참가 사업 필터", options: [{ value: "all", label: "전체 참가 사업" }] },
      ],
      dateRange: { fromLabel: "제출일 시작", toLabel: "제출일 종료" },
    });
    fillFilterSelect(toolbar, "program", (supportPrograms || []).map((p) => ({ value: p.id, label: p.name })));

    const renderAll = () => {
      const { term, selects, dateFrom, dateTo } = readFilters(toolbar);
      const filtered = (expenses || []).filter((e) =>
        isSubmittedToAdmin(e)
        && (selects.segment === "all" || getExpenseSegment(e.status) === selects.segment)
        && (selects.program === "all" || programIdOf(e) === selects.program)
        && inDateRange(e, dateFrom, dateTo)
        && matchesSearch(e, term)
      );
      listTarget.innerHTML = ExpenseTable(filtered, { admin: true, hideChecklist: true, reserveActionColumn: true });
      listTarget.querySelectorAll("[data-href]").forEach((row) => {
        row.addEventListener("click", (event) => {
          if (event.target.closest("a, button")) return;
          window.location.href = row.dataset.href;
        });
      });
    };

    bindFilters(toolbar, renderAll);
    renderAll();
  }
} catch (error) {
  showError(error);
}
