import { StatusBadge } from "./StatusBadge.js";
import { escapeHtml, formatCurrency, formatDate } from "../utils.js";

export function ExpenseTable(rows, options = {}) {
  const isSubFolder = window.location.pathname.includes("/admin/") || window.location.pathname.includes("/founder/");
  const base = isSubFolder ? "../" : "./";
  const target = options.admin ? `${base}admin/expense-detail.html` : `${base}founder/expense-detail.html`;
  if (!rows?.length) {
    return `<p class="empty">표시할 신청 건이 없습니다.</p>`;
  }

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${options.admin && !options.hideCompany ? "<th>기업</th>" : ""}
            <th>신청 제목</th>
            <th>비목</th>
            <th>공급가액</th>
            <th>상태</th>
            ${options.hideChecklist ? "" : "<th>누락</th><th>위험</th>"}
            <th>제출일</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr data-href="${target}?id=${encodeURIComponent(row.id)}" data-budget-category="${escapeHtml(row.budget_category || '')}">
              ${options.admin && !options.hideCompany ? `<td>${escapeHtml(row.company_name || "-")}</td>` : ""}
              <td><a href="${target}?id=${encodeURIComponent(row.id)}">${escapeHtml(row.title)}</a></td>
              <td>${escapeHtml(row.budget_category)}</td>
              <td>${formatCurrency(row.amount_supply)}</td>
              <td>${StatusBadge(row.status)}</td>
              ${options.hideChecklist ? "" : `<td>${Number(row.missing_count || 0)}</td><td>${Number(row.warning_count || 0)}</td>`}
              <td>${formatDate(row.submitted_at)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}


