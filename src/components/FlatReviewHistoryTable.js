import { escapeHtml, formatDate } from "../utils.js";

const decisionText = {
  approved: "승인 완료",
  rejected: "반려",
  revision_requested: "보완 요청",
};

const decisionTone = {
  approved: "success",
  rejected: "danger",
  revision_requested: "warning",
};

function DecisionBadge(decision) {
  const label = decisionText[decision] || decision || "-";
  const tone = decisionTone[decision] || "neutral";
  return `<span class="badge badge-${tone}">${escapeHtml(label)}</span>`;
}

export function FlatReviewHistoryTable(reviewHistory, isAdmin = false) {
  if (!reviewHistory?.length) {
    return `<p class="empty">심사 이력이 없습니다.</p>`;
  }

  const base = isAdmin ? "" : "../";
  const target = isAdmin ? "expense-detail.html" : `${base}founder/expense-detail.html`;

  return `
    <div class="table-wrap">
      <table class="review-history-table">
        <thead>
          <tr>
            <th>신청 건</th>
            <th>검토 결과</th>
            <th class="comment-header">의견</th>
            <th>검토자</th>
            <th>검토일</th>
          </tr>
        </thead>
        <tbody>
          ${reviewHistory.map((rev) => {
            const targetUrl = `${target}?id=${encodeURIComponent(rev.expense_request_id)}`;
            return `
              <tr>
                <td><a href="${targetUrl}" style="font-weight: 600;">${escapeHtml(rev.title || "-")}</a></td>
                <td>${DecisionBadge(rev.decision)}</td>
                <td class="comment-cell">${escapeHtml(rev.comment || "의견 내용이 없습니다.")}</td>
                <td>${escapeHtml(rev.reviewer_id || "관리자")}</td>
                <td class="date-cell">${formatDate(rev.created_at)}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}
