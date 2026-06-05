import { mountShell, runWithErrorBoundary, showError, showToast, showConfirm, setPendingToast } from "../../app.js";
import { requireRole } from "../../auth.js";
import {
  createExpense,
  updateExpenseRequest,
  submitExpenseRequest,
  getExpenseDetail,
  getFounderDashboard,
  getBudgetDocumentRequirements,
  getExpenseDocumentRequirements,
  uploadExpenseDocumentFile,
  deleteExpenseDocumentFile,
  requestAiBatchDocumentReview,
  setExpenseDocumentUserReview,
  downloadStoredFile,
  validateRequiredDocuments,
  getAiSettings,
} from "../../api.js";
import { hasApprovedBudget } from "../../domains/budget/budget-status.js";
import { FOUNDER_EDITABLE_STATUSES, COMMITTED_STATUSES, getSubmitDocumentPhase } from "../../domains/status.js";
import { getExpenseTypesForBudgetCategory } from "../../domains/expense/rules-engine.js";
import { renderDocumentPhasePanel, openAiReviewModal } from "../../components/expense/DocumentPhasePanel.js";
import { escapeHtml, formatNumber, getQueryParam, parseNumber } from "../../utils.js";

// 단계(phase) 매칭: 사전승인(pre)은 pre+both, 최종승인(final)은 final+both 서류.
function matchesPhase(reqPhase, phase) {
  if (phase === "pre") return reqPhase === "pre" || reqPhase === "both";
  if (phase === "final") return reqPhase === "final" || reqPhase === "both";
  return true;
}

// 선택한 예산 비목의 활성 첨부서류 요구사항을 단계별로 조회한다(미리보기·검증용).
function activeRequirementsFor(budgetId, phase) {
  if (!budgetId) return [];
  return getBudgetDocumentRequirements(budgetId)
    .filter((r) => r.active && matchesPhase(r.phase, phase));
}

// 접근 차단 후 안내 토스트를 보여주고 짧은 지연 뒤 리다이렉트할 때, 에러 배너를 띄우지 않기 위한 신호용 예외.
class RedirectSignal extends Error {}

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
    const aiSettings = await getAiSettings();
    if (company?.approval_status !== "approved" || !hasApprovedBudget(company?.budget_status)) {
      showToast("예산안 승인 완료 후 지출 신청을 생성할 수 있습니다.", { type: "warning" });
      setTimeout(() => { window.location.href = "dashboard.html"; }, 800);
      throw new RedirectSignal();
    }
    planItems = budgetSummary || [];
    renderBusinessPlanOptions(budgetSummary);

    // 편집 모드 진입: ?id= 로 기존 건을 불러온다. 수정 가능 상태가 아니면 상세로 돌려보낸다.
    const queryId = getQueryParam("id");
    if (queryId) {
      const detail = await getExpenseDetail(queryId);
      if (!FOUNDER_EDITABLE_STATUSES.includes(detail.expense.status)) {
        showToast("현재 상태에서는 내용을 수정할 수 없습니다.", { type: "warning" });
        setTimeout(() => { window.location.href = `expense-detail.html?id=${encodeURIComponent(queryId)}`; }, 800);
        throw new RedirectSignal();
      }
      editId = queryId;
      editStatus = detail.expense.status;
      editOwnAmount = Number(detail.expense.amount_supply || 0);
      prefillForm(detail.expense);
      applyEditModeCopy(editStatus);
    }

    // ----------------------------------------------------
    // 첨부서류: 작성 단계에서도 인라인 업로드/AI검토를 지원한다.
    // 파일은 expense_request_id 에 묶이므로, 첫 첨부 시 임시저장(draft)을 자동 생성해 id 를 확보한다.
    // ----------------------------------------------------
    const pickFile = () => new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.onchange = () => resolve(input.files[0] || null);
      input.click();
    });

    // 현재 폼 값을 저장한다. editId 가 없으면 draft 를 새로 만들고 URL 을 ?id= 로 바꿔 동일 건을 이어서 편집한다.
    const persist = async (inputVal) => {
      if (editId) {
        await updateExpenseRequest(editId, inputVal);
        return editId;
      }
      const data = await createExpense(inputVal, user);
      editId = data.id;
      editStatus = editStatus || "draft";
      editOwnAmount = Number(inputVal.amount_supply || 0);
      history.replaceState(null, "", `expense-new.html?id=${encodeURIComponent(editId)}`);
      return editId;
    };

    // 첨부를 위해 draft 가 보장된 id 를 반환한다(없으면 생성). 예산 항목 미선택 시 막는다.
    const ensureDraft = async () => {
      if (!getSelectedBusinessPlanItem()) {
        showToast("사업계획서 항목을 먼저 선택해주세요.", { type: "warning" });
        return null;
      }
      return persist(readInput(company.id));
    };

    const renderDocSection = () => {
      const container = document.querySelector("[data-doc-preview]");
      if (!container) return;
      const planItem = getSelectedBusinessPlanItem();
      const phase = getSubmitDocumentPhase(editStatus || "draft") || "pre";
      const phaseLabel = phase === "final" ? "최종승인" : "사전승인";

      if (!planItem) {
        container.innerHTML = `<h2>필요 첨부 서류</h2><p class="muted">예산 항목을 선택하면 필요한 첨부서류를 안내합니다.</p>`;
        return;
      }
      // draft 가 있으면 업로드 파일이 붙은 요구사항을, 없으면 예산 항목 기준 요구사항(빈 첨부)을 보여준다.
      const requirements = editId
        ? getExpenseDocumentRequirements(editId, phase)
        : activeRequirementsFor(planItem.support_program_budget_id, phase);
      if (!requirements.length) {
        container.innerHTML = `<h2>필요 첨부 서류 <span class="muted" style="font-weight:500">— ${phaseLabel} 단계</span></h2><p class="muted">이 예산 항목에는 ${phaseLabel} 단계 첨부서류가 설정되어 있지 않습니다.</p>`;
        return;
      }
      renderDocumentPhasePanel(container, {
        phase,
        title: `필요 첨부 서류 — ${phaseLabel} 단계`,
        requirements,
        editable: true,
        mode: "founder",
        aiEnabled: aiSettings.enabled,
      });
      attachDocEvents(container, phase, requirements);
    };

    const attachDocEvents = (container, phase, requirements) => {
      const doUpload = async (reqId, button) => {
        const req = requirements.find((r) => r.id === reqId);
        if (!req) return;
        const file = await pickFile();
        if (!file) return;
        await runWithErrorBoundary(async () => {
          const targetId = await ensureDraft();
          if (!targetId) return;
          await uploadExpenseDocumentFile(targetId, req, phase, file, user);
          renderDocSection();
        }, { button });
      };

      container.querySelectorAll("[data-doc-upload]").forEach((btn) =>
        btn.addEventListener("click", () => doUpload(btn.dataset.docUpload, btn)));
      container.querySelectorAll("[data-doc-replace]").forEach((btn) =>
        btn.addEventListener("click", () => doUpload(btn.dataset.docReplace, btn)));

      container.querySelectorAll("[data-doc-delete]").forEach((btn) =>
        btn.addEventListener("click", async () => {
          const ok = await showConfirm("첨부 파일을 삭제하시겠습니까?", {
            title: "첨부 파일 삭제",
            confirmText: "삭제",
            cancelText: "취소",
            tone: "danger",
          });
          if (!ok) return;
          await runWithErrorBoundary(async () => {
            await deleteExpenseDocumentFile(btn.dataset.docDelete);
            renderDocSection();
          }, { button: btn });
        }));

      container.querySelector("[data-doc-batch-review]")?.addEventListener("click", async (e) => {
        await runWithErrorBoundary(async () => {
          const { reviewed } = await requestAiBatchDocumentReview(editId, phase);
          renderDocSection();
          if (!reviewed) showToast("AI검토할 업로드 파일이 없습니다.", { type: "info" });
        }, { button: e.currentTarget });
      });

      container.querySelectorAll("[data-doc-open]").forEach((btn) =>
        btn.addEventListener("click", async () => {
          const req = requirements.find((r) => r.file?.id === btn.dataset.docOpen);
          await runWithErrorBoundary(async () => {
            await downloadStoredFile(req?.file?.link_url, req?.file?.original_filename);
          }, { button: btn });
        }));

      container.querySelectorAll("[data-doc-ai-comment]").forEach((btn) =>
        btn.addEventListener("click", () => {
          const req = requirements.find((r) => r.file?.id === btn.dataset.docAiComment);
          if (!req?.file) return;
          openAiReviewModal({
            req,
            mode: "founder",
            editable: true,
            onClear: async (comment) => {
              await setExpenseDocumentUserReview(req.file.id, { cleared: true, comment, user });
              renderDocSection();
            },
            onRevert: async () => {
              await setExpenseDocumentUserReview(req.file.id, { cleared: false, user });
              renderDocSection();
            },
          });
        }));
    };

    // 예산 항목 변경 시: draft 가 있으면 변경 내용을 저장해 요구사항·첨부가 어긋나지 않게 맞춘다.
    document.querySelector("#business_plan_item_id").addEventListener("change", async () => {
      if (editId && getSelectedBusinessPlanItem()) {
        await runWithErrorBoundary(() => updateExpenseRequest(editId, readInput(company.id)));
      }
      renderDocSection();
    });
    renderDocSection();

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
        showToast("사업계획서 항목을 선택해야 합니다.", { type: "warning" });
        return;
      }

      const inputVal = readInput(company.id);

      // 제출 시에만 모든 항목이 입력됐는지 검증한다(임시저장은 일부만 채워도 허용).
      if (action === "submit") {
        const missing = REQUIRED_FIELDS.find(({ id }) => !document.querySelector(`#${id}`).value.trim());
        if (missing) {
          showToast(`${missing.label}은(는) 필수 입력 항목입니다.`, { type: "warning" });
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
          showToast(`신청 금액(공급가액 기준 ${formatNumber(String(inputVal.amount_supply))}원)이 해당 비목의 집행 잔액(${formatNumber(String(available))}원)을 초과하여 신청할 수 없습니다.`, { type: "warning", duration: 5000 });
          return;
        }
        // 제출 단계의 필수 첨부서류 검증 (§7). 누락 시 같은 화면의 [필요 첨부 서류]에서 업로드하도록 안내한다.
        const phase = getSubmitDocumentPhase(editStatus || "draft");
        let missing = [];
        if (phase) {
          missing = editId
            ? validateRequiredDocuments(editId, phase).missing
            : activeRequirementsFor(planItem.support_program_budget_id, phase).filter((r) => r.required).map((r) => r.title);
        }
        const submitLabel = editStatus === "final_approval_revision" ? "최종승인" : "사전승인";
        if (missing.length) {
          // 작성 내용을 저장(draft)해 첨부 가능 상태로 전환하고, 같은 화면에서 업로드하도록 안내한다.
          await runWithErrorBoundary(async () => {
            await persist(inputVal);
            renderDocSection();
          }, { button: event.submitter });
          showToast(`이 예산 항목은 ${submitLabel} 필수 첨부서류가 있습니다.\n[필요 첨부 서류]에서 아래 서류를 업로드한 뒤 다시 신청해주세요.\n- ${missing.join("\n- ")}`, { type: "warning", duration: 6000 });
          return;
        }
        const okSubmit = await showConfirm(`${submitLabel} 신청을 진행하시겠습니까? 제출 후에는 관리자 검토가 시작됩니다.`, {
          title: `${submitLabel} 신청`,
          confirmText: "신청",
          cancelText: "취소",
        });
        if (!okSubmit) return;
      }

      await runWithErrorBoundary(async () => {
        const targetId = await persist(inputVal);
        if (action === "submit") {
          await submitExpenseRequest(targetId);
          // 이동 후 상세 페이지에서 완료 토스트를 띄운다.
          setPendingToast("지출 신청이 제출되었습니다. 관리자 검토 후 결과가 안내됩니다.", "success");
        } else {
          setPendingToast("임시저장되었습니다.", "info");
        }
        window.location.href = `expense-detail.html?id=${encodeURIComponent(targetId)}`;
      }, { button: event.submitter });
    });
  }
} catch (error) {
  // 안내 토스트 후 리다이렉트하는 정상 흐름은 에러 배너를 띄우지 않는다.
  if (!(error instanceof RedirectSignal)) showError(error);
}
