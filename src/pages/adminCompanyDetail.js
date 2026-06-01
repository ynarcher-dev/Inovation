import { mountShell, runWithErrorBoundary, showError, setText } from "../app.js";
import { requireRole } from "../auth.js";
import {
  getAdminCompanyDetail,
  updateCompanySupportTotal,
  upsertCompanyBudgetAllocation,
  approveCompany,
  rejectCompany,
} from "../api.js";
import { ExpenseTable } from "../components/ExpenseTable.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { BudgetTreeView } from "../components/BudgetTreeView.js";
import { FlatReviewHistoryTable } from "../components/FlatReviewHistoryTable.js";
import {
  escapeHtml,
  formatCurrency,
  formatDate,
  formatNumber,
  getQueryParam,
  parseNumber,
} from "../utils.js";

const approvalText = {
  pending: "승인 대기",
  approved: "승인 완료",
  rejected: "반려",
};

function getBudgetCategoryPaths(programBudgets) {
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

function ExpenseRequestsTable(expenses, categoryPaths) {
  if (!expenses?.length) {
    return `<p class="empty">표시할 신청 건이 없습니다.</p>`;
  }

  const base = "../";
  const target = `${base}admin/expense-detail.html`;

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>신청 제목</th>
            <th>비목</th>
            <th>금액</th>
            <th>공급가액</th>
            <th>부가세</th>
            <th>상태</th>
            <th>제출일</th>
          </tr>
        </thead>
        <tbody>
          ${expenses.map((row) => {
            const catPath = categoryPaths.get(row.budget_category) || row.budget_category || "-";
            return `
              <tr data-budget-category="${escapeHtml(row.budget_category || '')}">
                <td><a href="${target}?id=${encodeURIComponent(row.id)}" style="font-weight: 600;">${escapeHtml(row.title)}</a></td>
                <td>${escapeHtml(catPath)}</td>
                <td>${formatCurrency(row.total_amount)}</td>
                <td>${formatCurrency(row.amount_supply)}</td>
                <td>${formatCurrency(row.vat_amount)}</td>
                <td>${StatusBadge(row.status)}</td>
                <td>${formatDate(row.submitted_at)}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function attachCategoryHighlight(budgetTreeEl, expenseTableEl) {
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

function attachAllocationHandlers(container, companyId, onSaved) {
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

try {
  mountShell();
  const user = await requireRole(["admin", "super_admin"]);
  if (user) {
    const id = getQueryParam("id") || "comp-abc";
    let detail = await getAdminCompanyDetail(id);

    const supportTotalForm = document.querySelector("[data-support-total-form]");
    const supportTotalInput = document.querySelector("[data-support-total-input]");
    const budgetTreeEl = document.querySelector("[data-budget-tree]");
    const expenseTableEl = document.querySelector("[data-expense-table]");
    const reviewHistoryEl = document.querySelector("[data-review-history]");
    const internalMemoEl = document.getElementById("admin-internal-memo");

    // Tabs switching logic
    const tabButtons = document.querySelectorAll(".tab-button");
    const tabContents = document.querySelectorAll(".tab-content");
    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetTab = btn.dataset.tab;
        tabButtons.forEach((b) => b.classList.remove("active"));
        tabContents.forEach((c) => c.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById(targetTab)?.classList.add("active");
      });
    });

    const renderHeader = () => {
      const { company } = detail;
      setText("[data-company-name]", company.name);
      setText("[data-representative]", company.representative_name || "-");
      setText("[data-business-number]", company.business_number || "-");
      setText("[data-approval-status]", approvalText[company.approval_status] || company.approval_status || "-");
      supportTotalInput.value = formatNumber(company.support_total_amount || 0);
      setText("[data-business-plan-version]", company.business_plan?.version || "V1.0");
      setText("[data-business-plan-file]", company.business_plan?.original_filename || "최종_사업계획서.pdf");
      setText("[data-business-plan-approved]", company.business_plan?.approved_at ? formatDate(company.business_plan.approved_at) : "미지정");

      // Load internal memo
      if (internalMemoEl) {
        internalMemoEl.value = company.internal_memo || "";
      }

      budgetTreeEl.innerHTML = BudgetTreeView(detail.budgetTree, false); // view-only on admin too
      attachAllocationHandlers(budgetTreeEl, company.id, async () => {
        detail = await getAdminCompanyDetail(id);
        renderHeader();
      });

      const categoryPaths = getBudgetCategoryPaths(detail.programBudgets);
      const pendingExpenses = detail.expenses.filter((row) => row.status?.includes("submitted"));

      expenseTableEl.innerHTML = ExpenseRequestsTable(pendingExpenses, categoryPaths);
      reviewHistoryEl.innerHTML = FlatReviewHistoryTable(detail.reviewHistory, true);

      attachCategoryHighlight(budgetTreeEl, expenseTableEl);
    };

    supportTotalInput.addEventListener("input", () => {
      supportTotalInput.value = formatNumber(supportTotalInput.value);
    });

    supportTotalForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = supportTotalForm.querySelector("button[type=submit]");
      const newAmount = parseNumber(supportTotalInput.value);
      await runWithErrorBoundary(async () => {
        await updateCompanySupportTotal(id, newAmount);
        detail = await getAdminCompanyDetail(id);
        renderHeader();
        const original = button.textContent;
        button.textContent = "저장됨";
        setTimeout(() => { button.textContent = original; }, 1200);
      }, { button });
    });

    // Budget review actions
    const commentInput = document.getElementById("budget-review-comment");
    
    document.getElementById("btn-approve-budget")?.addEventListener("click", async (e) => {
      if (!confirm("이 기업의 배정 예산안을 최종 승인하시겠습니까?")) return;
      await runWithErrorBoundary(async () => {
        await approveCompany(id, user.id);
        
        // Log to reviews
        const reviews = JSON.parse(localStorage.getItem("mock_reviews") || "[]");
        reviews.push({
          id: "rev-budget-" + id,
          expense_request_id: "budget-" + id,
          reviewer_id: user.profile.name,
          decision: "approved",
          comment: commentInput.value.trim() || "예산 배정안을 승인합니다.",
          created_at: new Date().toISOString()
        });
        localStorage.setItem("mock_reviews", JSON.stringify(reviews));

        commentInput.value = "";
        detail = await getAdminCompanyDetail(id);
        renderHeader();
        alert("예산안이 승인 처리되었습니다.");
      }, { button: e.currentTarget });
    });

    const handleBudgetReview = async (decision, label, btn) => {
      const comment = commentInput.value.trim();
      if (!comment) {
        alert("보완요청 또는 반려 시에는 반드시 심사 의견을 작성해야 합니다.");
        commentInput.focus();
        return;
      }
      if (!confirm(`이 예산안을 ${label} 처리하시겠습니까?`)) return;

      await runWithErrorBoundary(async () => {
        await rejectCompany(id); // Set status to 'rejected'
        if (decision === "revision_requested") {
          // If it is revision, set status back to 'rejected' but label as revision in review
          const companies = JSON.parse(localStorage.getItem("mock_companies") || "[]");
          const idx = companies.findIndex(c => c.id === id);
          if (idx !== -1) {
            companies[idx].approval_status = "rejected"; // Under pending/rejected state
            localStorage.setItem("mock_companies", JSON.stringify(companies));
          }
        }

        // Add review log
        const reviews = JSON.parse(localStorage.getItem("mock_reviews") || "[]");
        // Remove old budget reviews for this company to prevent spamming
        const filtered = reviews.filter(r => r.expense_request_id !== "budget-" + id);
        filtered.push({
          id: "rev-budget-" + id + "-" + Date.now(),
          expense_request_id: "budget-" + id,
          reviewer_id: user.profile.name,
          decision: decision,
          comment: comment,
          created_at: new Date().toISOString()
        });
        localStorage.setItem("mock_reviews", JSON.stringify(filtered));

        commentInput.value = "";
        detail = await getAdminCompanyDetail(id);
        renderHeader();
        alert(`예산안이 ${label} 처리되었습니다.`);
      }, { button: btn });
    };

    document.getElementById("btn-revision-budget")?.addEventListener("click", (e) => {
      handleBudgetReview("revision_requested", "보완요청", e.currentTarget);
    });

    document.getElementById("btn-reject-budget")?.addEventListener("click", (e) => {
      handleBudgetReview("rejected", "반려", e.currentTarget);
    });

    // Save internal memo
    document.getElementById("btn-save-memo")?.addEventListener("click", async (e) => {
      const memoText = internalMemoEl.value.trim();
      const btn = e.currentTarget;
      await runWithErrorBoundary(async () => {
        const companies = JSON.parse(localStorage.getItem("mock_companies") || "[]");
        const idx = companies.findIndex(c => c.id === id);
        if (idx !== -1) {
          companies[idx].internal_memo = memoText;
          localStorage.setItem("mock_companies", JSON.stringify(companies));
        }
        const original = btn.textContent;
        btn.textContent = "저장완료";
        setTimeout(() => { btn.textContent = original; }, 1200);
      }, { button: btn });
    });

    // ZIP Download Mock
    document.getElementById("btn-download-all-docs")?.addEventListener("click", () => {
      alert("📦 [Mock ZIP 다운로드]\n최종 사업계획서 및 스타트업이 제출한 모든 지출 증빙 문서들이 ABC스포츠_증빙서류_일괄다운로드.zip 파일로 패키징되어 가상 다운로드되었습니다.");
    });

    renderHeader();
  }
} catch (error) {
  showError(error);
}
