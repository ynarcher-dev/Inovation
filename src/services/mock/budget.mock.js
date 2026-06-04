// Mock 예산 도메인: 창업자 예산 배정 제출, 관리자 예산 제출 검토, 단건 배정 upsert.
import { STORAGE_KEYS, load, save, uuid } from "./storage.mock.js";
import { mockGetCurrentUser } from "./auth.mock.js";
import { buildAllocRoundMaps, computeCommittedByBudgetId, PENDING_SUBMISSION_STATUSES } from "./_shared.mock.js";

export function mockSubmitFounderBudgetAllocations(companyId, inputAllocations, reason) {
  const companies = load(STORAGE_KEYS.COMPANIES, []);
  const cIdx = companies.findIndex((c) => c.id === companyId);
  if (cIdx === -1) throw new Error("기업을 찾을 수 없습니다.");
  const company = companies[cIdx];

  // 최초 예산이 한 번이라도 승인된 적이 있으면 이번 제출은 예산 변경(change)이다.
  const hasApprovedHistory = ["budget_approved", "change_submitted", "change_revision_requested", "change_approved"].includes(company.budget_status);
  const type = hasApprovedHistory ? "change" : "initial";
  const newStatus = hasApprovedHistory ? "change_submitted" : "budget_submitted";

  // 현재 확정 예산(1차/2차/총) — previous_* 계산 및 감액 검증용
  const approvedAllocations = load(STORAGE_KEYS.ALLOCATIONS, []).filter((a) => a.company_id === companyId);
  const { round1: round1Map, round2: round2Map, total: totalMap } = buildAllocRoundMaps(approvedAllocations);

  // 비목별 요청 1차/2차/총(승인 후) 금액을 계산한다.
  const requestedRound1Of = (item) => Number(item.allocated_amount || 0);
  const requestedRound2Of = (item) => {
    if (type !== "change") return 0;
    // round2 미지정 시 현재 확정 2차 유지(1차만 수정하는 경우).
    if (item.round2_allocated_amount == null) return round2Map.get(item.support_program_budget_id) || 0;
    return Number(item.round2_allocated_amount || 0);
  };
  const resultingTotalOf = (item) => requestedRound1Of(item) + requestedRound2Of(item);

  // 감액 하한 검증: 승인 후 총 예산이 이미 사용(승인/제출)된 금액보다 낮을 수 없다(new.md §10.7).
  const committed = computeCommittedByBudgetId(companyId);
  const violation = inputAllocations.find((a) => resultingTotalOf(a) < (committed.get(a.support_program_budget_id) || 0));
  if (violation) {
    const floor = committed.get(violation.support_program_budget_id) || 0;
    throw new Error(`이미 사용(승인/제출)된 금액(${floor.toLocaleString()}원)보다 낮게 예산을 줄일 수 없습니다.`);
  }

  // 이번 제출이 1차/2차를 각각 실제로 바꾸는지(표시·기록용 플래그).
  const round1Changed = type === "change" && inputAllocations.some((a) => requestedRound1Of(a) !== (round1Map.get(a.support_program_budget_id) || 0));
  const round2Requested = type === "change" && inputAllocations.some((a) => requestedRound2Of(a) !== (round2Map.get(a.support_program_budget_id) || 0));

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
    round1_changed: round1Changed, // 1차 예산 수정 포함 여부
    round2_requested: round2Requested, // 2차 예산 배정 신청 포함 여부
    reason: reason || (type === "change" ? "예산 변경 요청" : "최초 예산안 제출"),
    submitted_by: user?.id || null,
    submitted_at: now,
    reviewed_by: null,
    reviewed_at: null,
    review_comment: null,
    created_at: now,
  });

  inputAllocations.forEach((item) => {
    const bid = item.support_program_budget_id;
    const prevRound1 = round1Map.get(bid) || 0;
    const prevRound2 = round2Map.get(bid) || 0;
    const prevTotal = totalMap.get(bid) ?? prevRound1 + prevRound2;
    const reqRound1 = requestedRound1Of(item);
    const reqRound2 = requestedRound2Of(item);
    items.push({
      id: uuid(),
      budget_submission_id: submissionId,
      support_program_budget_id: bid,
      // 1차/2차 분리 필드(new.md §10.5)
      previous_round1_allocated_amount: prevRound1,
      previous_round2_allocated_amount: prevRound2,
      requested_round1_allocated_amount: reqRound1,
      requested_round2_allocated_amount: reqRound2,
      approved_round1_allocated_amount: null,
      approved_round2_allocated_amount: null,
      // 호환 필드: requested/previous_allocated_amount = '승인 후 총 배정' / '현재 총 배정'
      previous_allocated_amount: prevTotal,
      requested_allocated_amount: reqRound1 + reqRound2,
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

export function mockReviewBudgetSubmission(submissionId, decision, comment, reviewerId) {
  const statusMap = {
    initial: { approved: "budget_approved", revision_requested: "budget_revision_requested" },
    change: { approved: "change_approved", revision_requested: "change_revision_requested" },
  };
  if (!["approved", "revision_requested"].includes(decision)) {
    throw new Error("지원하지 않는 검토 결과입니다.");
  }
  if (decision !== "approved" && !String(comment || "").trim()) {
    throw new Error("보완 요청 시에는 심사 의견을 입력해야 합니다.");
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
    const isChange = submission.type === "change"; // 예산 변경(1차 수정/2차 배정) 승인 여부
    const subItems = items.filter((it) => it.budget_submission_id === submissionId);
    // approved_* 확정: 총 배정 + 1차/2차 승인 배정액
    items = items.map((it) => {
      if (it.budget_submission_id !== submissionId) return it;
      const reqRound2 = Number(it.requested_round2_allocated_amount || 0);
      const reqRound1 = it.requested_round1_allocated_amount != null
        ? Number(it.requested_round1_allocated_amount)
        : Number(it.requested_allocated_amount || 0) - reqRound2;
      return {
        ...it,
        approved_allocated_amount: Number(it.requested_allocated_amount || 0),
        approved_round1_allocated_amount: reqRound1,
        approved_round2_allocated_amount: isChange ? reqRound2 : 0,
      };
    });
    save(STORAGE_KEYS.BUDGET_SUBMISSION_ITEMS, items);

    // 확정 예산 반영(new.md §10.4/§10.5): 이번 제출에 포함된 비목만 갱신, 나머지는 유지.
    //  - 1차(initial) 승인: round1 = 요청액, round2 = 0, allocated = round1
    //  - 변경(change)  승인: round1 = 1차 요청액, round2 = 2차 요청액, allocated = round1 + round2
    let allocations = load(STORAGE_KEYS.ALLOCATIONS, []);
    const companyAllocs = allocations.filter((a) => a.company_id === submission.company_id);
    const allocByBudget = new Map(companyAllocs.map((a) => [a.support_program_budget_id, a]));
    subItems.forEach((it) => {
      const existing = allocByBudget.get(it.support_program_budget_id);
      const reqRound2 = Number(it.requested_round2_allocated_amount || 0);
      const reqRound1 = it.requested_round1_allocated_amount != null
        ? Number(it.requested_round1_allocated_amount)
        : Number(it.requested_allocated_amount || 0) - reqRound2;
      const round1 = isChange ? reqRound1 : Number(it.requested_allocated_amount || 0);
      const round2 = isChange ? reqRound2 : 0;
      const total = round1 + round2;
      if (existing) {
        existing.round1_allocated_amount = round1;
        existing.round2_allocated_amount = round2;
        existing.allocated_amount = total;
      } else {
        const created = {
          id: uuid(),
          company_id: submission.company_id,
          support_program_budget_id: it.support_program_budget_id,
          round1_allocated_amount: round1,
          round2_allocated_amount: round2,
          allocated_amount: total,
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
  const value = Number(amount || 0);
  if (idx !== -1) {
    // 직접 수정은 1차 배정액을 조정하는 것으로 본다. 승인된 2차 배정액은 유지한다.
    const round2 = Number(allocations[idx].round2_allocated_amount ?? 0);
    allocations[idx].round1_allocated_amount = value;
    allocations[idx].round2_allocated_amount = round2;
    allocations[idx].allocated_amount = value + round2;
  } else {
    allocations.push({
      id: uuid(),
      company_id: companyId,
      support_program_budget_id: budgetId,
      round1_allocated_amount: value,
      round2_allocated_amount: 0,
      allocated_amount: value,
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

