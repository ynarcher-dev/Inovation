import { mountShell, runWithErrorBoundary, showError } from "../../app.js";
import { requireRole } from "../../auth.js";
import {
  createExpense,
  updateExpenseRequest,
  submitExpenseRequest,
  getExpenseDetail,
  getFounderDashboard,
} from "../../api.js";
import { hasApprovedBudget } from "../../domains/budget/budget-status.js";
import { FOUNDER_EDITABLE_STATUSES, COMMITTED_STATUSES } from "../../domains/status.js";
import { getExpenseTypesForBudgetCategory } from "../../domains/expense/rules-engine.js";
import { escapeHtml, formatNumber, getQueryParam, parseNumber } from "../../utils.js";

let planItems = [];

// 사전승인/재제출(submit) 시 모두 입력돼야 하는 필수 항목. 예산 항목(드롭다운)은 별도로 검증한다.
const REQUIRED_FIELDS = [
  { id: "title", label: "지출 제목" },
  { id: "vendor_name", label: "거래처명" },
  { id: "vendor_business_number", label: "거래처 사업자등록번호" },
  { id: "amount_supply", label: "공급가액" },
  { id: "vat_amount", label: "부가세" },
  { id: "expected_completion_date", label: "지출 예정일자" },
  { id: "purpose", label: "신청 내용" },
];

// 편집 모드 상태. editId 가 있으면 이미 생성된 같은 건(보완/임시저장)을 수정한다.
let editId = null;
let editStatus = null;
let editOwnAmount = 0; // 편집 중인 건이 이미 예산을 점유 중일 때 잔액 비교에 되돌려줄 본인 공급가액

function getSelectedBusinessPlanItem() {
  const selectedId = document.querySelector("#business_plan_item_id").value;
  return planItems.find((item) => item.id === selectedId) || null;
}

function readInput(companyId) {
  const amountSupply = parseNumber(document.querySelector("#amount_supply").value);
  const vatAmount = parseNumber(document.querySelector("#vat_amount").value);
  const planItem = getSelectedBusinessPlanItem();
  const budgetCategory = planItem?.budget_category || "";
  // 지출 유형은 선택한 사업계획서 항목의 비목으로 자동 도출한다(매핑 없으면 공통 서류 기준).
  const expenseType = getExpenseTypesForBudgetCategory(budgetCategory)[0]?.value || "";
  return {
    company_id: companyId,
    title: document.querySelector("#title").value,
    business_plan_item_id: document.querySelector("#business_plan_item_id").value,
    expense_type: expenseType,
    budget_category: budgetCategory,
    amount_supply: amountSupply,
    vat_amount: vatAmount,
    total_amount: amountSupply + vatAmount,
    vendor_name: document.querySelector("#vendor_name").value,
    vendor_business_number: document.querySelector("#vendor_business_number").value,
    purpose: document.querySelector("#purpose").value,
    expected_completion_date: document.querySelector("#expected_completion_date").value || null,
    // 첨부 서류(선금 신청 포함) 기능은 재설계 중이라 현재는 신청하지 않는다.
    advance_payment_requested: false,
  };
}

// 항목의 비목 단계(뎁스) 경로와 잔여 금액 문자열을 구한다.
function planItemLabel(item) {
  const path = Array.isArray(item.path) && item.path.length ? item.path.join(" › ") : item.title;
  const remaining = `${formatNumber(item.remaining_amount ?? item.allocated_amount ?? 0)}원`;
  return { path, remaining };
}

function renderBusinessPlanOptions(items) {
  const select = document.querySelector("#business_plan_item_id");
  const dropdown = document.querySelector("[data-plan-select]");

  // 값 저장/폼 제출용 숨김 select.
  select.innerHTML = items?.length
    ? items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(planItemLabel(item).path)}</option>`).join("")
    : `<option value="">등록된 사업계획서 항목 없음</option>`;

  if (!items?.length) {
    dropdown.innerHTML = `<button type="button" class="amount-select__trigger" disabled><span class="amount-select__path">등록된 사업계획서 항목 없음</span></button>`;
    return;
  }

  const optionsHtml = items.map((item) => {
    const { path, remaining } = planItemLabel(item);
    return `<li role="option" class="amount-select__option" data-value="${escapeHtml(item.id)}">
        <span class="amount-select__path">${escapeHtml(path)}</span>
        <span class="amount-select__amount">잔액 ${escapeHtml(remaining)}</span>
      </li>`;
  }).join("");

  dropdown.innerHTML = `
    <button type="button" class="amount-select__trigger" aria-haspopup="listbox" aria-expanded="false">
      <span class="amount-select__path" data-trigger-path></span>
      <span class="amount-select__amount" data-trigger-amount></span>
    </button>
    <ul class="amount-select__list" role="listbox" hidden>${optionsHtml}</ul>`;

  const trigger = dropdown.querySelector(".amount-select__trigger");
  const list = dropdown.querySelector(".amount-select__list");

  const syncTrigger = () => {
    const current = items.find((item) => item.id === select.value) || items[0];
    const { path, remaining } = planItemLabel(current);
    dropdown.querySelector("[data-trigger-path]").textContent = path;
    dropdown.querySelector("[data-trigger-amount]").textContent = `잔액 ${remaining}`;
    list.querySelectorAll(".amount-select__option").forEach((option) => {
      option.setAttribute("aria-selected", option.dataset.value === select.value ? "true" : "false");
    });
  };

  const close = () => {
    list.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };

  trigger.addEventListener("click", () => {
    const open = list.hidden;
    list.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
  });

  list.querySelectorAll(".amount-select__option").forEach((option) => {
    option.addEventListener("click", () => {
      select.value = option.dataset.value;
      syncTrigger();
      close();
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  document.addEventListener("click", (event) => {
    if (!dropdown.contains(event.target)) close();
  });

  syncTrigger();
}

// 편집 모드: 기존 지출 건의 값을 폼에 채운다.
function prefillForm(expense) {
  document.querySelector("#title").value = expense.title || "";
  if (expense.business_plan_item_id) {
    document.querySelector("#business_plan_item_id").value = expense.business_plan_item_id;
  }
  document.querySelector("#vendor_name").value = expense.vendor_name || "";
  document.querySelector("#vendor_business_number").value = expense.vendor_business_number || "";
  document.querySelector("#amount_supply").value = formatNumber(String(expense.amount_supply || 0));
  document.querySelector("#vat_amount").value = formatNumber(String(expense.vat_amount || 0));
  document.querySelector("#expected_completion_date").value = expense.expected_completion_date || "";
  document.querySelector("#purpose").value = expense.purpose || "";
}

// 편집 모드 화면 카피(제목/버튼). 보완 단계는 '보완하기/재제출' 흐름으로 안내한다.
function applyEditModeCopy(status) {
  const titleEl = document.querySelector("[data-page-title]");
  const descEl = document.querySelector("[data-page-desc]");
  const submitBtn = document.querySelector("[data-action-submit]");
  if (status === "pre_approval_revision") {
    titleEl.textContent = "사전승인 보완";
    descEl.textContent = "검토 의견을 반영해 같은 건의 내용·서류를 수정한 뒤 다시 제출하세요.";
    submitBtn.textContent = "보완 후 재제출";
  } else if (status === "final_approval_revision") {
    titleEl.textContent = "최종승인 보완";
    descEl.textContent = "검토 의견을 반영해 같은 건의 내용·서류를 수정한 뒤 다시 제출하세요.";
    submitBtn.textContent = "최종승인 재제출";
  } else {
    titleEl.textContent = "지출 신청 수정";
    descEl.textContent = "임시저장 후 언제든 수정할 수 있으며, 사전승인 신청을 누르면 관리자 검토가 시작됩니다.";
    submitBtn.textContent = "사전승인 신청";
  }
}

try {
  mountShell();
  const user = await requireRole(["founder"]);
  if (user) {
    const { budgetSummary, company } = await getFounderDashboard();
    if (company?.approval_status !== "approved" || !hasApprovedBudget(company?.budget_status)) {
      window.alert("예산안 승인 완료 후 지출 신청을 생성할 수 있습니다.");
      window.location.href = "dashboard.html";
      throw new Error("예산안 승인 대기 중입니다.");
    }
    planItems = budgetSummary || [];
    renderBusinessPlanOptions(budgetSummary);

    // 편집 모드 진입: ?id= 로 기존 건을 불러온다. 수정 가능 상태가 아니면 상세로 돌려보낸다.
    const queryId = getQueryParam("id");
    if (queryId) {
      const detail = await getExpenseDetail(queryId);
      if (!FOUNDER_EDITABLE_STATUSES.includes(detail.expense.status)) {
        window.alert("현재 상태에서는 내용을 수정할 수 없습니다.");
        window.location.href = `expense-detail.html?id=${encodeURIComponent(queryId)}`;
        throw new Error("수정 불가 상태입니다.");
      }
      editId = queryId;
      editStatus = detail.expense.status;
      editOwnAmount = Number(detail.expense.amount_supply || 0);
      prefillForm(detail.expense);
      applyEditModeCopy(editStatus);
    }

    const form = document.querySelector("#expense-form");
    document.querySelectorAll("[data-money-input]").forEach((input) => {
      input.value = formatNumber(input.value);
      input.addEventListener("input", () => {
        const cursorAtEnd = input.selectionStart === input.value.length;
        input.value = formatNumber(input.value);
        if (cursorAtEnd) input.setSelectionRange(input.value.length, input.value.length);
      });
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const action = event.submitter?.value || "submit"; // draft(임시저장) | submit(제출)
      const planItem = getSelectedBusinessPlanItem();
      if (!planItem) {
        window.alert("사업계획서 항목을 선택해야 합니다.");
        return;
      }

      const inputVal = readInput(company.id);

      // 제출 시에만 모든 항목이 입력됐는지 검증한다(임시저장은 일부만 채워도 허용).
      if (action === "submit") {
        const missing = REQUIRED_FIELDS.find(({ id }) => !document.querySelector(`#${id}`).value.trim());
        if (missing) {
          window.alert(`${missing.label}은(는) 필수 입력 항목입니다.`);
          document.querySelector(`#${missing.id}`).focus();
          return;
        }
      }

      // 제출 시에만 비목 잔액을 검증한다. 편집 모드에서 이 건이 이미 예산을 점유 중이면 본인 금액은 잔액에 더해 비교한다.
      if (action === "submit") {
        const ownContribution =
          editId && COMMITTED_STATUSES.includes(editStatus) && planItem.id === inputVal.business_plan_item_id
            ? editOwnAmount
            : 0;
        const available = Number(planItem.remaining_amount || 0) + ownContribution;
        if (inputVal.amount_supply > available) {
          window.alert(`신청 금액(공급가액 기준 ${formatNumber(String(inputVal.amount_supply))}원)이 해당 비목의 집행 잔액(${formatNumber(String(available))}원)을 초과하여 신청할 수 없습니다.`);
          return;
        }
        const submitLabel = editStatus === "final_approval_revision" ? "최종승인" : "사전승인";
        if (!window.confirm(`${submitLabel} 신청을 진행하시겠습니까? 제출 후에는 관리자 검토가 시작됩니다.`)) {
          return;
        }
      }

      await runWithErrorBoundary(async () => {
        let targetId = editId;
        if (editId) {
          await updateExpenseRequest(editId, inputVal);
        } else {
          const data = await createExpense(inputVal, user);
          targetId = data.id;
        }
        // 제출 액션이면 현재 상태 기준으로 검토 단계로 보낸다.
        if (action === "submit") {
          await submitExpenseRequest(targetId);
        }
        window.location.href = `expense-detail.html?id=${encodeURIComponent(targetId)}`;
      }, { button: event.submitter });
    });
  }
} catch (error) {
  showError(error);
}
