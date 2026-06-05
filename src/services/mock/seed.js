// Mock seed 데이터: 최초 1회 localStorage 초기화 및 버전 변경 시 재시드.
import { STORAGE_KEYS, save } from "./storage.mock.js";

// localStorage 시드 데이터 버전. 데이터 구조가 바뀌면 올린다.
// 버전이 다르면 mock 데이터를 재시드한다(개발용 로컬 데이터만 초기화).
const DATA_VERSION = "8";
const DATA_VERSION_KEY = "mock_data_version";

// Initialize Mock Data
export function initMockData() {
  const seededVersion = localStorage.getItem(DATA_VERSION_KEY);
  if (localStorage.getItem(STORAGE_KEYS.USERS) && seededVersion === DATA_VERSION) return;
  // 구조가 바뀐 경우 기존 mock 키를 비우고 재시드한다(로컬 개발 데이터 한정).
  if (seededVersion !== DATA_VERSION) {
    Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
    sessionStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
  }

  // 1. Initial Users
  const users = [
    { id: "superadmin-uid", email: "super@yna.local", password: "yna123", raw_user_meta_data: { name: "최고관리자" } },
    { id: "admin-uid", email: "admin@yna.local", password: "yna123", raw_user_meta_data: { name: "관리자" } },
    { id: "founder-uid", email: "founder@yna.local", password: "yna123", raw_user_meta_data: { name: "김대표" } },
  ];
  save(STORAGE_KEYS.USERS, users);

  // 2. Initial Support Programs
  const programs = [
    { id: "prog-1", name: "체육인 창업지원", code: "PRG-ATHLETES", active: true, sort_order: 1, level_labels: { "1": "대분류", "2": "중분류", "3": "소분류" }, description: "체육인 창업지원 사업 설명", memo: "체육인 내부 메모" },
    { id: "prog-2", name: "예술인 창업지원", code: "PRG-ARTISTS", active: true, sort_order: 2, level_labels: { "1": "대분류", "2": "중분류", "3": "소분류" } },
    { id: "prog-3", name: "제주도민 창업지원", code: "PRG-JEJU", active: true, sort_order: 3, level_labels: { "1": "대분류", "2": "중분류", "3": "소분류" } },
  ];
  save(STORAGE_KEYS.PROGRAMS, programs);

  // 3. Initial Program Budgets Templates for "체육인 창업지원"
  const budgets = [
    // 대분류
    { id: "b-1", support_program_id: "prog-1", parent_id: null, level: 1, title: "일반수용비", budget_category: "일반수용비", allocated_amount: 0, sort_order: 1 },
    { id: "b-2", support_program_id: "prog-1", parent_id: null, level: 1, title: "인건비", budget_category: "인건비", allocated_amount: 0, sort_order: 2 },
    { id: "b-3", support_program_id: "prog-1", parent_id: null, level: 1, title: "전문가활용비", budget_category: "전문가활용비", allocated_amount: 0, sort_order: 3 },
    // 중분류 (인건비)
    { id: "b-2-1", support_program_id: "prog-1", parent_id: "b-2", level: 2, title: "대표자 인건비", budget_category: "대표자 인건비", allocated_amount: 0, sort_order: 1 },
    { id: "b-2-2", support_program_id: "prog-1", parent_id: "b-2", level: 2, title: "CTO", budget_category: "CTO", allocated_amount: 0, sort_order: 2 },
    { id: "b-2-3", support_program_id: "prog-1", parent_id: "b-2", level: 2, title: "CMO", budget_category: "CMO", allocated_amount: 0, sort_order: 3 },
  ];
  save(STORAGE_KEYS.BUDGETS, budgets);

  // 4. Initial Companies & Members
  const company = {
    id: "comp-abc",
    name: "ABC스포츠",
    representative_name: "김대표",
    business_number: "123-45-67890",
    support_total_amount: 30000000,
    self_payment_required_amount: 3000000,
    self_payment_paid: true,
    agreement_start_date: "2026-01-01",
    agreement_end_date: "2026-12-31",
    support_program_id: "prog-1",
    created_at: "2026-01-01T09:00:00Z",
    approval_status: "approved", // 가입 승인 상태 (예산 상태와 분리)
    budget_status: "budget_approved", // 예산안 승인 상태
    business_plan: {
      version: "V1.0",
      original_filename: "최종_사업계획서.pdf",
      approved_at: "2026-05-12T10:00:00Z",
      updated_at: "2026-05-20T09:30:00Z", // 최종 수정일자
    },
  };
  // 다른 참가 사업(prog-2)의 가입 신청 기업 — 사업별 권한 분리를 확인하기 위한 시드.
  // prog-1만 배정된 일반관리자에게는 보이지 않고, 슈퍼관리자에게만 보인다.
  const company2 = {
    id: "comp-art",
    name: "예술공방",
    representative_name: "이작가",
    business_number: "222-33-44455",
    support_total_amount: 0,
    self_payment_required_amount: 0,
    self_payment_paid: false,
    support_program_id: "prog-2",
    created_at: "2026-03-01T09:00:00Z",
    approval_status: "pending",
    budget_status: "not_submitted",
  };
  save(STORAGE_KEYS.COMPANIES, [company, company2]);

  const profiles = [
    { id: "prof-super", user_id: "superadmin-uid", role: "super_admin", name: "최고관리자" },
    // 일반관리자는 배정된 사업(program_ids)만 관리한다. 데모: 체육인 창업지원(prog-1)만 배정.
    { id: "prof-admin", user_id: "admin-uid", role: "admin", name: "관리자", program_ids: ["prog-1"] },
    { id: "prof-founder", user_id: "founder-uid", role: "founder", name: "김대표", company_name: "ABC스포츠" },
  ];
  save(STORAGE_KEYS.PROFILES, profiles);

  const members = [{ id: "mem-1", company_id: "comp-abc", user_id: "founder-uid", member_role: "owner" }];
  save(STORAGE_KEYS.MEMBERS, members);

  // 5. Initial Allocations (new.md §10.5)
  //  - round1_allocated_amount : 1차 승인 배정액
  //  - round2_allocated_amount : 2차 승인 배정액 (승인 전에는 확정 예산에 반영하지 않으므로 0)
  //  - allocated_amount        : 승인 완료된 차수의 합계(= round1 + 승인된 round2). 기존 지출 계산 호환값
  const mkAlloc = (id, budgetId, round1, round2 = 0) => ({
    id,
    company_id: "comp-abc",
    support_program_budget_id: budgetId,
    round1_allocated_amount: round1,
    round2_allocated_amount: round2,
    allocated_amount: round1 + round2,
  });
  const allocations = [
    mkAlloc("a-1", "b-1", 5000000),
    mkAlloc("a-2", "b-2-1", 15000000),
    mkAlloc("a-3", "b-2-2", 5000000),
    mkAlloc("a-4", "b-2-3", 5000000),
  ];
  save(STORAGE_KEYS.ALLOCATIONS, allocations);

  // 5-2. Budget Submission history (최초 예산안이 승인되어 확정된 이력)
  const budgetSubmissions = [
    {
      id: "bsub-1",
      company_id: "comp-abc",
      type: "initial",
      status: "budget_approved",
      reason: "최초 예산안 제출",
      submitted_by: "founder-uid",
      submitted_at: "2026-01-05T09:00:00Z",
      reviewed_by: "admin-uid",
      reviewed_at: "2026-01-07T10:00:00Z",
      review_comment: "비목 구성 적정하여 승인합니다.",
      created_at: "2026-01-05T09:00:00Z",
    },
  ];
  save(STORAGE_KEYS.BUDGET_SUBMISSIONS, budgetSubmissions);

  const budgetSubmissionItems = [
    { id: "bitem-1", budget_submission_id: "bsub-1", support_program_budget_id: "b-1", previous_allocated_amount: 0, requested_allocated_amount: 5000000, approved_allocated_amount: 5000000 },
    { id: "bitem-2", budget_submission_id: "bsub-1", support_program_budget_id: "b-2-1", previous_allocated_amount: 0, requested_allocated_amount: 15000000, approved_allocated_amount: 15000000 },
    { id: "bitem-3", budget_submission_id: "bsub-1", support_program_budget_id: "b-2-2", previous_allocated_amount: 0, requested_allocated_amount: 5000000, approved_allocated_amount: 5000000 },
    { id: "bitem-4", budget_submission_id: "bsub-1", support_program_budget_id: "b-2-3", previous_allocated_amount: 0, requested_allocated_amount: 5000000, approved_allocated_amount: 5000000 },
  ];
  save(STORAGE_KEYS.BUDGET_SUBMISSION_ITEMS, budgetSubmissionItems);

  // 6. Initial Expense Requests — 신규 8단계 상태를 골고루 시드한다.
  const expenses = [
    {
      // 사전승인 완료: founder 가 최종승인 신청을 할 수 있는 단계
      id: "exp-1",
      company_id: "comp-abc",
      founder_id: "founder-uid",
      business_plan_item_id: "a-1",
      title: "회사 홈페이지 리뉴얼 외주",
      expense_type: "일반용역비",
      budget_category: "일반수용비",
      amount_supply: 4500000,
      vat_amount: 450000,
      total_amount: 4950000,
      vendor_name: "디자인나라",
      vendor_business_number: "222-22-22222",
      purpose: "대외 홍보를 위한 홈페이지 리뉴얼",
      advance_payment_requested: false,
      status: "pre_approved",
      expected_completion_date: "2026-06-30",
      submitted_at: "2026-05-10T12:00:00Z",
      approved_at: "2026-05-12T10:00:00Z",
      created_at: "2026-05-09T09:00:00Z",
    },
    {
      // 사전승인 검토 대기: 관리자 검토 대기 목록(사전승인 검토)에 노출
      id: "exp-2",
      company_id: "comp-abc",
      founder_id: "founder-uid",
      business_plan_item_id: "a-2",
      title: "대표자 5월 인건비",
      expense_type: "인건비",
      budget_category: "대표자 인건비",
      amount_supply: 3000000,
      vat_amount: 0,
      total_amount: 3000000,
      vendor_name: "김대표",
      vendor_business_number: "",
      purpose: "대표자 인건비 집행",
      advance_payment_requested: false,
      status: "pre_approval_submitted",
      expected_completion_date: "2026-05-31",
      submitted_at: "2026-05-20T09:00:00Z",
      created_at: "2026-05-20T09:00:00Z",
    },
    {
      // 최종승인 검토 대기: 관리자 검토 대기 목록(최종승인 검토)에 노출
      id: "exp-3",
      company_id: "comp-abc",
      founder_id: "founder-uid",
      business_plan_item_id: "a-3",
      title: "CTO 외부 자문 용역",
      expense_type: "전문가활용비",
      budget_category: "CTO",
      amount_supply: 2000000,
      vat_amount: 200000,
      total_amount: 2200000,
      vendor_name: "테크자문",
      vendor_business_number: "333-33-33333",
      purpose: "기술 자문 용역비 최종 집행",
      advance_payment_requested: false,
      status: "final_approval_submitted",
      expected_completion_date: "2026-06-10",
      submitted_at: "2026-05-15T09:00:00Z",
      approved_at: "2026-05-18T10:00:00Z",
      final_submitted_at: "2026-05-25T09:00:00Z",
      created_at: "2026-05-15T09:00:00Z",
    },
    {
      // 사전승인 보완: founder 가 같은 건을 수정해 재제출하는 단계
      id: "exp-4",
      company_id: "comp-abc",
      founder_id: "founder-uid",
      business_plan_item_id: "a-3",
      title: "CTO 노트북 구매",
      expense_type: "전문가활용비",
      budget_category: "CTO",
      amount_supply: 1500000,
      vat_amount: 150000,
      total_amount: 1650000,
      vendor_name: "전자상회",
      vendor_business_number: "444-44-44444",
      purpose: "개발용 장비 구매",
      advance_payment_requested: false,
      status: "pre_approval_revision",
      expected_completion_date: "2026-06-05",
      submitted_at: "2026-05-22T09:00:00Z",
      created_at: "2026-05-22T09:00:00Z",
    },
    {
      // 임시저장: 제출 전 자유 수정 가능 단계(예산 점유 없음)
      id: "exp-5",
      company_id: "comp-abc",
      founder_id: "founder-uid",
      business_plan_item_id: "a-4",
      title: "CMO 마케팅 대행 (작성 중)",
      expense_type: "인건비",
      budget_category: "CMO",
      amount_supply: 1000000,
      vat_amount: 100000,
      total_amount: 1100000,
      vendor_name: "",
      vendor_business_number: "",
      purpose: "",
      advance_payment_requested: false,
      status: "draft",
      expected_completion_date: null,
      submitted_at: null,
      created_at: "2026-05-28T09:00:00Z",
    },
  ];
  save(STORAGE_KEYS.EXPENSES, expenses);

  const reviews = [
    { id: "rev-1", expense_request_id: "exp-1", reviewer_id: "admin-uid", decision: "approved", comment: "요구 서류 충족 및 비목 적합하여 사전승인합니다.", created_at: "2026-05-12T10:00:00Z" },
    { id: "rev-2", expense_request_id: "exp-3", reviewer_id: "admin-uid", decision: "approved", comment: "사전승인 적합. 최종 증빙 제출 바랍니다.", created_at: "2026-05-18T10:00:00Z" },
    { id: "rev-3", expense_request_id: "exp-4", reviewer_id: "admin-uid", decision: "revision_requested", comment: "견적서와 사양서를 보완해 같은 건으로 다시 제출해 주세요.", created_at: "2026-05-24T10:00:00Z" },
  ];
  save(STORAGE_KEYS.REVIEWS, reviews);

  // 7. Initial Guidance Items
  const guidance = [
    { id: "guid-1", title: "사업비 집행 지침 안내", content: "사업비는 규정에 맞게 집행해야 합니다.", link_url: "storage:sample_manual.pdf", active: true, sort_order: 1, support_program_id: "prog-1" },
  ];
  save(STORAGE_KEYS.GUIDANCE, guidance);

  // 8. 예산 항목별 커스텀 첨부서류 요구사항 (custom-document-requirements-plan.md §5.1)
  //    b-1(일반수용비), b-2-2(CTO) 비목에 사전/최종 단계 서류를 시드한다.
  const now = "2026-06-01T09:00:00Z";
  const mkReq = (id, budgetId, title, phase, required, ai, sort, description = "") => ({
    id, support_program_id: "prog-1", support_program_budget_id: budgetId,
    title, description, phase, required, ai_review_enabled: ai, active: true,
    sort_order: sort, created_by: "admin-uid", created_at: now, updated_at: now,
  });
  const docRequirements = [
    mkReq("req-1", "b-1", "견적서", "pre", true, true, 10, "거래처가 발행한 견적서를 첨부해주세요."),
    mkReq("req-2", "b-1", "계약서", "pre", true, true, 20, "거래처와 체결한 계약서를 첨부해주세요."),
    mkReq("req-3", "b-1", "참고자료", "pre", false, false, 30, "필요 시 참고할 자료를 첨부해주세요."),
    mkReq("req-4", "b-1", "세금계산서", "final", true, true, 40, "발행된 세금계산서를 첨부해주세요."),
    mkReq("req-5", "b-1", "검수확인서", "final", true, true, 50, "용역/물품 검수 확인서를 첨부해주세요."),
    mkReq("req-6", "b-1", "사업자등록증", "both", false, false, 60, "거래처 사업자등록증(공통)."),
    mkReq("req-7", "b-2-2", "견적서", "pre", true, true, 10, "자문 견적서를 첨부해주세요."),
    mkReq("req-8", "b-2-2", "세금계산서", "final", true, true, 20, "발행된 세금계산서를 첨부해주세요."),
  ];
  save(STORAGE_KEYS.DOC_REQUIREMENTS, docRequirements);

  // 9. 운영사업 공통 AI 검토 기준 문서 (custom-document-requirements-plan.md §5.3)
  const aiCriteria = [
    {
      id: "criteria-1", support_program_id: "prog-1", title: "사업비 집행 지침",
      original_filename: "사업비_집행_지침.pdf", mime_type: "application/pdf", size_bytes: 1240000,
      link_url: "storage:sample_criteria.pdf",
      extracted_criteria_text: "사업비 집행 시 거래처명, 공급가액, 발행일자, 증빙 적합성을 확인한다.",
      extraction_status: "completed", active: true, uploaded_by: "admin-uid",
      created_at: now, updated_at: now,
    },
  ];
  save(STORAGE_KEYS.AI_CRITERIA, aiCriteria);

  // 10. 창업자 업로드 파일 시드 — exp-1(사전승인 완료)의 사전승인 서류를 제출 완료로 둔다.
  const uploadedFiles = [
    {
      id: "ufile-1", expense_request_id: "exp-1", requirement_id: "req-1",
      support_program_budget_id: "b-1", phase: "pre",
      original_filename: "견적서_디자인나라.pdf", mime_type: "application/pdf", size_bytes: 412000,
      link_url: "storage:sample_quote.pdf", uploaded_by: "founder-uid",
      ai_review_status: "passed",
      ai_review_comment: "제출 가능:\n업로드된 파일에서 주요 항목이 확인되었습니다.\n관리자 최종 검토 전 참고용 결과입니다.",
      ai_check_result: { vendor_name: "디자인나라", amount: 4500000, criteria_applied: true },
      created_at: "2026-05-10T11:00:00Z",
    },
    {
      id: "ufile-2", expense_request_id: "exp-1", requirement_id: "req-2",
      support_program_budget_id: "b-1", phase: "pre",
      original_filename: "계약서.pdf", mime_type: "application/pdf", size_bytes: 388000,
      link_url: "storage:sample_contract.pdf", uploaded_by: "founder-uid",
      ai_review_status: "not_requested", ai_review_comment: null, ai_check_result: {},
      created_at: "2026-05-10T11:05:00Z",
    },
  ];
  save(STORAGE_KEYS.UPLOADED_FILES, uploadedFiles);

  localStorage.setItem(DATA_VERSION_KEY, DATA_VERSION);
}
