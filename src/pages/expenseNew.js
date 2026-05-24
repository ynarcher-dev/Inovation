import { mountShell, runWithErrorBoundary, showError } from "../app.js";
import { requireRole } from "../auth.js";
import { createExpense, getFounderDashboard } from "../api.js";
import { Checklist } from "../components/Checklist.js";
import { openDocumentActionModal } from "../components/DocumentActionModal.js";
import { generateChecklist, generateWarnings, getExpenseTypeMeta, getExpenseTypesForBudgetCategory } from "../rulesEngine.js";
import { escapeHtml, formatNumber, parseNumber } from "../utils.js";

let planItems = [];

function getSelectedBusinessPlanItem() {
  const selectedId = document.querySelector("#business_plan_item_id").value;
  return planItems.find((item) => item.id === selectedId) || null;
}

function readInput(companyId) {
  const amountSupply = parseNumber(document.querySelector("#amount_supply").value);
  const vatAmount = parseNumber(document.querySelector("#vat_amount").value);
  const meta = getExpenseTypeMeta(document.querySelector("#expense_type").value);
  const planItem = getSelectedBusinessPlanItem();
  const expenseType = document.querySelector("#expense_type").value;
  return {
    company_id: companyId,
    title: document.querySelector("#title").value,
    business_plan_item_id: document.querySelector("#business_plan_item_id").value,
    expense_type: expenseType || meta.value,
    budget_category: planItem?.budget_category || meta.budgetCategory,
    amount_supply: amountSupply,
    vat_amount: vatAmount,
    total_amount: amountSupply + vatAmount,
    vendor_name: document.querySelector("#vendor_name").value,
    vendor_business_number: document.querySelector("#vendor_business_number").value,
    purpose: document.querySelector("#purpose").value,
    expected_completion_date: document.querySelector("#expected_completion_date").value || null,
    advance_payment_requested: document.querySelector("#advance_payment_requested").checked,
  };
}

function renderDerived(input) {
  const meta = getExpenseTypeMeta(input.expense_type);
  document.querySelector("[data-budget-category]").textContent = input.budget_category;
  document.querySelector("[data-budget-reason]").textContent = `${meta.reason} 선택한 사업계획서 항목의 비목(${input.budget_category}) 범위 안에서 신청됩니다.`;
  const checklist = generateChecklist(input);
  document.querySelector("[data-checklist]").innerHTML = Checklist(checklist);
  document.querySelectorAll("[data-checklist] [data-document-type]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = checklist.find((documentItem) => documentItem.document_type === button.dataset.documentType);
      openDocumentActionModal(item, {
        completeLabel: "업로드/작성 위치 확인",
        requireFile: false,
        onComplete: async () => {
          window.alert("이 서류는 신청을 임시저장한 뒤 상세 화면에서 업로드하거나 작성할 수 있습니다.");
        },
      });
    });
  });
  const warnings = generateWarnings(input);
  document.querySelector("[data-warnings]").innerHTML = warnings.length
    ? warnings.map((warning) => `<p class="notice">${escapeHtml(warning.message)}</p>`).join("")
    : `<p class="empty">현재 입력값 기준 위험 경고가 없습니다.</p>`;
}

function renderBusinessPlanOptions(items) {
  const select = document.querySelector("#business_plan_item_id");
  select.innerHTML = items?.length
    ? items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)} (${escapeHtml(item.budget_category)})</option>`).join("")
    : `<option value="">등록된 사업계획서 항목 없음</option>`;
}

function renderExpenseTypeOptions() {
  const select = document.querySelector("#expense_type");
  const planItem = getSelectedBusinessPlanItem();
  const options = getExpenseTypesForBudgetCategory(planItem?.budget_category || "");
  const currentValue = select.value;

  if (!planItem) {
    select.innerHTML = `<option value="">사업계획서 항목을 먼저 선택하세요</option>`;
    select.disabled = true;
    return;
  }

  if (!options.length) {
    select.innerHTML = `<option value="">해당 비목에 등록된 지출 유형 없음</option>`;
    select.disabled = true;
    return;
  }

  select.disabled = false;
  select.innerHTML = options
    .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
    .join("");

  if (options.some((option) => option.value === currentValue)) {
    select.value = currentValue;
  }
}

try {
  mountShell();
  const user = await requireRole(["founder"]);
  if (user) {
    const { businessPlanItems, company } = await getFounderDashboard();
    if (company?.approval_status !== "approved") {
      window.alert("관리자 승인 완료 후 지출 신청을 생성할 수 있습니다.");
      window.location.href = "/founder/dashboard.html";
      throw new Error("관리자 승인 대기 중입니다.");
    }
    planItems = businessPlanItems || [];
    renderBusinessPlanOptions(businessPlanItems);
    renderExpenseTypeOptions();
    const form = document.querySelector("#expense-form");
    document.querySelectorAll("[data-money-input]").forEach((input) => {
      input.value = formatNumber(input.value);
      input.addEventListener("input", () => {
        const cursorAtEnd = input.selectionStart === input.value.length;
        input.value = formatNumber(input.value);
        if (cursorAtEnd) input.setSelectionRange(input.value.length, input.value.length);
      });
    });
    const update = () => {
      renderExpenseTypeOptions();
      renderDerived(readInput(company.id));
    };
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!getSelectedBusinessPlanItem() || !document.querySelector("#expense_type").value) {
        window.alert("사업계획서 항목과 지출 유형을 선택해야 합니다.");
        return;
      }
      await runWithErrorBoundary(async () => {
        const data = await createExpense(readInput(company.id), user);
        window.location.href = `/founder/expense-detail.html?id=${encodeURIComponent(data.id)}`;
      }, { button: event.submitter });
    });
    update();
  }
} catch (error) {
  showError(error);
}
