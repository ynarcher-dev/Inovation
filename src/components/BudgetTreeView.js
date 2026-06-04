import { escapeHtml, formatCurrency, formatNumber } from "../utils.js";

// 2차 배정 컬럼 헤더에 붙는 상태 라벨(new.md §10.3).
const ROUND2_HEADER_LABELS = {
  none: "미제출",
  pending: "승인 대기",
  revision: "보완 요청",
  approved: "승인 완료",
};

export function round2HeaderLabel(status) {
  return ROUND2_HEADER_LABELS[status] || ROUND2_HEADER_LABELS.none;
}

// 비목 예산 트리(매트릭스) 렌더러.
// options:
//  - showRounds : 1차/2차/총 승인 예산 컬럼을 분리해 표시(new.md §10.3)
//  - round2Status : 'none'|'pending'|'revision'|'approved' (2차 컬럼 헤더 상태)
//  - editTarget : isEditable 일 때 입력 대상. 'round1'(기본, 1차/최초 예산) | 'round2'(2차 배정 요청)
export function BudgetTreeView(tree, isEditable, levelLabels, options = {}) {
  if (!tree?.length) {
    return `<p class="empty">참가 사업의 예산/비목 구조가 등록되어 있지 않습니다. 관리자에게 문의하세요.</p>`;
  }

  const showRounds = !!options.showRounds;
  const round2Status = options.round2Status || "none";
  const round2Pending = round2Status === "pending" || round2Status === "revision";
  // 예산 변경 편집 모드: 1차 입력 + 2차 입력(기본 잠금, 헤더 체크박스로 활성화). new.md §10.6 보완.
  const editChange = isEditable && options.editTarget === "change";
  const round2Enabled = !!options.round2Enabled; // 2차 입력 활성화 여부
  const round2Checkbox = !!options.round2Checkbox; // 2차 헤더에 신청 체크박스 노출(최초 신청 전)
  const round2Locked = editChange && !round2Enabled; // 2차 컬럼 잠금(회색) 상태

  let maxLevel = 1;
  const computeMax = (nodes) => {
    for (const n of nodes) {
      if (n.level > maxLevel) maxLevel = n.level;
      if (n.children?.length) computeMax(n.children);
    }
  };
  computeMax(tree);

  const groups = tree.map((root) => {
    const paths = [];
    const visit = (node, ancestors) => {
      const path = [...ancestors, node];
      if (node.isLeaf) paths.push(path);
      else node.children.forEach((child) => visit(child, path));
    };
    visit(root, []);
    return { root, paths };
  });

  const renderHierarchyCells = (paths, rowIdx) => {
    const path = paths[rowIdx];
    const cells = [];
    for (let lv = 1; lv <= maxLevel; lv++) {
      const node = path[lv - 1];
      if (!node) {
        cells.push(`<td class="hierarchy-cell hierarchy-empty"></td>`);
        continue;
      }
      const prevNode = rowIdx > 0 ? paths[rowIdx - 1][lv - 1] : null;
      if (prevNode && prevNode.id === node.id) continue;
      let span = 1;
      for (let k = rowIdx + 1; k < paths.length; k++) {
        const future = paths[k][lv - 1];
        if (future && future.id === node.id) span++;
        else break;
      }
      const spanAttr = span > 1 ? ` rowspan="${span}"` : "";
      const category = node.budget_category
        ? `<span class="budget-tree-category">(${escapeHtml(node.budget_category)})</span>`
        : "";
      cells.push(
        `<td${spanAttr} class="hierarchy-cell hierarchy-level-${lv}">${escapeHtml(node.title)}${category}</td>`,
      );
    }
    return cells.join("");
  };

  // 2차 배정 컬럼에 표시할 금액: 검토 중(승인 대기/보완)이면 요청 금액, 그 외엔 승인된 2차 금액.
  const round2DisplayOf = (node) =>
    round2Pending ? Number(node.pending_round2_amount || 0) : Number(node.round2_allocated_amount || 0);

  // ---- 금액 셀(컬럼) 렌더러 ----
  const amountCells = (node) => {
    // 예산 변경 입력 모드: [1차 배정(입력)] [2차 배정 신청(입력, 기본 잠금)]
    if (editChange) {
      const r1Prefill = node.pending_round1_amount != null ? node.pending_round1_amount : node.round1_allocated_amount;
      const r2Prefill = node.pending_round2_amount != null ? node.pending_round2_amount : node.round2_allocated_amount;
      return `
        <td class="budget-amount">
          <input class="budget-alloc-input budget-round1-input" type="text" inputmode="numeric"
            data-alloc-round1="${escapeHtml(node.id)}"
            value="${formatNumber(r1Prefill || 0)}"
            placeholder="0">
        </td>
        <td class="budget-amount">
          <input class="budget-alloc-input budget-round2-input" type="text" inputmode="numeric"
            data-alloc-round2="${escapeHtml(node.id)}"
            value="${formatNumber(r2Prefill || 0)}"
            placeholder="0"${round2Enabled ? "" : " disabled"}>
        </td>`;
    }
    // 1차/최초 예산 입력 모드: 단일 배정 입력
    if (isEditable) {
      return `
        <td class="budget-amount">
          <input class="budget-alloc-input" type="text" inputmode="numeric"
            data-allocation-input="${escapeHtml(node.id)}"
            value="${formatNumber(node.allocated_amount || 0)}"
            placeholder="0">
        </td>`;
    }
    const remainingClass = Number(node.remaining_amount) < 0 ? "danger" : "success";
    // 1차/2차/총 분리 표시 모드
    if (showRounds) {
      const r2 = round2DisplayOf(node);
      const r2Class = round2Pending ? ' class="budget-amount muted"' : ' class="budget-amount"';
      return `
        <td class="budget-amount">${formatCurrency(node.round1_allocated_amount)}</td>
        <td${r2Class}>${r2 ? formatCurrency(r2) : "-"}</td>
        <td class="budget-amount">${formatCurrency(node.allocated_amount)}</td>
        <td class="budget-amount">${formatCurrency(node.approved_amount)}</td>
        <td class="budget-amount">${formatCurrency(node.pending_amount)}</td>
        <td class="budget-amount ${remainingClass}">${formatCurrency(node.remaining_amount)}</td>`;
    }
    // 레거시 표시 모드: 배정/승인/검토중/잔액
    return `
      <td class="budget-amount">${formatCurrency(node.allocated_amount)}</td>
      <td class="budget-amount">${formatCurrency(node.approved_amount)}</td>
      <td class="budget-amount">${formatCurrency(node.pending_amount)}</td>
      <td class="budget-amount ${remainingClass}">${formatCurrency(node.remaining_amount)}</td>`;
  };

  const renderLeafRow = (paths, rowIdx) => {
    const leaf = paths[rowIdx][paths[rowIdx].length - 1];
    const cat = leaf.budget_category ? escapeHtml(leaf.budget_category) : "";
    return `
      <tr class="leaf-row" data-budget-category="${cat}">
        ${renderHierarchyCells(paths, rowIdx)}
        ${amountCells(leaf)}
      </tr>
    `;
  };

  // 소계/합계 행은 입력 모드에선 금액 컬럼 소계만, 표시 모드에선 전체 금액 컬럼을 채운다.
  const subtotalAmountCells = (node, parentAttr = false) => {
    if (editChange) {
      const r1 = node.pending_round1_amount != null ? node.pending_round1_amount : node.round1_allocated_amount;
      const r2 = node.pending_round2_amount != null ? node.pending_round2_amount : node.round2_allocated_amount;
      return `
        <td class="budget-amount"${parentAttr ? ` data-parent-round1="${escapeHtml(node.id)}"` : ""}>${formatCurrency(r1)}</td>
        <td class="budget-amount"${parentAttr ? ` data-parent-round2="${escapeHtml(node.id)}"` : ""}>${formatCurrency(r2)}</td>`;
    }
    if (isEditable) {
      return `<td class="budget-amount"${parentAttr ? ` data-parent-allocation="${escapeHtml(node.id)}"` : ""}>${formatCurrency(node.allocated_amount)}</td>`;
    }
    const remainingClass = Number(node.remaining_amount) < 0 ? "danger" : "success";
    if (showRounds) {
      return `
        <td class="budget-amount">${formatCurrency(node.round1_allocated_amount)}</td>
        <td class="budget-amount${round2Pending ? " muted" : ""}">${formatCurrency(round2DisplayOf(node))}</td>
        <td class="budget-amount">${formatCurrency(node.allocated_amount)}</td>
        <td class="budget-amount">${formatCurrency(node.approved_amount)}</td>
        <td class="budget-amount">${formatCurrency(node.pending_amount)}</td>
        <td class="budget-amount ${remainingClass}">${formatCurrency(node.remaining_amount)}</td>`;
    }
    return `
      <td class="budget-amount">${formatCurrency(node.allocated_amount)}</td>
      <td class="budget-amount">${formatCurrency(node.approved_amount)}</td>
      <td class="budget-amount">${formatCurrency(node.pending_amount)}</td>
      <td class="budget-amount ${remainingClass}">${formatCurrency(node.remaining_amount)}</td>`;
  };

  const renderSubtotalRow = (root) => `
      <tr class="subtotal-row">
        <td colspan="${maxLevel}" class="subtotal-label">
          <span class="subtotal-tag">소계</span>${escapeHtml(root.title)}
        </td>
        ${subtotalAmountCells(root, true)}
      </tr>
    `;

  // 모든 소계(루트 비목)를 합산한 전체 합계 행.
  const renderGrandTotalRow = () => {
    const totals = tree.reduce(
      (acc, root) => ({
        round1: acc.round1 + Number(root.round1_allocated_amount || 0),
        round2: acc.round2 + round2DisplayOf(root),
        allocated: acc.allocated + Number(root.allocated_amount || 0),
        approved: acc.approved + Number(root.approved_amount || 0),
        pending: acc.pending + Number(root.pending_amount || 0),
        remaining: acc.remaining + Number(root.remaining_amount || 0),
      }),
      { round1: 0, round2: 0, allocated: 0, approved: 0, pending: 0, remaining: 0 },
    );
    const remainingClass = totals.remaining < 0 ? "danger" : "success";
    const cells = showRounds
      ? `
        <td class="budget-amount">${formatCurrency(totals.round1)}</td>
        <td class="budget-amount${round2Pending ? " muted" : ""}">${formatCurrency(totals.round2)}</td>
        <td class="budget-amount">${formatCurrency(totals.allocated)}</td>
        <td class="budget-amount">${formatCurrency(totals.approved)}</td>
        <td class="budget-amount">${formatCurrency(totals.pending)}</td>
        <td class="budget-amount ${remainingClass}">${formatCurrency(totals.remaining)}</td>`
      : `
        <td class="budget-amount">${formatCurrency(totals.allocated)}</td>
        <td class="budget-amount">${formatCurrency(totals.approved)}</td>
        <td class="budget-amount">${formatCurrency(totals.pending)}</td>
        <td class="budget-amount ${remainingClass}">${formatCurrency(totals.remaining)}</td>`;
    return `
      <tr class="grandtotal-row">
        <td colspan="${maxLevel}" class="subtotal-label">
          <span class="subtotal-tag grandtotal-tag">합계</span>전체 비목
        </td>
        ${cells}
      </tr>
    `;
  };

  // 관리자가 참가 사업별로 지정한 단계 명칭(level_labels)을 그대로 헤더에 사용한다. 미지정 시 기본값.
  const levelLabel = (lv) => {
    const label = levelLabels?.[lv] ?? levelLabels?.[String(lv)];
    return escapeHtml(label || `${lv}단계`);
  };
  const headerCells = Array.from({ length: maxLevel }, (_, i) => `<th>${levelLabel(i + 1)}</th>`).join("");

  // ---- 금액 컬럼 헤더 ----
  let amountHeaders;
  if (editChange) {
    const checkbox = round2Checkbox
      ? `<label id="round2-toggle-wrap" style="display:inline-flex; align-items:center; gap:6px; font-weight:600; cursor:pointer;">
           <input type="checkbox" id="round2-toggle"> 2차 예산 배정 신청
         </label>`
      : `2차 배정 신청`;
    amountHeaders = `
      <th class="budget-amount">1차 배정 (수정)</th>
      <th class="budget-amount round2-head">${checkbox}</th>`;
  } else if (isEditable) {
    amountHeaders = `<th class="budget-amount">배정 금액 (A)</th>`;
  } else if (showRounds) {
    amountHeaders = `
      <th class="budget-amount">1차 배정</th>
      <th class="budget-amount">2차 배정 (${escapeHtml(round2HeaderLabel(round2Status))})</th>
      <th class="budget-amount">총 승인 예산</th>
      <th class="budget-amount">승인 지출</th>
      <th class="budget-amount">검토 중 지출</th>
      <th class="budget-amount">잔액</th>`;
  } else {
    amountHeaders = `
      <th class="budget-amount">배정 금액 (A)</th>
      <th class="budget-amount">승인 금액 (B)</th>
      <th class="budget-amount">검토중 (C)</th>
      <th class="budget-amount">잔액 (A)-(B)-(C)</th>`;
  }

  return `
    <div class="table-wrap" style="overflow-x:auto">
      <table class="budget-matrix${round2Locked ? " round2-locked" : ""}" id="budget-matrix-table">
        <thead>
          <tr>
            ${headerCells}
            ${amountHeaders}
          </tr>
        </thead>
        <tbody>
          ${groups.map((g) => `
            ${g.paths.map((_, idx) => renderLeafRow(g.paths, idx)).join("")}
            ${renderSubtotalRow(g.root)}
          `).join("")}
          ${!isEditable ? renderGrandTotalRow() : ""}
        </tbody>
      </table>
    </div>
  `;
}
