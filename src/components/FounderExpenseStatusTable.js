import { escapeHtml, formatCurrency, formatDate } from "../utils.js";
import { getSimpleExpenseStatus } from "../status.js";

// 창업자 지출 현황 표.
// - 금액: 공급가액 + 부가세(합산)
// - 상태: 승인/보완/반려(검토 전은 검토 중)
// - 각 건은 독립적이므로 자신의 id 로만 상세에 연결된다(보완/반려 시 새 결재를 올리는 형태).
export function FounderExpenseStatusTable(rows) {
  if (!rows?.length) {
    return `<p class="empty">표시할 지출 신청 건이 없습니다.</p>`;
  }

  const sorted = [...rows].sort((a, b) =>
    String(b.submitted_at || b.created_at || "").localeCompare(String(a.submitted_at || a.created_at || ""))
  );

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>신청명</th>
            <th>금액</th>
            <th>제출일</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map((row) => {
            const total = Number(
              row.total_amount != null
                ? row.total_amount
                : Number(row.amount_supply || 0) + Number(row.vat_amount || 0)
            );
            const state = getSimpleExpenseStatus(row.status);
            const url = `expense-detail.html?id=${encodeURIComponent(row.id)}`;
            return `
              <tr>
                <td><a href="${url}">${escapeHtml(row.title)}</a></td>
                <td>${formatCurrency(total)}</td>
                <td>${formatDate(row.submitted_at)}</td>
                <td><span class="badge badge-${state.tone}">${escapeHtml(state.label)}</span></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}
