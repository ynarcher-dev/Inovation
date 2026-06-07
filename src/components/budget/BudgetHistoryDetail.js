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
          // 변경 제출의 '변경 전 총액'은 제출 시점에 저장된 previous_allocated_amount(스냅샷)를 쓴다.
          //   previous_round1/round2 는 제출 시 저장되지 않아(=null) 둘을 더하면 0 이 되고,
          //   변동이 없는 비목도 전부 '0→요청액' 증액으로 잘못 표시되던 문제를 막는다.
          //   (per-round 분리값이 저장된 데이터가 있으면 그 합을 우선 사용한다.)
          const prevTotal = isChange
            ? (it.previous_round1_allocated_amount != null || it.previous_round2_allocated_amount != null
                ? Number(it.previous_round1_allocated_amount || 0) + Number(it.previous_round2_allocated_amount || 0)
                : Number(it.previous_allocated_amount || 0))
            : 0;
          // 승인 완료 건은 승인된 최종값, 그 외에는 요청값을 최종값으로 사용한다.
          const requested2 = Number(it.requested_round2_allocated_amount || 0);
          const requestedTotal = Number(it.requested_allocated_amount || round1ReqOf(it) + requested2);
          const approvedTotal = Number(it.approved_allocated_amount || 0);
          const final2 = requested2;
          const finalTotal = isApproved && approvedTotal > 0 ? approvedTotal : requestedTotal;
          const final1 = round1ReqOf(it);
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
