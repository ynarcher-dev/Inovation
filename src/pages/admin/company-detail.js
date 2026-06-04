import { mountShell, runWithErrorBoundary, showError, setText } from "../../app.js";
import { requireRole } from "../../auth.js";
import {
  getAdminCompanyDetail,
  reviewBudgetSubmission,
  downloadStoredFile,
  updateCompanyInternalMemo,
} from "../../api.js";
import { BudgetTreeView } from "../../components/BudgetTreeView.js";
import { FlatReviewHistoryTable } from "../../components/FlatReviewHistoryTable.js";
import { BudgetSubmissionDiff } from "../../components/budget/BudgetSubmissionDiff.js";
import { ExpenseRequestsTable } from "../../components/expense/ExpenseRequestsTable.js";
import { getBudgetCategoryPaths, attachCategoryHighlight, attachAllocationHandlers } from "../../dom/admin-company-detail.js";
import { getBudgetStatusLabel } from "../../domains/budget/budget-status.js";
import {
  escapeHtml,
  formatCurrency,
  formatDate,
  getQueryParam,
} from "../../utils.js";

const approvalText = {
  pending: "가입 승인 대기",
  approved: "가입 승인 완료",
  rejected: "가입 반려",
};

try {
  mountShell();
  const user = await requireRole(["admin", "super_admin"]);
  if (user) {
    const id = getQueryParam("id") || "comp-abc";
    let detail = await getAdminCompanyDetail(id);

    const budgetTreeEl = document.querySelector("[data-budget-tree]");
    const expenseTableEl = document.querySelector("[data-expense-table]");
    const reviewHistoryEl = document.querySelector("[data-review-history]");
    const internalMemoEl = document.getElementById("admin-internal-memo");

    // Tabs switching logic
    const tabButtons = document.querySelectorAll(".tab-button");
    const tabContents = document.querySelectorAll(".tab-content");
    const activateTab = (targetTab) => {
      if (!document.getElementById(targetTab)) return;
      tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === targetTab));
      tabContents.forEach((c) => c.classList.toggle("active", c.id === targetTab));
    };
    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => activateTab(btn.dataset.tab));
    });
    // 요약 탭 빠른 액션: 지정 탭으로 이동
    document.querySelectorAll("[data-goto-tab]").forEach((btn) => {
      btn.addEventListener("click", () => activateTab(btn.dataset.gotoTab));
    });
    // 대시보드 등에서 ?tab=tab-budget-review 형태로 딥링크 진입 지원 (S5 동선)
    const initialTab = getQueryParam("tab");
    if (initialTab) activateTab(initialTab);

    // 사업계획서 1차/2차 탭: 첨부 파일/상태/최종 수정일. 승인 완료 파일만 다운로드를 노출한다.
    // 승인 대기 예산 제출에 연결된 첨부본은 최종 승인본으로 제공하지 않는다(창업자 대시보드와 동일 규칙).
    const renderBusinessPlanTab = () => {
      const plans = detail.company?.business_plans || {};
      const approvedSubmissionIds = new Set(
        (detail.budgetSubmissions || [])
          .filter((s) => ["budget_approved", "change_approved"].includes(s.status))
          .map((s) => s.id),
      );
      const renderSlot = (round) => {
        const plan = plans[round];
        const dlBtn = document.querySelector(`[data-bp-download="${round}"]`);
        if (!plan?.original_filename) {
          setText(`[data-bp-${round}-file]`, "미첨부");
          setText(`[data-bp-${round}-status]`, "-");
          setText(`[data-bp-${round}-updated]`, "-");
          if (dlBtn) dlBtn.hidden = true;
          return;
        }
        const approved = !plan.budget_submission_id || approvedSubmissionIds.has(plan.budget_submission_id);
        setText(`[data-bp-${round}-file]`, plan.original_filename);
        setText(`[data-bp-${round}-status]`, approved ? "승인 완료" : "승인 대기");
        setText(`[data-bp-${round}-updated]`, plan.updated_at ? formatDate(plan.updated_at) : "-");
        if (dlBtn) dlBtn.hidden = !approved;
      };
      renderSlot("round1");
      renderSlot("round2");
    };

    const renderHeader = () => {
      const { company } = detail;
      setText("[data-company-name]", company.name);
      setText("[data-representative]", company.representative_name || "-");
      setText("[data-business-number]", company.business_number || "-");
      renderBusinessPlanTab();

      // 요약 탭: 기업 기본정보
      setText("[data-summary-name]", company.name);
      setText("[data-phone]", company.phone || "-");
      setText("[data-program-name]", company.support_programs?.name || "-");
      const agreement = company.agreement_start_date && company.agreement_end_date
        ? `${formatDate(company.agreement_start_date)} ~ ${formatDate(company.agreement_end_date)}`
        : "-";
      setText("[data-agreement]", agreement);
      setText("[data-approval-status-2]", approvalText[company.approval_status] || company.approval_status || "-");
      setText("[data-budget-status-2]", getBudgetStatusLabel(company.budget_status));

      // 요약 탭: 예산 집계 (비목 배정 합산)
      const summaryRows = detail.budgetSummary || [];
      const sum = (key) => summaryRows.reduce((acc, r) => acc + Number(r[key] || 0), 0);
      setText("[data-sum-allocated]", formatCurrency(sum("allocated_amount")));
      setText("[data-sum-approved]", formatCurrency(sum("approved_amount")));
      setText("[data-sum-pending]", formatCurrency(sum("pending_amount")));
      setText("[data-sum-remaining]", formatCurrency(sum("remaining_amount")));
      const reviewHistory = detail.reviewHistory || [];
      const revisionRequestedCount = reviewHistory.filter((r) => r.decision === "revision_requested").length;
      setText("[data-revision-requested-count]", `${revisionRequestedCount}건`);

      // Load internal memo
      if (internalMemoEl) {
        internalMemoEl.value = company.internal_memo || "";
      }

      // 확정 예산 트리: 1차/2차/총 승인 예산 컬럼 + 2차 요청 상태 헤더(new.md §10.3).
      budgetTreeEl.innerHTML = BudgetTreeView(detail.budgetTree, false, company.support_programs?.level_labels, {
        showRounds: true,
        round2Status: detail.round2Status,
      });
      attachAllocationHandlers(budgetTreeEl, company.id, async () => {
        detail = await getAdminCompanyDetail(id);
        renderHeader();
      });

      const categoryPaths = getBudgetCategoryPaths(detail.programBudgets);
      const pendingExpenses = detail.expenses.filter((row) => row.status?.includes("submitted"));

      expenseTableEl.innerHTML = ExpenseRequestsTable(pendingExpenses, categoryPaths);
      reviewHistoryEl.innerHTML = FlatReviewHistoryTable(detail.reviewHistory, true);

      // 탭 배지: 검토 대기 표시
      const budgetReviewBadge = document.querySelector("[data-badge-budget-review]");
      if (budgetReviewBadge) budgetReviewBadge.hidden = !detail.pendingSubmission;
      const expenseReviewBadge = document.querySelector("[data-badge-expense-review]");
      if (expenseReviewBadge) {
        expenseReviewBadge.hidden = pendingExpenses.length === 0;
        expenseReviewBadge.textContent = pendingExpenses.length ? String(pendingExpenses.length) : "●";
      }

      attachCategoryHighlight(budgetTreeEl, expenseTableEl);
      renderBudgetReview();
    };

    // 예산 제출안 심사 영역 렌더링: 검토 대기 제출안이 있을 때만 버튼 활성화.
    const renderBudgetReview = () => {
      const detailEl = document.getElementById("budget-review-detail");
      const actionsEl = document.getElementById("budget-review-actions");
      const pending = detail.pendingSubmission;
      const reviewButtons = actionsEl ? actionsEl.querySelectorAll("button") : [];

      if (pending) {
        const committed = detail.committedByBudgetId || {};
        detailEl.innerHTML = BudgetSubmissionDiff(pending, detail.programBudgets, committed, detail.company);
        // 2차 수정 사업계획서 다운로드 버튼 바인딩(new.md §11.3).
        detailEl.querySelector("[data-round2-plan-download]")?.addEventListener("click", async (e) => {
          const btn = e.currentTarget;
          await runWithErrorBoundary(async () => {
            await downloadStoredFile(btn.dataset.round2PlanDownload, btn.dataset.round2PlanName);
          }, { button: btn });
        });
        reviewButtons.forEach((b) => (b.disabled = false));
        if (commentInput) commentInput.disabled = false;
        // 감액 불가 위반이 있으면 승인만 차단 (보완요청은 허용)
        const hasViolation = (pending.items || []).some(
          (it) => Number(it.requested_allocated_amount || 0) < Number(committed[it.support_program_budget_id] || 0)
        );
        const approveBtn = document.getElementById("btn-approve-budget");
        if (approveBtn) {
          approveBtn.disabled = hasViolation;
          approveBtn.title = hasViolation ? "감액 불가 비목이 있어 승인할 수 없습니다." : "";
        }
      } else {
        const status = detail.company.budget_status || "not_submitted";
        detailEl.innerHTML = `<p class="empty">현재 검토할 예산 제출안이 없습니다. (예산안 상태: ${escapeHtml(getBudgetStatusLabel(status))})</p>`;
        reviewButtons.forEach((b) => (b.disabled = true));
        if (commentInput) commentInput.disabled = true;
      }
    };

    // 예산 제출안 심사 액션 (승인 시에만 확정 예산 반영)
    const commentInput = document.getElementById("budget-review-comment");

    const submitBudgetReview = async (decision, label, btn) => {
      const pending = detail.pendingSubmission;
      if (!pending) {
        alert("검토할 예산 제출안이 없습니다.");
        return;
      }
      const comment = commentInput.value.trim();
      if (decision !== "approved" && !comment) {
        alert("보완요청 시에는 반드시 심사 의견을 작성해야 합니다.");
        commentInput.focus();
        return;
      }
      if (!confirm(`이 예산안을 ${label} 처리하시겠습니까?`)) return;

      await runWithErrorBoundary(async () => {
        await reviewBudgetSubmission(pending.id, decision, comment, user.profile.name);
        commentInput.value = "";
        detail = await getAdminCompanyDetail(id);
        renderHeader();
        alert(`예산안이 ${label} 처리되었습니다.`);
      }, { button: btn });
    };

    document.getElementById("btn-approve-budget")?.addEventListener("click", (e) => submitBudgetReview("approved", "승인", e.currentTarget));
    document.getElementById("btn-revision-budget")?.addEventListener("click", (e) => submitBudgetReview("revision_requested", "보완요청", e.currentTarget));

    // Save internal memo
    document.getElementById("btn-save-memo")?.addEventListener("click", async (e) => {
      const memoText = internalMemoEl.value.trim();
      const btn = e.currentTarget;
      await runWithErrorBoundary(async () => {
        await updateCompanyInternalMemo(id, memoText);
        const original = btn.textContent;
        btn.textContent = "저장완료";
        setTimeout(() => { btn.textContent = original; }, 1200);
      }, { button: btn });
    });

    // 사업계획서 1차/2차 다운로드(승인 완료 파일만 버튼 노출 — renderBusinessPlanTab 에서 제어).
    document.querySelectorAll("[data-bp-download]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const plan = detail.company?.business_plans?.[btn.dataset.bpDownload];
        if (!plan?.original_filename) return;
        await runWithErrorBoundary(async () => {
          await downloadStoredFile(plan.link_url, plan.original_filename);
        }, { button: btn });
      });
    });

    // ZIP Download Mock
    document.getElementById("btn-download-all-docs")?.addEventListener("click", () => {
      alert("📦 [Mock ZIP 다운로드]\n최종 사업계획서 및 스타트업이 제출한 모든 지출 증빙 문서들이 ABC스포츠_증빙서류_일괄다운로드.zip 파일로 패키징되어 가상 다운로드되었습니다.");
    });

    renderHeader();
  }
} catch (error) {
  showError(error);
}
