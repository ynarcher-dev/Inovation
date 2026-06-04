// Mock 공유 헬퍼: 예산 트리/잔액/제출 이력 계산 등 도메인 모듈이 공유하는 순수 보조 함수.
import { STORAGE_KEYS, load } from "./storage.mock.js";
import { BUDGET_APPROVED_STATUSES, BUDGET_PENDING_STATUSES, COMMITTED_STATUSES } from "../../domains/status.js";
import { generateChecklist, generateWarnings } from "../../domains/expense/rules-engine.js";

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

  let approvedOther = 0;
  let pendingOther = 0;
  for (const e of expenses) {
    if (e.id === expense.id) continue;
    if (!leafId || leafIdByExpense.get(e.id) !== leafId) continue;
    if (!COMMITTED_STATUSES.includes(e.status)) continue;
    const amt = Number(e.amount_supply || 0);
    if (BUDGET_PENDING_STATUSES.includes(e.status)) pendingOther += amt;
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

// 확정 예산(allocations)에서 비목 leaf별 1차/2차/총(승인) 배정 맵을 만든다(new.md §10.5).
//  - round1 : 1차 승인 배정액
//  - round2 : 2차 승인 배정액(승인 전에는 0)
//  - total  : 승인 완료된 차수의 합계(= round1 + 승인 round2). 기존 allocated_amount 호환값.
function buildAllocRoundMaps(allocations) {
  const round1 = new Map();
  const round2 = new Map();
  const total = new Map();
  for (const a of allocations) {
    const bid = a.support_program_budget_id;
    const r1 = Number(a.round1_allocated_amount ?? a.allocated_amount ?? 0);
    const r2 = Number(a.round2_allocated_amount ?? 0);
    round1.set(bid, r1);
    round2.set(bid, r2);
    total.set(bid, Number(a.allocated_amount ?? r1 + r2));
  }
  return { round1, round2, total };
}

// 비목 트리를 1차/2차/총 배정 + 검토 중 1·2차 요청 금액으로 채워 트리를 구성한다.
// maps: { round1, round2, total, pendingRound1?, pendingRound2? } — leaf별 금액 맵(Map). 누락 시 0.
// expenses를 넘기면 leaf별로 승인/검토중 '지출' 금액을 실제 지출 내역에서 집계해 반영한다.
function buildBudgetTreeWithAmounts(programBudgets, maps, expenses = [], leafIdByExpense = new Map()) {
  const round1Map = maps.round1 || new Map();
  const round2Map = maps.round2 || new Map();
  const totalMap = maps.total || new Map();
  const pendingR1Map = maps.pendingRound1 || new Map();
  const pendingR2Map = maps.pendingRound2 || new Map();
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
    let round1 = 0;
    let round2 = 0;
    let allocated = 0;
    let pendingRound1 = 0;
    let pendingRound2 = 0;
    let approved = 0;
    let pending = 0;
    if (isLeaf) {
      round1 = round1Map.get(node.id) ?? 0;
      round2 = round2Map.get(node.id) ?? 0;
      allocated = totalMap.has(node.id) ? totalMap.get(node.id) : round1 + round2;
      // 검토 중 요청 금액. 요청이 없으면 현재 확정값으로 채워(표시/프리필 일관성) 둔다.
      pendingRound1 = pendingR1Map.has(node.id) ? pendingR1Map.get(node.id) : round1;
      pendingRound2 = pendingR2Map.has(node.id) ? pendingR2Map.get(node.id) : round2;
      const related = expenses.filter((e) => leafIdByExpense.get(e.id) === node.id);
      approved = related
        .filter((e) => BUDGET_APPROVED_STATUSES.includes(e.status))
        .reduce((sum, e) => sum + Number(e.amount_supply || 0), 0);
      pending = related
        .filter((e) => BUDGET_PENDING_STATUSES.includes(e.status))
        .reduce((sum, e) => sum + Number(e.amount_supply || 0), 0);
    } else {
      for (const child of children) {
        round1 += child.round1_allocated_amount;
        round2 += child.round2_allocated_amount;
        allocated += child.allocated_amount;
        pendingRound1 += child.pending_round1_amount;
        pendingRound2 += child.pending_round2_amount;
        approved += child.approved_amount;
        pending += child.pending_amount;
      }
    }
    return {
      ...node,
      isLeaf,
      children,
      round1_allocated_amount: round1, // 1차 승인 배정액(확정)
      round2_allocated_amount: round2, // 2차 승인 배정액(승인 완료분)
      pending_round1_amount: pendingRound1, // 검토 중인 1차 요청 금액(편집 프리필용)
      pending_round2_amount: pendingRound2, // 검토 중인 2차 요청 금액(표시/프리필용, 잔액 미반영)
      allocated_amount: allocated, // 총 승인 예산(= 1차 + 승인 2차)
      approved_amount: approved,
      pending_amount: pending,
      // 잔액 = 총 승인 예산(A) - 승인금액(B) - 검토중(C). 검토중인 신청도 약정으로 보고 미리 차감한다.
      remaining_amount: allocated - approved - pending,
    };
  };
  return (childrenByParent.get(null) || []).map(decorate);
}

// 검토 대기/보완 중인 예산 변경 제출안의 비목별 1·2차 요청 금액 맵을 만든다.
// 승인 전이므로 총 승인 예산/잔액에는 반영하지 않고 표시/편집 프리필용으로만 쓴다(new.md §10.4).
function buildPendingRoundMaps(pendingSubmission) {
  const round1 = new Map();
  const round2 = new Map();
  if (!pendingSubmission || pendingSubmission.type !== "change") return { round1, round2 };
  for (const it of pendingSubmission.items || []) {
    const r2 = Number(it.requested_round2_allocated_amount || 0);
    // 구버전 호환: requested_round1 누락 시 (총 요청 - 2차)로 역산.
    const r1 = it.requested_round1_allocated_amount != null
      ? Number(it.requested_round1_allocated_amount)
      : Number(it.requested_allocated_amount || 0) - r2;
    round1.set(it.support_program_budget_id, r1);
    round2.set(it.support_program_budget_id, r2);
  }
  return { round1, round2 };
}

// 2차 배정 컬럼 헤더 상태값을 산출한다(new.md §10.3).
//  none(미제출) | pending(승인 대기) | revision(보완 요청) | approved(승인 완료)
// 예산 변경이 1차만 건드린 경우엔 2차 진행으로 표시하지 않고, 확정 2차 유무로만 판단한다.
function getRound2Status(budgetStatus, opts = {}) {
  const { hasConfirmedRound2 = false, hasPendingRound2 = false } = opts;
  if (hasPendingRound2) {
    if (budgetStatus === "change_submitted") return "pending";
    if (budgetStatus === "change_revision_requested") return "revision";
  }
  return hasConfirmedRound2 ? "approved" : "none";
}

// 비목별로 이미 사용(승인/제출)된 금액을 집계한다. 예산 감액 하한 계산용.
function computeCommittedByBudgetId(companyId) {
  const budgets = load(STORAGE_KEYS.BUDGETS, []);
  const allocations = load(STORAGE_KEYS.ALLOCATIONS, []).filter((a) => a.company_id === companyId);
  const expenses = load(STORAGE_KEYS.EXPENSES, []).filter((e) => e.company_id === companyId);
  const leafIdByExpense = resolveExpenseLeafIds(expenses, allocations, budgets);
  const map = new Map();
  for (const e of expenses) {
    if (!COMMITTED_STATUSES.includes(e.status)) continue;
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
      .filter((e) => BUDGET_APPROVED_STATUSES.includes(e.status))
      .reduce((sum, e) => sum + Number(e.amount_supply || 0), 0);
    const pendingAmount = related
      .filter((e) => BUDGET_PENDING_STATUSES.includes(e.status))
      .reduce((sum, e) => sum + Number(e.amount_supply || 0), 0);

    const round1 = Number(alloc.round1_allocated_amount ?? alloc.allocated_amount ?? 0);
    const round2 = Number(alloc.round2_allocated_amount ?? 0);
    const total = Number(alloc.allocated_amount ?? round1 + round2);
    return {
      id: alloc.id,
      support_program_budget_id: budgetNode.id,
      title: budgetNode.title,
      path: pathOf(budgetNode),
      budget_category: budgetNode.budget_category,
      round1_allocated_amount: round1, // 1차 승인 배정액
      round2_allocated_amount: round2, // 2차 승인 배정액
      allocated_amount: total, // 총 승인 예산(= 1차 + 승인 2차)
      approved_amount: approvedAmount,
      pending_amount: pendingAmount,
      remaining_amount: total - approvedAmount - pendingAmount,
    };
  }).filter(Boolean);
}

export {
  resolveExpenseLeafIds, computeExpenseBudgetCheck, decorateExpenseCounts,
  getPendingSubmission, attachSubmissionItems, buildAllocRoundMaps,
  buildBudgetTreeWithAmounts, buildPendingRoundMaps, getRound2Status,
  computeCommittedByBudgetId, calculateBudgetSummary, PENDING_SUBMISSION_STATUSES,
};
