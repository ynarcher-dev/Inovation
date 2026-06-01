import { mountShell, runWithErrorBoundary, showError, setText } from "../app.js";
import { requireRole } from "../auth.js";
import {
  getAdminCompanyDetail,
  updateCompanySupportTotal,
  upsertCompanyBudgetAllocation,
  reviewBudgetSubmission,
} from "../api.js";
import { ExpenseTable } from "../components/ExpenseTable.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { BudgetTreeView } from "../components/BudgetTreeView.js";
import { FlatReviewHistoryTable } from "../components/FlatReviewHistoryTable.js";
import { getBudgetStatusLabel } from "../budgetStatus.js";
import {
  escapeHtml,
  formatCurrency,
  formatDate,
  formatNumber,
  getQueryParam,
  parseNumber,
} from "../utils.js";

const approvalText = {
  pending: "가입 승인 대기",
  approved: "가입 승인 완료",
  rejected: "가입 반려",
};

// 제출안의 비목별 변경 전/후 금액 비교표를 만든다.
function BudgetSubmissionDiff(submission, programBudgets) {
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
  const items = (submission.items || []).slice().sort((a, b) =>
    pathOf(a.support_program_budget_id).localeCompare(pathOf(b.support_program_budget_id))
  );
  const prevTotal = items.reduce((s, it) => s + Number(it.previous_allocated_amount || 0), 0);
  const reqTotal = items.reduce((s, it) => s + Number(it.requested_allocated_amount || 0), 0);
  const typeLabel = submission.type === "change" ? "예산 변경 요청" : "최초 예산안";

  const rows = items.map((it) => {
    const prev = Number(it.previous_allocated_amount || 0);
    const req = Number(it.requested_allocated_amount || 0);
    const diff = req - prev;
    const diffStr = diff === 0 ? "-" : `${diff > 0 ? "+" : ""}${formatCurrency(diff)}`;
    const diffColor = diff > 0 ? "#047857" : diff < 0 ? "#b91c1c" : "#6b7280";
    return `
      <tr>
        <td>${escapeHtml(pathOf(it.support_program_budget_id) || "-")}</td>
        <td style="text-align:right;">${formatCurrency(prev)}</td>
        <td style="text-align:right;">${formatCurrency(req)}</td>
        <td style="text-align:right; color:${diffColor};">${diffStr}</td>
      </tr>`;
  }).join("");

  const totalDiff = reqTotal - prevTotal;
  return `
    <div class="notice" style="margin-bottom:8px;">
      <strong>${escapeHtml(typeLabel)}</strong>
      · 제출일 ${formatDate(submission.submitted_at)}
      ${submission.reason ? `· 사유: ${escapeHtml(submission.reason)}` : ""}
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>비목</th><th style="text-align:right;">변경 전</th><th style="text-align:right;">요청(변경 후)</th><th style="text-align:right;">증감</th></tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr style="font-weight:700;">
            <td>합계</td>
            <td style="text-align:right;">${formatCurrency(prevTotal)}</td>
            <td style="text-align:right;">${formatCurrency(reqTotal)}</td>
            <td style="text-align:right; color:${totalDiff > 0 ? "#047857" : totalDiff < 0 ? "#b91c1c" : "#6b7280"};">${totalDiff === 0 ? "-" : `${totalDiff > 0 ? "+" : ""}${formatCurrency(totalDiff)}`}</td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

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
      setText("[data-budget-status]", getBudgetStatusLabel(company.budget_status));
      supportTotalInput.value = formatNumber(company.support_total_amount || 0);
      setText("[data-business-plan-version]", company.business_plan?.version || "V1.0");
      setText("[data-business-plan-file]", company.business_plan?.original_filename || "최종_사업계획서.pdf");
      setText("[data-business-plan-approved]", company.business_plan?.approved_at ? formatDate(company.business_plan.approved_at) : "미지정");

      // Load internal memo
      if (internalMemoEl) {
        internalMemoEl.value = company.internal_memo || "";
      }

      budgetTreeEl.innerHTML = BudgetTreeView(detail.budgetTree, false, company.support_programs?.level_labels); // view-only on admin too
      attachAllocationHandlers(budgetTreeEl, company.id, async () => {
        detail = await getAdminCompanyDetail(id);
        renderHeader();
      });

      const categoryPaths = getBudgetCategoryPaths(detail.programBudgets);
      const pendingExpenses = detail.expenses.filter((row) => row.status?.includes("submitted"));

      expenseTableEl.innerHTML = ExpenseRequestsTable(pendingExpenses, categoryPaths);
      reviewHistoryEl.innerHTML = FlatReviewHistoryTable(detail.reviewHistory, true);

      attachCategoryHighlight(budgetTreeEl, expenseTableEl);
      renderBudgetReview();
    };

    // 예산 제출안 심사 영역 렌더링: 검토 대기 제출안이 있을 때만 버튼 활성화.
    const renderBudgetReview = () => {
      const detailEl = document.getElementById("budget-review-detail");
      const actionsEl = document.getElementById("budget-review-actions");
      const pending = detail.pendingSubmission;
      const reviewButtons = actionsEl ? actionsEl.querySelectorAll("button") : [];

      if (pending) {
        detailEl.innerHTML = BudgetSubmissionDiff(pending, detail.programBudgets);
        reviewButtons.forEach((b) => (b.disabled = false));
        if (commentInput) commentInput.disabled = false;
      } else {
        const status = detail.company.budget_status || "not_submitted";
        detailEl.innerHTML = `<p class="empty">현재 검토할 예산 제출안이 없습니다. (예산안 상태: ${escapeHtml(getBudgetStatusLabel(status))})</p>`;
        reviewButtons.forEach((b) => (b.disabled = true));
        if (commentInput) commentInput.disabled = true;
      }
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

    // 예산 제출안 심사 액션 (승인 시에만 확정 예산 반영)
    const commentInput = document.getElementById("budget-review-comment");

    const submitBudgetReview = async (decision, label, btn) => {
      const pending = detail.pendingSubmission;
      if (!pending) {
        alert("검토할 예산 제출안이 없습니다.");
        return;
      }
      const comment = commentInput.value.trim();
      if (decision !== "approved" && !comment) {
        alert("보완요청 또는 반려 시에는 반드시 심사 의견을 작성해야 합니다.");
        commentInput.focus();
        return;
      }
      if (!confirm(`이 예산안을 ${label} 처리하시겠습니까?`)) return;

      await runWithErrorBoundary(async () => {
        await reviewBudgetSubmission(pending.id, decision, comment, user.profile.name);
        commentInput.value = "";
        detail = await getAdminCompanyDetail(id);
        renderHeader();
        alert(`예산안이 ${label} 처리되었습니다.`);
      }, { button: btn });
    };

    document.getElementById("btn-approve-budget")?.addEventListener("click", (e) => submitBudgetReview("approved", "승인", e.currentTarget));
    document.getElementById("btn-revision-budget")?.addEventListener("click", (e) => submitBudgetReview("revision_requested", "보완요청", e.currentTarget));
    document.getElementById("btn-reject-budget")?.addEventListener("click", (e) => submitBudgetReview("rejected", "반려", e.currentTarget));

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
