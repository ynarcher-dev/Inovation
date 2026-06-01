import { mountShell, runWithErrorBoundary, showError } from "../app.js";
import { requireRole } from "../auth.js";
import { downloadStoredFile, getExpenseDetail } from "../api.js";
import { Checklist } from "../components/Checklist.js";
import { getSimpleExpenseStatus } from "../status.js";
import { escapeHtml, formatCurrency, formatDate, getQueryParam } from "../utils.js";

// 신청은 작성 즉시 '검토 중'으로 접수되고 이후 수정이 불가하므로, 상세 화면은 조회 전용이다.
const ADVANCE_DOC_TYPES = new Set(["advance_payment_request", "advance_payment_plan"]);
const OTHER_EVIDENCE_TYPE = "other_evidence";

try {
  mountShell();
  const user = await requireRole(["founder"]);
  if (user) {
    const id = getQueryParam("id");
    const { expense, documents, files, reviews } = await getExpenseDetail(id);

    // 제출된 첨부 파일을 원본 파일명으로 다시 내려받는다(조회 전용 공통 동작).
    const wireDownloads = (root) => {
      root.querySelectorAll("[data-download-file]").forEach((button) => {
        button.addEventListener("click", () => {
          runWithErrorBoundary(async () => {
            await downloadStoredFile(button.dataset.downloadFile, button.dataset.fileName);
          }, { button });
        });
      });
    };

    // 기타 증빙서류 파일 목록(다운로드 전용).
    const evidenceListHtml = (evidenceFiles) => {
      if (!evidenceFiles.length) return "";
      const items = evidenceFiles.map((file) => `
        <li class="evidence-file">
          <span class="evidence-file-name"><span aria-hidden="true">📎</span> ${escapeHtml(file.original_filename)}</span>
          <span class="doc-file-actions">
            <button class="doc-file-btn" type="button" data-download-file="${escapeHtml(file.link_url || "")}" data-file-name="${escapeHtml(file.original_filename)}">다운로드</button>
          </span>
        </li>`).join("");
      return `<ul class="evidence-list">${items}</ul>`;
    };

    // 서류 제출 영역: 기본 첨부 + 선금 신청 서류 + 기타 증빙서류(모두 조회 전용).
    const renderChecklist = () => {
      const baseDocs = documents.filter((d) => !ADVANCE_DOC_TYPES.has(d.document_type));
      const advanceDocs = documents.filter((d) => ADVANCE_DOC_TYPES.has(d.document_type));
      const evidenceFiles = files.filter((f) => f.document_type === OTHER_EVIDENCE_TYPE);

      const checklistRoot = document.querySelector("[data-checklist]");
      checklistRoot.innerHTML = Checklist(baseDocs, { files, actionable: false, downloadable: true });
      wireDownloads(checklistRoot);

      const advanceRoot = document.querySelector("[data-advance-docs]");
      if (advanceDocs.length) {
        advanceRoot.innerHTML = `<h3 class="doc-section-title">선금 신청 서류</h3>`
          + Checklist(advanceDocs, { files, actionable: false, downloadable: true });
        wireDownloads(advanceRoot);
      } else {
        advanceRoot.innerHTML = "";
      }

      const otherRoot = document.querySelector("[data-other-evidence-docs]");
      if (evidenceFiles.length) {
        otherRoot.innerHTML = `<h3 class="doc-section-title">기타 증빙서류</h3>` + evidenceListHtml(evidenceFiles);
        wireDownloads(otherRoot);
      } else {
        otherRoot.innerHTML = "";
      }
    };

    // 검토 결과(decision)별 한글 라벨/배지 톤.
    const REVIEW_DECISIONS = {
      approved: { label: "승인", tone: "success" },
      revision_requested: { label: "보완요청", tone: "warning" },
      rejected: { label: "반려", tone: "danger" },
    };

    // 승인/보완요청/반려 코멘트를 최신순으로 노출한다(검토 이력이 없으면 영역 자체를 숨김).
    const renderReviews = () => {
      const reviewRoot = document.querySelector("[data-reviews]");
      if (!reviewRoot) return;
      const list = (reviews || [])
        .filter((r) => REVIEW_DECISIONS[r.decision])
        .slice()
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      if (!list.length) {
        reviewRoot.innerHTML = "";
        return;
      }
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

    // 뱃지는 검토 중/승인/보완/반려 단순 상태로만 노출한다(집행·검수·정산 세부단계 숨김).
    const simpleStatus = getSimpleExpenseStatus(expense.status);
    document.querySelector("[data-title]").textContent = expense.title;
    document.querySelector("[data-status]").innerHTML =
      `<span class="badge badge-${simpleStatus.tone}">${escapeHtml(simpleStatus.label)}</span>`;
    document.querySelector("[data-summary]").innerHTML = `
      <dl class="summary-list">
        <div class="summary-row">
          <dt>지출 제목</dt>
          <dd>${escapeHtml(expense.title || "-")}</dd>
        </div>
        <div class="summary-row">
          <dt>사업계획서 항목</dt>
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
    renderReviews();
    renderChecklist();
  }
} catch (error) {
  showError(error);
}
