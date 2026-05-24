import { mountShell, runWithErrorBoundary, showError } from "../app.js";
import { requireRole } from "../auth.js";
import { getExpenseDetail, reviewExpenseRequest } from "../api.js";
import { Checklist } from "../components/Checklist.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { escapeHtml, formatCurrency, getQueryParam } from "../utils.js";

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
    const { expense, documents, files, reviews } = await getExpenseDetail(id);
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
    document.querySelector("[data-checklist]").innerHTML = Checklist(documents);
    document.querySelector("[data-files]").innerHTML = FileTable(files);
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
  }
} catch (error) {
  showError(error);
}
