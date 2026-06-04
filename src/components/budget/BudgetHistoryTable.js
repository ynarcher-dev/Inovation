// 예산안 제출/변경 요청과 검토 결과 이력 — 창업자 대시보드 예산 변경 히스토리 탭용.
import { escapeHtml, formatDate } from "../../utils.js";
import { getBudgetStatusLabel, getBudgetStatusTone } from "../../domains/budget/budget-status.js";
import { BudgetHistoryDetail } from "./BudgetHistoryDetail.js";

export function BudgetHistoryTable(submissions, round2PlanSubmissionId = null) {
  if (!submissions?.length) return `<p class="empty">예산 제출/변경 이력이 없습니다.</p>`;
  // 변경 제출의 '구분'은 1차/2차 중 무엇을 건드렸는지로 3종(예산안 등록/1차 예산 수정/2차 예산 수정)으로만 표시한다.
  //  - 1차 금액만 수정 → "1차 예산 수정"
  //  - 2차 금액을 수정했거나, 이 제출에 2차 사업계획서를 첨부 → "2차 예산 수정"
  //  - 1·2차를 모두 건드린 경우도 2차 우선으로 "2차 예산 수정".
  const typeLabel = (s) => {
    if (s.type !== "change") return "예산안 등록";
    // 2차 금액 변경(round2_requested) 또는 이 제출에 연결된 2차 사업계획서 첨부가 있으면 2차로 본다.
    const touchedRound2 = s.round2_requested || (round2PlanSubmissionId && s.id === round2PlanSubmissionId);
    return touchedRound2 ? "2차 예산 수정" : "1차 예산 수정";
  };
  // 상태 배지는 워크플로 단계만 보여준다. 최초/변경 구분은 왼쪽 '구분' 컬럼이 담당한다.
  const statusLabel = (status) => {
    if (status?.includes("revision")) return "보완 요청";
    if (status?.includes("approved")) return "승인 완료";
    if (status?.includes("submitted")) return "검토 대기";
    return getBudgetStatusLabel(status);
  };
  return `
    <div class="table-wrap">
      <table class="review-history-table budget-history-table">
        <thead>
          <tr>
            <th class="expand-col" aria-hidden="true"></th>
            <th>구분</th>
            <th>제출일</th>
            <th>상태</th>
            <th>검토일</th>
            <th class="comment-header">사유 / 검토 의견</th>
          </tr>
        </thead>
        <tbody>
          ${submissions.map((s, i) => `
            <tr class="history-row" data-history-row="${i}" tabindex="0" role="button" aria-expanded="false">
              <td class="expand-col"><span class="expand-icon" aria-hidden="true">▸</span></td>
              <td>${escapeHtml(typeLabel(s))}</td>
              <td class="date-cell">${formatDate(s.submitted_at)}</td>
              <td><span class="badge badge-${getBudgetStatusTone(s.status)}">${escapeHtml(statusLabel(s.status))}</span></td>
              <td class="date-cell">${s.reviewed_at ? formatDate(s.reviewed_at) : "-"}</td>
              <td class="comment-cell">${escapeHtml(s.review_comment || s.reason || "-")}</td>
            </tr>
            <tr class="history-detail-row" data-history-detail="${i}" hidden>
              <td colspan="6">
                <div class="history-detail">
                  <h4 class="history-detail-title">비목별 ${s.type === "change" ? "변경" : "등록"} 내역</h4>
                  ${BudgetHistoryDetail(s)}
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>`;
}
