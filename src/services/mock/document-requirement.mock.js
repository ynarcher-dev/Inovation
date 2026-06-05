// Mock 예산 항목별 커스텀 첨부서류 요구사항 + 운영사업 공통 AI 검토 기준 문서 + 창업자 업로드/AI검토.
// custom-document-requirements-plan.md 의 §5(데이터 구조)·§6(API)·§7(검증) 을 mock 으로 구현한다.
import { STORAGE_KEYS, load, save, uuid } from "./storage.mock.js";
import { mockGetAiSettings } from "./ai-settings.mock.js";

// ----------------------------------------------------
// 내부 헬퍼: 지출 신청 → 예산 비목(leaf) id / 운영사업 id 해석
// ----------------------------------------------------
// 요구사항은 비목(leaf) 기준으로 연결된다. 지출의 business_plan_item_id(=배정 id)로 비목을 찾고,
// 보조로 budget_category 문자열로 찾는다(resolveExpenseLeafIds 와 동일한 우선순위).
function resolveExpenseBudgetId(expense) {
  if (!expense) return null;
  const allocations = load(STORAGE_KEYS.ALLOCATIONS, []);
  const alloc = allocations.find((a) => a.id === expense.business_plan_item_id);
  if (alloc) return alloc.support_program_budget_id;
  if (expense.budget_category) {
    const budgets = load(STORAGE_KEYS.BUDGETS, []);
    const node = budgets.find((b) => b.budget_category === expense.budget_category);
    if (node) return node.id;
  }
  return null;
}

function getExpenseById(expenseRequestId) {
  const expenses = load(STORAGE_KEYS.EXPENSES, []);
  const expense = expenses.find((e) => e.id === expenseRequestId);
  if (!expense) throw new Error("지출 신청을 찾을 수 없습니다.");
  return expense;
}

function getProgramIdForExpense(expense) {
  const companies = load(STORAGE_KEYS.COMPANIES, []);
  const comp = companies.find((c) => c.id === expense.company_id);
  return comp?.support_program_id || null;
}

// 단계(phase) 매칭: 사전승인(pre)은 pre+both, 최종승인(final)은 final+both 서류를 본다.
function matchesPhase(reqPhase, phase) {
  if (phase === "pre") return reqPhase === "pre" || reqPhase === "both";
  if (phase === "final") return reqPhase === "final" || reqPhase === "both";
  return true;
}

// ----------------------------------------------------
// 관리자: 예산 항목별 첨부서류 요구사항 CRUD (§6 관리자용)
// ----------------------------------------------------
export function mockGetBudgetDocumentRequirements(budgetId) {
  if (!budgetId) return [];
  const reqs = load(STORAGE_KEYS.DOC_REQUIREMENTS, []);
  const files = load(STORAGE_KEYS.UPLOADED_FILES, []);
  return reqs
    .filter((r) => r.support_program_budget_id === budgetId)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    // 비활성화/삭제 정책 판단용: 업로드 이력이 있으면 완전 삭제 대신 비활성화한다(§9).
    .map((r) => ({ ...r, upload_count: files.filter((f) => f.requirement_id === r.id).length }));
}

export function mockCreateBudgetDocumentRequirement(input) {
  const reqs = load(STORAGE_KEYS.DOC_REQUIREMENTS, []);
  const siblings = reqs.filter((r) => r.support_program_budget_id === input.support_program_budget_id);
  const maxSort = siblings.reduce((max, r) => Math.max(max, Number(r.sort_order || 0)), 0);
  const now = new Date().toISOString();
  const rec = {
    id: uuid(),
    support_program_id: input.support_program_id || null,
    support_program_budget_id: input.support_program_budget_id,
    title: input.title,
    description: input.description || "",
    phase: ["pre", "final", "both"].includes(input.phase) ? input.phase : "both",
    required: input.required !== false,
    ai_review_enabled: input.ai_review_enabled !== false,
    active: true,
    sort_order: Number(input.sort_order ?? maxSort + 10),
    created_by: input.created_by || null,
    created_at: now,
    updated_at: now,
  };
  reqs.push(rec);
  save(STORAGE_KEYS.DOC_REQUIREMENTS, reqs);
  return rec;
}

export function mockUpdateBudgetDocumentRequirement(id, input) {
  const reqs = load(STORAGE_KEYS.DOC_REQUIREMENTS, []);
  const idx = reqs.findIndex((r) => r.id === id);
  if (idx === -1) throw new Error("첨부서류 요구사항을 찾을 수 없습니다.");
  const next = { ...reqs[idx] };
  const assign = (key, value) => { if (value !== undefined) next[key] = value; };
  assign("title", input.title);
  assign("description", input.description);
  if (input.phase !== undefined && ["pre", "final", "both"].includes(input.phase)) next.phase = input.phase;
  if (input.required !== undefined) next.required = !!input.required;
  if (input.ai_review_enabled !== undefined) next.ai_review_enabled = !!input.ai_review_enabled;
  if (input.active !== undefined) next.active = !!input.active;
  if (input.sort_order !== undefined) next.sort_order = Number(input.sort_order || 0);
  next.updated_at = new Date().toISOString();
  reqs[idx] = next;
  save(STORAGE_KEYS.DOC_REQUIREMENTS, reqs);
  return next;
}

// 비활성화: 업로드 이력 보존을 위해 완전 삭제 대신 active=false 로 둔다(§2.1/§9).
export function mockDeactivateBudgetDocumentRequirement(id) {
  return mockUpdateBudgetDocumentRequirement(id, { active: false });
}

// 완전 삭제: 업로드 이력이 연결된 경우 막고 비활성화를 유도한다(§9).
export function mockDeleteBudgetDocumentRequirement(id) {
  const files = load(STORAGE_KEYS.UPLOADED_FILES, []);
  if (files.some((f) => f.requirement_id === id)) {
    throw new Error("이미 업로드된 파일이 있어 삭제할 수 없습니다. 비활성화 처리하세요.");
  }
  const reqs = load(STORAGE_KEYS.DOC_REQUIREMENTS, []);
  save(STORAGE_KEYS.DOC_REQUIREMENTS, reqs.filter((r) => r.id !== id));
  return { ok: true };
}

// ----------------------------------------------------
// 관리자: 운영사업 공통 AI 검토 기준 문서 (§3.3 / §5.3 / §6)
// ----------------------------------------------------
export function mockGetProgramAiCriteriaDocument(programId) {
  if (!programId) return null;
  const docs = load(STORAGE_KEYS.AI_CRITERIA, []);
  return docs.find((d) => d.support_program_id === programId && d.active) || null;
}

// 새 기준 문서를 올리면 기존 활성 문서는 비활성화하고 새 문서를 활성 기준으로 삼는다(§5.3).
export function mockUploadProgramAiCriteriaDocument(programId, input) {
  const docs = load(STORAGE_KEYS.AI_CRITERIA, []);
  docs.forEach((d) => { if (d.support_program_id === programId && d.active) d.active = false; });
  const now = new Date().toISOString();
  const rec = {
    id: uuid(),
    support_program_id: programId,
    title: input.title || input.original_filename || "AI 검토 기준 문서",
    original_filename: input.original_filename || null,
    mime_type: input.mime_type || "application/octet-stream",
    size_bytes: Number(input.size_bytes || 0),
    link_url: input.link_url || null,
    extracted_criteria_text: null,
    extraction_status: "pending",
    active: true,
    uploaded_by: input.uploaded_by || null,
    created_at: now,
    updated_at: now,
  };
  docs.push(rec);
  save(STORAGE_KEYS.AI_CRITERIA, docs);
  // mock 환경: 업로드 직후 기준 추출이 완료된 것으로 처리한다(실제로는 OCR/문서분석 서버 필요, §9).
  return mockExtractProgramAiCriteria(rec.id);
}

export function mockExtractProgramAiCriteria(criteriaId) {
  const docs = load(STORAGE_KEYS.AI_CRITERIA, []);
  const idx = docs.findIndex((d) => d.id === criteriaId);
  if (idx === -1) throw new Error("기준 문서를 찾을 수 없습니다.");
  docs[idx].extraction_status = "completed";
  docs[idx].extracted_criteria_text =
    "사업비 집행 시 거래처명, 공급가액, 발행일자, 증빙 적합성을 확인한다. (mock 추출 결과)";
  docs[idx].updated_at = new Date().toISOString();
  save(STORAGE_KEYS.AI_CRITERIA, docs);
  return docs[idx];
}

export function mockDeleteProgramAiCriteriaDocument(criteriaId) {
  const docs = load(STORAGE_KEYS.AI_CRITERIA, []);
  save(STORAGE_KEYS.AI_CRITERIA, docs.filter((d) => d.id !== criteriaId));
  return { ok: true };
}

// ----------------------------------------------------
// 창업자: 단계별 첨부서류 요구사항 조회 + 업로드/삭제 (§4 / §6)
// ----------------------------------------------------
// 지출 신청의 비목에 설정된 활성 요구사항을 단계(phase) 기준으로 조회하고, 업로드 파일을 붙여 반환한다.
export function mockGetExpenseDocumentRequirements(expenseRequestId, phase) {
  const expense = getExpenseById(expenseRequestId);
  const budgetId = resolveExpenseBudgetId(expense);
  const reqs = load(STORAGE_KEYS.DOC_REQUIREMENTS, [])
    .filter((r) => r.support_program_budget_id === budgetId && r.active && matchesPhase(r.phase, phase))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const files = load(STORAGE_KEYS.UPLOADED_FILES, []).filter((f) => f.expense_request_id === expenseRequestId);
  return reqs.map((r) => ({ ...r, file: files.find((f) => f.requirement_id === r.id) || null }));
}

export function mockUploadExpenseDocumentFile(expenseRequestId, requirementId, phase, input) {
  const files = load(STORAGE_KEYS.UPLOADED_FILES, []);
  // 같은 요구사항에 이미 올린 파일이 있으면 교체한다(요구사항당 1파일).
  const next = files.filter((f) => !(f.expense_request_id === expenseRequestId && f.requirement_id === requirementId));
  const rec = {
    id: uuid(),
    expense_request_id: expenseRequestId,
    requirement_id: requirementId,
    support_program_budget_id: input.support_program_budget_id || null,
    phase: phase || "both",
    original_filename: input.original_filename || "첨부파일.pdf",
    mime_type: input.mime_type || "application/octet-stream",
    size_bytes: Number(input.size_bytes || 0),
    link_url: input.link_url || null,
    uploaded_by: input.uploaded_by || null,
    ai_review_status: "not_requested",
    ai_review_comment: null,
    ai_check_result: {},
    // 신청자가 AI 보완 요청을 착오로 보고 '이상없음'으로 소명한 경우(§AI 오검출 대응).
    user_review_status: null, // null | "cleared"
    user_review_comment: null,
    user_review_by: null,
    user_review_at: null,
    created_at: new Date().toISOString(),
  };
  next.push(rec);
  save(STORAGE_KEYS.UPLOADED_FILES, next);
  return rec;
}

export function mockDeleteExpenseDocumentFile(fileId) {
  const files = load(STORAGE_KEYS.UPLOADED_FILES, []);
  save(STORAGE_KEYS.UPLOADED_FILES, files.filter((f) => f.id !== fileId));
  return { ok: true };
}

// ----------------------------------------------------
// 창업자: AI 검토 (§2.4 / §5.2)
// ----------------------------------------------------
// AI 검토는 승인/반려를 결정하지 않는 1차 보완 필터다. 운영사업 공통 기준 문서가 있으면 함께 참고한다.

// 한 파일의 검토 결과를 만든다(공용 헬퍼).
// batchCount > 1 이면 같은 단계 문서를 함께 비교한 '교차검증' 결과임을 코멘트에 덧붙인다.
// mock: 파일명 길이 짝/홀수로 통과/보완을 갈라 데모에서 두 결과를 모두 보여준다.
function buildReviewResult(file, expense, req, criteria, batchCount = 0) {
  const needsRevision = (String(file.original_filename || "").length % 2) === 1;
  const docName = req?.title || file.original_filename || "첨부파일";

  let status;
  let comment;
  if (needsRevision) {
    status = "needs_revision";
    const lines = [
      `${docName}의 공급가액이 신청 금액(${Number(expense.amount_supply || 0).toLocaleString()}원)과 일치하지 않습니다.`,
      `업체명이 지출 신청서의 거래처명(${expense.vendor_name || "-"})과 다릅니다.`,
      "발행일자가 확인되지 않습니다.",
    ];
    comment = `보완 필요:\n- ${lines.join("\n- ")}\n\n제출 전 위 항목을 확인해주세요.`;
  } else {
    status = "passed";
    comment = "제출 가능:\n업로드된 파일에서 주요 항목이 확인되었습니다.\n관리자 최종 검토 전 참고용 결과입니다.";
  }
  if (criteria?.extracted_criteria_text) {
    comment += `\n\n[적용 기준] ${criteria.title} 의 지침을 함께 참고했습니다.`;
  } else {
    comment += "\n\n[기본 검토] 공통 기준 문서가 없어 첨부서류명·신청 정보·관리자 설정값 기준으로 검토했습니다.";
  }
  if (batchCount > 1) {
    comment += `\n\n[교차검증] 같은 단계 ${batchCount}건 문서를 함께 비교해 금액·거래처·발행일자 정합성을 확인했습니다.`;
  }

  return {
    status,
    comment,
    ai_check_result: {
      vendor_name: expense.vendor_name || null,
      amount: Number(expense.amount_supply || 0),
      issue_date: expense.expected_completion_date || null,
      criteria_applied: !!criteria?.extracted_criteria_text,
      batch_size: batchCount || 1,
    },
  };
}

// 단일 파일 검토(개별 재검토용). 화면 기본 흐름은 일괄검토를 사용한다.
export function mockRequestAiDocumentReview(fileId) {
  if (!mockGetAiSettings().enabled) throw new Error("AI review is disabled by admin settings.");
  const files = load(STORAGE_KEYS.UPLOADED_FILES, []);
  const idx = files.findIndex((f) => f.id === fileId);
  if (idx === -1) throw new Error("업로드된 파일을 찾을 수 없습니다.");
  const file = files[idx];
  const expense = getExpenseById(file.expense_request_id);
  const req = load(STORAGE_KEYS.DOC_REQUIREMENTS, []).find((r) => r.id === file.requirement_id) || null;
  const criteria = mockGetProgramAiCriteriaDocument(getProgramIdForExpense(expense));
  const { status, comment, ai_check_result } = buildReviewResult(file, expense, req, criteria, 0);
  // 재검토로 새 AI 결과가 나오면 이전 '이상없음' 소명은 무효화한다.
  files[idx] = { ...file, ai_review_status: status, ai_review_comment: comment, ai_reviewed_at: new Date().toISOString(), ai_check_result, ...clearedUserReview() };
  save(STORAGE_KEYS.UPLOADED_FILES, files);
  return files[idx];
}

// 신청자 소명 필드 초기화(재검토/덮어쓰기 시 공용).
function clearedUserReview() {
  return { user_review_status: null, user_review_comment: null, user_review_by: null, user_review_at: null };
}

// 단계별 일괄 검토(§4): 해당 단계의 'AI검토 사용 + 파일 업로드' 서류를 한 번에 검토한다.
// 실제 API 전환 시, 이 함수가 단일 호출로 모든 파일 + 공통 기준 문서를 함께 전달해 문서 간 교차검증까지 수행하는 지점이다.
export function mockRequestAiBatchReview(expenseRequestId, phase) {
  if (!mockGetAiSettings().enabled) throw new Error("AI review is disabled by admin settings.");
  const expense = getExpenseById(expenseRequestId);
  const criteria = mockGetProgramAiCriteriaDocument(getProgramIdForExpense(expense));
  const targets = mockGetExpenseDocumentRequirements(expenseRequestId, phase)
    .filter((r) => r.ai_review_enabled && r.file);
  if (!targets.length) return { reviewed: 0 };

  const files = load(STORAGE_KEYS.UPLOADED_FILES, []);
  const now = new Date().toISOString();
  for (const req of targets) {
    const idx = files.findIndex((f) => f.id === req.file.id);
    if (idx === -1) continue;
    const { status, comment, ai_check_result } = buildReviewResult(files[idx], expense, req, criteria, targets.length);
    files[idx] = { ...files[idx], ai_review_status: status, ai_review_comment: comment, ai_reviewed_at: now, ai_check_result, ...clearedUserReview() };
  }
  save(STORAGE_KEYS.UPLOADED_FILES, files);
  return { reviewed: targets.length };
}

// 신청자 'AI 보완 → 이상없음' 소명 처리/취소(§AI 오검출 대응).
//  - cleared=true 면 소명 사유(comment) 필수. AI 보완 필요 결과에만 적용한다.
//  - cleared=false 면 소명을 취소(원래 AI 결과로 복귀).
export function mockSetExpenseDocumentUserReview(fileId, { cleared, comment, user } = {}) {
  const files = load(STORAGE_KEYS.UPLOADED_FILES, []);
  const idx = files.findIndex((f) => f.id === fileId);
  if (idx === -1) throw new Error("업로드된 파일을 찾을 수 없습니다.");
  const file = files[idx];
  if (cleared) {
    if (file.ai_review_status !== "needs_revision") {
      throw new Error("보완 필요로 표시된 서류만 이상없음으로 소명할 수 있습니다.");
    }
    const note = (comment || "").trim();
    if (!note) throw new Error("이상없음 사유를 입력해주세요.");
    files[idx] = {
      ...file,
      user_review_status: "cleared",
      user_review_comment: note,
      user_review_by: user?.id || null,
      user_review_at: new Date().toISOString(),
    };
  } else {
    files[idx] = { ...file, ...clearedUserReview() };
  }
  save(STORAGE_KEYS.UPLOADED_FILES, files);
  return files[idx];
}

// ----------------------------------------------------
// 제출 검증 (§7)
// ----------------------------------------------------
// 해당 단계의 active + required 요구사항이 모두 업로드되어 있는지 확인한다.
// AI 검토 완료는 제출 필수 조건이 아니다(권장 조건, §7).
export function mockValidateRequiredDocuments(expenseRequestId, phase) {
  const reqs = mockGetExpenseDocumentRequirements(expenseRequestId, phase);
  const missing = reqs.filter((r) => r.required && !r.file).map((r) => r.title);
  return { ok: missing.length === 0, missing };
}
