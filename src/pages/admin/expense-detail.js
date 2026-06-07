import { mountShell, runWithErrorBoundary, showError, showToast, showConfirm, setPendingToast } from "../../app.js";
import { requireRole } from "../../auth.js";
import {
  getExpenseDetail,
  reviewExpenseRequest,
  getExpenseDocumentRequirements,
  downloadStoredFile,
  getAiSettings,
} from "../../api.js";
import { StatusBadge } from "../../components/StatusBadge.js";
import { getReviewKind } from "../../domains/status.js";
import { renderDocumentPhasePanel, openAiReviewModal } from "../../components/expense/DocumentPhasePanel.js";
import { escapeHtml, formatCurrency, formatDate, getQueryParam } from "../../utils.js";

// 관리자 상세: 제출된 첨부서류 + AI 검토 결과를 단계별 읽기 전용으로 표시한다(§6).
async function renderAdminDocPanels(expenseId, aiEnabled) {
  const defs = [
    { phase: "pre", title: "사전승인 첨부서류", container: "[data-doc-panel-pre]" },
    { phase: "final", title: "최종승인 첨부서류", container: "[data-doc-panel-final]" },
  ];
  for (const def of defs) {
    const container = document.querySelector(def.container);
    if (!container) continue;
    const requirements = (await getExpenseDocumentRequirements(expenseId, def.phase)) || [];
    renderDocumentPhasePanel(container, {
      phase: def.phase, title: def.title, requirements, editable: false, mode: "admin",
      aiEnabled,
    });
    container.querySelectorAll("[data-doc-open]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const req = requirements.find((r) => r.file?.id === btn.dataset.docOpen);
        await runWithErrorBoundary(async () => {
          await downloadStoredFile(req?.file?.link_url, req?.file?.original_filename);
        }, { button: btn });
      }));
    container.querySelectorAll("[data-doc-ai-comment]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const req = requirements.find((r) => r.file?.id === btn.dataset.docAiComment);
        if (!req?.file) return;
        openAiReviewModal({ req, mode: "admin", editable: false });
      }));
  }
}

const REVIEW_DECISIONS = {
  approved: { label: "승인", tone: "success" },
  revision_requested: { label: "보완요청", tone: "warning" },
};

// 승인/보완요청 코멘트를 최신순으로 노출한다(검토 이력이 없으면 카드를 숨김).
function renderReviews(reviews) {
  const reviewRoot = document.querySelector("[data-reviews]");
  if (!reviewRoot) return;
  const list = (reviews || [])
    .filter((r) => REVIEW_DECISIONS[r.decision])
    .slice()
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  if (!list.length) {
    reviewRoot.innerHTML = "";
    reviewRoot.hidden = true;
    return;
  }
  reviewRoot.hidden = false;
  const rows = list.map((review) => {
    const meta = REVIEW_DECISIONS[review.decision];
    return `
      <div class="review-row">
        <div class="review-row-head">
          <span class="badge badge-${meta.tone}">${escapeHtml(meta.label)}</span>
          <span class="review-date">${formatDate(review.created_at)}</span>
        </div>
        <p class="review-comment">${review.comment ? escapeHtml(review.comment) : "코멘트 없음"}</p>
      </div>`;
  }).join("");
  reviewRoot.innerHTML = `<h2>검토 결과</h2>${rows}`;
}

try {
  mountShell();
  const user = await requireRole(["admin", "super_admin"]);
  if (user) {
    const id = getQueryParam("id");
    const { expense, budgetCheck, reviews } = await getExpenseDetail(id);
    const aiSettings = await getAiSettings();
    document.querySelector("[data-title]").textContent = expense.title;
    document.querySelector("[data-status]").innerHTML = StatusBadge(expense.status);
    document.querySelector("[data-summary]").innerHTML = `
      <dl class="summary-list summary-list--wide">
        <div class="summary-row">
          <dt>기업</dt>
          <dd>${escapeHtml(expense.company_name || "-")}</dd>
        </div>
        <div class="summary-row">
          <dt>대표자</dt>
          <dd>${escapeHtml(expense.representative_name || "-")}</dd>
        </div>
        <div class="summary-row">
          <dt>지출 제목</dt>
          <dd>${escapeHtml(expense.title || "-")}</dd>
        </div>
        <div class="summary-row">
          <dt>예산 항목</dt>
          <dd>${escapeHtml(expense.business_plan_item_label || expense.budget_category || "-")}</dd>
        </div>
        <div class="summary-row">
          <dt>거래처명</dt>
          <dd>${escapeHtml(expense.vendor_name || "-")}</dd>
        </div>
        <div class="summary-row">
          <dt>거래처 사업자등록번호</dt>
          <dd>${escapeHtml(expense.vendor_business_number || "-")}</dd>
        </div>
        <div class="summary-row">
          <dt>공급가액</dt>
          <dd class="summary-amount">${formatCurrency(expense.amount_supply)}</dd>
        </div>
        <div class="summary-row">
          <dt>부가세</dt>
          <dd class="summary-amount">${formatCurrency(expense.vat_amount)}</dd>
        </div>
        <div class="summary-row">
          <dt>총액</dt>
          <dd class="summary-amount">${formatCurrency(expense.total_amount)}</dd>
        </div>
        <div class="summary-row">
          <dt>지출 예정일자</dt>
          <dd>${expense.expected_completion_date ? formatDate(expense.expected_completion_date) : "-"}</dd>
        </div>
        <div class="summary-row">
          <dt>신청 내용</dt>
          <dd>${escapeHtml(expense.purpose || "-")}</dd>
        </div>
        ${budgetCheck ? `
        <div class="summary-row">
          <dt>적합성</dt>
          <dd class="summary-fit ${budgetCheck.exceeds ? "danger" : "success"}">${budgetCheck.exceeds ? "잔액 초과 ⚠️" : "잔액 내 적합"} <span class="muted">(신청 후 잔액 ${formatCurrency(budgetCheck.remaining_after)})</span></dd>
        </div>` : ""}
      </dl>
    `;
    renderReviews(reviews);
    await renderAdminDocPanels(expense.id, aiSettings.enabled);

    // 현재 상태에 따라 검토 종류(사전승인/최종승인)와 폼을 분기한다.
    //  - 검토 결과는 승인/보완요청 두 가지다(반려 없음).
    //  - 검토 대상이 아닌 상태에서는 검토 폼을 숨긴다.
    const reviewKind = getReviewKind(expense.status);
    const reviewForm = document.querySelector("[data-review-form]");
    const reviewTitle = document.querySelector("[data-review-title]");
    const reviewEmpty = document.querySelector("[data-review-empty]");

    if (reviewKind === "pre") {
      reviewTitle.textContent = "사전승인 검토";
      reviewForm.hidden = false;
      reviewEmpty.hidden = true;
    } else if (reviewKind === "final") {
      reviewTitle.textContent = "최종승인 검토";
      reviewForm.hidden = false;
      reviewEmpty.hidden = true;
    } else {
      reviewTitle.textContent = "검토 처리";
      reviewForm.hidden = true;
      reviewEmpty.hidden = false;
    }

    reviewForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitter = event.submitter;
      const decision = submitter.value;
      const commentInput = document.querySelector("#comment");
      const comment = commentInput.value;
      const meta = REVIEW_DECISIONS[decision];
      const label = meta?.label || "처리";

      // 보완요청 시에는 사유를 입력받는다.
      if (decision === "revision_requested" && !comment.trim()) {
        showToast("보완요청 시에는 사유를 입력해야 합니다.", { type: "warning" });
        commentInput.focus();
        return;
      }

      // 잔액 초과 건을 승인할 때는 초과 사실을 명시한 경고 확인을 한 번 더 받는다(강제 승인 허용).
      const overBudgetApproval = decision === "approved" && budgetCheck?.exceeds;
      const confirmMessage = overBudgetApproval
        ? `이 신청은 예산 잔액을 초과합니다. (신청 후 잔액 ${formatCurrency(budgetCheck.remaining_after)}) 그래도 승인하시겠습니까?`
        : `검토 결과를 '${label}'(으)로 처리하시겠습니까?`;
      const ok = await showConfirm(confirmMessage, {
        title: overBudgetApproval ? "잔액 초과 승인" : `${label} 처리`,
        confirmText: label,
        cancelText: "취소",
        tone: decision === "approved" && !overBudgetApproval ? "default" : "danger",
      });
      if (!ok) return;

      await runWithErrorBoundary(async () => {
        await reviewExpenseRequest(expense.id, decision, comment, user.id);
        // reload 후 완료 토스트를 띄우기 위해 미리 예약한다(§6.2).
        setPendingToast(`검토 결과가 저장되었습니다. (${label})`, "success");
        window.location.reload();
      }, { button: submitter });
    });
  }
} catch (error) {
  showError(error);
}
