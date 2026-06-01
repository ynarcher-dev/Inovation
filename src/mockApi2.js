// Part 2 of the local Mock API implementation.
// Keeps code sizes below 500 lines per file.

import {
  STORAGE_KEYS,
  load,
  save,
  uuid,
  mockGetCurrentUser,
} from "./mockApi.js";
import { generateChecklist, generateWarnings } from "./rulesEngine.js";
import { postApprovalStages } from "./status.js";

// 지출 신청 → 비목 leaf id 매핑.
// 비목명(budget_category)은 관리자가 비목을 만들 때 비어 있을 수 있어(=null) 신뢰할 수 없으므로,
//  1순위: business_plan_item_id(= 배정 id)로 leaf를 찾고(안정 키),
//  2순위(시드/레거시 보조): budget_category 문자열로 leaf를 찾는다.
function resolveExpenseLeafIds(expenses, allocations, budgets) {
  const leafIdByAllocId = new Map(allocations.map((a) => [a.id, a.support_program_budget_id]));
  const leafIdByCategory = new Map();
  for (const b of budgets) {
    if (b.budget_category) leafIdByCategory.set(b.budget_category, b.id);
  }
  const map = new Map();
  for (const e of expenses) {
    let leafId = null;
    if (e.business_plan_item_id && leafIdByAllocId.has(e.business_plan_item_id)) {
      leafId = leafIdByAllocId.get(e.business_plan_item_id);
    } else if (e.budget_category && leafIdByCategory.has(e.budget_category)) {
      leafId = leafIdByCategory.get(e.budget_category);
    }
    map.set(e.id, leafId);
  }
  return map;
}

// 지출 신청의 비목 잔액 적합성을 계산한다(관리자 검토 보조).
function computeExpenseBudgetCheck(expense) {
  const budgets = load(STORAGE_KEYS.BUDGETS, []);
  const allocations = load(STORAGE_KEYS.ALLOCATIONS, []).filter((a) => a.company_id === expense.company_id);
  const expenses = load(STORAGE_KEYS.EXPENSES, []).filter((e) => e.company_id === expense.company_id);
  const allocById = new Map(allocations.map((a) => [a.support_program_budget_id, Number(a.allocated_amount || 0)]));
  const cat = expense.budget_category;
  // 동일 비목(leaf) 기준으로 배정/기집행을 집계한다. (비목명이 아닌 leaf id로 연결)
  const leafIdByExpense = resolveExpenseLeafIds([expense, ...expenses], allocations, budgets);
  const leafId = leafIdByExpense.get(expense.id);

  const allocated = leafId && allocById.has(leafId) ? allocById.get(leafId) : 0;

  const committedStatuses = [
    "pre_approval_submitted", "pre_approval_revision_requested", "pre_approved",
    "executing", "execution_submitted", "inspection_submitted", "settlement_submitted", "completed",
  ];
  let approvedOther = 0;
  let pendingOther = 0;
  for (const e of expenses) {
    if (e.id === expense.id) continue;
    if (!leafId || leafIdByExpense.get(e.id) !== leafId) continue;
    if (!committedStatuses.includes(e.status)) continue;
    const amt = Number(e.amount_supply || 0);
    if (["pre_approval_submitted", "pre_approval_revision_requested"].includes(e.status)) pendingOther += amt;
    else approvedOther += amt;
  }

  const requested = Number(expense.amount_supply || 0);
  const remainingBefore = allocated - approvedOther - pendingOther;
  return {
    budget_category: cat,
    allocated,
    approved_other: approvedOther,
    pending_other: pendingOther,
    remaining_before: remainingBefore,
    requested,
    remaining_after: remainingBefore - requested,
    exceeds: requested > remainingBefore,
  };
}

// 지출 행에 누락 서류 수/위험 경고 수를 부가한다(목록 표시용).
function decorateExpenseCounts(expense) {
  const checklist = generateChecklist(expense);
  const warnings = generateWarnings(expense);
  return {
    missing_count: checklist.filter((d) => d.required).length,
    warning_count: warnings.filter((w) => w.severity === "warning" || w.severity === "danger").length,
  };
}

// 검토 대기/보완 중인(아직 확정되지 않은) 예산 제출 상태
const PENDING_SUBMISSION_STATUSES = [
  "budget_submitted",
  "budget_revision_requested",
  "change_submitted",
  "change_revision_requested",
];

// 현재 진행 중인(검토 대기/보완) 예산 제출안과 그 항목을 반환한다. 없으면 null.
function getPendingSubmission(companyId) {
  const submissions = load(STORAGE_KEYS.BUDGET_SUBMISSIONS, []).filter((s) => s.company_id === companyId);
  const pending = submissions
    .filter((s) => PENDING_SUBMISSION_STATUSES.includes(s.status))
    .sort((a, b) => String(b.submitted_at || "").localeCompare(String(a.submitted_at || "")))[0];
  if (!pending) return null;
  const items = load(STORAGE_KEYS.BUDGET_SUBMISSION_ITEMS, []).filter((it) => it.budget_submission_id === pending.id);
  return { ...pending, items };
}

// 각 예산 제출안에 비목별 항목(이전/요청/승인 금액)과 비목명을 조인한다. — 히스토리 펼침 상세용
function attachSubmissionItems(submissions, budgets) {
  const allItems = load(STORAGE_KEYS.BUDGET_SUBMISSION_ITEMS, []);
  const budgetById = new Map(budgets.map((b) => [b.id, b]));
  return submissions.map((s) => ({
    ...s,
    items: allItems
      .filter((it) => it.budget_submission_id === s.id)
      .map((it) => {
        const node = budgetById.get(it.support_program_budget_id);
        return {
          ...it,
          title: node?.title || "(삭제된 비목)",
          budget_category: node?.budget_category || null,
        };
      }),
  }));
}

// 비목 트리를 leaf별 금액 맵으로 채워 단순 트리를 구성한다(읽기 전용 미리보기용).
// expenses를 넘기면 leaf별로 승인/검토중 금액을 실제 지출 내역에서 집계해 반영한다.
function buildBudgetTreeWithAmounts(programBudgets, amountByBudgetId, expenses = [], leafIdByExpense = new Map()) {
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
      allocated = amountByBudgetId.get(node.id) ?? 0;
      const related = expenses.filter((e) => leafIdByExpense.get(e.id) === node.id);
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
      // 잔액 = 배정금액(A) - 승인금액(B) - 검토중(C). 검토중인 신청도 약정으로 보고 미리 차감한다.
      remaining_amount: allocated - approved - pending,
    };
  };
  return (childrenByParent.get(null) || []).map(decorate);
}

// 비목별로 이미 사용(승인/제출)된 금액을 집계한다. 예산 감액 하한 계산용.
function computeCommittedByBudgetId(companyId) {
  const budgets = load(STORAGE_KEYS.BUDGETS, []);
  const allocations = load(STORAGE_KEYS.ALLOCATIONS, []).filter((a) => a.company_id === companyId);
  const expenses = load(STORAGE_KEYS.EXPENSES, []).filter((e) => e.company_id === companyId);
  const committedStatuses = [
    "pre_approval_submitted", "pre_approval_revision_requested", "pre_approved",
    "executing", "execution_submitted", "inspection_submitted", "settlement_submitted", "completed",
  ];
  const leafIdByExpense = resolveExpenseLeafIds(expenses, allocations, budgets);
  const map = new Map();
  for (const e of expenses) {
    if (!committedStatuses.includes(e.status)) continue;
    const leafId = leafIdByExpense.get(e.id);
    if (!leafId) continue;
    map.set(leafId, (map.get(leafId) || 0) + Number(e.amount_supply || 0));
  }
  return map;
}

// Helper to calculate budget summary
function calculateBudgetSummary(allocations, budgets, companyId, expenses) {
  const budgetById = new Map(budgets.map((b) => [b.id, b]));
  // 비목 노드에서 부모를 거슬러 올라가 관리자가 설정한 단계(뎁스) 경로를 만든다.
  const pathOf = (node) => {
    const titles = [];
    const seen = new Set();
    let cur = node;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      titles.unshift(cur.title);
      cur = cur.parent_id ? budgetById.get(cur.parent_id) : null;
    }
    return titles;
  };
  const companyAllocs = allocations.filter((a) => a.company_id === companyId);
  const companyExpenses = expenses.filter((e) => e.company_id === companyId);
  const leafIdByExpense = resolveExpenseLeafIds(companyExpenses, companyAllocs, budgets);
  return companyAllocs.map((alloc) => {
    const budgetNode = budgets.find((b) => b.id === alloc.support_program_budget_id);
    if (!budgetNode) return null;
    const related = companyExpenses.filter((e) => leafIdByExpense.get(e.id) === budgetNode.id);
    const approvedAmount = related
      .filter((e) => ["pre_approved", "executing", "execution_submitted", "inspection_submitted", "settlement_submitted", "completed"].includes(e.status))
      .reduce((sum, e) => sum + Number(e.amount_supply || 0), 0);
    const pendingAmount = related
      .filter((e) => ["pre_approval_submitted", "pre_approval_revision_requested"].includes(e.status))
      .reduce((sum, e) => sum + Number(e.amount_supply || 0), 0);

    return {
      id: alloc.id,
      support_program_budget_id: budgetNode.id,
      title: budgetNode.title,
      path: pathOf(budgetNode),
      budget_category: budgetNode.budget_category,
      allocated_amount: Number(alloc.allocated_amount || 0),
      approved_amount: approvedAmount,
      pending_amount: pendingAmount,
      remaining_amount: Number(alloc.allocated_amount || 0) - approvedAmount - pendingAmount,
    };
  }).filter(Boolean);
}

// ----------------------------------------------------
// Mock Guidance / Instruction Functions
// ----------------------------------------------------
export function mockGetGuidanceItems(programId) {
  const items = load(STORAGE_KEYS.GUIDANCE, []);
  if (programId) return items.filter((i) => i.support_program_id === programId && i.active !== false);
  return items.filter((i) => !i.support_program_id && i.active !== false);
}

export function mockCreateGuidanceItem(input, adminUserId) {
  const items = load(STORAGE_KEYS.GUIDANCE, []);
  const newItem = {
    id: uuid(),
    title: input.title,
    content: input.content || null,
    link_url: input.link_url || null,
    sort_order: Number(input.sort_order || 0),
    active: true,
    support_program_id: input.support_program_id || null,
    created_by: adminUserId,
    created_at: new Date().toISOString(),
  };
  items.push(newItem);
  save(STORAGE_KEYS.GUIDANCE, items);
  return newItem;
}

export function mockUpdateGuidanceItem(id, input) {
  const items = load(STORAGE_KEYS.GUIDANCE, []);
  const idx = items.findIndex((i) => i.id === id);
  if (idx !== -1) {
    items[idx] = { ...items[idx], ...input };
    save(STORAGE_KEYS.GUIDANCE, items);
    return items[idx];
  }
  throw new Error("안내 항목을 찾을 수 없습니다.");
}

export function mockDeleteGuidanceItem(id) {
  let items = load(STORAGE_KEYS.GUIDANCE, []);
  items = items.filter((i) => i.id !== id);
  save(STORAGE_KEYS.GUIDANCE, items);
  return { ok: true };
}

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
  };

  const expenses = load(STORAGE_KEYS.EXPENSES, []).filter((e) => e.company_id === company.id);
  const guidanceItems = mockGetGuidanceItems(company.support_program_id);
  const budgets = load(STORAGE_KEYS.BUDGETS, []).filter((b) => b.support_program_id === company.support_program_id);
  const allocations = load(STORAGE_KEYS.ALLOCATIONS, []).filter((a) => a.company_id === company.id);
  
  // Calculate budget tree
  const childrenByParent = new Map();
  for (const item of budgets) {
    const key = item.parent_id || null;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(item);
  }
  const allocByBudgetId = new Map(allocations.map((a) => [a.support_program_budget_id, Number(a.allocated_amount || 0)]));
  const leafIdByExpense = resolveExpenseLeafIds(expenses, allocations, budgets);

  const decorate = (node) => {
    const children = (childrenByParent.get(node.id) || []).map(decorate);
    const isLeaf = children.length === 0;
    let allocated = 0;
    let approved = 0;
    let pending = 0;
    if (isLeaf) {
      allocated = allocByBudgetId.get(node.id) ?? 0;
      const related = expenses.filter((e) => leafIdByExpense.get(e.id) === node.id);
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
      // 잔액 = 배정금액(A) - 승인금액(B) - 검토중(C). 검토중인 신청도 약정으로 보고 미리 차감한다.
      remaining_amount: allocated - approved - pending,
    };
  };

  const budgetTree = (childrenByParent.get(null) || []).map(decorate);
  const reviewHistory = load(STORAGE_KEYS.REVIEWS, []).filter((r) =>
    r.expense_request_id === "budget-" + company.id || expenses.some((e) => e.id === r.expense_request_id)
  );

  // 검토 대기/보완 중인 예산 제출안(읽기 전용 미리보기용)
  const pendingSubmission = getPendingSubmission(company.id);
  let pendingBudgetTree = null;
  if (pendingSubmission) {
    const requestedByBudgetId = new Map(
      pendingSubmission.items.map((it) => [it.support_program_budget_id, Number(it.requested_allocated_amount || 0)])
    );
    pendingBudgetTree = buildBudgetTreeWithAmounts(budgets, requestedByBudgetId, expenses, leafIdByExpense);
  }
  const budgetSubmissions = attachSubmissionItems(
    load(STORAGE_KEYS.BUDGET_SUBMISSIONS, [])
      .filter((s) => s.company_id === company.id)
      .sort((a, b) => String(b.submitted_at || "").localeCompare(String(a.submitted_at || ""))),
    budgets
  );

  return {
    company: companyWithProgram,
    expenses: expenses || [],
    budgetSummary: calculateBudgetSummary(allocations, budgets, company.id, expenses),
    budgetTree,
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

// 창업자가 예산안(또는 변경안)을 제출한다.
// 핵심 원칙(new.md 2.3/2.4/5장):
//  - 확정 예산(company_budget_allocations)은 관리자 승인 시점에만 갱신한다. 제출만으로는 바꾸지 않는다.
//  - 가입 승인 상태(approval_status)는 절대 건드리지 않는다(상태 분리).
//  - 제출 내용은 budget_submissions / budget_submission_items 에 보존한다.
export function mockSubmitFounderBudgetAllocations(companyId, inputAllocations, reason) {
  const companies = load(STORAGE_KEYS.COMPANIES, []);
  const cIdx = companies.findIndex((c) => c.id === companyId);
  if (cIdx === -1) throw new Error("기업을 찾을 수 없습니다.");
  const company = companies[cIdx];

  // 현재 확정 예산 — 변경 요청 여부 판단 및 previous_allocated_amount 계산용
  const approvedAllocations = load(STORAGE_KEYS.ALLOCATIONS, []).filter((a) => a.company_id === companyId);
  const approvedByBudgetId = new Map(approvedAllocations.map((a) => [a.support_program_budget_id, Number(a.allocated_amount || 0)]));

  // 감액 하한 검증: 이미 사용(승인/제출)된 금액보다 낮게 줄일 수 없다.
  const committed = computeCommittedByBudgetId(companyId);
  const violation = inputAllocations.find((a) => Number(a.allocated_amount || 0) < (committed.get(a.support_program_budget_id) || 0));
  if (violation) {
    const floor = committed.get(violation.support_program_budget_id) || 0;
    throw new Error(`이미 사용(승인/제출)된 금액(${floor.toLocaleString()}원)보다 낮게 예산을 줄일 수 없습니다.`);
  }

  // 최초 예산이 한 번이라도 승인된 적이 있으면 이번 제출은 '변경 요청'이다.
  const hasApprovedHistory = ["budget_approved", "change_submitted", "change_revision_requested", "change_approved", "change_rejected"].includes(company.budget_status);
  const type = hasApprovedHistory ? "change" : "initial";
  const newStatus = hasApprovedHistory ? "change_submitted" : "budget_submitted";

  const user = mockGetCurrentUser();
  const now = new Date().toISOString();

  // 진행 중이던 이전 제출은 새 제출로 대체한다(검토 대기 중복 방지).
  let submissions = load(STORAGE_KEYS.BUDGET_SUBMISSIONS, []);
  let items = load(STORAGE_KEYS.BUDGET_SUBMISSION_ITEMS, []);
  const supersededIds = submissions
    .filter((s) => s.company_id === companyId && PENDING_SUBMISSION_STATUSES.includes(s.status))
    .map((s) => s.id);
  if (supersededIds.length) {
    submissions = submissions.filter((s) => !supersededIds.includes(s.id));
    items = items.filter((it) => !supersededIds.includes(it.budget_submission_id));
  }

  const submissionId = uuid();
  submissions.push({
    id: submissionId,
    company_id: companyId,
    type,
    status: newStatus,
    reason: reason || (type === "change" ? "예산 변경 요청" : "최초 예산안 제출"),
    submitted_by: user?.id || null,
    submitted_at: now,
    reviewed_by: null,
    reviewed_at: null,
    review_comment: null,
    created_at: now,
  });

  inputAllocations.forEach((item) => {
    items.push({
      id: uuid(),
      budget_submission_id: submissionId,
      support_program_budget_id: item.support_program_budget_id,
      previous_allocated_amount: approvedByBudgetId.get(item.support_program_budget_id) ?? 0,
      requested_allocated_amount: Number(item.allocated_amount || 0),
      approved_allocated_amount: null,
    });
  });

  save(STORAGE_KEYS.BUDGET_SUBMISSIONS, submissions);
  save(STORAGE_KEYS.BUDGET_SUBMISSION_ITEMS, items);

  // 예산 상태만 갱신. 확정 예산(allocations)과 가입 승인 상태(approval_status)는 그대로 둔다.
  companies[cIdx].budget_status = newStatus;
  save(STORAGE_KEYS.COMPANIES, companies);

  return { submissionId, status: newStatus, type };
}

// ----------------------------------------------------
// Mock Admin Dashboard Functions
// ----------------------------------------------------
export function mockGetAdminDashboard() {
  const companies = load(STORAGE_KEYS.COMPANIES, []);
  const expenses = load(STORAGE_KEYS.EXPENSES, []);
  const programs = load(STORAGE_KEYS.PROGRAMS, []);
  const budgets = load(STORAGE_KEYS.BUDGETS, []);
  const allocations = load(STORAGE_KEYS.ALLOCATIONS, []);

  const mappedCompanies = companies.map((c) => {
    const prog = programs.find((p) => p.id === c.support_program_id);
    const companyExpenses = expenses.filter((e) => e.company_id === c.id);
    return {
      ...c,
      support_programs: prog ? { name: prog.name } : null,
      budgetSummary: calculateBudgetSummary(allocations, budgets, c.id, companyExpenses),
      pendingBudgetSubmission: getPendingSubmission(c.id),
      expense_count: companyExpenses.length,
    };
  });

  const totalSupportAmount = mappedCompanies.reduce((s, c) => s + Number(c.support_total_amount || 0), 0);
  const totalApprovedAmount = expenses
    .filter((e) => ["pre_approved", "executing", "execution_submitted", "inspection_submitted", "settlement_submitted", "completed"].includes(e.status))
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
    supportPrograms: programs.filter((p) => p.active !== false),
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

  const programs = load(STORAGE_KEYS.PROGRAMS, []);
  const program = programs.find((p) => p.id === company.support_program_id);
  const companyWithProgram = {
    ...company,
    support_programs: program ? { id: program.id, name: program.name, level_labels: program.level_labels } : null,
  };

  const expenses = load(STORAGE_KEYS.EXPENSES, []).filter((e) => e.company_id === companyId);
  const guidanceItems = mockGetGuidanceItems(company.support_program_id);
  const budgets = load(STORAGE_KEYS.BUDGETS, []).filter((b) => b.support_program_id === company.support_program_id);
  const allocations = load(STORAGE_KEYS.ALLOCATIONS, []).filter((a) => a.company_id === companyId);

  // Calculate budget tree
  const childrenByParent = new Map();
  for (const item of budgets) {
    const key = item.parent_id || null;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(item);
  }
  const allocByBudgetId = new Map(allocations.map((a) => [a.support_program_budget_id, Number(a.allocated_amount || 0)]));
  const leafIdByExpense = resolveExpenseLeafIds(expenses, allocations, budgets);

  const decorate = (node) => {
    const children = (childrenByParent.get(node.id) || []).map(decorate);
    const isLeaf = children.length === 0;
    let allocated = 0;
    let approved = 0;
    let pending = 0;
    if (isLeaf) {
      allocated = allocByBudgetId.get(node.id) ?? 0;
      const related = expenses.filter((e) => leafIdByExpense.get(e.id) === node.id);
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
      // 잔액 = 배정금액(A) - 승인금액(B) - 검토중(C). 검토중인 신청도 약정으로 보고 미리 차감한다.
      remaining_amount: allocated - approved - pending,
    };
  };

  const budgetTree = (childrenByParent.get(null) || []).map(decorate);
  const reviewHistory = load(STORAGE_KEYS.REVIEWS, []).filter((r) =>
    r.expense_request_id === "budget-" + companyId || expenses.some((e) => e.id === r.expense_request_id)
  );

  // 비목별 이미 커밋된(승인+검토중) 지출 금액 — 감액 하한 계산용
  const committedMap = computeCommittedByBudgetId(companyId);
  const committedByBudgetId = Object.fromEntries(committedMap);

  // 검토 대기/보완 중인 예산 제출안 + 전체 제출 이력
  const pendingSubmission = getPendingSubmission(companyId);
  let pendingBudgetTree = null;
  if (pendingSubmission) {
    // 제출자 이름 조인
    const users = load(STORAGE_KEYS.USERS, []);
    const submitter = users.find((u) => u.id === pendingSubmission.submitted_by);
    pendingSubmission.submitted_by_name =
      submitter?.raw_user_meta_data?.name || company.representative_name || "-";
    const requestedByBudgetId = new Map(
      pendingSubmission.items.map((it) => [it.support_program_budget_id, Number(it.requested_allocated_amount || 0)])
    );
    pendingBudgetTree = buildBudgetTreeWithAmounts(budgets, requestedByBudgetId, expenses, leafIdByExpense);
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
  const decoratedExpenses = (expenses || []).map((e) => {
    const required = generateChecklist(e).filter((d) => d.required);
    const uploaded = uploadedTypesByExpense.get(e.id) || new Set();
    const submitted = required.filter((d) => uploaded.has(d.document_type)).length;
    const warns = generateWarnings(e);
    return {
      ...e,
      doc_required: required.length,
      doc_submitted: submitted,
      warning_count: warns.filter((w) => w.severity === "warning" || w.severity === "danger").length,
    };
  });

  return {
    company: companyWithProgram,
    budgetSummary: calculateBudgetSummary(allocations, budgets, companyId, expenses),
    budgetTree,
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
    companies[idx].approval_status = "rejected";
    companies[idx].approved_at = null;
    companies[idx].approved_by = null;
    save(STORAGE_KEYS.COMPANIES, companies);
    return companies[idx];
  }
  throw new Error("기업을 찾을 수 없습니다.");
}

// 관리자: 예산 제출안 검토(승인/보완요청/반려).
// 승인된 경우에만 확정 예산(company_budget_allocations)을 갱신한다(new.md 2.3/5장 원칙).
export function mockReviewBudgetSubmission(submissionId, decision, comment, reviewerId) {
  const statusMap = {
    initial: { approved: "budget_approved", rejected: "budget_rejected", revision_requested: "budget_revision_requested" },
    change: { approved: "change_approved", rejected: "change_rejected", revision_requested: "change_revision_requested" },
  };
  if (!["approved", "rejected", "revision_requested"].includes(decision)) {
    throw new Error("지원하지 않는 검토 결과입니다.");
  }
  if (decision !== "approved" && !String(comment || "").trim()) {
    throw new Error("보완 요청 또는 반려 시에는 심사 의견을 입력해야 합니다.");
  }

  const submissions = load(STORAGE_KEYS.BUDGET_SUBMISSIONS, []);
  const sIdx = submissions.findIndex((s) => s.id === submissionId);
  if (sIdx === -1) throw new Error("예산 제출안을 찾을 수 없습니다.");
  const submission = submissions[sIdx];
  if (!PENDING_SUBMISSION_STATUSES.includes(submission.status)) {
    throw new Error("이미 처리된 예산 제출안입니다.");
  }
  const type = submission.type === "change" ? "change" : "initial";
  const newStatus = statusMap[type][decision];
  const now = new Date().toISOString();

  // §10.6 승인 직전 재검증: 요청 배정액이 이미 커밋된(승인+검토중) 지출 금액보다 낮게 감액되면 승인 차단
  if (decision === "approved") {
    const committed = computeCommittedByBudgetId(submission.company_id);
    const budgets = load(STORAGE_KEYS.BUDGETS, []);
    const titleById = new Map(budgets.map((b) => [b.id, b.title]));
    const subItems = load(STORAGE_KEYS.BUDGET_SUBMISSION_ITEMS, []).filter((it) => it.budget_submission_id === submissionId);
    const violations = subItems
      .filter((it) => Number(it.requested_allocated_amount || 0) < (committed.get(it.support_program_budget_id) || 0))
      .map((it) => {
        const used = committed.get(it.support_program_budget_id) || 0;
        const req = Number(it.requested_allocated_amount || 0);
        return `· ${titleById.get(it.support_program_budget_id) || "비목"}: 요청 ${req.toLocaleString()}원 < 집행/검토중 ${used.toLocaleString()}원`;
      });
    if (violations.length) {
      throw new Error(`이미 집행(승인/검토중)된 금액보다 낮게 감액할 수 없습니다.\n${violations.join("\n")}`);
    }
  }

  submission.status = newStatus;
  submission.reviewed_by = reviewerId || null;
  submission.reviewed_at = now;
  submission.review_comment = String(comment || "").trim() || null;
  submissions[sIdx] = submission;
  save(STORAGE_KEYS.BUDGET_SUBMISSIONS, submissions);

  const companies = load(STORAGE_KEYS.COMPANIES, []);
  const cIdx = companies.findIndex((c) => c.id === submission.company_id);
  if (cIdx !== -1) companies[cIdx].budget_status = newStatus;

  let items = load(STORAGE_KEYS.BUDGET_SUBMISSION_ITEMS, []);

  if (decision === "approved") {
    const subItems = items.filter((it) => it.budget_submission_id === submissionId);
    // approved_allocated_amount = requested_allocated_amount 로 확정
    items = items.map((it) =>
      it.budget_submission_id === submissionId
        ? { ...it, approved_allocated_amount: Number(it.requested_allocated_amount || 0) }
        : it
    );
    save(STORAGE_KEYS.BUDGET_SUBMISSION_ITEMS, items);

    // 확정 예산 반영: 이번 제출에 포함된 비목만 승인액으로 갱신, 나머지는 유지
    let allocations = load(STORAGE_KEYS.ALLOCATIONS, []);
    const companyAllocs = allocations.filter((a) => a.company_id === submission.company_id);
    const allocByBudget = new Map(companyAllocs.map((a) => [a.support_program_budget_id, a]));
    subItems.forEach((it) => {
      const existing = allocByBudget.get(it.support_program_budget_id);
      const amount = Number(it.requested_allocated_amount || 0);
      if (existing) {
        existing.allocated_amount = amount;
      } else {
        const created = {
          id: uuid(),
          company_id: submission.company_id,
          support_program_budget_id: it.support_program_budget_id,
          allocated_amount: amount,
        };
        companyAllocs.push(created);
        allocByBudget.set(it.support_program_budget_id, created);
      }
    });
    allocations = allocations.filter((a) => a.company_id !== submission.company_id).concat(companyAllocs);
    save(STORAGE_KEYS.ALLOCATIONS, allocations);

    if (cIdx !== -1) {
      companies[cIdx].support_total_amount = companyAllocs.reduce((s, a) => s + Number(a.allocated_amount || 0), 0);
    }
  }

  if (cIdx !== -1) save(STORAGE_KEYS.COMPANIES, companies);

  // 통합 심사 이력 위젯 호환: 예산 검토도 reviews 에 기록(expense_request_id = "budget-"+companyId)
  const reviews = load(STORAGE_KEYS.REVIEWS, []);
  reviews.push({
    id: uuid(),
    expense_request_id: "budget-" + submission.company_id,
    reviewer_id: reviewerId || null,
    decision,
    comment: String(comment || "").trim() || (decision === "approved" ? "예산안을 승인합니다." : ""),
    created_at: now,
  });
  save(STORAGE_KEYS.REVIEWS, reviews);

  return { status: newStatus };
}

// 관리자가 확정 예산을 직접 수정(override). 확정 예산과 총 지원금을 함께 갱신한다.
export function mockUpsertCompanyBudgetAllocation(companyId, budgetId, amount) {
  const allocations = load(STORAGE_KEYS.ALLOCATIONS, []);
  const idx = allocations.findIndex((a) => a.company_id === companyId && a.support_program_budget_id === budgetId);
  if (idx !== -1) {
    allocations[idx].allocated_amount = Number(amount || 0);
  } else {
    allocations.push({
      id: uuid(),
      company_id: companyId,
      support_program_budget_id: budgetId,
      allocated_amount: Number(amount || 0),
    });
  }
  save(STORAGE_KEYS.ALLOCATIONS, allocations);

  const companies = load(STORAGE_KEYS.COMPANIES, []);
  const cIdx = companies.findIndex((c) => c.id === companyId);
  if (cIdx !== -1) {
    companies[cIdx].support_total_amount = allocations
      .filter((a) => a.company_id === companyId)
      .reduce((s, a) => s + Number(a.allocated_amount || 0), 0);
    save(STORAGE_KEYS.COMPANIES, companies);
  }
  return { ok: true };
}

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

// 지출 신청의 business_plan_item_id(=기업 예산 배정 id)를 비목 단계 경로 문자열로 해석한다.
// 매핑이 끊겨 있으면 비목명으로, 그것도 없으면 "-"로 폴백한다.
function resolveBusinessPlanItemLabel(expense) {
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

export function mockGetExpenseDetail(id) {
  const expenses = load(STORAGE_KEYS.EXPENSES, []);
  const expense = expenses.find((e) => e.id === id);
  if (!expense) throw new Error("지출 신청을 찾을 수 없습니다.");

  const companies = load(STORAGE_KEYS.COMPANIES, []);
  const comp = companies.find((c) => c.id === expense.company_id);

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
    // '제출 전'(draft) 단계 없이 작성 즉시 사전승인 제출(검토 중) 상태로 생성한다.
    status: "pre_approval_submitted",
    expected_completion_date: input.expected_completion_date || null,
    created_at: new Date().toISOString(),
    submitted_at: new Date().toISOString(),
  };
  expenses.push(newExpense);
  save(STORAGE_KEYS.EXPENSES, expenses);
  return newExpense;
}

export function mockSubmitExpenseRequest(id) {
  const expenses = load(STORAGE_KEYS.EXPENSES, []);
  const idx = expenses.findIndex((e) => e.id === id);
  if (idx !== -1) {
    expenses[idx].status = "pre_approval_submitted";
    expenses[idx].submitted_at = new Date().toISOString();
    save(STORAGE_KEYS.EXPENSES, expenses);
    return expenses[idx];
  }
  throw new Error("지출 신청을 찾을 수 없습니다.");
}

export function mockReviewExpenseRequest(id, decision, comment, reviewerId) {
  const statusMap = {
    approved: "pre_approved",
    rejected: "rejected",
    revision_requested: "pre_approval_revision_requested",
  };
  if (!statusMap[decision]) throw new Error("지원하지 않는 검토 결과입니다.");

  const expenses = load(STORAGE_KEYS.EXPENSES, []);
  const idx = expenses.findIndex((e) => e.id === id);
  if (idx === -1) throw new Error("지출 신청을 찾을 수 없습니다.");

  expenses[idx].status = statusMap[decision];
  expenses[idx].approved_at = decision === "approved" ? new Date().toISOString() : null;
  save(STORAGE_KEYS.EXPENSES, expenses);

  const reviews = load(STORAGE_KEYS.REVIEWS, []);
  reviews.push({
    id: uuid(),
    expense_request_id: id,
    reviewer_id: reviewerId,
    decision,
    comment,
    created_at: new Date().toISOString(),
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

// 사전승인 이후 집행/검수/정산/완료 단계 전이.
export function mockAdvanceExpenseStage(expenseId, expectedFrom) {
  const expenses = load(STORAGE_KEYS.EXPENSES, []);
  const idx = expenses.findIndex((e) => e.id === expenseId);
  if (idx === -1) throw new Error("지출 신청을 찾을 수 없습니다.");
  const current = expenses[idx].status;
  const next = postApprovalStages[current];
  if (!next) throw new Error("다음 단계로 진행할 수 없는 상태입니다.");
  if (expectedFrom && expectedFrom !== current) {
    throw new Error("상태가 변경되었습니다. 새로고침 후 다시 시도하세요.");
  }
  const now = new Date().toISOString();
  expenses[idx].status = next.to;
  expenses[idx].updated_at = now;
  if (next.to === "completed") expenses[idx].completed_at = now;
  save(STORAGE_KEYS.EXPENSES, expenses);
  return expenses[idx];
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

// 창업자가 사업계획서 파일을 첨부/수정한다. 최종 수정일자(updated_at)를 갱신한다.
export function mockUpdateBusinessPlan(companyId, file) {
  const companies = load(STORAGE_KEYS.COMPANIES, []);
  const idx = companies.findIndex((c) => c.id === companyId);
  if (idx === -1) throw new Error("기업 정보를 찾을 수 없습니다.");
  const filename = file?.original_filename || file?.name || "사업계획서";
  companies[idx].business_plan = {
    ...(companies[idx].business_plan || {}),
    original_filename: filename,
    link_url: file?.link_url || `storage:${filename}`,
    updated_at: new Date().toISOString(),
  };
  save(STORAGE_KEYS.COMPANIES, companies);
  return companies[idx].business_plan;
}
