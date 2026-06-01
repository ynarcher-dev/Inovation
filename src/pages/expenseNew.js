import { mountShell, runWithErrorBoundary, showError } from "../app.js";
import { requireRole } from "../auth.js";
import { createExpense, getFounderDashboard, uploadDocumentFile } from "../api.js";
import { hasApprovedBudget } from "../budgetStatus.js";
import { Checklist } from "../components/Checklist.js";
import { openDocumentActionModal } from "../components/DocumentActionModal.js";
import { wireDropzones, showDropzoneFile } from "../components/dropzone.js";
import { generateChecklist, getExpenseTypesForBudgetCategory } from "../rulesEngine.js";
import { escapeHtml, formatNumber, parseNumber } from "../utils.js";

let planItems = [];
// 신청 생성 전이라 첨부 파일은 메모리에 보관했다가 신청 접수 시 업로드한다.
const heldFiles = new Map();
// 기타 증빙서류(복수 첨부)도 메모리에 보관한다.
const otherFiles = [];
const OTHER_EVIDENCE_TYPE = "other_evidence";
let rerender = () => {};

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
    advance_payment_requested: document.querySelector("#advance_payment_requested").checked,
  };
}

// 선금 신청 시 추가되는 서류 유형(토글 아래에 별도로 노출한다).
const ADVANCE_DOC_TYPES = new Set(["advance_payment_request", "advance_payment_plan"]);

// 자동작성/작성하기 등 모달이 필요한 버튼만 연결한다(업로드 유형은 드롭존이라 제외).
function attachChecklistHandlers(selector, items) {
  document.querySelectorAll(`${selector} button[data-document-type]`).forEach((button) => {
    button.addEventListener("click", () => {
      const item = items.find((documentItem) => documentItem.document_type === button.dataset.documentType);
      openDocumentActionModal(item, {
        completeLabel: "업로드/작성 위치 확인",
        requireFile: false,
        onComplete: async () => {
          window.alert("이 서류는 신청 접수 후 담당자 안내에 따라 처리됩니다.");
        },
      });
    });
  });
}

// 업로드 유형 드롭존: 드롭/선택한 파일을 메모리에 담고, 보관 중인 파일은 다시 표시한다.
function wireUploads(selector) {
  const root = document.querySelector(selector);
  if (!root) return;
  wireDropzones(root, (documentType, file) => {
    heldFiles.set(documentType, file);
    rerender();
  });
  root.querySelectorAll("[data-dropzone]").forEach((zone) => {
    const file = heldFiles.get(zone.dataset.documentType);
    if (file) {
      showDropzoneFile(zone, file.name, () => {
        heldFiles.delete(zone.dataset.documentType);
        rerender();
      });
    }
  });
}

// 기타 증빙서류: 토글 on일 때 복수 파일을 드롭/선택해 목록으로 보여 준다.
function addEvidenceFiles(fileList) {
  for (const file of fileList || []) otherFiles.push(file);
  renderOtherEvidence();
}

function renderOtherEvidence() {
  const container = document.querySelector("[data-other-evidence]");
  if (!container) return;
  const enabled = document.querySelector("#other_evidence_enabled").checked;
  container.hidden = !enabled;
  if (!enabled) {
    container.innerHTML = "";
    return;
  }

  const listHtml = otherFiles.map((file, index) => `
    <li class="evidence-file">
      <span class="evidence-file-name"><span aria-hidden="true">📎</span> ${escapeHtml(file.name)}</span>
      <button type="button" class="doc-file-btn is-danger" data-remove-evidence="${index}">삭제</button>
    </li>`).join("");

  container.innerHTML = `
    <label class="doc-dropzone" data-evidence-dropzone>
      <input type="file" multiple hidden>
      <span class="doc-dropzone-icon" aria-hidden="true">⬆</span>
      <span class="doc-dropzone-text">파일을 끌어다 놓거나 클릭해서 선택<br>(여러 개 가능)</span>
    </label>
    ${otherFiles.length ? `<ul class="evidence-list">${listHtml}</ul>` : ""}`;

  const zone = container.querySelector("[data-evidence-dropzone]");
  const input = zone.querySelector("input[type=file]");
  input.addEventListener("change", () => {
    addEvidenceFiles(input.files);
    input.value = "";
  });
  ["dragenter", "dragover"].forEach((type) => {
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.add("is-dragover");
    });
  });
  ["dragleave", "dragend"].forEach((type) => {
    zone.addEventListener(type, () => zone.classList.remove("is-dragover"));
  });
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("is-dragover");
    addEvidenceFiles(event.dataTransfer?.files);
  });
  container.querySelectorAll("[data-remove-evidence]").forEach((button) => {
    button.addEventListener("click", () => {
      otherFiles.splice(Number(button.dataset.removeEvidence), 1);
      renderOtherEvidence();
    });
  });
}

function renderDerived(input) {
  const checklist = generateChecklist(input);
  // 기본 첨부 서류는 토글 위, 선금 신청 추가 서류는 토글 아래에 분리해 렌더한다.
  const baseDocs = checklist.filter((item) => !ADVANCE_DOC_TYPES.has(item.document_type));
  const advanceDocs = checklist.filter((item) => ADVANCE_DOC_TYPES.has(item.document_type));

  document.querySelector("[data-checklist]").innerHTML = Checklist(baseDocs);
  attachChecklistHandlers("[data-checklist]", baseDocs);
  wireUploads("[data-checklist]");

  document.querySelector("[data-advance-checklist]").innerHTML = advanceDocs.length ? Checklist(advanceDocs) : "";
  attachChecklistHandlers("[data-advance-checklist]", advanceDocs);
  wireUploads("[data-advance-checklist]");

  // 신청에서 빠진 서류 유형의 보관 파일은 정리한다(예: 선금 토글 off).
  const validTypes = new Set(checklist.map((item) => item.document_type));
  for (const documentType of heldFiles.keys()) {
    if (!validTypes.has(documentType)) heldFiles.delete(documentType);
  }

  // 집행 가이드 내용은 추후 채울 예정이라 현재는 비워 둔다.
  document.querySelector("[data-warnings]").innerHTML = "";
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
      renderDerived(readInput(company.id));
    };
    rerender = update; // 드롭존 콜백에서 재렌더를 호출할 수 있게 연결한다.
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    // 선금 신청 체크박스는 필수서류 영역(폼 바깥)에 있어 직접 change를 연결한다.
    document.querySelector("#advance_payment_requested").addEventListener("change", update);
    // 기타 증빙서류 토글도 폼 바깥이라 직접 연결한다.
    document.querySelector("#other_evidence_enabled").addEventListener("change", renderOtherEvidence);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const planItem = getSelectedBusinessPlanItem();
      if (!planItem) {
        window.alert("사업계획서 항목을 선택해야 합니다.");
        return;
      }

      const inputVal = readInput(company.id);
      // Validate remaining amount limit
      if (inputVal.amount_supply > Number(planItem.remaining_amount || 0)) {
        window.alert(`신청 금액(공급가액 기준 ${formatNumber(inputVal.amount_supply)}원)이 해당 비목의 집행 잔액(${formatNumber(planItem.remaining_amount)}원)을 초과하여 신청할 수 없습니다.`);
        return;
      }

      // 신청은 접수 즉시 검토 단계로 넘어가며 이후 수정할 수 없으므로 한 번 확인한다.
      if (!window.confirm("신청을 접수하면 이후 수정할 수 없습니다. 사전승인 신청을 진행하시겠습니까?")) {
        return;
      }

      await runWithErrorBoundary(async () => {
        const data = await createExpense(inputVal, user);
        // 드래그앤드랍으로 보관해 둔 첨부 파일을 신청 생성 후 업로드한다.
        for (const [documentType, file] of heldFiles) {
          await uploadDocumentFile(data.id, documentType, file, user);
        }
        // 기타 증빙서류 토글이 켜져 있으면 보관한 복수 파일을 함께 업로드한다.
        if (document.querySelector("#other_evidence_enabled").checked) {
          for (const file of otherFiles) {
            await uploadDocumentFile(data.id, OTHER_EVIDENCE_TYPE, file, user);
          }
        }
        window.location.href = `expense-detail.html?id=${encodeURIComponent(data.id)}`;
      }, { button: event.submitter });
    });
    update();
  }
} catch (error) {
  showError(error);
}

