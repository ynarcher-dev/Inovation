import { mountShell, showError } from "../app.js";
import { requireRole } from "../auth.js";
import { getExpenseDetail, reviewExpenseRequest } from "../api.js";
import { Checklist } from "../components/Checklist.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { escapeHtml, formatCurrency, getQueryParam } from "../utils.js";

try {
  mountShell();
  const user = await requireRole(["admin", "super_admin"]);
  if (user) {
    const id = getQueryParam("id");
    const { expense, documents } = await getExpenseDetail(id);
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
    document.querySelector("[data-review-form]").addEventListener("submit", async (event) => {
      event.preventDefault();
      const decision = event.submitter.value;
      const comment = document.querySelector("#comment").value;
      await reviewExpenseRequest(expense.id, decision, comment, user.id);
      window.location.reload();
    });
  }
} catch (error) {
  showError(error);
}

