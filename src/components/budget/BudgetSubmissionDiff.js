// 예산 제출안(최초/2차 변경)의 비목별 변경 전/후 비교표 — 관리자 기업상세 예산 검토용.
import { escapeHtml, formatCurrency, formatDate } from "../../utils.js";
import { getBudgetStatusLabel } from "../../domains/budget/budget-status.js";

// 제출안의 비목별 변경 전/후 금액 비교표를 만든다.
// committedByBudgetId: 비목별 이미 집행(승인+검토중)된 금액 맵 → 감액 하한 경고 산출
export function BudgetSubmissionDiff(submission, programBudgets, committedByBudgetId = {}, company = {}) {
  if (!submission) return "";
  const titleById = new Map(programBudgets.map((b) => [b.id, b]));
  const pathOf = (id) => {
    const parts = [];
    let curr = titleById.get(id);
    while (curr) {
      parts.unshift(curr.title);
      curr = curr.parent_id ? titleById.get(curr.parent_id) : null;
    }
    return parts.join(" > ");
  };
  const committedOf = (id) => Number(committedByBudgetId[id] || 0);
  const items = (submission.items || []).slice().sort((a, b) =>
    pathOf(a.support_program_budget_id).localeCompare(pathOf(b.support_program_budget_id))
  );
  const isChange = submission.type === "change";
  const typeLabel = isChange ? "2차 예산 배정 요청" : "최초 예산안";

  const submissionMeta = `
    <div class="notice" style="margin-bottom:8px;">
      <strong>${escapeHtml(typeLabel)}</strong>
      · 제출일 ${formatDate(submission.submitted_at)}
      · 제출자 ${escapeHtml(submission.submitted_by_name || "-")}
      · 현재 예산 상태 ${escapeHtml(getBudgetStatusLabel(company.budget_status))}
      ${submission.reason ? `<br>사유: ${escapeHtml(submission.reason)}` : ""}
    </div>`;

  // 예산 변경(1차 수정 + 2차 배정) 검토표(new.md §10.7):
  // 비목 | 1차 배정(변경 전→후) | 2차 배정(변경 전→후) | 승인 후 총 예산 | 집행/검토 중 | 승인 후 예상 잔액
  if (isChange) {
    // 변경 전→후를 한 셀에 보여준다(같으면 단일 값).
    const prevReqCell = (prev, req, color) => {
      if (prev === req) return `<span>${formatCurrency(req)}</span>`;
      const arrow = req > prev ? "▲" : "▼";
      const c = req > prev ? "#047857" : "#b91c1c";
      return `<span class="muted" style="text-decoration:line-through;">${formatCurrency(prev)}</span> <span style="color:${color || c}; font-weight:600;">${arrow} ${formatCurrency(req)}</span>`;
    };
    const violationsArr = [];
    const r2Rows = items.map((it) => {
      const prev1 = Number(it.previous_round1_allocated_amount || 0);
      const prev2 = Number(it.previous_round2_allocated_amount || 0);
      const req2 = Number(it.requested_round2_allocated_amount || 0);
      const req1 = it.requested_round1_allocated_amount != null
        ? Number(it.requested_round1_allocated_amount)
        : Number(it.requested_allocated_amount || 0) - req2;
      const totalAfter = Number(it.requested_allocated_amount || req1 + req2);
      const committed = committedOf(it.support_program_budget_id);
      const expectedRemaining = totalAfter - committed;
      const isViolation = totalAfter < committed; // 승인 후 총 예산이 집행/검토중보다 낮으면 감액 불가
      const pathLabel = pathOf(it.support_program_budget_id) || "-";
      if (isViolation) violationsArr.push(`${pathLabel} (승인 후 ${formatCurrency(totalAfter)} < 집행·검토중 ${formatCurrency(committed)})`);
      return `
        <tr${isViolation ? ' style="background:#fef2f2;"' : ""}>
          <td>${escapeHtml(pathLabel)}${isViolation ? ' <span style="color:#b91c1c; font-weight:700;">⚠ 감액 불가</span>' : ""}</td>
          <td style="text-align:right;">${prevReqCell(prev1, req1)}</td>
          <td style="text-align:right;">${prevReqCell(prev2, req2)}</td>
          <td style="text-align:right; font-weight:600;">${formatCurrency(totalAfter)}</td>
          <td style="text-align:right; color:${committed > 0 ? "#374151" : "#9ca3af"};">${formatCurrency(committed)}</td>
          <td style="text-align:right; color:${expectedRemaining < 0 ? "#b91c1c" : "#374151"};">${formatCurrency(expectedRemaining)}</td>
        </tr>`;
    }).join("");
    const sumReq1 = items.reduce((s, it) => s + (it.requested_round1_allocated_amount != null ? Number(it.requested_round1_allocated_amount) : Number(it.requested_allocated_amount || 0) - Number(it.requested_round2_allocated_amount || 0)), 0);
    const sumReq2 = items.reduce((s, it) => s + Number(it.requested_round2_allocated_amount || 0), 0);
    const sumTotalAfter = items.reduce((s, it) => s + Number(it.requested_allocated_amount || 0), 0);
    const sumCommitted = items.reduce((s, it) => s + committedOf(it.support_program_budget_id), 0);
    const scopeNote = `${submission.round1_changed ? "1차 예산 수정" : ""}${submission.round1_changed && submission.round2_requested ? " + " : ""}${submission.round2_requested ? "2차 예산 배정 신청" : ""}` || "예산 변경";
    // 이번 제출에 연결된 2차 수정 사업계획서 다운로드(new.md §11.3).
    const round2Plan = company.business_plans?.round2;
    const round2PlanLinked = round2Plan && (!round2Plan.budget_submission_id || round2Plan.budget_submission_id === submission.id);
    const round2PlanBlock = round2PlanLinked
      ? `<div class="notice notice-info" style="margin-bottom:8px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <span>2차 수정 사업계획서: <strong>${escapeHtml(round2Plan.original_filename || "첨부파일")}</strong></span>
          <button type="button" class="button small secondary" data-round2-plan-download="${escapeHtml(round2Plan.link_url || "")}" data-round2-plan-name="${escapeHtml(round2Plan.original_filename || "사업계획서")}">다운로드</button>
        </div>`
      : (submission.round2_requested
        ? `<div class="notice" style="margin-bottom:8px; background:#fffbeb; border-color:#fde68a; color:#92400e;">⚠ 2차 배정 신청이나 수정 사업계획서 첨부가 확인되지 않았습니다.</div>`
        : "");
    const warning = violationsArr.length
      ? `<div class="notice" style="margin-bottom:8px; background:#fef2f2; border-color:#fecaca; color:#b91c1c;">
          <strong>⚠ 감액 불가 경고</strong> · 승인 후 총 예산이 이미 집행(승인/검토중)된 금액보다 낮은 비목이 있어 승인할 수 없습니다.
          <ul style="margin:6px 0 0; padding-left:18px;">${violationsArr.map((v) => `<li>${escapeHtml(v)}</li>`).join("")}</ul>
        </div>`
      : "";
    return `
      ${warning}
      ${submissionMeta}
      <div class="notice" style="margin-bottom:8px;">요청 범위: <strong>${escapeHtml(scopeNote)}</strong></div>
      ${round2PlanBlock}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>비목</th>
              <th style="text-align:right;">1차 배정 (변경 전→후)</th>
              <th style="text-align:right;">2차 배정 (변경 전→후)</th>
              <th style="text-align:right;">승인 후 총 예산</th>
              <th style="text-align:right;">집행/검토 중</th>
              <th style="text-align:right;">승인 후 예상 잔액</th>
            </tr>
          </thead>
          <tbody>${r2Rows}</tbody>
          <tfoot>
            <tr style="font-weight:700;">
              <td>합계</td>
              <td style="text-align:right;">${formatCurrency(sumReq1)}</td>
              <td style="text-align:right;">${formatCurrency(sumReq2)}</td>
              <td style="text-align:right;">${formatCurrency(sumTotalAfter)}</td>
              <td style="text-align:right;">${formatCurrency(sumCommitted)}</td>
              <td style="text-align:right;">${formatCurrency(sumTotalAfter - sumCommitted)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  }

  const prevTotal = items.reduce((s, it) => s + Number(it.previous_allocated_amount || 0), 0);
  const reqTotal = items.reduce((s, it) => s + Number(it.requested_allocated_amount || 0), 0);

  const violations = [];
  const rows = items.map((it) => {
    const prev = Number(it.previous_allocated_amount || 0);
    const req = Number(it.requested_allocated_amount || 0);
    const committed = committedOf(it.support_program_budget_id);
    const diff = req - prev;
    const diffStr = diff === 0 ? "-" : `${diff > 0 ? "+" : ""}${formatCurrency(diff)}`;
    const diffColor = diff > 0 ? "#047857" : diff < 0 ? "#b91c1c" : "#6b7280";
    // 감액 불가: 요청액이 이미 집행/검토중 금액보다 낮으면 경고
    const isViolation = req < committed;
    const pathLabel = pathOf(it.support_program_budget_id) || "-";
    if (isViolation) violations.push(`${pathLabel} (요청 ${formatCurrency(req)} < 집행·검토중 ${formatCurrency(committed)})`);
    return `
      <tr${isViolation ? ' style="background:#fef2f2;"' : ""}>
        <td>${escapeHtml(pathLabel)}${isViolation ? ' <span style="color:#b91c1c; font-weight:700;">⚠ 감액 불가</span>' : ""}</td>
        <td style="text-align:right;">${formatCurrency(prev)}</td>
        <td style="text-align:right;">${formatCurrency(req)}</td>
        <td style="text-align:right; color:${diffColor};">${diffStr}</td>
        <td style="text-align:right; color:${committed > 0 ? "#374151" : "#9ca3af"};">${formatCurrency(committed)}</td>
      </tr>`;
  }).join("");

  const totalDiff = reqTotal - prevTotal;
  const warningBanner = violations.length
    ? `<div class="notice" style="margin-bottom:8px; background:#fef2f2; border-color:#fecaca; color:#b91c1c;">
        <strong>⚠ 감액 불가 경고</strong> · 다음 비목은 이미 집행(승인/검토중)된 금액보다 낮게 요청되어 승인할 수 없습니다.
        <ul style="margin:6px 0 0; padding-left:18px;">${violations.map((v) => `<li>${escapeHtml(v)}</li>`).join("")}</ul>
      </div>`
    : "";
  return `
    ${warningBanner}
    <div class="notice" style="margin-bottom:8px;">
      <strong>${escapeHtml(typeLabel)}</strong>
      · 제출일 ${formatDate(submission.submitted_at)}
      · 제출자 ${escapeHtml(submission.submitted_by_name || "-")}
      · 현재 예산 상태 ${escapeHtml(getBudgetStatusLabel(company.budget_status))}
      ${submission.reason ? `<br>사유: ${escapeHtml(submission.reason)}` : ""}
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>비목</th><th style="text-align:right;">변경 전</th><th style="text-align:right;">요청(변경 후)</th><th style="text-align:right;">증감</th><th style="text-align:right;">집행·검토중</th></tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr style="font-weight:700;">
            <td>합계</td>
            <td style="text-align:right;">${formatCurrency(prevTotal)}</td>
            <td style="text-align:right;">${formatCurrency(reqTotal)}</td>
            <td style="text-align:right; color:${totalDiff > 0 ? "#047857" : totalDiff < 0 ? "#b91c1c" : "#6b7280"};">${totalDiff === 0 ? "-" : `${totalDiff > 0 ? "+" : ""}${formatCurrency(totalDiff)}`}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}
