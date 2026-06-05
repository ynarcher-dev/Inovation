import { mountShell, runWithErrorBoundary, showError, setText, showToast, showConfirm } from "../../app.js";
import { requireRole } from "../../auth.js";
import {
  getAdminCompanyDetail,
  reviewBudgetSubmission,
  downloadStoredFile,
  updateCompanyInternalMemo,
  approveCompany,
  rejectCompany,
  resetFounderPassword,
  requestBudgetAiReview,
} from "../../api.js";
import { BudgetTreeView } from "../../components/BudgetTreeView.js";
import { FlatReviewHistoryTable } from "../../components/FlatReviewHistoryTable.js";
import { BudgetSubmissionDiff } from "../../components/budget/BudgetSubmissionDiff.js";
import { ExpenseRequestsTable } from "../../components/expense/ExpenseRequestsTable.js";
import { getBudgetCategoryPaths, attachCategoryHighlight, attachAllocationHandlers } from "../../dom/admin-company-detail.js";
import { getBudgetStatusLabel } from "../../domains/budget/budget-status.js";
import {
  escapeHtml,
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
    const aiBudgetReviewBtn = document.getElementById("btn-ai-budget-review");
    const aiBudgetReviewResultEl = document.querySelector("[data-ai-budget-review-result]");

    const budgetTitleById = () => new Map((detail.programBudgets || []).map((budget) => [budget.id, budget]));
    const budgetPathOf = (budgetId) => {
      const titleById = budgetTitleById();
      const parts = [];
      let current = titleById.get(budgetId);
      while (current) {
        parts.unshift(current.title);
        current = current.parent_id ? titleById.get(current.parent_id) : null;
      }
      return parts.join(" > ");
    };
    const buildBudgetAiPayload = () => {
      const pending = detail.pendingSubmission;
      if (!pending) return null;
      const committed = detail.committedByBudgetId || {};
      return {
        company: {
          id: detail.company?.id,
          name: detail.company?.name,
          representative_name: detail.company?.representative_name,
          support_program_name: detail.company?.support_programs?.name,
          budget_status: detail.company?.budget_status,
          support_total_amount: detail.company?.support_total_amount,
          agreement_start_date: detail.company?.agreement_start_date,
          agreement_end_date: detail.company?.agreement_end_date,
        },
        submission: {
          id: pending.id,
          type: pending.type,
          status: pending.status,
          reason: pending.reason,
          submitted_at: pending.submitted_at,
          submitted_by_name: pending.submitted_by_name,
          items: (pending.items || []).map((item) => ({
            budget_path: budgetPathOf(item.support_program_budget_id),
            previous_allocated_amount: Number(item.previous_allocated_amount || 0),
            requested_allocated_amount: Number(item.requested_allocated_amount || 0),
            previous_round1_allocated_amount: Number(item.previous_round1_allocated_amount || 0),
            requested_round1_allocated_amount: Number(item.requested_round1_allocated_amount || 0),
            previous_round2_allocated_amount: Number(item.previous_round2_allocated_amount || 0),
            requested_round2_allocated_amount: Number(item.requested_round2_allocated_amount || 0),
            committed_or_pending_amount: Number(committed[item.support_program_budget_id] || 0),
          })),
        },
      };
    };
    const aiToneClass = (level) => {
      if (["danger", "error", "high"].includes(level)) return "notice-danger";
      if (["warning", "medium"].includes(level)) return "notice-warning";
      if (["success", "ok", "low"].includes(level)) return "notice-success";
      return "notice-info";
    };
    const renderBudgetAiReviewResult = (result) => {
      if (!aiBudgetReviewResultEl) return;
      const risks = result.risks?.length
        ? result.risks.map((risk) => `
            <div class="notice ${aiToneClass(risk.level)}" style="margin:8px 0 0; padding:12px 14px;">
              <strong>${escapeHtml(risk.title || "검토 항목")}</strong>
              ${risk.detail ? `<p style="margin:6px 0 0;">${escapeHtml(risk.detail)}</p>` : ""}
            </div>`).join("")
        : `<div class="notice notice-success" style="margin-top:8px; padding:12px 14px;">특이 위험 항목이 감지되지 않았습니다.</div>`;
      aiBudgetReviewResultEl.innerHTML = `
        <div class="notice notice-info" style="padding:12px 14px;">
          <strong>AI 제안: ${escapeHtml(result.decision_suggestion || "needs_review")}</strong>
          ${result.summary ? `<p style="margin:6px 0 0;">${escapeHtml(result.summary)}</p>` : ""}
        </div>
        ${risks}
        ${result.revision_comment_draft ? `
          <div class="notice" style="margin-top:8px; padding:12px 14px;">
            <strong>보완요청 코멘트 초안</strong>
            <p style="margin:6px 0 0; white-space:pre-wrap;">${escapeHtml(result.revision_comment_draft)}</p>
          </div>` : ""}
      `;
    };

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

      // 기업/계정 정보 탭: 기업 기본정보
      setText("[data-summary-name]", company.name);
      setText("[data-phone]", company.phone || "-");
      setText("[data-program-name]", company.support_programs?.name || "-");
      const agreement = company.agreement_start_date && company.agreement_end_date
        ? `${formatDate(company.agreement_start_date)} ~ ${formatDate(company.agreement_end_date)}`
        : "-";
      setText("[data-agreement]", agreement);
      setText("[data-approval-status-2]", approvalText[company.approval_status] || company.approval_status || "-");
      setText("[data-budget-status-2]", getBudgetStatusLabel(company.budget_status));

      // 기업/계정 정보 탭: 계정 가입 현황
      const account = detail.account || {};
      setText("[data-account-email]", account.email || "-");
      setText("[data-account-name]", account.name || company.representative_name || "-");
      setText("[data-account-status]", approvalText[company.approval_status] || company.approval_status || "-");
      setText("[data-account-created]", company.created_at ? formatDate(company.created_at) : "-");
      setText("[data-account-approved]", company.approved_at ? formatDate(company.approved_at) : "-");

      // 가입 승인/반려 버튼: 현재 상태에 따라 비활성화
      const approveSignupBtn = document.getElementById("btn-approve-signup");
      const rejectSignupBtn = document.getElementById("btn-reject-signup");
      if (approveSignupBtn) approveSignupBtn.disabled = company.approval_status === "approved";
      if (rejectSignupBtn) rejectSignupBtn.disabled = company.approval_status === "rejected";

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
      if (budgetReviewBadge) {
        budgetReviewBadge.hidden = !detail.pendingSubmission;
        if (detail.pendingSubmission) {
          budgetReviewBadge.classList.add("dot-badge");
          budgetReviewBadge.textContent = ""; // ● 글자 제거하여 순수 점으로 렌더링
        }
      }
      const expenseReviewBadge = document.querySelector("[data-badge-expense-review]");
      if (expenseReviewBadge) {
        expenseReviewBadge.hidden = pendingExpenses.length === 0;
        if (pendingExpenses.length > 0) {
          expenseReviewBadge.textContent = String(pendingExpenses.length);
          expenseReviewBadge.classList.remove("dot-badge");
          expenseReviewBadge.classList.add("count-badge");
        } else {
          expenseReviewBadge.textContent = "";
          expenseReviewBadge.classList.add("dot-badge");
          expenseReviewBadge.classList.remove("count-badge");
        }
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
        if (aiBudgetReviewBtn) aiBudgetReviewBtn.disabled = false;
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
        if (aiBudgetReviewBtn) aiBudgetReviewBtn.disabled = true;
        if (aiBudgetReviewResultEl) aiBudgetReviewResultEl.innerHTML = "";
      }
    };

    // 예산 제출안 심사 액션 (승인 시에만 확정 예산 반영)
    const commentInput = document.getElementById("budget-review-comment");

    const submitBudgetReview = async (decision, label, btn) => {
      const pending = detail.pendingSubmission;
      if (!pending) {
        showToast("검토할 예산 제출안이 없습니다.", { type: "warning" });
        return;
      }
      const comment = commentInput.value.trim();
      if (decision !== "approved" && !comment) {
        showToast("보완요청 시에는 사유를 입력해야 합니다.", { type: "warning" });
        commentInput.focus();
        return;
      }
      const ok = await showConfirm(`이 예산안을 ${label} 처리하시겠습니까?`, {
        title: `예산안 ${label}`,
        confirmText: label,
        cancelText: "취소",
        tone: decision === "approved" ? "default" : "danger",
      });
      if (!ok) return;

      await runWithErrorBoundary(async () => {
        await reviewBudgetSubmission(pending.id, decision, comment, user.profile.name);
        commentInput.value = "";
        detail = await getAdminCompanyDetail(id);
        renderHeader();
        showToast(`예산안이 ${label} 처리되었습니다.`, { type: "success" });
      }, { button: btn });
    };

    document.getElementById("btn-approve-budget")?.addEventListener("click", (e) => submitBudgetReview("approved", "승인", e.currentTarget));
    document.getElementById("btn-revision-budget")?.addEventListener("click", (e) => submitBudgetReview("revision_requested", "보완요청", e.currentTarget));
    aiBudgetReviewBtn?.addEventListener("click", async (e) => {
      const payload = buildBudgetAiPayload();
      if (!payload) {
        showToast("AI로 검토할 예산 제출안이 없습니다.", { type: "warning" });
        return;
      }
      if (aiBudgetReviewResultEl) {
        aiBudgetReviewResultEl.innerHTML = `<p class="empty">AI가 예산 제출안을 검토하는 중입니다...</p>`;
      }
      await runWithErrorBoundary(async () => {
        const result = await requestBudgetAiReview(payload);
        renderBudgetAiReviewResult(result);
        if (result.revision_comment_draft && commentInput && !commentInput.value.trim()) {
          commentInput.value = result.revision_comment_draft;
        }
        showToast("AI 검토가 완료되었습니다.", { type: "success" });
      }, { button: e.currentTarget });
    });

    // 계정 가입 승인/반려: 처리 후 상세를 다시 불러와 현황을 갱신한다.
    const reloadDetail = async () => {
      detail = await getAdminCompanyDetail(id);
      renderHeader();
    };
    document.getElementById("btn-approve-signup")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const ok = await showConfirm("이 기업의 가입을 승인하시겠습니까?", {
        title: "가입 승인",
        confirmText: "승인",
        cancelText: "취소",
      });
      if (!ok) return;
      await runWithErrorBoundary(async () => {
        await approveCompany(id, user.id);
        await reloadDetail();
        showToast("가입이 승인되었습니다.", { type: "success" });
      }, { button: btn });
    });
    document.getElementById("btn-reject-signup")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const ok = await showConfirm("이 기업의 가입을 반려하시겠습니까?", {
        title: "가입 반려",
        confirmText: "반려",
        cancelText: "취소",
        tone: "danger",
      });
      if (!ok) return;
      await runWithErrorBoundary(async () => {
        await rejectCompany(id);
        await reloadDetail();
        showToast("가입이 반려되었습니다.", { type: "success" });
      }, { button: btn });
    });

    // 기업 담당자 로그인 비밀번호 재설정
    document.getElementById("btn-reset-founder-password")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const input = document.getElementById("founder-new-password");
      const next = input.value.trim();
      if (next.length < 6) {
        showToast("새 비밀번호는 6자 이상이어야 합니다.", { type: "warning" });
        input.focus();
        return;
      }
      const ok = await showConfirm("기업 담당자의 로그인 비밀번호를 변경하시겠습니까?", {
        title: "비밀번호 변경",
        confirmText: "변경",
        cancelText: "취소",
      });
      if (!ok) return;
      await runWithErrorBoundary(async () => {
        await resetFounderPassword(id, next);
        input.value = "";
        showToast("비밀번호가 변경되었습니다.", { type: "success" });
      }, { button: btn });
    });

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

    // ZIP Download — 아직 미구현. 실제 완료된 다운로드처럼 보이지 않도록 '준비 중' 안내만 한다.
    document.getElementById("btn-download-all-docs")?.addEventListener("click", () => {
      showToast("전체 문서 ZIP 다운로드는 아직 준비 중입니다.", { type: "info" });
    });

    renderHeader();
  }
} catch (error) {
  showError(error);
}
