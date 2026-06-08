import { mountShell, runWithErrorBoundary, showError, setText, showToast, showConfirm } from "../../app.js";
import { requireRole } from "../../auth.js";
import {
  getAdminCompanyDetail,
  reviewBudgetSubmission,
  downloadStoredFile,
  downloadStoredFileToDisk,
  updateCompanyInternalMemo,
  approveCompany,
  rejectCompany,
  resetFounderPassword,
  requestBudgetAiReview,
  fetchStoredFileBase64,
  downloadExpenseEvidenceZip,
} from "../../api.js";
import { BudgetTreeView } from "../../components/BudgetTreeView.js";
import { BudgetSubmissionDiff } from "../../components/budget/BudgetSubmissionDiff.js";
import { BudgetHistoryTable } from "../../components/budget/BudgetHistoryTable.js";
import { ExpenseTable } from "../../components/ExpenseTable.js";
import { attachCategoryHighlight, attachAllocationHandlers } from "../../dom/admin-company-detail.js";
import { getBudgetStatusLabel } from "../../domains/budget/budget-status.js";
import { ADMIN_REVIEW_STATUSES } from "../../domains/status.js";
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

const expenseDetailHref = (id) => `expense-detail.html?id=${encodeURIComponent(id)}`;

try {
  mountShell();
  const user = await requireRole(["admin", "super_admin"]);
  if (user) {
    const id = getQueryParam("id") || "comp-abc";
    let detail = await getAdminCompanyDetail(id);

    const budgetTreeEl = document.querySelector("[data-budget-tree]");
    const expenseTableEl = document.querySelector("[data-expense-table]");
    const expenseAllTableEl = document.querySelector("[data-expense-all-table]");
    const budgetSubmissionsEl = document.querySelector("[data-budget-submissions]");
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
    // AI 비전/문서 모델이 읽을 수 있는 형식만 첨부한다(파일명 확장자로 판별). hwp/docx 등은 제외.
    const aiReadableMime = (name) => {
      const ext = String(name || "").split(".").pop().toLowerCase();
      if (ext === "pdf") return "application/pdf";
      if (ext === "png") return "image/png";
      if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
      if (ext === "webp") return "image/webp";
      return null;
    };

    // 예산 검토 AI 에 함께 보낼 사업계획서 첨부본을 수집한다.
    // 제출 차수에 맞는 계획서를 우선(최초→1차, 변경→2차)하되, 용량/토큰 보호를 위해 가장 관련 있는 1건만 첨부한다.
    const collectBudgetPlanDocuments = async () => {
      const plans = detail.company?.business_plans || {};
      const order = detail.pendingSubmission?.type === "change" ? ["round2", "round1"] : ["round1", "round2"];
      for (const round of order) {
        const plan = plans[round];
        if (!plan?.link_url) continue;
        const mime = aiReadableMime(plan.original_filename);
        if (!mime) continue; // AI 가 읽을 수 없는 형식은 건너뛴다(텍스트 기준으로만 검토).
        let fetched = null;
        try {
          fetched = await fetchStoredFileBase64(plan.link_url);
        } catch (_) {
          continue; // 파일을 가져오지 못하면 첨부 없이(텍스트 기준) 검토를 진행한다.
        }
        if (!fetched?.data_base64) continue;
        const resolvedMime =
          fetched.mime_type && fetched.mime_type !== "application/octet-stream" ? fetched.mime_type : mime;
        return [{
          round,
          filename: plan.original_filename || `${round}.pdf`,
          mime_type: resolvedMime,
          data_base64: fetched.data_base64,
        }];
      }
      return [];
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
      // 협약 기간은 참가 사업(신규사업 관리)에서 세팅한 값을 우선 사용한다(기업별 레거시 값은 대체용).
      const agreeStart = company.support_programs?.agreement_start_date || company.agreement_start_date;
      const agreeEnd = company.support_programs?.agreement_end_date || company.agreement_end_date;
      const agreement = agreeStart && agreeEnd
        ? `${formatDate(agreeStart)} ~ ${formatDate(agreeEnd)}`
        : "-";
      setText("[data-agreement]", agreement);
      setText("[data-approval-status-2]", approvalText[company.approval_status] || company.approval_status || "-");
      setText("[data-budget-status-2]", getBudgetStatusLabel(company.budget_status));

      // 기업/계정 정보 탭: 계정 가입 현황
      const account = detail.account || {};
      setText("[data-account-email]", account.email || "-");
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

      // 지출 검토 대기: 관리자 '지출 신청 승인 대기' 목록과 동일한 표(ExpenseTable)를 쓰되,
      // 기업 상세 화면이므로 기업 열만 숨긴다(검토 대기 상태 = 사전/최종 승인 검토 대기).
      const pendingExpenses = detail.expenses.filter((row) => ADMIN_REVIEW_STATUSES.includes(row.status));

      expenseTableEl.innerHTML = ExpenseTable(pendingExpenses, {
        admin: true,
        hideCompany: true,
        hideChecklist: true,
        emptyText: "검토 대기 중인 예산 사용 신청이 없습니다.",
        action: (row) => `<a class="button small" href="${expenseDetailHref(row.id)}">검토하기</a>`,
      });
      // 지출 신청 현황: 검토 대기와 동일한 표 구성에, 처리 열 대신 '증빙 다운로드'(첨부서류 ZIP) 버튼 열을 둔다.
      if (expenseAllTableEl) {
        const allExpenses = [...detail.expenses].sort((a, b) =>
          String(b.submitted_at || b.created_at || "").localeCompare(String(a.submitted_at || a.created_at || "")),
        );
        expenseAllTableEl.innerHTML = ExpenseTable(allExpenses, {
          admin: true,
          hideCompany: true,
          hideChecklist: true,
          emptyText: "아직 등록된 지출 신청이 없습니다.",
          actionLabel: "증빙",
          action: (row) =>
            `<button class="button small secondary" type="button" data-evidence-zip="${escapeHtml(row.id)}">증빙 다운로드</button>`,
        });
      }
      // 예산 검토 탭: 검토 패널 외에 이 기업의 예산안 제출/변경 요청 이력과 상태를 함께 보여준다.
      if (budgetSubmissionsEl) {
        budgetSubmissionsEl.innerHTML = BudgetHistoryTable(
          detail.budgetSubmissions,
          detail.company?.business_plans?.round2?.budget_submission_id || null,
        );
      }

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

    // 입력/AI 작성 내용에 맞춰 코멘트 입력란 높이를 자동으로 늘린다(수동 입력·AI 초안 모두 반영).
    const COMMENT_MIN_HEIGHT = 64;
    const autoGrowComment = () => {
      if (!commentInput) return;
      commentInput.style.height = "auto";
      commentInput.style.height = `${Math.max(COMMENT_MIN_HEIGHT, commentInput.scrollHeight)}px`;
    };
    if (commentInput) {
      commentInput.style.overflowY = "hidden";
      commentInput.addEventListener("input", autoGrowComment);
    }

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
        autoGrowComment();
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
        // 사업계획서 첨부본을 함께 보내, 예산 항목/금액이 사업계획과 정합하는지도 점검하게 한다.
        payload.documents = await collectBudgetPlanDocuments();
        const result = await requestBudgetAiReview(payload);
        renderBudgetAiReviewResult(result);
        if (result.revision_comment_draft && commentInput && !commentInput.value.trim()) {
          commentInput.value = result.revision_comment_draft;
          autoGrowComment();
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
    // 새 탭에서 여는 대신 원본 파일명으로 실제 파일을 내려받는다.
    document.querySelectorAll("[data-bp-download]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const plan = detail.company?.business_plans?.[btn.dataset.bpDownload];
        if (!plan?.original_filename) return;
        await runWithErrorBoundary(async () => {
          await downloadStoredFileToDisk(plan.link_url, plan.original_filename);
        }, { button: btn });
      });
    });

    // 지출 검토 대기/현황 표: 행 클릭 → 지출 상세 검토 페이지로 이동(컨테이너에 1회 위임 바인딩, 표는 매 렌더마다 갱신됨).
    //   링크/버튼(검토하기·증빙 다운로드) 클릭은 자체 동작에 맡기고 행 이동은 막는다.
    const navigateExpenseRow = (e) => {
      if (e.target.closest("a, button")) return;
      const row = e.target.closest("tr[data-href]");
      if (row) window.location.href = row.dataset.href;
    };
    expenseTableEl?.addEventListener("click", navigateExpenseRow);
    expenseAllTableEl?.addEventListener("click", async (e) => {
      // 증빙 다운로드 버튼: 이 기업의 첨부서류를 ZIP 으로 내려받는다.
      const zipBtn = e.target.closest("[data-evidence-zip]");
      if (zipBtn) {
        const expenseId = zipBtn.dataset.evidenceZip;
        const expenseRow = detail.expenses.find((row) => row.id === expenseId) || { id: expenseId };
        await runWithErrorBoundary(async () => {
          const count = await downloadExpenseEvidenceZip({ ...expenseRow, company_name: detail.company?.name });
          if (count === 0) {
            showToast("첨부된 증빙서류가 없습니다.", { type: "info" });
          } else {
            showToast(`증빙서류 ${count}건을 ZIP으로 내려받았습니다.`, { type: "success" });
          }
        }, { button: zipBtn });
        return;
      }
      navigateExpenseRow(e);
    });

    // 예산 신청 현황 표: 행 클릭/Enter → 비목별 상세 펼침(창업자 히스토리 표와 동일 동작).
    const toggleBudgetRow = (row) => {
      const idx = row.dataset.historyRow;
      const detailRow = budgetSubmissionsEl?.querySelector(`[data-history-detail="${idx}"]`);
      if (!detailRow) return;
      const willOpen = detailRow.hidden;
      detailRow.hidden = !willOpen;
      row.classList.toggle("expanded", willOpen);
      row.setAttribute("aria-expanded", String(willOpen));
    };
    budgetSubmissionsEl?.addEventListener("click", (e) => {
      const row = e.target.closest("[data-history-row]");
      if (row) toggleBudgetRow(row);
    });
    budgetSubmissionsEl?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const row = e.target.closest("[data-history-row]");
      if (row) { e.preventDefault(); toggleBudgetRow(row); }
    });

    renderHeader();
  }
} catch (error) {
  showError(error);
}
