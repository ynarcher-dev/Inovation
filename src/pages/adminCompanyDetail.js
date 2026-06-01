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
// committedByBudgetId: 비목별 이미 집행(승인+검토중)된 금액 맵 → 감액 하한 경고 산출
function BudgetSubmissionDiff(submission, programBudgets, committedByBudgetId = {}, company = {}) {
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
  const prevTotal = items.reduce((s, it) => s + Number(it.previous_allocated_amount || 0), 0);
  const reqTotal = items.reduce((s, it) => s + Number(it.requested_allocated_amount || 0), 0);
  const typeLabel = submission.type === "change" ? "예산 변경 요청" : "최초 예산안";

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
            <th>거래처</th>
            <th>공급가액</th>
            <th>부가세</th>
            <th>첨부</th>
            <th>경고</th>
            <th>상태</th>
            <th>제출일</th>
          </tr>
        </thead>
        <tbody>
          ${expenses.map((row) => {
            const catPath = categoryPaths.get(row.budget_category) || row.budget_category || "-";
            const required = Number(row.doc_required || 0);
            const submitted = Number(row.doc_submitted || 0);
            const docComplete = required > 0 && submitted >= required;
            const docLabel = required > 0
              ? `<span style="color:${docComplete ? "#047857" : "#b91c1c"}; font-weight:600;">${submitted}/${required}</span>`
              : `<span class="muted">-</span>`;
            const warnCount = Number(row.warning_count || 0);
            const warnLabel = warnCount > 0
              ? `<span style="color:#d97706; font-weight:700;">⚠ ${warnCount}</span>`
              : `<span class="muted">0</span>`;
            return `
              <tr data-budget-category="${escapeHtml(row.budget_category || '')}">
                <td><a href="${target}?id=${encodeURIComponent(row.id)}" style="font-weight: 600;">${escapeHtml(row.title)}</a></td>
                <td>${escapeHtml(catPath)}</td>
                <td>${escapeHtml(row.vendor_name || "-")}</td>
                <td>${formatCurrency(row.amount_supply)}</td>
                <td>${formatCurrency(row.vat_amount)}</td>
                <td>${docLabel}</td>
                <td>${warnLabel}</td>
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
    const activateTab = (targetTab) => {
      if (!document.getElementById(targetTab)) return;
      tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === targetTab));
      tabContents.forEach((c) => c.classList.toggle("active", c.id === targetTab));
    };
    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => activateTab(btn.dataset.tab));
    });
    // 요약 탭 빠른 액션: 지정 탭으로 이동
    document.querySelectorAll("[data-goto-tab]").forEach((btn) => {
      btn.addEventListener("click", () => activateTab(btn.dataset.gotoTab));
    });
    // 대시보드 등에서 ?tab=tab-budget-review 형태로 딥링크 진입 지원 (S5 동선)
    const initialTab = getQueryParam("tab");
    if (initialTab) activateTab(initialTab);

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

      // 요약 탭: 기업 기본정보
      setText("[data-summary-name]", company.name);
      setText("[data-phone]", company.phone || "-");
      setText("[data-program-name]", company.support_programs?.name || "-");
      const agreement = company.agreement_start_date && company.agreement_end_date
        ? `${formatDate(company.agreement_start_date)} ~ ${formatDate(company.agreement_end_date)}`
        : "-";
      setText("[data-agreement]", agreement);
      setText("[data-approval-status-2]", approvalText[company.approval_status] || company.approval_status || "-");
      setText("[data-budget-status-2]", getBudgetStatusLabel(company.budget_status));

      // 요약 탭: 예산 집계 (비목 배정 합산)
      const summaryRows = detail.budgetSummary || [];
      const sum = (key) => summaryRows.reduce((acc, r) => acc + Number(r[key] || 0), 0);
      setText("[data-sum-allocated]", formatCurrency(sum("allocated_amount")));
      setText("[data-sum-approved]", formatCurrency(sum("approved_amount")));
      setText("[data-sum-pending]", formatCurrency(sum("pending_amount")));
      setText("[data-sum-remaining]", formatCurrency(sum("remaining_amount")));
      const revisionCount = (detail.reviewHistory || [])
        .filter((r) => r.decision === "revision_requested" || r.decision === "rejected").length;
      setText("[data-revision-count]", String(revisionCount));

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

      // 탭 배지: 검토 대기 표시
      const budgetReviewBadge = document.querySelector("[data-badge-budget-review]");
      if (budgetReviewBadge) budgetReviewBadge.hidden = !detail.pendingSubmission;
      const expenseReviewBadge = document.querySelector("[data-badge-expense-review]");
      if (expenseReviewBadge) {
        expenseReviewBadge.hidden = pendingExpenses.length === 0;
        expenseReviewBadge.textContent = pendingExpenses.length ? String(pendingExpenses.length) : "●";
      }

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
        const committed = detail.committedByBudgetId || {};
        detailEl.innerHTML = BudgetSubmissionDiff(pending, detail.programBudgets, committed, detail.company);
        reviewButtons.forEach((b) => (b.disabled = false));
        if (commentInput) commentInput.disabled = false;
        // 감액 불가 위반이 있으면 승인만 차단 (보완/반려는 허용)
        const hasViolation = (pending.items || []).some(
          (it) => Number(it.requested_allocated_amount || 0) < Number(committed[it.support_program_budget_id] || 0)
        );
        const approveBtn = document.getElementById("btn-approve-budget");
        if (approveBtn) {
          approveBtn.disabled = hasViolation;
          approveBtn.title = hasViolation ? "감액 불가 비목이 있어 승인할 수 없습니다." : "";
        }
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
