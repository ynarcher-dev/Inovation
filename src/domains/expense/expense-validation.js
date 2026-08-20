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

// admin 승인 취소: 승인 완료 상태 → 되돌아갈 상태.
// 보완요청(창업자 잘못)과 달리 '관리자 판단 정정'이며, 창업자가 다시 제출해야 하는 직전 단계로 돌아간다.
//   final_approved -> pre_approved : 최종승인 서류를 수정해 재제출
//   pre_approved   -> draft        : 신청 내용/사전승인 서류를 수정해 재제출
// 두 롤백 지점 모두 isDocumentPhaseEditable(status.js) 기준으로 해당 단계 첨부서류가 자동 해금된다.
export const EXPENSE_CANCEL_TRANSITIONS = {
  final_approved: "pre_approved",
  pre_approved: "draft",
};

// 취소 후 되돌아갈 상태. 취소 불가 상태면 null.
// 키가 '승인 완료' 상태뿐이라 역순 강제가 규칙에서 자연히 따라온다. 최종승인 단계로 넘어간 건은
// status 가 pre_approved 가 아니므로 사전승인만 먼저 취소할 수 없고, 최종승인을 먼저 취소해야 한다.
export function nextCancelStatus(current) {
  return EXPENSE_CANCEL_TRANSITIONS[current] || null;
}

export function canCancelApproval(current) {
  return nextCancelStatus(current) !== null;
}

// 취소 대상이 사전승인인지 최종승인인지 구분한다(status.js 의 getReviewKind 와 같은 축).
export function getCancelKind(current) {
  if (current === "final_approved") return "final";
  if (current === "pre_approved") return "pre";
  return null;
}

// ----------------------------------------------------
// founder 철회 / 신청 취소 / 삭제 규칙
// ----------------------------------------------------

// founder 제출 철회: 관리자가 아직 검토하지 않은 '검토 대기' 상태에서만,
// 제출 직전 단계로 한 단계 되돌린다(승인 취소와 같은 단계적 롤백 축).
//   pre_approval_submitted   -> draft        : 예산 점유(검토 중)가 풀려 잔액으로 환원된다
//   final_approval_submitted -> pre_approved : 사전승인은 유지되므로 예산 점유(약정)는 유지된다
// 검토가 이미 끝난 건(승인/보완)은 철회 대상이 아니다 — 보완 건은 수정·재제출 또는 신청 취소로 처리한다.
export const EXPENSE_WITHDRAW_TRANSITIONS = {
  pre_approval_submitted: "draft",
  final_approval_submitted: "pre_approved",
};

// 철회 후 되돌아갈 상태. 철회 불가 상태면 null.
export function nextWithdrawStatus(current) {
  return EXPENSE_WITHDRAW_TRANSITIONS[current] || null;
}

export function canWithdraw(current) {
  return nextWithdrawStatus(current) !== null;
}

// founder 신청 취소(cancelled 전이): 신청 건이 창업자 손에 있는(수정 가능한) 상태에서만 가능하다.
// 검토 대기 건은 철회부터, 승인 완료 건은 관리자 승인 취소부터 거쳐야 이 상태로 내려온다.
// cancelled 는 종결 상태다 — 예산 집계에서 빠지고, 수정/재제출할 수 없으며, 기록 보존을 위해 목록에는 남는다.
export const FOUNDER_CANCELLABLE_STATUSES = ["draft", "pre_approval_revision", "final_approval_revision"];

export function canFounderCancel(current) {
  return FOUNDER_CANCELLABLE_STATUSES.includes(current);
}

// founder 완전 삭제: 한 번도 제출된 적 없는 임시저장 건만 지울 수 있다.
// submitted_at 은 최초 사전승인 제출 시 찍힌 뒤 지워지지 않으므로 '제출 이력'의 판별 기준이 된다.
// 제출 이력이 있는 건은 삭제 대신 신청 취소(cancelled)로 기록을 보존한다.
export function canFounderDelete(expense) {
  return expense?.status === "draft" && !expense?.submitted_at;
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
