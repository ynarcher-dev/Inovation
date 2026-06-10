import { mountShell, setText, showError, showToast, runWithErrorBoundary } from "../../app.js";
import {
  getAdminDashboard,
  getEvidenceFilenameSettings,
  getExpenseVoucherSettings,
  downloadExpenseEvidenceZip,
  buildExpenseVoucherText,
} from "../../api.js";
import { requireRole } from "../../auth.js";
import { ADMIN_REVIEW_STATUSES, EXPENSE_SEGMENTS, getExpenseSegment } from "../../domains/status.js";
import { ExpenseTable } from "../../components/ExpenseTable.js";
import { openVoucherTextModal } from "../../components/ExpenseVoucherModal.js";
import { FilterToolbar, bindFilters, fillFilterSelect, readFilters } from "../../components/admin/FilterToolbar.js";
import { createPaginatedList } from "../../components/admin/Pagination.js";
import { escapeHtml } from "../../utils.js";

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

// 표 행 클릭 → 상세 이동. 페이지 전환마다 다시 그려지므로 컨테이너 범위로 재바인딩한다.
function bindRowNav(root) {
  root.querySelectorAll("[data-href]").forEach((row) => {
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

    // 증빙 ZIP 다운로드/지출결의 생성에 쓰는 전역 설정(좌측 '예산사용 정리기'에서 관리).
    //   로드 실패해도 기본값으로 동작하도록 한다.
    let evidenceFilenameSettings = { template: "{기업명}_{첨부분류}_{신청제목}_{총액}", seq_start: 1, seq_pad: 1 };
    try { evidenceFilenameSettings = await getEvidenceFilenameSettings(); } catch (e) { /* 기본값 유지 */ }
    let voucherSettings = { template: "" };
    try { voucherSettings = await getExpenseVoucherSettings(); } catch (e) { /* 기본값 유지 */ }

    // 지출 행에는 company_name 만 있고 대표자명은 없으므로 기업 목록에서 보강한다(지출결의 {대표자} 토큰용).
    const companyById = new Map((companies || []).map((c) => [c.id, c]));
    const enrichExpense = (row) => ({
      ...row,
      company_name: row.company_name || companyById.get(row.company_id)?.name || "",
      representative_name: companyById.get(row.company_id)?.representative_name || "",
    });

    // 상단: 예산 사용 승인 (검토 대기 목록) — 전체 현황과 동일 ExpenseTable + '처리' 열.
    const pendingList = createPaginatedList({
      container: document.querySelector("[data-expense-approval-section]"),
      renderItems: (rows) => ExpenseTable(rows, {
        admin: true,
        hideChecklist: true,
        emptyText: "검토 대기 중인 예산 사용 신청이 없습니다.",
        action: (row) => `<a class="button small" href="${expenseDetailHref(row.id)}">검토하기</a>`,
      }),
      onRendered: bindRowNav,
    });
    pendingList.setItems((expenses || []).filter((e) => EXPENSE_PENDING_STATUSES.includes(e.status)));

    // 지출에는 참가 사업 id 가 직접 없으므로 기업 → 사업 매핑으로 보정한다.
    const programByCompany = new Map((companies || []).map((c) => [c.id, c.support_program_id]));
    const programIdOf = (expense) => expense.support_program_id || programByCompany.get(expense.company_id) || null;

    // 하단: 전체 지출 신청 현황 (처리 이력 추적)
    const toolbar = document.querySelector("[data-expense-toolbar]");
    toolbar.innerHTML = FilterToolbar({
      search: { placeholder: "기업명 · 신청 제목 · 예산 항목 검색", ariaLabel: "지출 신청 검색" },
      selects: [
        { key: "segment", ariaLabel: "결재 구간 필터", options: SEGMENT_OPTIONS },
        { key: "program", ariaLabel: "참가 사업 필터", options: [{ value: "all", label: "전체 참가 사업" }] },
      ],
      dateRange: { fromLabel: "제출일 시작", toLabel: "제출일 종료" },
    });
    fillFilterSelect(toolbar, "program", (supportPrograms || []).map((p) => ({ value: p.id, label: p.name })));

    const allContainer = document.querySelector("[data-expense-all]");
    const allList = createPaginatedList({
      container: allContainer,
      // 처리 열에 '증빙 다운로드'(ZIP) + '지출결의'(텍스트) 버튼을 둔다(기업 상세 현황표와 동일).
      renderItems: (rows) => ExpenseTable(rows, {
        admin: true,
        hideChecklist: true,
        actionLabel: "처리",
        action: (row) =>
          `<div class="row-action-stack">
            <button class="button small secondary" type="button" data-evidence-zip="${escapeHtml(row.id)}">증빙 다운로드</button>
            <button class="button small secondary" type="button" data-voucher-text="${escapeHtml(row.id)}">지출결의</button>
          </div>`,
      }),
      onRendered: bindRowNav,
    });

    // 증빙 다운로드/지출결의 버튼은 컨테이너에 1회 위임 바인딩한다(페이지 전환으로 표가 다시 그려져도 유지).
    allContainer.addEventListener("click", async (e) => {
      const zipBtn = e.target.closest("[data-evidence-zip]");
      if (zipBtn) {
        const expense = enrichExpense((expenses || []).find((r) => r.id === zipBtn.dataset.evidenceZip) || { id: zipBtn.dataset.evidenceZip });
        await runWithErrorBoundary(async () => {
          const count = await downloadExpenseEvidenceZip(expense, {
            template: evidenceFilenameSettings.template,
            seqConfig: { seq_start: evidenceFilenameSettings.seq_start, seq_pad: evidenceFilenameSettings.seq_pad },
          });
          showToast(
            count === 0 ? "첨부된 증빙서류가 없습니다." : `증빙서류 ${count}건을 ZIP으로 내려받았습니다.`,
            { type: count === 0 ? "info" : "success" },
          );
        }, { button: zipBtn });
        return;
      }

      const voucherBtn = e.target.closest("[data-voucher-text]");
      if (voucherBtn) {
        const expense = enrichExpense((expenses || []).find((r) => r.id === voucherBtn.dataset.voucherText) || { id: voucherBtn.dataset.voucherText });
        await runWithErrorBoundary(async () => {
          const text = await buildExpenseVoucherText(expense, {
            voucherTemplate: voucherSettings.template,
            filenameSettings: evidenceFilenameSettings,
          });
          openVoucherTextModal({ title: expense.title, text });
        }, { button: voucherBtn });
      }
    });

    const renderAll = () => {
      const { term, selects, dateFrom, dateTo } = readFilters(toolbar);
      const filtered = (expenses || []).filter((e) =>
        isSubmittedToAdmin(e)
        && (selects.segment === "all" || getExpenseSegment(e.status) === selects.segment)
        && (selects.program === "all" || programIdOf(e) === selects.program)
        && inDateRange(e, dateFrom, dateTo)
        && matchesSearch(e, term)
      );
      allList.setItems(filtered);
    };

    bindFilters(toolbar, renderAll);
    renderAll();
  }
} catch (error) {
  showError(error);
}
