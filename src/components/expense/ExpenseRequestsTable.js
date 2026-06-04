// 검토 대기 중인 지출(예산 사용) 신청 목록 — 관리자 기업상세용.
import { escapeHtml, formatCurrency, formatDate } from "../../utils.js";

export function ExpenseRequestsTable(expenses, categoryPaths) {
  if (!expenses?.length) {
    return `<p class="empty">검토 대기 중인 예산 사용 신청이 없습니다.</p>`;
  }

  const expenseDetailHref = (id) => `expense-detail.html?id=${encodeURIComponent(id)}`;

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>신청 제목</th><th>비목</th><th>공급가액</th><th>제출일</th><th>처리</th></tr>
        </thead>
        <tbody>
          ${expenses.map((row) => {
            const catPath = categoryPaths.get(row.budget_category) || row.budget_category || "-";
            return `
              <tr data-budget-category="${escapeHtml(row.budget_category || '')}">
                <td>${escapeHtml(row.title || "-")}</td>
                <td>${escapeHtml(catPath)}</td>
                <td>${formatCurrency(row.amount_supply)}</td>
                <td>${row.submitted_at ? formatDate(row.submitted_at) : "-"}</td>
                <td><a class="button small" href="${expenseDetailHref(row.id)}">검토하기</a></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}
