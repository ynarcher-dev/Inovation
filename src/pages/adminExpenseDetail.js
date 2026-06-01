import { mountShell, runWithErrorBoundary, showError } from "../app.js";
import { requireRole } from "../auth.js";
import { advanceExpenseStage, getExpenseDetail, reviewExpenseRequest } from "../api.js";
import { Checklist } from "../components/Checklist.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { escapeHtml, formatCurrency, getQueryParam } from "../utils.js";

function BudgetCheckPanel(check) {
  if (!check) return "";
  const tone = check.exceeds ? "#b91c1c" : "#047857";
  const fit = check.exceeds ? "잔액 초과 ⚠️" : "잔액 내 적합";
  return `
    <div class="table-wrap">
      <table>
        <tbody>
          <tr><th>비목</th><td>${escapeHtml(check.budget_category || "-")}</td></tr>
          <tr><th>배정(확정) 예산</th><td>${formatCurrency(check.allocated)}</td></tr>
          <tr><th>기승인/검토중(타 건)</th><td>${formatCurrency(check.approved_other)} / ${formatCurrency(check.pending_other)}</td></tr>
          <tr><th>신청 전 잔액</th><td>${formatCurrency(check.remaining_before)}</td></tr>
          <tr><th>이번 신청(공급가액)</th><td>${formatCurrency(check.requested)}</td></tr>
          <tr><th>적합성</th><td style="color:${tone}; font-weight:700;">${fit} (신청 후 잔액 ${formatCurrency(check.remaining_after)})</td></tr>
        </tbody>
      </table>
    </div>
  `;
}

function WarningList(warnings) {
  if (!warnings?.length) return `<p class="empty">현재 입력값 기준 위험 경고가 없습니다.</p>`;
  const toneColor = { danger: "#b91c1c", warning: "#d97706", info: "#2563eb" };
  return warnings.map((w) => `
    <p class="notice" style="border-left:4px solid ${toneColor[w.severity] || "#6b7280"}; padding-left:8px;">${escapeHtml(w.message)}</p>
  `).join("");
}

function FileTable(files) {
  if (!files?.length) return `<p class="empty">업로드된 파일이 없습니다.</p>`;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>서류</th>
            <th>파일명</th>
            <th>크기</th>
          </tr>
        </thead>
        <tbody>
          ${files.map((file) => `
            <tr>
              <td>${escapeHtml(file.document_type)}</td>
              <td>${escapeHtml(file.original_filename)}</td>
              <td>${Math.ceil(Number(file.size_bytes || 0) / 1024).toLocaleString()} KB</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
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

function ReviewList(reviews) {
  if (!reviews?.length) return `<p class="empty">검토 이력이 없습니다.</p>`;
  return `
    <div class="checklist">
      ${reviews.map((review) => `
        <div class="checklist-row">
          <div>
            <strong>${escapeHtml(review.decision)}</strong>
            <span>${escapeHtml(review.comment || "-")}</span>
          </div>
        </div>
      `).join("")}
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
      <p><strong>기업</strong> ${escapeHtml(expense.company_name || "-")}</p>
      <p><strong>대표자</strong> ${escapeHtml(expense.representative_name || "-")}</p>
      <p><strong>비목</strong> ${escapeHtml(expense.budget_category)}</p>
      <p><strong>공급가액</strong> ${formatCurrency(expense.amount_supply)}</p>
      <p><strong>거래처</strong> ${escapeHtml(expense.vendor_name || "-")}</p>
      <p><strong>신청 내용</strong><br>${escapeHtml(expense.purpose || "-")}</p>
    `;
    document.querySelector("[data-budget-check]").innerHTML = BudgetCheckPanel(budgetCheck);
    document.querySelector("[data-warnings]").innerHTML = WarningList(warnings);
    document.querySelector("[data-checklist]").innerHTML = Checklist(documents, { files, actionable: false });
    document.querySelector("[data-files]").innerHTML = FileTable(files);
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
      const summaryCard = document.querySelector("[data-summary]").closest("section");
      const wrap = document.createElement("div");
      wrap.className = "actions";
      wrap.style.marginTop = "12px";
      wrap.innerHTML = `<button class="button" id="btn-complete-expense" type="button">최종 완료 처리</button>`;
      summaryCard.appendChild(wrap);
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
