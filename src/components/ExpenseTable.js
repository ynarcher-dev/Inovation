import { StatusBadge } from "./StatusBadge.js";
import { escapeHtml, formatCurrency, formatDate } from "../utils.js";

// 열별 고정 너비(%). table-layout:fixed 와 함께 써서 내용 길이와 무관하게 열 위치를 고정한다.
//   '승인 대기'와 '전체 현황'이 같은 너비로 정렬되도록, 두 표가 동일한 열 구성을 공유한다.
//   상태 열은 배지 옆에 승인 취소 마커가 붙을 수 있어 넓게 잡는다. 늘린 폭은 여유가 있는
//   기업/공급가액에서 가져온다(예산 항목은 wrap-cell 이라 좁히면 줄바꿈으로 행 높이가 어긋난다).
const COL_WIDTHS = {
  company: 11,
  title: 14,
  budget: 28,
  amount: 10,
  status: 14,
  missing: 7,
  warning: 7,
  date: 12,
  action: 11,
};

// 승인 취소 이력 마커. 취소하면 상태가 이전 신청 단계로 되돌아가므로 상태값만으로는
// '한 번 승인됐다가 취소된 건'을 구분할 수 없다. 상태 배지 옆에 횟수를 덧붙여 표시한다.
// cancel_count 는 대시보드 조회에서 붙여준다(없으면 아무것도 그리지 않는다).
//  - 배지와 같은 줄에 두어 행 높이를 균일하게 유지한다(간격은 .cancel-marker 가 담당).
//  - 목록에서는 '↺ N회'로 짧게만 알리고, 자세한 내용은 tooltip 과 상세 화면에서 확인한다.
function CancelMarker(row) {
  const count = Number(row.cancel_count || 0);
  if (count <= 0) return "";
  const at = row.last_cancelled_at ? formatDate(row.last_cancelled_at) : "";
  const title = at ? `승인 취소 ${count}회 · 최근 ${at}` : `승인 취소 ${count}회`;
  return `<span class="cancel-marker" title="${escapeHtml(title)}">`
    + `<span class="cancel-marker-icon" aria-hidden="true">↺</span>${count}회</span>`;
}

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
              <td>${StatusBadge(row.status)}${CancelMarker(row)}</td>
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
