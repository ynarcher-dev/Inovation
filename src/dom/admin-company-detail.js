// 관리자 기업상세 DOM 핸들러: 비목 카테고리 경로 계산, 비목↔지출 카테고리 하이라이트, 비목 배정 인라인 편집.
import { formatNumber, parseNumber } from "../utils.js";
import { runWithErrorBoundary } from "../app.js";
import { upsertCompanyBudgetAllocation } from "../api.js";

export function getBudgetCategoryPaths(programBudgets) {
  const budgetsById = new Map(programBudgets.map((b) => [b.id, b]));
  const paths = new Map();

  for (const budget of programBudgets) {
    if (budget.budget_category) {
      const parts = [];
      let curr = budget;
      while (curr) {
        parts.unshift(curr.title);
        curr = curr.parent_id ? budgetsById.get(curr.parent_id) : null;
      }
      paths.set(budget.budget_category, parts.join(">"));
    }
  }
  return paths;
}

export function attachCategoryHighlight(budgetTreeEl, expenseTableEl) {
  const clearAll = () => {
    budgetTreeEl.querySelectorAll(".budget-category-highlight").forEach((el) => el.classList.remove("budget-category-highlight"));
    expenseTableEl.querySelectorAll(".expense-category-highlight").forEach((el) => el.classList.remove("expense-category-highlight"));
  };

  expenseTableEl.querySelectorAll("tr[data-budget-category]").forEach((row) => {
    row.addEventListener("mouseenter", () => {
      clearAll();
      const cat = row.dataset.budgetCategory;
      if (!cat) return;
      budgetTreeEl.querySelectorAll(`tr[data-budget-category="${CSS.escape(cat)}"]`).forEach((r) => r.classList.add("budget-category-highlight"));
    });
    row.addEventListener("mouseleave", clearAll);
  });

  budgetTreeEl.querySelectorAll("tr.leaf-row[data-budget-category]").forEach((row) => {
    row.addEventListener("mouseenter", () => {
      clearAll();
      const cat = row.dataset.budgetCategory;
      if (!cat) return;
      expenseTableEl.querySelectorAll(`tr[data-budget-category="${CSS.escape(cat)}"]`).forEach((r) => r.classList.add("expense-category-highlight"));
    });
    row.addEventListener("mouseleave", clearAll);
  });
}

export function attachAllocationHandlers(container, companyId, onSaved) {
  container.querySelectorAll("[data-allocation-input]").forEach((input) => {
    input.addEventListener("input", () => {
      input.value = formatNumber(input.value);
    });

    const commit = async () => {
      const budgetId = input.dataset.allocationInput;
      const newAmount = parseNumber(input.value);
      const currentAmount = Number(input.dataset.currentAmount || 0);
      if (newAmount === currentAmount) return;
      input.disabled = true;
      await runWithErrorBoundary(async () => {
        await upsertCompanyBudgetAllocation(companyId, budgetId, newAmount);
        await onSaved();
      }, {});
      input.disabled = false;
    };

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      } else if (event.key === "Escape") {
        input.value = formatNumber(input.dataset.currentAmount || 0);
        input.blur();
      }
    });
  });
}
