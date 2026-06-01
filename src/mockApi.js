// Mock API & Auth Implementation for local-only, frontend-first development.
// Stores all states in localStorage to persist across page reloads.

export const STORAGE_KEYS = {
  USERS: "mock_users",
  CURRENT_USER: "mock_current_user",
  COMPANIES: "mock_companies",
  PROFILES: "mock_profiles",
  MEMBERS: "mock_company_members",
  EXPENSES: "mock_expense_requests",
  PLANS: "mock_business_plans",
  PLAN_ITEMS: "mock_business_plan_items",
  PROGRAMS: "mock_support_programs",
  BUDGETS: "mock_support_program_budgets",
  ALLOCATIONS: "mock_company_budget_allocations",
  BUDGET_SUBMISSIONS: "mock_budget_submissions",
  BUDGET_SUBMISSION_ITEMS: "mock_budget_submission_items",
  UPLOADED_FILES: "mock_uploaded_files",
  REVIEWS: "mock_reviews",
  GUIDANCE: "mock_guidance_items",
  FILES: "mock_file_blobs",
};

// 실제 첨부 파일(바이트)을 dataURL 로 보관한다(mock 환경). 다운로드 시 그대로 복원한다.
// 반환 key 는 link_url 로 사용되어 다른 레코드(guidance/business_plan 등)와 연결된다.
export function mockStoreFile(dataUrl, filename, type) {
  const files = load(STORAGE_KEYS.FILES, {});
  const key = `storage:${uuid()}:${filename}`;
  files[key] = { data: dataUrl, filename, type: type || "application/octet-stream" };
  save(STORAGE_KEYS.FILES, files);
  return key;
}

export function mockGetFile(key) {
  if (!key) return null;
  const files = load(STORAGE_KEYS.FILES, {});
  return files[key] || null;
}

// localStorage 시드 데이터 버전. 데이터 구조가 바뀌면 올린다.
// 버전이 다르면 mock 데이터를 재시드한다(개발용 로컬 데이터만 초기화).
const DATA_VERSION = "3";
const DATA_VERSION_KEY = "mock_data_version";

// Helper: load from localStorage
export function load(key, defaultVal = []) {
  const data = localStorage.getItem(key);
  return data ? JSON.parse(data) : defaultVal;
}

// Helper: save to localStorage
export function save(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

// UUID generator
export function uuid() {
  return "uuid-" + Math.random().toString(36).substr(2, 9);
}

// Initialize Mock Data
export function initMockData() {
  const seededVersion = localStorage.getItem(DATA_VERSION_KEY);
  if (localStorage.getItem(STORAGE_KEYS.USERS) && seededVersion === DATA_VERSION) return;
  // 구조가 바뀐 경우 기존 mock 키를 비우고 재시드한다(로컬 개발 데이터 한정).
  if (seededVersion !== DATA_VERSION) {
    Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
  }

  // 1. Initial Users
  const users = [
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
  save(STORAGE_KEYS.COMPANIES, [company]);

  const profiles = [
    { id: "prof-admin", user_id: "admin-uid", role: "admin", name: "관리자" },
    { id: "prof-founder", user_id: "founder-uid", role: "founder", name: "김대표", company_name: "ABC스포츠" },
  ];
  save(STORAGE_KEYS.PROFILES, profiles);

  const members = [{ id: "mem-1", company_id: "comp-abc", user_id: "founder-uid", member_role: "owner" }];
  save(STORAGE_KEYS.MEMBERS, members);

  // 5. Initial Allocations
  const allocations = [
    { id: "a-1", company_id: "comp-abc", support_program_budget_id: "b-1", allocated_amount: 5000000 },
    { id: "a-2", company_id: "comp-abc", support_program_budget_id: "b-2-1", allocated_amount: 15000000 },
    { id: "a-3", company_id: "comp-abc", support_program_budget_id: "b-2-2", allocated_amount: 5000000 },
    { id: "a-4", company_id: "comp-abc", support_program_budget_id: "b-2-3", allocated_amount: 5000000 },
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

  // 6. Initial Expense Requests
  const expenses = [
    {
      id: "exp-1",
      company_id: "comp-abc",
      founder_id: "founder-uid",
      business_plan_item_id: null,
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
  ];
  save(STORAGE_KEYS.EXPENSES, expenses);

  const reviews = [
    { id: "rev-1", expense_request_id: "exp-1", reviewer_id: "admin-uid", decision: "approved", comment: "요구 서류 충족 및 비목 적합하여 승인합니다.", created_at: "2026-05-12T10:00:00Z" }
  ];
  save(STORAGE_KEYS.REVIEWS, reviews);

  // 7. Initial Guidance Items
  const guidance = [
    { id: "guid-1", title: "사업비 집행 지침 안내", content: "사업비는 규정에 맞게 집행해야 합니다.", link_url: "storage:sample_manual.pdf", active: true, sort_order: 1, support_program_id: "prog-1" },
  ];
  save(STORAGE_KEYS.GUIDANCE, guidance);

  localStorage.setItem(DATA_VERSION_KEY, DATA_VERSION);
}

// ----------------------------------------------------
// Mock Auth Functions
// ----------------------------------------------------
export function mockGetCurrentUser() {
  const user = load(STORAGE_KEYS.CURRENT_USER, null);
  if (!user) return null;
  const profiles = load(STORAGE_KEYS.PROFILES, []);
  const profile = profiles.find((p) => p.user_id === user.id) || { role: "founder", name: "임시" };
  return { ...user, profile };
}

export function mockSignIn(loginId, password) {
  const users = load(STORAGE_KEYS.USERS, []);
  const normalized = String(loginId || "").trim();
  const email = normalized === "admin" ? "admin@yna.local" : normalized === "founder" ? "founder@yna.local" : normalized;
  
  const user = users.find((u) => u.email === email && u.password === password);
  if (!user) throw new Error("아이디 또는 비밀번호가 잘못되었습니다.");

  // 창업자는 가입 승인 전/반려 상태에서 로그인을 차단한다. (관리자는 예외)
  const profiles = load(STORAGE_KEYS.PROFILES, []);
  const profile = profiles.find((p) => p.user_id === user.id);
  if (profile?.role === "founder") {
    const members = load(STORAGE_KEYS.MEMBERS, []);
    const member = members.find((m) => m.user_id === user.id);
    const companies = load(STORAGE_KEYS.COMPANIES, []);
    const company = companies.find((c) => c.id === member?.company_id);
    if (company && company.approval_status !== "approved") {
      const blocked = new Error(
        company.approval_status === "rejected"
          ? "가입이 반려되었습니다. 관리자에게 문의해 주세요."
          : "가입 승인 대기 중입니다. 관리자 승인 후 로그인할 수 있습니다."
      );
      blocked.blocked = true; // 로그인 페이지에서 얼럿으로 안내
      throw blocked;
    }
  }

  save(STORAGE_KEYS.CURRENT_USER, user);
  return { user };
}

export function mockSignUpFounder(input) {
  const users = load(STORAGE_KEYS.USERS, []);
  if (users.find((u) => u.email === input.email)) {
    throw new Error("이미 사용 중인 이메일 주소입니다.");
  }
  const newUserId = uuid();
  const newUser = { id: newUserId, email: input.email, password: input.password, raw_user_meta_data: input };
  users.push(newUser);
  save(STORAGE_KEYS.USERS, users);

  // Create Company (Pending status)
  const companies = load(STORAGE_KEYS.COMPANIES, []);
  const newCompanyId = uuid();
  companies.push({
    id: newCompanyId,
    name: input.company_name,
    representative_name: input.founder_name,
    business_number: input.business_number || "",
    support_total_amount: 0,
    self_payment_required_amount: 0,
    self_payment_paid: false,
    support_program_id: input.support_program_id,
    created_at: new Date().toISOString(),
    approval_status: "pending", // 가입 승인 대기
    budget_status: "not_submitted", // 예산안 미제출
  });
  save(STORAGE_KEYS.COMPANIES, companies);

  // Create Profile
  const profiles = load(STORAGE_KEYS.PROFILES, []);
  profiles.push({
    id: uuid(),
    user_id: newUserId,
    role: "founder",
    name: input.founder_name,
    company_name: input.company_name,
    phone: input.phone || "",
  });
  save(STORAGE_KEYS.PROFILES, profiles);

  // Create Member
  const members = load(STORAGE_KEYS.MEMBERS, []);
  members.push({ id: uuid(), company_id: newCompanyId, user_id: newUserId, member_role: "owner" });
  save(STORAGE_KEYS.MEMBERS, members);

  return { needsConfirmation: false, user: newUser };
}

export function mockSignOut() {
  localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
}

export function mockVerifyCurrentPassword(password) {
  const currentUser = mockGetCurrentUser();
  if (!currentUser) throw new Error("로그인이 필요합니다.");
  const users = load(STORAGE_KEYS.USERS, []);
  const user = users.find((u) => u.id === currentUser.id);
  if (!user || user.password !== password) throw new Error("비밀번호가 일치하지 않습니다.");
}

// Helper to calculate budget summary for mock
function mockCalculateBudgetSummary(companyId, expenses) {
  const allocations = load(STORAGE_KEYS.ALLOCATIONS, []);
  const budgets = load(STORAGE_KEYS.BUDGETS, []);
  
  // Filter allocations for this company
  const companyAllocs = allocations.filter((a) => a.company_id === companyId);
  const companyExpenses = expenses.filter((e) => e.company_id === companyId);

  return companyAllocs.map((alloc) => {
    const budgetNode = budgets.find((b) => b.id === alloc.support_program_budget_id);
    if (!budgetNode) return null;
    
    // Find expenses matching this category
    const related = companyExpenses.filter((e) => e.budget_category === budgetNode.budget_category);
    const approvedAmount = related
      .filter((e) => ["pre_approved", "executing", "execution_submitted", "inspection_submitted", "settlement_submitted", "completed"].includes(e.status))
      .reduce((sum, e) => sum + Number(e.amount_supply || 0), 0);
    const pendingAmount = related
      .filter((e) => ["pre_approval_submitted", "pre_approval_revision_requested"].includes(e.status))
      .reduce((sum, e) => sum + Number(e.amount_supply || 0), 0);

    return {
      id: alloc.id,
      title: budgetNode.title,
      budget_category: budgetNode.budget_category,
      allocated_amount: Number(alloc.allocated_amount || 0),
      approved_amount: approvedAmount,
      pending_amount: pendingAmount,
      remaining_amount: Number(alloc.allocated_amount || 0) - approvedAmount - pendingAmount,
    };
  }).filter(Boolean);
}

// Helper to build budget tree
function mockBuildBudgetTreeWithAllocations(programBudgets, allocations, expenses) {
  const companyAllocs = allocations || [];
  const allocByBudgetId = new Map(companyAllocs.map((a) => [a.support_program_budget_id, Number(a.allocated_amount || 0)]));
  
  const childrenByParent = new Map();
  for (const item of programBudgets) {
    const key = item.parent_id || null;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(item);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }

  const decorate = (node) => {
    const children = (childrenByParent.get(node.id) || []).map(decorate);
    const isLeaf = children.length === 0;
    let allocated = 0;
    let approved = 0;
    let pending = 0;
    
    if (isLeaf) {
      allocated = allocByBudgetId.get(node.id) ?? 0;
      const related = expenses.filter((e) => e.budget_category === node.budget_category && node.budget_category);
      approved = related
        .filter((e) => ["pre_approved", "executing", "execution_submitted", "inspection_submitted", "settlement_submitted", "completed"].includes(e.status))
        .reduce((sum, e) => sum + Number(e.amount_supply || 0), 0);
      pending = related
        .filter((e) => ["pre_approval_submitted", "pre_approval_revision_requested"].includes(e.status))
        .reduce((sum, e) => sum + Number(e.amount_supply || 0), 0);
    } else {
      for (const child of children) {
        allocated += child.allocated_amount;
        approved += child.approved_amount;
        pending += child.pending_amount;
      }
    }

    return {
      ...node,
      isLeaf,
      children,
      allocated_amount: allocated,
      approved_amount: approved,
      pending_amount: pending,
      remaining_amount: allocated - approved - pending,
    };
  };

  return (childrenByParent.get(null) || []).map(decorate);
}

// ----------------------------------------------------
// Mock Program Functions
// ----------------------------------------------------
export function mockGetSupportPrograms() {
  return load(STORAGE_KEYS.PROGRAMS, []).filter((p) => p.active !== false);
}

export function mockCreateSupportProgram(input, adminUserId) {
  const programs = load(STORAGE_KEYS.PROGRAMS, []);
  const newProgram = {
    id: uuid(),
    name: input.name,
    code: "PRG-" + Math.random().toString(36).substr(2, 6).toUpperCase(),
    active: true,
    sort_order: Number(input.sort_order || 0),
    level_labels: { "1": "대분류", "2": "중분류", "3": "소분류" },
    created_by: adminUserId,
    created_at: new Date().toISOString(),
  };
  programs.push(newProgram);
  save(STORAGE_KEYS.PROGRAMS, programs);
  return newProgram;
}

export function mockUpdateSupportProgram(id, input) {
  const programs = load(STORAGE_KEYS.PROGRAMS, []);
  const idx = programs.findIndex((p) => p.id === id);
  if (idx !== -1) {
    programs[idx] = { ...programs[idx], name: input.name, sort_order: Number(input.sort_order || 0) };
    save(STORAGE_KEYS.PROGRAMS, programs);
    return programs[idx];
  }
  throw new Error("프로그램을 찾을 수 없습니다.");
}

export function mockDeleteSupportProgram(id) {
  const programs = load(STORAGE_KEYS.PROGRAMS, []);
  const idx = programs.findIndex((p) => p.id === id);
  if (idx !== -1) {
    programs[idx].active = false;
    save(STORAGE_KEYS.PROGRAMS, programs);
    return { ok: true };
  }
  throw new Error("프로그램을 찾을 수 없습니다.");
}

export function mockUpdateSupportProgramDescription(id, description) {
  const programs = load(STORAGE_KEYS.PROGRAMS, []);
  const idx = programs.findIndex((p) => p.id === id);
  if (idx !== -1) {
    programs[idx].description = description;
    save(STORAGE_KEYS.PROGRAMS, programs);
    return programs[idx];
  }
  throw new Error("프로그램을 찾을 수 없습니다.");
}

export function mockUpdateSupportProgramMemo(id, memo) {
  const programs = load(STORAGE_KEYS.PROGRAMS, []);
  const idx = programs.findIndex((p) => p.id === id);
  if (idx !== -1) {
    programs[idx].memo = memo;
    save(STORAGE_KEYS.PROGRAMS, programs);
    return programs[idx];
  }
  throw new Error("프로그램을 찾을 수 없습니다.");
}

export function mockUpdateSupportProgramLevelLabels(id, labels) {
  const programs = load(STORAGE_KEYS.PROGRAMS, []);
  const idx = programs.findIndex((p) => p.id === id);
  if (idx !== -1) {
    programs[idx].level_labels = labels;
    save(STORAGE_KEYS.PROGRAMS, programs);
    return programs[idx];
  }
  throw new Error("프로그램을 찾을 수 없습니다.");
}

// ----------------------------------------------------
// Mock Program Budget/Category Functions
// ----------------------------------------------------
export function mockGetSupportProgramBudgets(programId) {
  const budgets = load(STORAGE_KEYS.BUDGETS, []);
  return budgets.filter((b) => b.support_program_id === programId);
}

export function mockCreateSupportProgramBudget(input) {
  const budgets = load(STORAGE_KEYS.BUDGETS, []);
  const newBudget = {
    id: uuid(),
    support_program_id: input.support_program_id,
    parent_id: input.parent_id || null,
    level: Number(input.level || 1),
    title: input.title,
    budget_category: input.budget_category || null,
    allocated_amount: Number(input.allocated_amount || 0),
    description: input.description || null,
    sort_order: Number(input.sort_order || 0),
    created_at: new Date().toISOString(),
  };
  budgets.push(newBudget);
  save(STORAGE_KEYS.BUDGETS, budgets);
  return newBudget;
}

export function mockUpdateSupportProgramBudget(id, input) {
  const budgets = load(STORAGE_KEYS.BUDGETS, []);
  const idx = budgets.findIndex((b) => b.id === id);
  if (idx !== -1) {
    budgets[idx] = {
      ...budgets[idx],
      title: input.title,
      budget_category: input.budget_category,
      allocated_amount: Number(input.allocated_amount || 0),
      description: input.description || null,
      sort_order: Number(input.sort_order || 0),
    };
    save(STORAGE_KEYS.BUDGETS, budgets);
    return budgets[idx];
  }
  throw new Error("예산 비목을 찾을 수 없습니다.");
}

export function mockDeleteSupportProgramBudget(id) {
  let budgets = load(STORAGE_KEYS.BUDGETS, []);
  // Delete self and all recursively nested children
  const toDelete = new Set([id]);
  let added = true;
  while (added) {
    added = false;
    for (const b of budgets) {
      if (b.parent_id && toDelete.has(b.parent_id) && !toDelete.has(b.id)) {
        toDelete.add(b.id);
        added = true;
      }
    }
  }
  budgets = budgets.filter((b) => !toDelete.has(b.id));
  save(STORAGE_KEYS.BUDGETS, budgets);
  return { ok: true };
}
