// Mock 기업 도메인: 창업자/관리자 대시보드, 기업 상세, 가입 승인/반려, 지원금 총액, 프로필, 사업계획서.
import { STORAGE_KEYS, load, save } from "./storage.mock.js";
import { mockGetCurrentUser } from "./auth.mock.js";
import { mockGetCurrentAdminProgramScope, mockAdminCanAccessProgram } from "./admin-account.mock.js";
import { mockGetGuidanceItems } from "./guidance.mock.js";
import { BUDGET_APPROVED_STATUSES } from "../../domains/status.js";
import { generateChecklist, generateWarnings } from "../../domains/expense/rules-engine.js";
import {
  resolveExpenseLeafIds, getPendingSubmission, buildAllocRoundMaps, buildPendingRoundMaps,
  buildBudgetTreeWithAmounts, getRound2Status, calculateBudgetSummary, attachSubmissionItems,
  decorateExpenseCounts, computeCommittedByBudgetId,
} from "./_shared.mock.js";


// ----------------------------------------------------
// Mock Founder Dashboard Functions
// ----------------------------------------------------
export function mockGetFounderDashboard() {
  const currentUser = mockGetCurrentUser();
  if (!currentUser) throw new Error("로그인이 필요합니다.");

  const members = load(STORAGE_KEYS.MEMBERS, []);
  const member = members.find((m) => m.user_id === currentUser.id);
  if (!member) return { company: null, expenses: [] };

  const companies = load(STORAGE_KEYS.COMPANIES, []);
  const company = companies.find((c) => c.id === member.company_id);
  if (!company) return { company: null, expenses: [] };

  // Join program details
  const programs = load(STORAGE_KEYS.PROGRAMS, []);
  const program = programs.find((p) => p.id === company.support_program_id);
  const companyWithProgram = {
    ...company,
    support_programs: program
      ? { id: program.id, name: program.name, description: program.description || "", level_labels: program.level_labels }
      : null,
    // 1차/2차 사업계획서 슬롯(레거시 business_plan 마이그레이션 포함). new.md §10.2.
    business_plans: normalizeBusinessPlans(company),
  };

  const expenses = load(STORAGE_KEYS.EXPENSES, []).filter((e) => e.company_id === company.id);
  const guidanceItems = mockGetGuidanceItems(company.support_program_id);
  const budgets = load(STORAGE_KEYS.BUDGETS, []).filter((b) => b.support_program_id === company.support_program_id);
  const allocations = load(STORAGE_KEYS.ALLOCATIONS, []).filter((a) => a.company_id === company.id);
  
  const leafIdByExpense = resolveExpenseLeafIds(expenses, allocations, budgets);

  // 검토 대기/보완 중인 예산 제출안(읽기 전용 미리보기용)
  const pendingSubmission = getPendingSubmission(company.id);

  // 확정 예산 트리: 1차/2차/총 배정 + 검토 중 2차 요청(승인 대기 표시용) 반영(new.md §10.3/§10.4).
  const allocMaps = buildAllocRoundMaps(allocations);
  const pendingRoundMaps = buildPendingRoundMaps(pendingSubmission);
  allocMaps.pendingRound1 = pendingRoundMaps.round1;
  allocMaps.pendingRound2 = pendingRoundMaps.round2;
  const budgetTree = buildBudgetTreeWithAmounts(budgets, allocMaps, expenses, leafIdByExpense);
  const round2Status = getRound2Status(company.budget_status, {
    hasConfirmedRound2: [...allocMaps.round2.values()].some((v) => Number(v) > 0),
    hasPendingRound2: !!pendingSubmission?.round2_requested,
  });

  const reviewHistory = load(STORAGE_KEYS.REVIEWS, []).filter((r) =>
    r.expense_request_id === "budget-" + company.id || expenses.some((e) => e.id === r.expense_request_id)
  );

  // 최초(1차) 예산안 검토 대기 미리보기: 아직 확정 예산이 없으므로 요청 round1 금액으로 트리를 그린다.
  let pendingBudgetTree = null;
  if (pendingSubmission && pendingSubmission.type !== "change") {
    const requestedByBudgetId = new Map(
      pendingSubmission.items.map((it) => [it.support_program_budget_id, Number(it.requested_allocated_amount || 0)])
    );
    pendingBudgetTree = buildBudgetTreeWithAmounts(
      budgets,
      { round1: requestedByBudgetId, total: requestedByBudgetId },
      expenses,
      leafIdByExpense
    );
  }
  const budgetSubmissions = attachSubmissionItems(
    load(STORAGE_KEYS.BUDGET_SUBMISSIONS, [])
      .filter((s) => s.company_id === company.id)
      .sort((a, b) => String(b.submitted_at || "").localeCompare(String(a.submitted_at || ""))),
    budgets
  );

  // 지출 현황 표/검색용: 비목(사업계획서 항목) 라벨을 부가한다(new.md §5).
  const decoratedExpenses = (expenses || []).map((e) => ({
    ...e,
    business_plan_item_label: resolveBusinessPlanItemLabel(e),
  }));

  return {
    company: companyWithProgram,
    expenses: decoratedExpenses,
    budgetSummary: calculateBudgetSummary(allocations, budgets, company.id, expenses),
    budgetTree,
    round2Status,
    programBudgets: budgets,
    allocations,
    pendingSubmission,
    pendingBudgetTree,
    budgetSubmissions,
    manualLinks: guidanceItems,
    reviewHistory: reviewHistory.map((r) => {
      if (r.expense_request_id?.startsWith("budget-")) {
        return { ...r, title: "예산 및 비목 배정안" };
      }
      const exp = expenses.find((e) => e.id === r.expense_request_id);
      return { ...r, title: exp ? exp.title : "-" };
    }),
  };
}

// 창업자가 예산안(최초=1차) 또는 예산 변경(1차 수정 / 2차 배정 신청)을 제출한다(new.md §10).
// 핵심 원칙(new.md 2.3/2.4/5장/10장):
//  - 확정 예산(company_budget_allocations)은 관리자 승인 시점에만 갱신한다. 제출만으로는 바꾸지 않는다.
//  - 가입 승인 상태(approval_status)는 절대 건드리지 않는다(상태 분리).
//  - inputAllocations[] 해석:
//    · initial: { support_program_budget_id, allocated_amount(=1차 요청) }
//    · change : { support_program_budget_id, allocated_amount(=1차 요청), round2_allocated_amount(=2차 요청 최종값) }
//      1차만 수정할 수도, 2차만 신청할 수도, 둘 다 변경할 수도 있다. round2 미지정 시 현재 확정 2차 유지.

export function mockGetAdminDashboard() {
  // 일반관리자는 배정된 사업의 기업만 본다(슈퍼관리자는 scope=null → 전체).
  const scope = mockGetCurrentAdminProgramScope();
  const inScope = (programId) => scope === null || scope.includes(programId);

  const companies = load(STORAGE_KEYS.COMPANIES, []).filter((c) => inScope(c.support_program_id));
  const companyIdSet = new Set(companies.map((c) => c.id));
  const programs = load(STORAGE_KEYS.PROGRAMS, []);
  const expenses = load(STORAGE_KEYS.EXPENSES, []).filter((e) => scope === null || companyIdSet.has(e.company_id));
  const budgets = load(STORAGE_KEYS.BUDGETS, []);
  const allocations = load(STORAGE_KEYS.ALLOCATIONS, []);

  const mappedCompanies = companies.map((c) => {
    const prog = programs.find((p) => p.id === c.support_program_id);
    const companyExpenses = expenses.filter((e) => e.company_id === c.id);
    const pendingSubmission = getPendingSubmission(c.id);
    const companyAllocs = allocations.filter((a) => a.company_id === c.id);
    return {
      ...c,
      support_programs: prog ? { name: prog.name } : null,
      budgetSummary: calculateBudgetSummary(allocations, budgets, c.id, companyExpenses),
      pendingBudgetSubmission: pendingSubmission,
      // 1차(budget_status)와 분리해, 2차(변경·추가배정) 진행 상태를 기업상세와 동일하게 산출한다.
      round2Status: getRound2Status(c.budget_status, {
        hasConfirmedRound2: companyAllocs.some((a) => Number(a.round2_allocated_amount || 0) > 0),
        hasPendingRound2: !!pendingSubmission?.round2_requested,
      }),
      expense_count: companyExpenses.length,
    };
  });

  const totalSupportAmount = mappedCompanies.reduce((s, c) => s + Number(c.support_total_amount || 0), 0);
  const totalApprovedAmount = expenses
    .filter((e) => BUDGET_APPROVED_STATUSES.includes(e.status))
    .reduce((s, e) => s + Number(e.amount_supply || 0), 0);

  // 비목명은 저장값(budget_category)이 비어 있을 수 있어 business_plan_item_id 기준으로 해석한다.
  const budgetById = new Map(budgets.map((b) => [b.id, b]));
  const leafIdByExpense = resolveExpenseLeafIds(expenses, allocations, budgets);

  return {
    companyCount: companies.length,
    companies: mappedCompanies,
    totalSupportAmount,
    totalApprovedAmount,
    totalIssueCount: 0,
    supportPrograms: programs.filter((p) => p.active !== false && inScope(p.id)),
    expenses: expenses.map((e) => {
      const comp = companies.find((c) => c.id === e.company_id);
      const leafNode = budgetById.get(leafIdByExpense.get(e.id));
      return {
        ...e,
        budget_category: leafNode?.budget_category || leafNode?.title || e.budget_category || null,
        company_name: comp ? comp.name : "-",
        representative_name: comp ? comp.representative_name : "-",
        ...decorateExpenseCounts(e),
      };
    }),
  };
}

export function mockGetAdminCompanyDetail(companyId) {
  const companies = load(STORAGE_KEYS.COMPANIES, []);
  const company = companies.find((c) => c.id === companyId);
  if (!company) throw new Error("기업을 찾을 수 없습니다.");
  if (!mockAdminCanAccessProgram(company.support_program_id)) throw new Error("이 사업에 대한 접근 권한이 없습니다.");

  const programs = load(STORAGE_KEYS.PROGRAMS, []);
  const program = programs.find((p) => p.id === company.support_program_id);
  const companyWithProgram = {
    ...company,
    support_programs: program ? { id: program.id, name: program.name, level_labels: program.level_labels } : null,
    // 1차/2차 사업계획서 슬롯(레거시 business_plan 마이그레이션 포함). 창업자 대시보드와 동일 구조.
    business_plans: normalizeBusinessPlans(company),
  };

  // 기업 담당자(창업자) 로그인 계정 정보: MEMBERS → USERS 조인. 가입 현황/비밀번호 재설정 화면에서 사용한다.
  const members = load(STORAGE_KEYS.MEMBERS, []);
  const member = members.find((m) => m.company_id === companyId);
  const users = load(STORAGE_KEYS.USERS, []);
  const accountUser = member ? users.find((u) => u.id === member.user_id) : null;
  const account = {
    user_id: accountUser?.id || null,
    email: accountUser?.email || null,
    name: accountUser?.raw_user_meta_data?.name || company.representative_name || null,
  };

  const expenses = load(STORAGE_KEYS.EXPENSES, []).filter((e) => e.company_id === companyId);
  const budgets = load(STORAGE_KEYS.BUDGETS, []).filter((b) => b.support_program_id === company.support_program_id);
  const allocations = load(STORAGE_KEYS.ALLOCATIONS, []).filter((a) => a.company_id === companyId);

  const leafIdByExpense = resolveExpenseLeafIds(expenses, allocations, budgets);

  // 비목별 이미 커밋된(승인+검토중) 지출 금액 — 감액 하한 계산용
  const committedMap = computeCommittedByBudgetId(companyId);
  const committedByBudgetId = Object.fromEntries(committedMap);

  // 검토 대기/보완 중인 예산 제출안 + 전체 제출 이력
  const pendingSubmission = getPendingSubmission(companyId);
  if (pendingSubmission) {
    // 제출자 이름 조인
    const users = load(STORAGE_KEYS.USERS, []);
    const submitter = users.find((u) => u.id === pendingSubmission.submitted_by);
    pendingSubmission.submitted_by_name =
      submitter?.raw_user_meta_data?.name || company.representative_name || "-";
  }

  // 확정 예산 트리: 1차/2차/총 배정 + 검토 중 2차 요청(승인 대기 표시용) 반영(new.md §10.3/§10.4).
  const allocMaps = buildAllocRoundMaps(allocations);
  const pendingRoundMaps = buildPendingRoundMaps(pendingSubmission);
  allocMaps.pendingRound1 = pendingRoundMaps.round1;
  allocMaps.pendingRound2 = pendingRoundMaps.round2;
  const budgetTree = buildBudgetTreeWithAmounts(budgets, allocMaps, expenses, leafIdByExpense);
  const round2Status = getRound2Status(company.budget_status, {
    hasConfirmedRound2: [...allocMaps.round2.values()].some((v) => Number(v) > 0),
    hasPendingRound2: !!pendingSubmission?.round2_requested,
  });

  const reviewHistory = load(STORAGE_KEYS.REVIEWS, []).filter((r) =>
    r.expense_request_id === "budget-" + companyId || expenses.some((e) => e.id === r.expense_request_id)
  );

  // 최초(1차) 예산안 검토 대기 미리보기: 아직 확정 예산이 없으므로 요청 round1 금액으로 트리를 그린다.
  let pendingBudgetTree = null;
  if (pendingSubmission && pendingSubmission.type !== "change") {
    const requestedByBudgetId = new Map(
      pendingSubmission.items.map((it) => [it.support_program_budget_id, Number(it.requested_allocated_amount || 0)])
    );
    pendingBudgetTree = buildBudgetTreeWithAmounts(
      budgets,
      { round1: requestedByBudgetId, total: requestedByBudgetId },
      expenses,
      leafIdByExpense
    );
  }
  const budgetSubmissions = attachSubmissionItems(
    load(STORAGE_KEYS.BUDGET_SUBMISSIONS, [])
      .filter((s) => s.company_id === companyId)
      .sort((a, b) => String(b.submitted_at || "").localeCompare(String(a.submitted_at || ""))),
    budgets
  );

  // 지출 검토 목록(§11.2)용: 비목 경로·첨부 제출률·위험 경고 수를 부가한다.
  const uploadedFiles = load(STORAGE_KEYS.UPLOADED_FILES, []);
  const uploadedTypesByExpense = new Map();
  for (const f of uploadedFiles) {
    if (!uploadedTypesByExpense.has(f.expense_request_id)) uploadedTypesByExpense.set(f.expense_request_id, new Set());
    uploadedTypesByExpense.get(f.expense_request_id).add(f.document_type);
  }
  const budgetById = new Map(budgets.map((b) => [b.id, b]));
  const decoratedExpenses = (expenses || []).map((e) => {
    const required = generateChecklist(e).filter((d) => d.required);
    const uploaded = uploadedTypesByExpense.get(e.id) || new Set();
    const submitted = required.filter((d) => uploaded.has(d.document_type)).length;
    const warns = generateWarnings(e);
    const leafNode = budgetById.get(leafIdByExpense.get(e.id));
    return {
      ...e,
      budget_category: leafNode?.budget_category || leafNode?.title || e.budget_category || null,
      doc_required: required.length,
      doc_submitted: submitted,
      warning_count: warns.filter((w) => w.severity === "warning" || w.severity === "danger").length,
    };
  });

  return {
    company: companyWithProgram,
    account,
    budgetSummary: calculateBudgetSummary(allocations, budgets, companyId, expenses),
    budgetTree,
    round2Status,
    programBudgets: budgets,
    committedByBudgetId,
    pendingSubmission,
    pendingBudgetTree,
    budgetSubmissions,
    expenses: decoratedExpenses,
    reviewHistory: reviewHistory.map((r) => {
      if (r.expense_request_id?.startsWith("budget-")) {
        return { ...r, title: "예산 및 비목 배정안" };
      }
      const exp = expenses.find((e) => e.id === r.expense_request_id);
      return { ...r, title: exp ? exp.title : "-" };
    }),
  };
}

// 가입(참여기업) 승인. 가입 승인 상태만 변경하고, 확정 예산은 만들지 않는다.
// 예산은 별도의 예산안 제출/승인 흐름에서 확정된다(상태 분리).
export function mockApproveCompany(companyId, adminUserId) {
  const companies = load(STORAGE_KEYS.COMPANIES, []);
  const idx = companies.findIndex((c) => c.id === companyId);
  if (idx === -1) throw new Error("기업을 찾을 수 없습니다.");
  if (!mockAdminCanAccessProgram(companies[idx].support_program_id)) throw new Error("이 사업에 대한 접근 권한이 없습니다.");

  companies[idx].approval_status = "approved";
  companies[idx].approved_at = new Date().toISOString();
  companies[idx].approved_by = adminUserId;
  if (!companies[idx].budget_status) companies[idx].budget_status = "not_submitted";
  save(STORAGE_KEYS.COMPANIES, companies);
  return companies[idx];
}

export function mockRejectCompany(companyId) {
  const companies = load(STORAGE_KEYS.COMPANIES, []);
  const idx = companies.findIndex((c) => c.id === companyId);
  if (idx !== -1) {
    if (!mockAdminCanAccessProgram(companies[idx].support_program_id)) throw new Error("이 사업에 대한 접근 권한이 없습니다.");
    companies[idx].approval_status = "rejected";
    companies[idx].approved_at = null;
    companies[idx].approved_by = null;
    save(STORAGE_KEYS.COMPANIES, companies);
    return companies[idx];
  }
  throw new Error("기업을 찾을 수 없습니다.");
}

// 관리자: 예산 제출안 검토(승인/보완요청).
// 승인된 경우에만 확정 예산(company_budget_allocations)을 갱신한다(new.md 2.3/5장 원칙).

export function mockUpdateCompanySupportTotal(companyId, amount) {
  const companies = load(STORAGE_KEYS.COMPANIES, []);
  const idx = companies.findIndex((c) => c.id === companyId);
  if (idx !== -1) {
    companies[idx].support_total_amount = Number(amount || 0);
    save(STORAGE_KEYS.COMPANIES, companies);
    return companies[idx];
  }
  throw new Error("기업을 찾을 수 없습니다.");
}

// 기업 담당자(창업자) 로그인 비밀번호 재설정. MEMBERS → USERS 로 계정을 찾아 갱신한다.
export function mockResetFounderPassword(companyId, newPassword) {
  const next = String(newPassword || "");
  if (next.length < 6) throw new Error("새 비밀번호는 6자 이상이어야 합니다.");

  const members = load(STORAGE_KEYS.MEMBERS, []);
  const member = members.find((m) => m.company_id === companyId);
  if (!member) throw new Error("이 기업에 연결된 로그인 계정을 찾을 수 없습니다.");

  const users = load(STORAGE_KEYS.USERS, []);
  const idx = users.findIndex((u) => u.id === member.user_id);
  if (idx === -1) throw new Error("이 기업에 연결된 로그인 계정을 찾을 수 없습니다.");

  users[idx].password = next;
  save(STORAGE_KEYS.USERS, users);
  return { ok: true };
}

// 관리자 내부 메모 저장. 페이지에서 localStorage 직접 접근 대신 이 서비스 계층을 경유한다.
export function mockUpdateCompanyInternalMemo(companyId, memo) {
  const companies = load(STORAGE_KEYS.COMPANIES, []);
  const idx = companies.findIndex((c) => c.id === companyId);
  if (idx === -1) throw new Error("기업을 찾을 수 없습니다.");
  companies[idx].internal_memo = memo || "";
  save(STORAGE_KEYS.COMPANIES, companies);
  return companies[idx];
}

// 지출 신청의 business_plan_item_id(=기업 예산 배정 id)를 비목 단계 경로 문자열로 해석한다.
// 매핑이 끊겨 있으면 비목명으로, 그것도 없으면 "-"로 폴백한다.
export function resolveBusinessPlanItemLabel(expense) {
  const allocations = load(STORAGE_KEYS.ALLOCATIONS, []);
  const budgets = load(STORAGE_KEYS.BUDGETS, []);
  const budgetById = new Map(budgets.map((b) => [b.id, b]));

  const alloc = allocations.find((a) => a.id === expense.business_plan_item_id);
  const budgetNode = alloc ? budgetById.get(alloc.support_program_budget_id) : null;
  if (!budgetNode) return expense.budget_category || "-";

  const titles = [];
  const seen = new Set();
  let cur = budgetNode;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    titles.unshift(cur.title);
    cur = cur.parent_id ? budgetById.get(cur.parent_id) : null;
  }
  return titles.join(" › ") || expense.budget_category || "-";
}


export function mockUpdateFounderProfile(input) {
  const currentUser = mockGetCurrentUser();
  if (!currentUser) throw new Error("로그인이 필요합니다.");

  const members = load(STORAGE_KEYS.MEMBERS, []);
  const member = members.find((m) => m.user_id === currentUser.id);
  if (!member) throw new Error("기업 정보를 찾을 수 없습니다.");

  const companies = load(STORAGE_KEYS.COMPANIES, []);
  const idx = companies.findIndex((c) => c.id === member.company_id);
  if (idx !== -1) {
    companies[idx].name = input.company_name;
    companies[idx].representative_name = input.representative_name;
    companies[idx].business_number = input.business_number || "";
    save(STORAGE_KEYS.COMPANIES, companies);

    const profiles = load(STORAGE_KEYS.PROFILES, []);
    const pIdx = profiles.findIndex((p) => p.user_id === currentUser.id);
    if (pIdx !== -1) {
      profiles[pIdx].name = input.representative_name;
      profiles[pIdx].company_name = input.company_name;
      profiles[pIdx].phone = input.phone || "";
      save(STORAGE_KEYS.PROFILES, profiles);
    }
    return companies[idx].id;
  }
  throw new Error("수정할 기업 정보를 찾을 수 없습니다.");
}

// 기존 단일 business_plan 을 1차/2차 슬롯 구조로 정규화한다(new.md §10.2 마이그레이션).
//  - company.business_plans.{round1, round2} 가 표준 구조.
//  - 레거시 company.business_plan 은 round1 로 취급한다.
export function normalizeBusinessPlans(company) {
  if (!company) return { round1: null, round2: null };
  const plans = company.business_plans || {};
  const round1 = plans.round1 || (company.business_plan
    ? {
        original_filename: company.business_plan.original_filename,
        link_url: company.business_plan.link_url,
        uploaded_at: company.business_plan.uploaded_at || company.business_plan.updated_at || null,
        updated_at: company.business_plan.updated_at || company.business_plan.approved_at || null,
      }
    : null);
  return { round1: round1 || null, round2: plans.round2 || null };
}

// 창업자가 사업계획서 파일을 첨부/수정한다. round("round1"|"round2")별로 보관하며 최종 수정일자를 갱신한다.
// options.budget_submission_id 가 있으면 2차 사업계획서를 해당 예산 변경 제출 건에 연결한다(new.md §10.4/§11.4).
// 기존 호출 호환: round 인자가 없으면 "round1"로 처리한다.
export function mockUpdateBusinessPlan(companyId, round, file, options = {}) {
  // 레거시 시그니처 호환: mockUpdateBusinessPlan(companyId, fileObject)
  if (round && typeof round === "object") {
    file = round;
    round = "round1";
  }
  const slot = round === "round2" ? "round2" : "round1";

  const companies = load(STORAGE_KEYS.COMPANIES, []);
  const idx = companies.findIndex((c) => c.id === companyId);
  if (idx === -1) throw new Error("기업 정보를 찾을 수 없습니다.");

  const company = companies[idx];
  const normalized = normalizeBusinessPlans(company);
  const now = new Date().toISOString();
  const filename = file?.original_filename || file?.name || "사업계획서";
  const existing = normalized[slot];

  const nextEntry = {
    ...(existing || {}),
    original_filename: filename,
    link_url: file?.link_url || `storage:${filename}`,
    uploaded_at: existing?.uploaded_at || now,
    updated_at: now,
  };
  // 1차/2차 모두 첨부된 예산 제출 건에 연결한다. 노출(다운로드)은 해당 제출이 승인된 후에만 허용된다(new.md §10.4/§11.4).
  // 새 파일을 첨부했다면 새 제출 건 id로 갱신하고, 파일 교체 없이 호출되면 기존 연결을 유지한다.
  {
    const sid = options.budget_submission_id || file?.budget_submission_id || existing?.budget_submission_id || null;
    if (sid) nextEntry.budget_submission_id = sid;
  }

  const business_plans = { ...normalized, [slot]: nextEntry };
  company.business_plans = business_plans;
  // 레거시 필드도 round1 기준으로 동기화해 기존 화면(admin 등) 호환을 유지한다.
  if (slot === "round1") {
    company.business_plan = {
      ...(company.business_plan || {}),
      original_filename: nextEntry.original_filename,
      link_url: nextEntry.link_url,
      updated_at: nextEntry.updated_at,
    };
  }
  companies[idx] = company;
  save(STORAGE_KEYS.COMPANIES, companies);
  return business_plans;
}
