// 예산 제출안의 비목별 등록/배정 내역(히스토리 행 펼침 상세).
import { escapeHtml, formatCurrency } from "../../utils.js";

export function BudgetHistoryDetail(s) {
  if (!s.items?.length) return `<p class="muted caption" style="margin:0;">비목별 상세 내역이 없습니다.</p>`;
  const isChange = s.type === "change";
  const isApproved = ["budget_approved", "change_approved"].includes(s.status);
  const round1ReqOf = (it) => (it.requested_round1_allocated_amount != null
    ? Number(it.requested_round1_allocated_amount)
    : Number(it.requested_allocated_amount || 0) - Number(it.requested_round2_allocated_amount || 0));
  // 증액(+)은 초록, 감액(-)은 빨강. 변동 없으면 강조 없이 0원.
  const deltaCell = (delta) => {
    if (delta === 0) return formatCurrency(0);
    const sign = delta > 0 ? "+" : "";
    return `<span class="delta-${delta > 0 ? "up" : "down"}">${sign}${formatCurrency(delta)}</span>`;
  };
  // 모든 상세 테이블이 동일한 컬럼 폭으로 정렬되도록 colgroup으로 폭을 고정한다.
  const colgroup = `
    <colgroup>
      <col style="width:28%">
      <col style="width:18%">
      <col style="width:18%">
      <col style="width:18%">
      <col style="width:18%">
    </colgroup>`;
  return `
    <table class="budget-history-detail-table fixed-cols">
      ${colgroup}
      <thead>
        <tr>
          <th>비목</th>
          <th class="num">1차</th>
          <th class="num">2차</th>
          <th class="num">증액/감액</th>
          <th class="num">총액</th>
        </tr>
      </thead>
      <tbody>
        ${s.items.map((it) => {
          // 최초 등록은 이전 배정이 없으므로 이전 총액 0, 2차도 0.
          const prevTotal = isChange
            ? Number(it.previous_round1_allocated_amount || 0) + Number(it.previous_round2_allocated_amount || 0)
            : 0;
          // 승인 완료 건은 승인된 최종값, 그 외에는 요청값을 최종값으로 사용한다.
          const final2 = isChange
            ? (isApproved && it.approved_round2_allocated_amount != null
              ? Number(it.approved_round2_allocated_amount)
              : Number(it.requested_round2_allocated_amount || 0))
            : 0;
          const finalTotal = isApproved && it.approved_allocated_amount != null
            ? Number(it.approved_allocated_amount)
            : Number(it.requested_allocated_amount || round1ReqOf(it) + final2);
          const final1 = finalTotal - final2;
          const delta = finalTotal - prevTotal;
          return `
            <tr>
              <td>${escapeHtml(it.title)}</td>
              <td class="num">${formatCurrency(final1)}</td>
              <td class="num">${formatCurrency(final2)}</td>
              <td class="num">${deltaCell(delta)}</td>
              <td class="num">${formatCurrency(finalTotal)}</td>
            </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}
