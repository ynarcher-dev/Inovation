import { escapeHtml, formatCurrency, formatDate } from "../utils.js";
import { getStatusLabel, getStatusTone, getProcessSteps } from "../domains/status.js";

// 4-스텝 미니 프로세스 UI(작성 → 사전승인 → 최종승인 → 완료). new.md §5.
function ProcessSteps(status) {
  const steps = getProcessSteps(status);
  const dots = steps
    .map((s, i) => {
      const connector = i > 0 ? `<span class="proc-line proc-line-${steps[i - 1].state}"></span>` : "";
      return `${connector}<span class="proc-step proc-${s.state}"><span class="proc-dot"></span><span class="proc-label">${escapeHtml(s.label)}</span></span>`;
    })
    .join("");
  return `<div class="proc-track">${dots}</div>`;
}

// 창업자 지출 현황 표(new.md §5 권장 컬럼).
// - 신청명 / 비목·사업계획서 항목 / 금액(공급가액+부가세) / 제출일 / 현재 단계(배지) / 진행 상태(미니 프로세스)
// - 행 전체를 클릭하면 상세 페이지로 이동한다(보완 건은 같은 expense.id 를 유지).
// rows 는 호출부에서 검색/필터를 거친 결과를 받는다. 비어 있으면 emptyMessage 를 표시한다.
// opts.actionColumn: 진행 상태 우측에 부가 액션 컬럼을 추가한다(관리자 증빙 다운로드 등).
//   { header: string, cell: (row) => htmlString } — cell 안의 버튼은 row 클릭 이동을 막도록 호출부에서 처리한다.
export function FounderExpenseStatusTable(rows, emptyMessage = "표시할 지출 신청 건이 없습니다.", opts = {}) {
  if (!rows?.length) {
    return `<p class="empty">${escapeHtml(emptyMessage)}</p>`;
  }

  const action = opts.actionColumn;
  const sorted = [...rows].sort((a, b) =>
    String(b.submitted_at || b.created_at || "").localeCompare(String(a.submitted_at || a.created_at || ""))
  );

  return `
    <div class="table-wrap">
      <table class="founder-expense-table">
        <colgroup>
          <col style="width:${action ? "21%" : "24%"}">
          <col style="width:${action ? "17%" : "20%"}">
          <col style="width:12%">
          <col style="width:11%">
          <col style="width:12%">
          <col style="width:${action ? "15%" : "21%"}">
          ${action ? `<col style="width:12%">` : ""}
        </colgroup>
        <thead>
          <tr>
            <th>신청명</th>
            <th>비목 / 사업계획서 항목</th>
            <th class="num">금액</th>
            <th>제출일</th>
            <th>현재 단계</th>
            <th>진행 상태</th>
            ${action ? `<th>${escapeHtml(action.header || "")}</th>` : ""}
          </tr>
        </thead>
        <tbody>
          ${sorted.map((row) => {
            const total = Number(
              row.total_amount != null
                ? row.total_amount
                : Number(row.amount_supply || 0) + Number(row.vat_amount || 0)
            );
            const category = row.business_plan_item_label || row.budget_category || "-";
            const url = `expense-detail.html?id=${encodeURIComponent(row.id)}`;
            return `
              <tr class="clickable-row" data-expense-href="${url}" tabindex="0" role="link">
                <td><span class="row-link">${escapeHtml(row.title)}</span></td>
                <td class="muted">${escapeHtml(category)}</td>
                <td class="num">${formatCurrency(total)}</td>
                <td>${row.submitted_at ? formatDate(row.submitted_at) : "-"}</td>
                <td><span class="badge badge-${getStatusTone(row.status)}">${escapeHtml(getStatusLabel(row.status))}</span></td>
                <td>${ProcessSteps(row.status)}</td>
                ${action ? `<td>${action.cell ? action.cell(row) : ""}</td>` : ""}
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}
