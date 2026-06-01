// Part 2 of the local Mock API implementation.
// Keeps code sizes below 500 lines per file.

import {
  STORAGE_KEYS,
  load,
  save,
  uuid,
  mockGetCurrentUser,
} from "./mockApi.js";

// Helper to calculate budget summary
function calculateBudgetSummary(allocations, budgets, companyId, expenses) {
  const companyAllocs = allocations.filter((a) => a.company_id === companyId);
  return companyAllocs.map((alloc) => {
    const budgetNode = budgets.find((b) => b.id === alloc.support_program_budget_id);
    if (!budgetNode) return null;
    const related = expenses.filter((e) => e.company_id === companyId && e.budget_category === budgetNode.budget_category);
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
    support_programs: program ? { name: program.name } : null,
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

  const budgetTree = (childrenByParent.get(null) || []).map(decorate);
  const reviewHistory = load(STORAGE_KEYS.REVIEWS, []).filter((r) => 
    r.expense_request_id === "budget-" + company.id || expenses.some((e) => e.id === r.expense_request_id)
  );

  return {
    company: companyWithProgram,
    expenses: expenses || [],
    budgetSummary: calculateBudgetSummary(allocations, budgets, company.id, expenses),
    budgetTree,
    programBudgets: budgets,
    allocations,
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

export function mockSubmitFounderBudgetAllocations(companyId, inputAllocations) {
  let allocations = load(STORAGE_KEYS.ALLOCATIONS, []);
  // Delete existing allocations for company
  allocations = allocations.filter((a) => a.company_id !== companyId);

  // Add new
  inputAllocations.forEach((item) => {
    allocations.push({
      id: uuid(),
      company_id: companyId,
      support_program_budget_id: item.support_program_budget_id,
      allocated_amount: Number(item.allocated_amount || 0),
    });
  });
  save(STORAGE_KEYS.ALLOCATIONS, allocations);

  // Recalculate support_total_amount in company
  const companies = load(STORAGE_KEYS.COMPANIES, []);
  const idx = companies.findIndex((c) => c.id === companyId);
  if (idx !== -1) {
    const sum = inputAllocations.reduce((s, i) => s + Number(i.allocated_amount || 0), 0);
    companies[idx].support_total_amount = sum;
    companies[idx].approval_status = "pending"; // Request approval again on budget update
    save(STORAGE_KEYS.COMPANIES, companies);
  }
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
      expense_count: companyExpenses.length,
    };
  });

  const totalSupportAmount = mappedCompanies.reduce((s, c) => s + Number(c.support_total_amount || 0), 0);
  const totalApprovedAmount = expenses
    .filter((e) => ["pre_approved", "executing", "execution_submitted", "inspection_submitted", "settlement_submitted", "completed"].includes(e.status))
    .reduce((s, e) => s + Number(e.amount_supply || 0), 0);

  return {
    companyCount: companies.length,
    companies: mappedCompanies,
    totalSupportAmount,
    totalApprovedAmount,
    totalIssueCount: 0,
    supportPrograms: programs.filter((p) => p.active !== false),
    expenses: expenses.map((e) => {
      const comp = companies.find((c) => c.id === e.company_id);
      return {
        ...e,
        company_name: comp ? comp.name : "-",
        representative_name: comp ? comp.representative_name : "-",
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

  const budgetTree = (childrenByParent.get(null) || []).map(decorate);
  const reviewHistory = load(STORAGE_KEYS.REVIEWS, []).filter((r) => 
    r.expense_request_id === "budget-" + companyId || expenses.some((e) => e.id === r.expense_request_id)
  );

  return {
    company: companyWithProgram,
    budgetSummary: calculateBudgetSummary(allocations, budgets, companyId, expenses),
    budgetTree,
    programBudgets: budgets,
    expenses: expenses || [],
    reviewHistory: reviewHistory.map((r) => {
      if (r.expense_request_id?.startsWith("budget-")) {
        return { ...r, title: "예산 및 비목 배정안" };
      }
      const exp = expenses.find((e) => e.id === r.expense_request_id);
      return { ...r, title: exp ? exp.title : "-" };
    }),
  };
}

export function mockApproveCompany(companyId, adminUserId) {
  const companies = load(STORAGE_KEYS.COMPANIES, []);
  const idx = companies.findIndex((c) => c.id === companyId);
  if (idx !== -1) {
    companies[idx].approval_status = "approved";
    companies[idx].approved_at = new Date().toISOString();
    companies[idx].approved_by = adminUserId;
    save(STORAGE_KEYS.COMPANIES, companies);

    // Clone program budgets structure as company budget allocations with 0 amount
    const company = companies[idx];
    if (company.support_program_id) {
      const budgets = load(STORAGE_KEYS.BUDGETS, []);
      const programBudgets = budgets.filter((b) => b.support_program_id === company.support_program_id);
      
      const allocations = load(STORAGE_KEYS.ALLOCATIONS, []);
      const filteredAllocations = allocations.filter((a) => a.company_id !== companyId);
      
      programBudgets.forEach((pb) => {
        filteredAllocations.push({
          id: uuid(),
          company_id: companyId,
          support_program_budget_id: pb.id,
          allocated_amount: 0,
        });
      });
      save(STORAGE_KEYS.ALLOCATIONS, filteredAllocations);
    }

    return companies[idx];
  }
  throw new Error("기업을 찾을 수 없습니다.");
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

export function mockGetExpenseDetail(id) {
  const expenses = load(STORAGE_KEYS.EXPENSES, []);
  const expense = expenses.find((e) => e.id === id);
  if (!expense) throw new Error("지출 신청을 찾을 수 없습니다.");

  const companies = load(STORAGE_KEYS.COMPANIES, []);
  const comp = companies.find((c) => c.id === expense.company_id);

  const reviews = load(STORAGE_KEYS.REVIEWS, []).filter((r) => r.expense_request_id === id);

  return {
    expense: {
      ...expense,
      company_name: comp ? comp.name : "-",
      representative_name: comp ? comp.representative_name : "-",
    },
    documents: [], // Mock: documents checklist can be empty or dynamically filled
    files: [],
    reviews: reviews || [],
  };
}

export function mockCreateExpense(input, user) {
  const expenses = load(STORAGE_KEYS.EXPENSES, []);
  const newExpense = {
    id: uuid(),
    company_id: input.company_id,
    founder_id: user.id,
    business_plan_item_id: null,
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
    status: "draft",
    expected_completion_date: input.expected_completion_date || null,
    created_at: new Date().toISOString(),
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
