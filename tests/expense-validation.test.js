import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextSubmitStatus,
  nextReviewStatus,
  isInitialCommitStatus,
  computeExpenseTotals,
  validateExpenseFields,
  validateBudgetWithinLimit,
  findMissingRequiredDocuments,
  ExpenseValidationError,
  firstErrorMessage,
} from "../src/domains/expense/expense-validation.js";

// ----------------------------------------------------
// 상태 전이 (founder 제출 / admin 검토 단일 소스)
// ----------------------------------------------------
test("제출: 정상 상태 전이", () => {
  assert.equal(nextSubmitStatus("draft"), "pre_approval_submitted");
  assert.equal(nextSubmitStatus("pre_approval_revision"), "pre_approval_submitted");
  assert.equal(nextSubmitStatus("pre_approved"), "final_approval_submitted");
  assert.equal(nextSubmitStatus("final_approval_revision"), "final_approval_submitted");
});

test("제출: 잘못된 상태 전이는 null", () => {
  assert.equal(nextSubmitStatus("pre_approval_submitted"), null); // 검토 중 재제출 불가
  assert.equal(nextSubmitStatus("final_approved"), null);
  assert.equal(nextSubmitStatus("unknown"), null);
});

test("검토: 결정별 상태 전이", () => {
  assert.equal(nextReviewStatus("pre_approval_submitted", "approved"), "pre_approved");
  assert.equal(nextReviewStatus("pre_approval_submitted", "revision_requested"), "pre_approval_revision");
  assert.equal(nextReviewStatus("final_approval_submitted", "approved"), "final_approved");
  assert.equal(nextReviewStatus("final_approval_submitted", "revision_requested"), "final_approval_revision");
});

test("검토: 검토 대상이 아닌 상태/결정은 null", () => {
  assert.equal(nextReviewStatus("draft", "approved"), null);
  assert.equal(nextReviewStatus("pre_approval_submitted", "rejected"), null);
});

test("최초 점유 상태는 사전승인 제출뿐", () => {
  assert.equal(isInitialCommitStatus("pre_approval_submitted"), true);
  assert.equal(isInitialCommitStatus("final_approval_submitted"), false);
});

// ----------------------------------------------------
// 금액 계산
// ----------------------------------------------------
test("총액 = 공급가액 + 부가세", () => {
  assert.deepEqual(computeExpenseTotals({ amount_supply: 1000, vat_amount: 100 }), {
    amount_supply: 1000,
    vat_amount: 100,
    total_amount: 1100,
  });
  assert.deepEqual(computeExpenseTotals({}), { amount_supply: 0, vat_amount: 0, total_amount: 0 });
});

// ----------------------------------------------------
// 필드 검증
// ----------------------------------------------------
test("음수 금액은 거부", () => {
  const { valid, errors } = validateExpenseFields({ title: "t", expense_type: "material", amount_supply: -1 });
  assert.equal(valid, false);
  assert.match(errors.amount_supply, /0보다 작을/);
});

test("제출 시 0원은 거부", () => {
  const { valid, errors } = validateExpenseFields(
    { title: "t", expense_type: "material", amount_supply: 0, business_plan_item_id: "x" },
    { forSubmit: true }
  );
  assert.equal(valid, false);
  assert.match(errors.amount_supply, /0보다 커야/);
});

test("초안(비제출)에서는 0원 허용", () => {
  const { valid } = validateExpenseFields({ title: "t", expense_type: "material", amount_supply: 0 });
  assert.equal(valid, true);
});

test("제출 시 제목/유형/비목 누락은 필드 단위 오류", () => {
  const { valid, errors } = validateExpenseFields({ amount_supply: 1000 }, { forSubmit: true });
  assert.equal(valid, false);
  assert.ok(errors.title);
  assert.ok(errors.expense_type);
  assert.ok(errors.budget_category);
});

test("유효한 제출 입력은 통과", () => {
  const { valid, errors } = validateExpenseFields(
    { title: "노트북", expense_type: "material", amount_supply: 1000000, business_plan_item_id: "a1" },
    { forSubmit: true }
  );
  assert.equal(valid, true);
  assert.deepEqual(errors, {});
});

// ----------------------------------------------------
// 예산 초과
// ----------------------------------------------------
test("예산 잔액 초과는 거부", () => {
  const r = validateBudgetWithinLimit({ requested: 1500, remainingBefore: 1000 });
  assert.equal(r.valid, false);
  assert.match(r.error, /초과/);
});

test("예산 잔액 이내는 통과(경계 포함)", () => {
  assert.equal(validateBudgetWithinLimit({ requested: 1000, remainingBefore: 1000 }).valid, true);
  assert.equal(validateBudgetWithinLimit({ requested: 999, remainingBefore: 1000 }).valid, true);
});

// ----------------------------------------------------
// 필수 첨부 누락
// ----------------------------------------------------
test("필수 첨부 누락 목록", () => {
  const checklist = [
    { document_type: "estimate", label: "견적서", required: true },
    { document_type: "contract", label: "계약서", required: true },
    { document_type: "memo", label: "메모", required: false },
  ];
  const missing = findMissingRequiredDocuments(checklist, new Set(["estimate"]));
  assert.equal(missing.length, 1);
  assert.equal(missing[0].document_type, "contract");
});

test("필수 첨부가 모두 있으면 빈 배열", () => {
  const checklist = [{ document_type: "estimate", label: "견적서", required: true }];
  assert.deepEqual(findMissingRequiredDocuments(checklist, ["estimate"]), []);
});

// ----------------------------------------------------
// 오류 헬퍼
// ----------------------------------------------------
test("ExpenseValidationError 는 fieldErrors 를 보존", () => {
  const err = new ExpenseValidationError("메시지", { amount_supply: "음수" });
  assert.ok(err instanceof Error);
  assert.equal(err.fieldErrors.amount_supply, "음수");
});

test("firstErrorMessage 는 첫 오류/대체문구 반환", () => {
  assert.equal(firstErrorMessage({ a: "첫번째", b: "두번째" }), "첫번째");
  assert.equal(firstErrorMessage({}, "기본"), "기본");
});
