// 지출 신청 도메인 검증 (순수 모듈 — 브라우저/스토리지 의존 없음).
// 화면(expense-new.js)과 서비스 계층(expense.mock.js / 향후 remote adapter)이 같은 규칙을 공유한다.
// 화면을 우회해 호출해도 동일하게 검증되도록, 서비스 계층은 저장/제출 전에 이 함수들을 통과해야 한다.

// ----------------------------------------------------
// 상태 전이 규칙 (founder 제출 / admin 검토 단일 소스)
// ----------------------------------------------------

// founder 제출: 현재 상태 → 다음 제출 상태
export const EXPENSE_SUBMIT_TRANSITIONS = {
  draft: "pre_approval_submitted",
  pre_approval_revision: "pre_approval_submitted",
  pre_approved: "final_approval_submitted",
  final_approval_revision: "final_approval_submitted",
};

export function nextSubmitStatus(current) {
  return EXPENSE_SUBMIT_TRANSITIONS[current] || null;
}

// admin 검토: 현재 상태 + 결정(approved|revision_requested) → 다음 상태
export const EXPENSE_REVIEW_TRANSITIONS = {
  pre_approval_submitted: {
    approved: "pre_approved",
    revision_requested: "pre_approval_revision",
  },
  final_approval_submitted: {
    approved: "final_approved",
    revision_requested: "final_approval_revision",
  },
};

export function nextReviewStatus(current, decision) {
  const branch = EXPENSE_REVIEW_TRANSITIONS[current];
  return branch ? branch[decision] || null : null;
}

// 최초 제출(예산을 처음 점유) 상태인지 — 예산 초과 검증이 필요한 시점.
export function isInitialCommitStatus(nextStatus) {
  return nextStatus === "pre_approval_submitted";
}

// ----------------------------------------------------
// 금액 계산 / 필드 검증
// ----------------------------------------------------

// 공급가액/부가세 → 총액. 금액류는 숫자로 정규화한다.
export function computeExpenseTotals(input) {
  const amount_supply = Number(input.amount_supply || 0);
  const vat_amount = Number(input.vat_amount || 0);
  return { amount_supply, vat_amount, total_amount: amount_supply + vat_amount };
}

// 지출 신청 필드 검증. 필드 단위 오류 객체를 반환한다.
//  opts.forSubmit=true 이면 제출 기준(금액>0, 비목 필수)으로 더 엄격히 검사한다.
export function validateExpenseFields(input, { forSubmit = false } = {}) {
  const errors = {};

  // 공급가액
  const rawSupply = input.amount_supply;
  const supply = Number(rawSupply);
  if (rawSupply === undefined || rawSupply === null || rawSupply === "" || Number.isNaN(supply)) {
    errors.amount_supply = "공급가액을 입력해주세요.";
  } else if (supply < 0) {
    errors.amount_supply = "공급가액은 0보다 작을 수 없습니다.";
  } else if (forSubmit && supply <= 0) {
    errors.amount_supply = "공급가액은 0보다 커야 합니다.";
  }

  // 부가세(있으면 음수 불가)
  const vat = Number(input.vat_amount || 0);
  if (Number.isNaN(vat) || vat < 0) {
    errors.vat_amount = "부가세는 0보다 작을 수 없습니다.";
  }

  // 필수 텍스트
  if (!String(input.title || "").trim()) errors.title = "지출 제목을 입력해주세요.";
  if (!String(input.expense_type || "").trim()) errors.expense_type = "지출 유형을 선택해주세요.";

  // 제출 시 비목(배정 항목 또는 비목명) 필수
  if (forSubmit && !input.business_plan_item_id && !String(input.budget_category || "").trim()) {
    errors.budget_category = "비목을 선택해주세요.";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// 비목 잔액 초과 검증. remainingBefore 는 본인 신청을 제외한 가용 잔액.
export function validateBudgetWithinLimit({ requested, remainingBefore }) {
  const req = Number(requested || 0);
  const rem = Number(remainingBefore || 0);
  if (req > rem) {
    return {
      valid: false,
      error: `신청 금액(${req.toLocaleString("ko-KR")}원)이 비목 잔액(${rem.toLocaleString("ko-KR")}원)을 초과합니다.`,
    };
  }
  return { valid: true, error: null };
}

// 필수 첨부서류 누락 목록. checklist 는 generateChecklist 결과, uploadedTypes 는 업로드된 document_type 집합.
export function findMissingRequiredDocuments(checklist, uploadedTypes) {
  const set = uploadedTypes instanceof Set ? uploadedTypes : new Set(uploadedTypes || []);
  return (checklist || [])
    .filter((d) => d.required && !set.has(d.document_type))
    .map((d) => ({ document_type: d.document_type, label: d.label }));
}

// 필드 단위 오류를 함께 실어 던지는 도메인 검증 오류.
export class ExpenseValidationError extends Error {
  constructor(message, fieldErrors) {
    super(message);
    this.name = "ExpenseValidationError";
    this.fieldErrors = fieldErrors || {};
  }
}

// errors 객체 → 사용자에게 보여줄 한 줄 메시지(첫 오류).
export function firstErrorMessage(errors, fallback = "입력값을 확인해주세요.") {
  const keys = Object.keys(errors || {});
  return keys.length ? errors[keys[0]] : fallback;
}
