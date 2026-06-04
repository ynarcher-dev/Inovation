// Mock 지원사업/예산 비목 CRUD. (mockCalculate/BuildBudgetTree 는 현재 미사용이나 동작 보존 위해 유지)
import { STORAGE_KEYS, load, save, uuid } from "./storage.mock.js";
import { mockGetCurrentAdminProgramScope } from "./admin-account.mock.js";

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
      .filter((e) => ["pre_approved", "final_approval_submitted", "final_approval_revision", "final_approved"].includes(e.status))
      .reduce((sum, e) => sum + Number(e.amount_supply || 0), 0);
    const pendingAmount = related
      .filter((e) => ["pre_approval_submitted", "pre_approval_revision"].includes(e.status))
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
        .filter((e) => ["pre_approved", "final_approval_submitted", "final_approval_revision", "final_approved"].includes(e.status))
        .reduce((sum, e) => sum + Number(e.amount_supply || 0), 0);
      pending = related
        .filter((e) => ["pre_approval_submitted", "pre_approval_revision"].includes(e.status))
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
  const active = load(STORAGE_KEYS.PROGRAMS, []).filter((p) => p.active !== false);
  // 일반관리자는 배정된 사업만, 슈퍼관리자/비관리자는 전체를 본다.
  const scope = mockGetCurrentAdminProgramScope();
  return scope === null ? active : active.filter((p) => scope.includes(p.id));
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

  // 일반관리자가 만든 사업은 본인 권한에 자동 배정해, 생성 직후 목록에서 사라지지 않도록 한다.
  if (adminUserId) {
    const profiles = load(STORAGE_KEYS.PROFILES, []);
    const idx = profiles.findIndex((p) => p.user_id === adminUserId);
    if (idx !== -1 && profiles[idx].role === "admin") {
      const ids = new Set(profiles[idx].program_ids || []);
      ids.add(newProgram.id);
      profiles[idx].program_ids = [...ids];
      save(STORAGE_KEYS.PROFILES, profiles);
    }
  }
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
