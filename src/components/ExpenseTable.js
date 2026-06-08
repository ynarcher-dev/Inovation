import { StatusBadge } from "./StatusBadge.js";
import { escapeHtml, formatCurrency, formatDate } from "../utils.js";

// 열별 고정 너비(%). table-layout:fixed 와 함께 써서 내용 길이와 무관하게 열 위치를 고정한다.
//   '승인 대기'와 '전체 현황'이 같은 너비로 정렬되도록, 두 표가 동일한 열 구성을 공유한다.
const COL_WIDTHS = {
  company: 13,
  title: 14,
  budget: 28,
  amount: 12,
  status: 10,
  missing: 7,
  warning: 7,
  date: 12,
  action: 11,
};

export function ExpenseTable(rows, options = {}) {
  const isSubFolder = window.location.pathname.includes("/admin/") || window.location.pathname.includes("/founder/");
  const base = isSubFolder ? "../" : "./";
  const target = options.admin ? `${base}admin/expense-detail.html` : `${base}founder/expense-detail.html`;
  if (!rows?.length) {
    return options.emptyText
      ? `<p class="empty">${escapeHtml(options.emptyText)}</p>`
      : `<p class="empty">표시할 신청 건이 없습니다.</p>`;
  }

  const showCompany = options.admin && !options.hideCompany;
  const showChecklist = !options.hideChecklist;
  // 선택적 '처리' 열. action(row, href) 이 있으면 버튼을, reserveActionColumn 만 있으면 빈 열을 둔다.
  //   '전체 현황'도 같은 자리를 비워 두어 '승인 대기'와 열 너비가 정확히 일치하게 한다.
  const hasAction = typeof options.action === "function";
  const showActionColumn = hasAction || options.reserveActionColumn === true;

  // 활성 열 키 목록(렌더 순서와 colgroup 순서를 일치시킨다).
  const colKeys = [
    ...(showCompany ? ["company"] : []),
    "title", "budget", "amount", "status",
    ...(showChecklist ? ["missing", "warning"] : []),
    "date",
    ...(showActionColumn ? ["action"] : []),
  ];
  const colgroup = `<colgroup>${colKeys.map((k) => `<col style="width:${COL_WIDTHS[k]}%" />`).join("")}</colgroup>`;

  const hrefFor = (row) => `${target}?id=${encodeURIComponent(row.id)}`;

  return `
    <div class="table-wrap">
      <table class="fixed-table">
        ${colgroup}
        <thead>
          <tr>
            ${showCompany ? "<th>기업</th>" : ""}
            <th>신청 제목</th>
            <th>예산 항목</th>
            <th>공급가액</th>
            <th>상태</th>
            ${showChecklist ? "<th>누락</th><th>위험</th>" : ""}
            <th>제출일</th>
            ${showActionColumn ? `<th>${hasAction ? escapeHtml(options.actionLabel || "처리") : ""}</th>` : ""}
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr data-href="${hrefFor(row)}" data-budget-category="${escapeHtml(row.budget_category || '')}">
              ${showCompany ? `<td>${escapeHtml(row.company_name || "-")}</td>` : ""}
              <td><a href="${hrefFor(row)}">${escapeHtml(row.title)}</a></td>
              <td class="wrap-cell">${escapeHtml(row.business_plan_item_label || row.budget_category || "-")}</td>
              <td>${formatCurrency(row.amount_supply)}</td>
              <td>${StatusBadge(row.status)}</td>
              ${showChecklist ? `<td>${Number(row.missing_count || 0)}</td><td>${Number(row.warning_count || 0)}</td>` : ""}
              <td>${formatDate(row.submitted_at)}</td>
              ${showActionColumn ? `<td>${hasAction ? options.action(row, hrefFor(row)) : ""}</td>` : ""}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}
