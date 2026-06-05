import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateChecklist,
  generateWarnings,
  getExpenseTypeMeta,
  getExpenseTypesForBudgetCategory,
} from "../src/domains/expense/rules-engine.js";

test("공통 필수 서류는 항상 포함된다", () => {
  const docs = generateChecklist({ expense_type: "material", amount_supply: 1000 });
  const types = docs.map((d) => d.document_type);
  assert.ok(types.includes("estimate"));
  assert.ok(types.includes("vendor_business_license"));
  assert.ok(types.includes("vendor_bankbook"));
});

test("공급가액 500만원 이상이면 비교견적서가 필수로 추가된다", () => {
  const below = generateChecklist({ expense_type: "material", amount_supply: 4999999 });
  const at = generateChecklist({ expense_type: "material", amount_supply: 5000000 });
  assert.ok(!below.some((d) => d.document_type === "comparative_estimate"));
  assert.ok(at.some((d) => d.document_type === "comparative_estimate" && d.required));
});

test("선금 신청 시 선금 관련 서류가 추가된다", () => {
  const docs = generateChecklist({ expense_type: "material", amount_supply: 1000, advance_payment_requested: true });
  const types = docs.map((d) => d.document_type);
  assert.ok(types.includes("advance_payment_request"));
  assert.ok(types.includes("advance_payment_plan"));
});

test("유형별 서류: general_service 는 계약서/과업지시서를 포함", () => {
  const docs = generateChecklist({ expense_type: "general_service", amount_supply: 1000 });
  const types = docs.map((d) => d.document_type);
  assert.ok(types.includes("contract"));
  assert.ok(types.includes("task_order"));
});

test("경고: 부가세 입력 시 VAT 제외 경고", () => {
  const warnings = generateWarnings({ expense_type: "material", amount_supply: 1000, vat_amount: 100 });
  assert.ok(warnings.some((w) => w.code === "VAT_EXCLUDED"));
});

test("경고: 500만원 이상 비교견적 / 2천만원 이상 일반용역 고액", () => {
  const w1 = generateWarnings({ expense_type: "material", amount_supply: 5000000 });
  assert.ok(w1.some((w) => w.code === "COMPARATIVE_ESTIMATE_REQUIRED"));
  const w2 = generateWarnings({ expense_type: "general_service", amount_supply: 20000000 });
  assert.ok(w2.some((w) => w.code === "HIGH_VALUE_SERVICE" && w.severity === "danger"));
});

test("지출 유형 메타/역매핑", () => {
  assert.equal(getExpenseTypeMeta("material").budgetCategory, "재료비");
  assert.equal(getExpenseTypeMeta("unknown").value, "general_service"); // 기본값
  const services = getExpenseTypesForBudgetCategory("일반수용비");
  assert.ok(services.length >= 1);
  assert.ok(services.every((o) => o.budgetCategory === "일반수용비"));
});
