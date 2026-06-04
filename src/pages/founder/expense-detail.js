import { mountShell, runWithErrorBoundary, showError } from "../../app.js";
import { requireRole } from "../../auth.js";
import { getExpenseDetail, submitExpenseRequest } from "../../api.js";
import { getStatusLabel, getStatusTone } from "../../domains/status.js";
import { escapeHtml, formatCurrency, formatDate, getQueryParam } from "../../utils.js";

try {
  mountShell();
  const user = await requireRole(["founder"]);
  if (user) {
    const id = getQueryParam("id");
    const { expense, reviews } = await getExpenseDetail(id);

    // 검토 결과(decision)별 한글 라벨/배지 톤.
    const REVIEW_DECISIONS = {
      approved: { label: "승인", tone: "success" },
      revision_requested: { label: "보완요청", tone: "warning" },
    };

    // 승인/보완요청 코멘트를 최신순으로 노출한다(검토 이력이 없으면 영역 자체를 숨김).
    const renderReviews = () => {
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
    };

    // 수정 가능 상태별 CTA(수정/보완하기, 사전·최종승인 신청)를 렌더한다.
    const renderCta = () => {
      const ctaRoot = document.querySelector("[data-cta]");
      const guideEl = document.querySelector("[data-edit-guide]");
      if (!ctaRoot) return;
      const editHref = `expense-new.html?id=${encodeURIComponent(id)}`;
      const buttons = [];
      let guide = "";

      if (expense.status === "draft") {
        buttons.push(`<a class="button secondary" href="${editHref}">수정하기</a>`);
        buttons.push(`<button class="button" type="button" data-submit-expense>사전승인 신청</button>`);
        guide = "임시저장 상태입니다. 내용·서류를 수정한 뒤 사전승인을 신청하세요.";
      } else if (expense.status === "pre_approval_revision") {
        buttons.push(`<a class="button" href="${editHref}">보완하기</a>`);
        guide = "보완 요청된 건은 같은 신청 건에서 서류와 내용을 수정한 뒤 다시 제출할 수 있습니다.";
      } else if (expense.status === "final_approval_revision") {
        buttons.push(`<a class="button" href="${editHref}">최종승인 보완하기</a>`);
        guide = "최종승인 보완 요청된 건은 같은 신청 건에서 수정한 뒤 다시 제출할 수 있습니다.";
      } else if (expense.status === "pre_approved") {
        buttons.push(`<button class="button" type="button" data-submit-expense>최종승인 신청</button>`);
        guide = "사전승인이 완료되었습니다. 최종승인용 서류를 추가한 뒤 최종승인을 신청하세요.";
      }

      ctaRoot.innerHTML = buttons.join("");
      if (guideEl) guideEl.textContent = guide;

      const submitBtn = ctaRoot.querySelector("[data-submit-expense]");
      if (submitBtn) {
        submitBtn.addEventListener("click", (event) => {
          const label = expense.status === "pre_approved" ? "최종승인" : "사전승인";
          if (!window.confirm(`${label} 신청을 진행하시겠습니까? 제출 후에는 관리자 검토가 시작됩니다.`)) return;
          runWithErrorBoundary(async () => {
            await submitExpenseRequest(id);
            window.location.reload();
          }, { button: event.currentTarget });
        });
      }
    };

    // 뱃지는 신규 8단계명을 그대로 노출한다.
    document.querySelector("[data-title]").textContent = expense.title;
    document.querySelector("[data-status]").innerHTML =
      `<span class="badge badge-${getStatusTone(expense.status)}">${escapeHtml(getStatusLabel(expense.status))}</span>`;
    document.querySelector("[data-summary]").innerHTML = `
      <dl class="summary-list summary-list--wide">
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
          <dt>지출 예정일자</dt>
          <dd>${formatDate(expense.expected_completion_date)}</dd>
        </div>
        <div class="summary-row">
          <dt>신청 내용</dt>
          <dd>${escapeHtml(expense.purpose || "-")}</dd>
        </div>
      </dl>
    `;
    renderCta();
    renderReviews();
  }
} catch (error) {
  showError(error);
}
