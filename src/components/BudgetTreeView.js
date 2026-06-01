import { escapeHtml, formatCurrency, formatNumber } from "../utils.js";

export function BudgetTreeView(tree, isEditable) {
  if (!tree?.length) {
    return `<p class="empty">참가 사업의 예산/비목 구조가 등록되어 있지 않습니다. 관리자에게 문의하세요.</p>`;
  }

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

  const renderLeafRow = (paths, rowIdx) => {
    const leaf = paths[rowIdx][paths[rowIdx].length - 1];
    const remainingClass = Number(leaf.remaining_amount) < 0 ? "danger" : "success";
    const cat = leaf.budget_category ? escapeHtml(leaf.budget_category) : "";
    
    let allocationCell = "";
    if (isEditable) {
      allocationCell = `
        <td class="budget-amount">
          <input class="budget-alloc-input" type="text" inputmode="numeric"
            data-allocation-input="${escapeHtml(leaf.id)}"
            value="${formatNumber(leaf.allocated_amount || 0)}"
            placeholder="0">
        </td>
      `;
    } else {
      allocationCell = `
        <td class="budget-amount">${formatCurrency(leaf.allocated_amount)}</td>
      `;
    }

    return `
      <tr class="leaf-row" data-budget-category="${cat}">
        ${renderHierarchyCells(paths, rowIdx)}
        ${allocationCell}
        ${!isEditable ? `
          <td class="budget-amount">${formatCurrency(leaf.approved_amount)}</td>
          <td class="budget-amount">${formatCurrency(leaf.pending_amount)}</td>
          <td class="budget-amount ${remainingClass}">${formatCurrency(leaf.remaining_amount)}</td>
        ` : ""}
      </tr>
    `;
  };

  const renderSubtotalRow = (root) => {
    const remainingClass = Number(root.remaining_amount) < 0 ? "danger" : "success";
    return `
      <tr class="subtotal-row">
        <td colspan="${maxLevel}" class="subtotal-label">
          <span class="subtotal-tag">소계</span>${escapeHtml(root.title)}
        </td>
        <td class="budget-amount" data-parent-allocation="${escapeHtml(root.id)}">${formatCurrency(root.allocated_amount)}</td>
        ${!isEditable ? `
          <td class="budget-amount">${formatCurrency(root.approved_amount)}</td>
          <td class="budget-amount">${formatCurrency(root.pending_amount)}</td>
          <td class="budget-amount ${remainingClass}">${formatCurrency(root.remaining_amount)}</td>
        ` : ""}
      </tr>
    `;
  };

  const headerCells = Array.from({ length: maxLevel }, (_, i) => `<th>뎁스${i + 1}</th>`).join("");

  return `
    <div class="table-wrap" style="overflow-x:auto">
      <table class="budget-matrix" id="budget-matrix-table">
        <thead>
          <tr>
            ${headerCells}
            <th class="budget-amount">배정 금액</th>
            ${!isEditable ? `
              <th class="budget-amount">승인 금액</th>
              <th class="budget-amount">제출 대기</th>
              <th class="budget-amount">잔액</th>
            ` : ""}
          </tr>
        </thead>
        <tbody>
          ${groups.map((g) => `
            ${g.paths.map((_, idx) => renderLeafRow(g.paths, idx)).join("")}
            ${g.root.isLeaf ? "" : renderSubtotalRow(g.root)}
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}
