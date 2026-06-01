import { mountShell, runWithErrorBoundary, showError, setText } from "../app.js";
import { requireRole } from "../auth.js";
import { getFounderDashboard, submitFounderBudgetAllocations, getGuidanceDownloadUrl } from "../api.js";
import { ExpenseTable } from "../components/ExpenseTable.js";
import { BudgetTreeView } from "../components/BudgetTreeView.js";
import { FlatReviewHistoryTable } from "../components/FlatReviewHistoryTable.js";
import { escapeHtml, formatCurrency, formatDate, formatNumber, parseNumber } from "../utils.js";

function ManualLinks(manualLinks) {
  if (!manualLinks?.length) return `<span class="muted">안내사항 문서가 없습니다.</span>`;
  return manualLinks.map(link => `
    <a href="#" class="guidance-link" data-guidance-link="${escapeHtml(link.link_url)}">
      📄 ${escapeHtml(link.title)} (${escapeHtml(link.content || "다운로드")})
    </a>
  `).join(" | ");
}

try {
  mountShell();
  const user = await requireRole(["founder"]);
  if (user) {
    let detail = await getFounderDashboard();
    const { expenses, manualLinks, reviewHistory } = detail;
    const approvalNotice = document.querySelector("[data-approval-notice]");
    const newExpenseLink = document.querySelector("[data-new-expense-link]");

    // Tabs switching
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

    // Recalculate allocation sums dynamically in editing mode
    const recalculateTreeSums = () => {
      const inputs = document.querySelectorAll("[data-allocation-input]");
      const values = {};
      inputs.forEach((input) => { values[input.dataset.allocationInput] = parseNumber(input.value); });

      const getSum = (node) => {
        if (node.isLeaf) return values[node.id] || 0;
        return node.children ? node.children.reduce((s, c) => s + getSum(c), 0) : 0;
      };

      const updateDom = (nodes) => {
        for (const node of nodes) {
          if (!node.isLeaf) {
            const sum = getSum(node);
            const cell = document.querySelector(`[data-parent-allocation="${node.id}"]`);
            if (cell) cell.textContent = formatCurrency(sum);
            if (node.children) updateDom(node.children);
          }
        }
      };

      updateDom(detail.budgetTree);
      const grandTotal = detail.budgetTree.reduce((s, root) => s + getSum(root), 0);
      document.getElementById("budget-edit-total").textContent = formatCurrency(grandTotal);
    };

    const renderEditableTree = () => {
      document.getElementById("budget-empty-card").hidden = true;
      const container = document.getElementById("budget-tree-container");
      container.hidden = false;

      const treeEl = document.querySelector("[data-budget-tree]");
      treeEl.innerHTML = BudgetTreeView(detail.budgetTree, true) + `
        <div style="margin-top: 24px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--line); padding-top: 16px;">
          <div>
            <strong>총 배정 금액: </strong>
            <span id="budget-edit-total" style="font-size: 18px; font-weight: 700; color: var(--primary);">0원</span>
          </div>
          <div class="actions">
            <button class="button" id="save-budget-btn" type="submit">승인 신청</button>
            <button class="button secondary" id="cancel-budget-btn" type="button">취소</button>
          </div>
        </div>
      `;

      recalculateTreeSums();

      const table = document.getElementById("budget-matrix-table");
      table.addEventListener("input", (event) => {
        if (event.target.classList.contains("budget-alloc-input")) {
          const cursorAtEnd = event.target.selectionStart === event.target.value.length;
          event.target.value = formatNumber(event.target.value);
          if (cursorAtEnd) {
            event.target.setSelectionRange(event.target.value.length, event.target.value.length);
          }
          recalculateTreeSums();
        }
      });

      document.getElementById("cancel-budget-btn").addEventListener("click", () => { renderInitialState(); });

      document.getElementById("budget-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const saveBtn = document.getElementById("save-budget-btn");
        const cancelBtn = document.getElementById("cancel-budget-btn");
        saveBtn.disabled = true;
        cancelBtn.disabled = true;

        const inputs = document.querySelectorAll("[data-allocation-input]");
        const allocations = Array.from(inputs).map((input) => ({
          support_program_budget_id: input.dataset.allocationInput,
          allocated_amount: parseNumber(input.value),
        }));

        await runWithErrorBoundary(async () => {
          await submitFounderBudgetAllocations(detail.company.id, allocations);
          window.alert("예산 배정 신청이 완료되었습니다. 관리자 승인 후 지출 신청이 가능합니다.");
          detail = await getFounderDashboard();
          renderInitialState();
        }, { button: saveBtn });

        saveBtn.disabled = false;
        cancelBtn.disabled = false;
      });
    };

    const renderInitialState = () => {
      const hasAllocations = detail.allocations && detail.allocations.length > 0;
      
      // Top Cards
      setText("[data-company-name]", detail.company?.name || "-");
      setText("[data-representative]", detail.company?.representative_name || "-");
      setText("[data-support-program]", detail.company?.support_programs?.name || "-");
      setText("[data-agreement]", `${formatDate(detail.company?.agreement_start_date)} - ${formatDate(detail.company?.agreement_end_date)}`);
      
      const supportTotal = Number(detail.company?.support_total_amount || 0);
      setText("[data-support-total]", `${formatCurrency(supportTotal)}`);
      
      // Approved total
      const approvedExpenses = expenses.filter((r) => r.status === "pre_approved");
      const approvedTotalSum = approvedExpenses.reduce((s, r) => s + Number(r.amount_supply || 0), 0);
      setText("[data-approved-total]", formatCurrency(approvedTotalSum));

      // Execution rate
      const rate = supportTotal ? Math.round((approvedTotalSum / supportTotal) * 100) : 0;
      setText("[data-execution-rate]", `${rate}% 집행 완료`);

      // Self Payment Status
      const selfPayAmount = Number(detail.company?.self_payment_required_amount || 0);
      setText("[data-self-payment-total]", `${formatNumber(selfPayAmount)}원`);
      const selfPayStatusEl = document.querySelector("[data-self-payment-status]");
      if (selfPayStatusEl) {
        if (detail.company?.self_payment_paid) {
          selfPayStatusEl.textContent = "완납";
          selfPayStatusEl.style.color = "#10b981";
        } else {
          selfPayStatusEl.textContent = "미납";
          selfPayStatusEl.style.color = "#ef4444";
        }
      }

      // Counters
      setText("[data-approved-count]", expenses.filter((r) => r.status === "pre_approved").length);
      setText("[data-revision-count]", expenses.filter((r) => r.status?.includes("revision")).length);
      setText("[data-rejected-count]", expenses.filter((r) => r.status === "rejected").length);

      // Business Plan
      const bp = detail.company?.business_plan;
      setText("[data-business-plan-file]", bp?.original_filename || "등록된 사업계획서가 없습니다.");
      setText("[data-business-plan-approved]", bp?.approved_at ? `${formatDate(bp.approved_at)} 승인됨` : "");

      // Revision feedbacks card
      const revisionFeedbackCard = document.getElementById("revision-feedback-card");
      const revisionExpenses = expenses.filter((r) => r.status?.includes("revision"));
      if (revisionExpenses.length > 0) {
        revisionFeedbackCard.hidden = false;
        // Show comment from the latest review of the revision requests
        const latestRev = reviewHistory.find((r) => r.decision === "revision_requested");
        document.getElementById("revision-feedback-text").innerHTML = latestRev
          ? `보완이 시급한 건: <strong>${escapeHtml(latestRev.title)}</strong><br>의견: "${escapeHtml(latestRev.comment)}"`
          : "보완 요청 서류가 존재합니다. 지출 신청 상세 페이지를 확인해 주세요.";
      } else {
        revisionFeedbackCard.hidden = true;
      }

      // Action routing notice
      if (detail.company?.approval_status && detail.company.approval_status !== "approved") {
        approvalNotice.hidden = false;
        if (!hasAllocations) {
          approvalNotice.textContent = "지출 신청을 진행하려면 먼저 예산 배정액을 신청하고 승인을 받아야 합니다.";
          newExpenseLink.classList.add("disabled");
          newExpenseLink.style.pointerEvents = "none";
        } else {
          approvalNotice.textContent = detail.company.approval_status === "pending"
            ? "배정 예산 승인이 대기 중입니다. 승인 완료 후 지출 신청이 가능합니다."
            : "배정 예산 승인이 반려되었습니다. 예산안을 재조정해 주세요.";
          newExpenseLink.classList.add("disabled");
          newExpenseLink.style.pointerEvents = "none";
        }
      } else {
        approvalNotice.hidden = true;
        newExpenseLink.classList.remove("disabled");
        newExpenseLink.style.pointerEvents = "auto";
      }

      if (!hasAllocations) {
        document.getElementById("budget-empty-card").hidden = false;
        document.getElementById("budget-tree-container").hidden = true;
      } else {
        document.getElementById("budget-empty-card").hidden = true;
        document.getElementById("budget-tree-container").hidden = false;
        document.querySelector("[data-budget-tree]").innerHTML = BudgetTreeView(detail.budgetTree, false);
      }
    };

    document.getElementById("start-budget-btn").addEventListener("click", () => { renderEditableTree(); });
    document.getElementById("revision-counter-card")?.addEventListener("click", () => {
      const btn = document.querySelector('[data-tab="tab-expense"]');
      if (btn) btn.click();
    });

    setText("[data-user-name]", user.profile.name);
    
    // Bind guidance links
    const guidanceContainer = document.querySelector("[data-manual-links]");
    if (guidanceContainer) {
      guidanceContainer.innerHTML = ManualLinks(manualLinks);
      const links = guidanceContainer.querySelectorAll(".guidance-link");
      links.forEach((link) => {
        link.addEventListener("click", async (event) => {
          event.preventDefault();
          const linkUrl = link.dataset.guidanceLink;
          await runWithErrorBoundary(async () => {
            const downloadUrl = await getGuidanceDownloadUrl(linkUrl);
            window.open(downloadUrl, "_blank", "noopener,noreferrer");
          }, {});
        });
      });
    }

    document.querySelector("[data-expense-table]").innerHTML = ExpenseTable(expenses);
    document.querySelector("[data-review-history]").innerHTML = FlatReviewHistoryTable(reviewHistory);

    renderInitialState();
  }
} catch (error) {
  showError(error);
}
