import { mountShell, runWithErrorBoundary, showError } from "../app.js";
import { requireRole } from "../auth.js";
import { advanceExpenseStage, downloadStoredFile, getExpenseDetail, reviewExpenseRequest } from "../api.js";
import { Checklist } from "../components/Checklist.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { escapeHtml, formatCurrency, formatDate, getQueryParam } from "../utils.js";

function BudgetCheckPanel(check) {
  if (!check) return `<p class="empty">예산 검토 정보가 없습니다.</p>`;
  const fitClass = check.exceeds ? "danger" : "success";
  const fit = check.exceeds ? "잔액 초과 ⚠️" : "잔액 내 적합";
  return `
    <dl class="summary-list summary-list--wide">
      <div class="summary-row">
        <dt>비목</dt>
        <dd>${escapeHtml(check.budget_category || "-")}</dd>
      </div>
      <div class="summary-row">
        <dt>배정(확정) 예산</dt>
        <dd class="summary-num">${formatCurrency(check.allocated)}</dd>
      </div>
      <div class="summary-row">
        <dt>기승인 / 검토중(타 건)</dt>
        <dd class="summary-num">${formatCurrency(check.approved_other)} / ${formatCurrency(check.pending_other)}</dd>
      </div>
      <div class="summary-row">
        <dt>신청 전 잔액</dt>
        <dd class="summary-num">${formatCurrency(check.remaining_before)}</dd>
      </div>
      <div class="summary-row">
        <dt>이번 신청(공급가액)</dt>
        <dd class="summary-num">${formatCurrency(check.requested)}</dd>
      </div>
      <div class="summary-row">
        <dt>적합성</dt>
        <dd class="summary-fit ${fitClass}">${fit} <span class="muted">(신청 후 잔액 ${formatCurrency(check.remaining_after)})</span></dd>
      </div>
    </dl>
  `;
}

function WarningList(warnings) {
  if (!warnings?.length) return `<p class="empty">현재 입력값 기준 위험 경고가 없습니다.</p>`;
  const toneClass = { danger: "notice-danger", warning: "notice-warning", info: "notice-info" };
  return `<div class="warning-list">${warnings.map((w) => `
    <p class="notice ${toneClass[w.severity] || ""}">${escapeHtml(w.message)}</p>
  `).join("")}</div>`;
}

// 신청자(설립자)가 제출한 서류를 동일한 분류로 보여준다(기본 첨부 / 선금 신청 / 기타 증빙).
const ADVANCE_DOC_TYPES = new Set(["advance_payment_request", "advance_payment_plan"]);
const OTHER_EVIDENCE_TYPE = "other_evidence";

// 기타 증빙서류: 신청자가 올린 복수 파일 목록(다운로드 전용).
function EvidenceList(evidenceFiles) {
  if (!evidenceFiles.length) return "";
  const items = evidenceFiles.map((file) => `
    <li class="evidence-file">
      <span class="evidence-file-name"><span aria-hidden="true">📎</span> ${escapeHtml(file.original_filename)}</span>
      <span class="doc-file-actions">
        <button class="doc-file-btn" type="button" data-download-file="${escapeHtml(file.link_url || "")}" data-file-name="${escapeHtml(file.original_filename)}">다운로드</button>
      </span>
    </li>`).join("");
  return `<ul class="evidence-list">${items}</ul>`;
}

function AiPanel(files, expense) {
  const analyzable = (files || []).filter((f) => !f.generated);
  if (!analyzable.length) return `<p class="empty">분석할 업로드 파일이 없습니다.</p>`;
  const fmtAmount = (v) => (v == null ? "-" : formatCurrency(v));
  const match = (a, b) => (a != null && b != null && Number(a) === Number(b));
  return `
    <p class="notice" style="border-left:4px solid #6b7280; padding-left:8px;">AI 추출 결과는 <strong>참고용</strong>이며 자동 승인 근거로 사용하지 않습니다. 최종 판단은 관리자가 수행합니다.</p>
    ${analyzable.map((f) => {
      const ai = f.ai_check_result || {};
      const amountMatch = match(ai.amount, expense?.amount_supply);
      const vendorMatch = ai.vendor_name && expense?.vendor_name && ai.vendor_name === expense.vendor_name;
      return `
        <div class="card" style="padding:10px 12px; margin-bottom:8px;">
          <strong>${escapeHtml(f.original_filename)}</strong>
          <table style="width:100%; margin-top:6px; font-size:13px;">
            <tr><th style="text-align:left;">문서 유형</th><td>${escapeHtml(ai.document_type || f.document_type || "-")}</td></tr>
            <tr><th style="text-align:left;">추출 금액</th><td>${fmtAmount(ai.amount)} ${amountMatch ? "✅ 신청 금액 일치" : "⚠️ 신청 금액과 대조 필요"}</td></tr>
            <tr><th style="text-align:left;">추출 업체명</th><td>${escapeHtml(ai.vendor_name || "-")} ${vendorMatch ? "✅ 일치" : "⚠️ 대조 필요"}</td></tr>
            <tr><th style="text-align:left;">추출 일자</th><td>${escapeHtml(ai.date || "-")}</td></tr>
            <tr><th style="text-align:left;">날인 감지</th><td>${ai.has_seal ? "있음" : "없음"}</td></tr>
          </table>
        </div>
      `;
    }).join("")}
  `;
}

const REVIEW_DECISIONS = {
  approved: { label: "승인", tone: "success" },
  revision_requested: { label: "보완요청", tone: "warning" },
  rejected: { label: "반려", tone: "danger" },
};

function ReviewList(reviews) {
  const list = (reviews || [])
    .filter((r) => REVIEW_DECISIONS[r.decision])
    .slice()
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  if (!list.length) return `<p class="empty">검토 이력이 없습니다.</p>`;
  return `
    <div class="review-list">
      ${list.map((review) => {
        const meta = REVIEW_DECISIONS[review.decision];
        return `
          <div class="review-row">
            <div class="review-row-head">
              <span class="badge badge-${meta.tone}">${escapeHtml(meta.label)}</span>
              <span class="review-date">${formatDate(review.created_at)}</span>
            </div>
            <p class="review-comment">${review.comment ? escapeHtml(review.comment) : "코멘트 없음"}</p>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

try {
  mountShell();
  const user = await requireRole(["admin", "super_admin"]);
  if (user) {
    const id = getQueryParam("id");
    const { expense, documents, warnings, budgetCheck, files, reviews } = await getExpenseDetail(id);
    document.querySelector("[data-title]").textContent = expense.title;
    document.querySelector("[data-status]").innerHTML = StatusBadge(expense.status);
    document.querySelector("[data-summary]").innerHTML = `
      <dl class="summary-list">
        <div class="summary-row">
          <dt>기업</dt>
          <dd>${escapeHtml(expense.company_name || "-")}</dd>
        </div>
        <div class="summary-row">
          <dt>대표자</dt>
          <dd>${escapeHtml(expense.representative_name || "-")}</dd>
        </div>
        <div class="summary-row">
          <dt>사업계획서 항목</dt>
          <dd>${escapeHtml(expense.business_plan_item_label || expense.budget_category || "-")}</dd>
        </div>
        <div class="summary-row">
          <dt>거래처</dt>
          <dd>${escapeHtml(expense.vendor_name || "-")}${expense.vendor_business_number ? ` <span class="muted">(${escapeHtml(expense.vendor_business_number)})</span>` : ""}</dd>
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
          <dt>지출 예정일</dt>
          <dd>${expense.expected_completion_date ? formatDate(expense.expected_completion_date) : "-"}</dd>
        </div>
        <div class="summary-row">
          <dt>선금 신청</dt>
          <dd>${expense.advance_payment_requested ? "예" : "아니오"}</dd>
        </div>
        <div class="summary-row summary-row-block">
          <dt>지출 목적</dt>
          <dd>${escapeHtml(expense.purpose || "-")}</dd>
        </div>
      </dl>
    `;
    document.querySelector("[data-budget-check]").innerHTML = BudgetCheckPanel(budgetCheck);
    document.querySelector("[data-warnings]").innerHTML = WarningList(warnings);

    // 신청자가 제출한 서류를 분류한다(기본 첨부 / 선금 신청 서류 / 기타 증빙서류).
    const baseDocs = documents.filter((d) => !ADVANCE_DOC_TYPES.has(d.document_type));
    const advanceDocs = documents.filter((d) => ADVANCE_DOC_TYPES.has(d.document_type));
    const evidenceFiles = files.filter((f) => f.document_type === OTHER_EVIDENCE_TYPE);

    // 첨부서류 제출률(필수 서류 기준)
    const requiredDocs = documents.filter((d) => d.required);
    const submittedDocs = requiredDocs.filter((d) => d.status === "uploaded");
    const checklistTitle = document.querySelector("[data-doc-rate]");
    if (checklistTitle) {
      const rate = requiredDocs.length ? Math.round((submittedDocs.length / requiredDocs.length) * 100) : 100;
      const allIn = submittedDocs.length === requiredDocs.length;
      checklistTitle.innerHTML = `필수 ${requiredDocs.length}건 중 <strong style="color:${allIn ? "#047857" : "#b91c1c"};">${submittedDocs.length}건 제출 (${rate}%)</strong>`;
    }

    document.querySelector("[data-checklist]").innerHTML = Checklist(baseDocs, { files, actionable: false, downloadable: true });
    document.querySelector("[data-advance-docs]").innerHTML = advanceDocs.length
      ? `<h3 class="doc-section-title">선금 신청 서류</h3>${Checklist(advanceDocs, { files, actionable: false, downloadable: true })}`
      : "";
    document.querySelector("[data-other-evidence-docs]").innerHTML = evidenceFiles.length
      ? `<h3 class="doc-section-title">기타 증빙서류</h3>${EvidenceList(evidenceFiles)}`
      : "";

    // 첨부 파일 다운로드 (체크리스트/증빙 목록 공용)
    document.querySelectorAll("[data-download-file]").forEach((button) => {
      button.addEventListener("click", () => {
        runWithErrorBoundary(async () => {
          await downloadStoredFile(button.dataset.downloadFile, button.dataset.fileName);
        }, { button });
      });
    });
    document.querySelector("[data-ai]").innerHTML = AiPanel(files, expense);
    document.querySelector("[data-reviews]").innerHTML = ReviewList(reviews);
    document.querySelector("[data-review-form]").addEventListener("submit", async (event) => {
      event.preventDefault();
      const decision = event.submitter.value;
      const comment = document.querySelector("#comment").value;
      await runWithErrorBoundary(async () => {
        await reviewExpenseRequest(expense.id, decision, comment, user.id);
        window.location.reload();
      }, { button: event.submitter });
    });

    // 정산 제출 건은 관리자가 최종 완료 처리한다(집행 이후 단계).
    if (expense.status === "settlement_submitted") {
      const reviewCard = document.querySelector("[data-review-form]").closest("section");
      const wrap = document.createElement("div");
      wrap.className = "actions";
      wrap.style.marginTop = "12px";
      wrap.innerHTML = `<button class="button" id="btn-complete-expense" type="button">최종 완료 처리</button>`;
      reviewCard.appendChild(wrap);
      document.getElementById("btn-complete-expense").addEventListener("click", (event) => {
        if (!window.confirm("이 지출 건을 최종 완료 처리하시겠습니까?")) return;
        runWithErrorBoundary(async () => {
          await advanceExpenseStage(expense.id, "settlement_submitted");
          window.location.reload();
        }, { button: event.currentTarget });
      });
    }
  }
} catch (error) {
  showError(error);
}
