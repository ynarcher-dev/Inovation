// Mock 지출 도메인: 지출 상세/생성/수정/제출/검토, 서류 업로드·표시·삭제.
import { STORAGE_KEYS, load, save, uuid } from "./storage.mock.js";
import { FOUNDER_EDITABLE_STATUSES } from "../../domains/status.js";
import { generateChecklist, generateWarnings } from "../../domains/expense/rules-engine.js";
import { computeExpenseBudgetCheck } from "./_shared.mock.js";
import { resolveBusinessPlanItemLabel } from "./company.mock.js";
import { mockAdminCanAccessProgram } from "./admin-account.mock.js";

export function mockGetExpenseDetail(id) {
  const expenses = load(STORAGE_KEYS.EXPENSES, []);
  const expense = expenses.find((e) => e.id === id);
  if (!expense) throw new Error("지출 신청을 찾을 수 없습니다.");

  const companies = load(STORAGE_KEYS.COMPANIES, []);
  const comp = companies.find((c) => c.id === expense.company_id);
  // 일반관리자는 배정된 사업의 지출만 열람할 수 있다(직접 URL 접근 차단). 슈퍼관리자·창업자는 통과.
  if (comp && !mockAdminCanAccessProgram(comp.support_program_id)) throw new Error("이 사업에 대한 접근 권한이 없습니다.");

  // 사업계획서 항목(=배정 id)을 관리자가 설정한 비목 단계 경로로 해석한다(표시용).
  const businessPlanItemLabel = resolveBusinessPlanItemLabel(expense);

  const reviews = load(STORAGE_KEYS.REVIEWS, []).filter((r) => r.expense_request_id === id);

  // 업로드된 파일 + AI 분석(참고용)
  const files = load(STORAGE_KEYS.UPLOADED_FILES, [])
    .filter((f) => f.expense_request_id === id)
    .map((f) => ({
      ...f,
      ai_check_result: f.ai_check_result && Object.keys(f.ai_check_result).length
        ? f.ai_check_result
        : mockAiExtract(f.document_type, expense),
    }));
  const uploadedTypes = new Set(files.map((f) => f.document_type));

  // 체크리스트: 업로드된 서류는 상태를 'uploaded'로 반영
  const documents = generateChecklist(expense).map((d) =>
    uploadedTypes.has(d.document_type) ? { ...d, status: "uploaded" } : d
  );

  return {
    expense: {
      ...expense,
      company_name: comp ? comp.name : "-",
      representative_name: comp ? comp.representative_name : "-",
      business_plan_item_label: businessPlanItemLabel,
    },
    documents, // 비목/금액/선금 여부에 따른 필수 서류 (업로드 상태 반영)
    warnings: generateWarnings(expense), // 위험 경고
    budgetCheck: computeExpenseBudgetCheck(expense), // 비목 잔액 적합성
    files,
    reviews: reviews || [],
  };
}

export function mockCreateExpense(input, user) {
  const expenses = load(STORAGE_KEYS.EXPENSES, []);
  const newExpense = {
    id: uuid(),
    company_id: input.company_id,
    founder_id: user.id,
    business_plan_item_id: input.business_plan_item_id || null,
    title: input.title,
    expense_type: input.expense_type,
    budget_category: input.budget_category,
    amount_supply: Number(input.amount_supply || 0),
    vat_amount: Number(input.vat_amount || 0),
    total_amount: Number(input.amount_supply || 0) + Number(input.vat_amount || 0),
    vendor_name: input.vendor_name || "",
    vendor_business_number: input.vendor_business_number || "",
    purpose: input.purpose || "",
    advance_payment_requested: input.advance_payment_requested || false,
    // 작성 시작은 임시저장(draft) 상태로 생성한다. 제출 전까지 예산을 점유하지 않는다.
    status: "draft",
    expected_completion_date: input.expected_completion_date || null,
    created_at: new Date().toISOString(),
    submitted_at: null,
  };
  expenses.push(newExpense);
  save(STORAGE_KEYS.EXPENSES, expenses);
  return newExpense;
}

// 수정 가능 상태(임시저장/사전승인 보완/최종승인 보완)에서 같은 건의 내용을 수정한다.
// 보완 건은 새 결재를 만들지 않고 같은 expense.id 를 유지한 채 수정·재제출한다(new.md 5.2).
export function mockUpdateExpenseRequest(id, input) {
  const expenses = load(STORAGE_KEYS.EXPENSES, []);
  const idx = expenses.findIndex((e) => e.id === id);
  if (idx === -1) throw new Error("지출 신청을 찾을 수 없습니다.");
  const current = expenses[idx];
  if (!FOUNDER_EDITABLE_STATUSES.includes(current.status)) {
    throw new Error("현재 상태에서는 신청 내용을 수정할 수 없습니다.");
  }
  const next = { ...current };
  // 전달된 필드만 갱신한다(부분 수정 허용). 금액류는 숫자로 정규화한다.
  const assign = (key, value) => { if (value !== undefined) next[key] = value; };
  assign("business_plan_item_id", input.business_plan_item_id);
  assign("title", input.title);
  assign("expense_type", input.expense_type);
  assign("budget_category", input.budget_category);
  assign("vendor_name", input.vendor_name);
  assign("vendor_business_number", input.vendor_business_number);
  assign("purpose", input.purpose);
  assign("expected_completion_date", input.expected_completion_date);
  if (input.advance_payment_requested !== undefined) next.advance_payment_requested = !!input.advance_payment_requested;
  if (input.amount_supply !== undefined) next.amount_supply = Number(input.amount_supply || 0);
  if (input.vat_amount !== undefined) next.vat_amount = Number(input.vat_amount || 0);
  next.total_amount = Number(next.amount_supply || 0) + Number(next.vat_amount || 0);
  next.updated_at = new Date().toISOString();
  expenses[idx] = next;
  save(STORAGE_KEYS.EXPENSES, expenses);
  return next;
}

// 현재 상태에 따라 사전승인/최종승인 검토 단계로 제출한다(new.md 3.1).
//  - draft, pre_approval_revision    -> pre_approval_submitted
//  - pre_approved, final_approval_revision -> final_approval_submitted
export function mockSubmitExpenseRequest(id) {
  const expenses = load(STORAGE_KEYS.EXPENSES, []);
  const idx = expenses.findIndex((e) => e.id === id);
  if (idx === -1) throw new Error("지출 신청을 찾을 수 없습니다.");
  const current = expenses[idx].status;
  const transitions = {
    draft: "pre_approval_submitted",
    pre_approval_revision: "pre_approval_submitted",
    pre_approved: "final_approval_submitted",
    final_approval_revision: "final_approval_submitted",
  };
  const nextStatus = transitions[current];
  if (!nextStatus) throw new Error("현재 상태에서는 제출할 수 없습니다.");
  const now = new Date().toISOString();
  expenses[idx].status = nextStatus;
  if (nextStatus === "pre_approval_submitted") expenses[idx].submitted_at = now;
  else expenses[idx].final_submitted_at = now;
  expenses[idx].updated_at = now;
  save(STORAGE_KEYS.EXPENSES, expenses);
  return expenses[idx];
}

// 관리자 검토. 현재 상태(사전승인/최종승인 검토)에 따라 결과 상태를 분기한다(new.md 3.2).
//  - 검토 결과는 승인/보완요청 두 가지다(반려 없음).
//  - 보완요청 시 검토 의견을 필수로 요구한다.
export function mockReviewExpenseRequest(id, decision, comment, reviewerId) {
  const decisionMap = {
    pre_approval_submitted: {
      approved: "pre_approved",
      revision_requested: "pre_approval_revision",
    },
    final_approval_submitted: {
      approved: "final_approved",
      revision_requested: "final_approval_revision",
    },
  };

  const expenses = load(STORAGE_KEYS.EXPENSES, []);
  const idx = expenses.findIndex((e) => e.id === id);
  if (idx === -1) throw new Error("지출 신청을 찾을 수 없습니다.");

  const current = expenses[idx].status;
  const branch = decisionMap[current];
  if (!branch) throw new Error("현재 상태는 검토 대상이 아닙니다.");
  const nextStatus = branch[decision];
  if (!nextStatus) throw new Error("현재 단계에서 허용되지 않는 검토 결과입니다.");
  if (decision !== "approved" && !String(comment || "").trim()) {
    throw new Error("보완 요청 시에는 검토 의견을 입력해야 합니다.");
  }

  expenses[idx].status = nextStatus;
  const now = new Date().toISOString();
  if (decision === "approved") {
    if (nextStatus === "pre_approved") expenses[idx].approved_at = now;
    if (nextStatus === "final_approved") expenses[idx].final_approved_at = now;
  }
  expenses[idx].updated_at = now;
  save(STORAGE_KEYS.EXPENSES, expenses);

  const reviews = load(STORAGE_KEYS.REVIEWS, []);
  reviews.push({
    id: uuid(),
    expense_request_id: id,
    reviewer_id: reviewerId,
    decision,
    comment,
    created_at: now,
  });
  save(STORAGE_KEYS.REVIEWS, reviews);

  return expenses[idx];
}

// ----------------------------------------------------
// Mock 파일 업로드/삭제 & AI 분석(참고용)
// ----------------------------------------------------

// AI 문서 분석 결과(참고용)를 모사한다. 실제로는 R2 업로드 후 분석 함수가 채운다.
// new.md 2.6: AI는 문서 유형/금액/업체명/날짜/날인 여부 추출까지만 보조하며 자동 승인 근거가 아니다.
function mockAiExtract(documentType, expense) {
  return {
    document_type: documentType,
    vendor_name: expense?.vendor_name || null,
    amount: expense ? Number(expense.amount_supply || 0) : null,
    date: expense?.expected_completion_date || (expense?.submitted_at ? String(expense.submitted_at).slice(0, 10) : null),
    has_seal: true,
    note: "AI 추출 결과는 참고용이며 자동 승인 근거로 사용하지 않습니다.",
  };
}

export function mockUploadDocumentFile(expenseRequestId, documentType, file, user) {
  const files = load(STORAGE_KEYS.UPLOADED_FILES, []);
  const record = {
    id: uuid(),
    expense_request_id: expenseRequestId,
    document_type: documentType,
    original_filename: file?.name || `${documentType}.pdf`,
    mime_type: file?.type || "application/octet-stream",
    size_bytes: Number(file?.size || 0),
    uploaded_by: user?.id || null,
    ai_check_result: {},
    created_at: new Date().toISOString(),
  };
  files.push(record);
  save(STORAGE_KEYS.UPLOADED_FILES, files);
  return record;
}

// 자동작성/폼 작성 서류: 파일 없이 제출 처리한다.
export function mockMarkDocumentUploaded(expenseRequestId, documentType) {
  const files = load(STORAGE_KEYS.UPLOADED_FILES, []);
  const record = {
    id: uuid(),
    expense_request_id: expenseRequestId,
    document_type: documentType,
    original_filename: `${documentType}_자동작성.pdf`,
    mime_type: "application/pdf",
    size_bytes: 0,
    uploaded_by: null,
    ai_check_result: {},
    generated: true,
    created_at: new Date().toISOString(),
  };
  files.push(record);
  save(STORAGE_KEYS.UPLOADED_FILES, files);
  return record;
}

export function mockDeleteUploadedFile(fileId) {
  const files = load(STORAGE_KEYS.UPLOADED_FILES, []);
  const next = files.filter((f) => f.id !== fileId);
  save(STORAGE_KEYS.UPLOADED_FILES, next);
  return { ok: true };
}

