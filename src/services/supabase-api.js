import { getSupabase } from "../auth.js";
import { CONFIG } from "../config.js";
import { BUDGET_APPROVED_STATUSES, BUDGET_PENDING_STATUSES, COMMITTED_STATUSES } from "../domains/status.js";


// Helper to get logged in user profile
async function getMyProfile(supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("로그인이 필요합니다.");
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  // profiles 에는 company_id 컬럼이 없다. 창업자↔기업 연결은 company_members 가 단일 소스다.
  // 호출부(getFounderDashboard/submitFounderBudgetAllocations 등)가 profile.company_id 를
  // 기대하므로 여기서 소속 회사를 보강한다(없으면 undefined 유지 — 관리자 등).
  if (profile && !profile.company_id) {
    const { data: member } = await supabase
      .from("company_members")
      .select("company_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (member?.company_id) profile.company_id = member.company_id;
  }
  return { user, profile };
}

// ----------------------------------------------------
// 1. 지원사업 (Support Programs)
// ----------------------------------------------------
export async function getSupportPrograms() {
  const supabase = await getSupabase();
  let profile = null;
  try {
    const res = await getMyProfile(supabase);
    profile = res.profile;
  } catch (e) {
    // 비로그인 상태이거나 프로필이 없어도 전체 활성 사업 목록은 조회할 수 있어야 하므로(회원가입 등) 예외를 무시합니다.
  }
  
  let query = supabase.from("support_programs").select("*").eq("active", true);
  if (profile?.role === "admin" && Array.isArray(profile.program_ids) && profile.program_ids.length > 0) {
    query = query.in("id", profile.program_ids);
  }
  
  const { data, error } = await query.order("sort_order", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createSupportProgram(input, adminUserId) {
  const supabase = await getSupabase();
  const programCode = input.code || ("PRG-" + Math.random().toString(36).substring(2, 8).toUpperCase());
  const { data, error } = await supabase
    .from("support_programs")
    .insert({
      name: input.name,
      code: programCode,
      sort_order: Number(input.sort_order || 0),
      active: true,
      level_labels: { "1": "대분류", "2": "중분류", "3": "소분류" },
      created_by: adminUserId,
    })
    .select("*")
    .single();
  if (error) throw error;
  
  // 일반관리자의 경우 권한 배정 자동 업데이트
  if (adminUserId) {
    const { data: profile } = await supabase.from("profiles").select("role, program_ids").eq("id", adminUserId).single();
    if (profile?.role === "admin") {
      const ids = [...new Set([...(profile.program_ids || []), data.id])];
      await supabase.from("profiles").update({ program_ids: ids }).eq("id", adminUserId);
    }
  }
  return data;
}

export async function updateSupportProgram(id, input) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("support_programs")
    .update({ name: input.name, sort_order: Number(input.sort_order || 0) })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteSupportProgram(id) {
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("support_programs")
    .update({ active: false })
    .eq("id", id);
  if (error) throw error;
  return { ok: true };
}

export async function updateSupportProgramDescription(id, description) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("support_programs")
    .update({ description })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateSupportProgramMemo(id, memo) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("support_programs")
    .update({ memo })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateSupportProgramLevelLabels(id, labels) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("support_programs")
    .update({ level_labels: labels })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// ----------------------------------------------------
// 2. 비목 구조 (Support Program Budgets)
// ----------------------------------------------------
export async function getSupportProgramBudgets(programId) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("support_program_budgets")
    .select("*")
    .eq("support_program_id", programId);
  if (error) throw error;
  return data;
}

export async function createSupportProgramBudget(input) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("support_program_budgets")
    .insert({
      support_program_id: input.support_program_id,
      parent_id: input.parent_id || null,
      level: Number(input.level || 1),
      title: input.title,
      budget_category: input.budget_category || null,
      allocated_amount: Number(input.allocated_amount || 0),
      sort_order: Number(input.sort_order || 0),
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateSupportProgramBudget(id, input) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("support_program_budgets")
    .update({
      title: input.title,
      budget_category: input.budget_category,
      allocated_amount: Number(input.allocated_amount || 0),
      sort_order: Number(input.sort_order || 0),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteSupportProgramBudget(id) {
  const supabase = await getSupabase();
  // 재귀 하위 삭제는 RLS/Foreign Key Cascade 설정 또는 트리거로 권장되나,
  // 클라이언트에서도 하위 전체 목록 조회 후 일괄 삭제를 진행합니다.
  const { data: allBudgets } = await supabase.from("support_program_budgets").select("id, parent_id");
  const toDelete = new Set([id]);
  let added = true;
  while (added) {
    added = false;
    for (const b of allBudgets || []) {
      if (b.parent_id && toDelete.has(b.parent_id) && !toDelete.has(b.id)) {
        toDelete.add(b.id);
        added = true;
      }
    }
  }
  const { error } = await supabase
    .from("support_program_budgets")
    .delete()
    .in("id", [...toDelete]);
  if (error) throw error;
  return { ok: true };
}

// ----------------------------------------------------
// 3. 관리자 계정 관리 (Admin Accounts)
// ----------------------------------------------------
export async function getAdminAccounts() {
  const supabase = await getSupabase();
  // profiles 중 role이 admin, super_admin 인 계정 목록
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, role, program_ids")
    .in("role", ["admin", "super_admin"]);
  if (error) throw error;
  
  // UI 호환 형태 반환
  return data.map((p) => ({
    user_id: p.id,
    profile_id: p.id,
    name: p.name || "",
    role: p.role,
    program_ids: p.program_ids || [],
  }));
}

export async function createAdminAccount(input) {
  const name = String(input?.name || "").trim();
  const email = String(input?.email || "").trim().toLowerCase();
  const password = String(input?.password || "");

  if (!name) throw new Error("관리자 이름을 입력해 주세요.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("올바른 로그인 이메일을 입력해 주세요.");
  if (password.length < 6) throw new Error("비밀번호는 6자 이상이어야 합니다.");

  const supabase = await getSupabase();

  // 1. 임시 Supabase 클라이언트를 생성하여 현재 관리자의 로그인 세션이 덮어써지는 것을 방지
  // storageKey를 고유하게 지정하여 Multiple GoTrueClient 경고를 해결합니다.
  const tempSupabase = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "sb-temp-auth-token"
    }
  });

  // 2. 임시 클라이언트로 Auth SignUp 실행
  const { data, error: signUpError } = await tempSupabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name: name
      }
    }
  });

  if (signUpError) {
    if (signUpError.message === "User already registered") {
      throw new Error("이미 등록된 이메일 주소입니다.");
    }
    throw signUpError;
  }
  if (!data.user) throw new Error("계정 생성에 실패했습니다.");

  // 3. 원래 로그인된 Supabase 클라이언트로 가입된 사용자의 프로필 role을 'admin'으로 변경
  // (auth.users 가입 성공 시 handle_new_user 트리거로 인해 profiles에 row가 자동으로 생성되어 있음)
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ role: "admin", name: name })
    .eq("id", data.user.id);

  if (profileError) {
    throw new Error(`계정은 생성되었으나 프로필 설정에 실패했습니다: ${profileError.message}`);
  }

  return { ok: true, user_id: data.user.id };
}

export async function deleteAdminAccount(actorUserId, targetUserId) {
  const supabase = await getSupabase();
  if (actorUserId === targetUserId) throw new Error("본인 계정은 삭제할 수 없습니다.");
  const { error } = await supabase.from("profiles").delete().eq("id", targetUserId);
  if (error) throw error;
  return { ok: true };
}

export async function resetAdminPassword(targetUserId, newPassword) {
  throw new Error("관리자 비밀번호 초기화는 수파베이스 Auth 대시보드를 이용해 주십시오.");
}

export async function updateAdminPrograms(targetUserId, programIds) {
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("profiles")
    .update({ program_ids: programIds })
    .eq("id", targetUserId);
  if (error) throw error;
  return { ok: true };
}

// ----------------------------------------------------
// 4. AI 설정 (AI Settings)
// ----------------------------------------------------
export async function getAiSettings() {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("ai_settings")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) return { enabled: false, provider: "openai", model: "gpt-4o" };
  // 테이블 컬럼 -> UI/mock 계약으로 매핑한다. model 은 openai_model 컬럼에 저장한다.
  return {
    ...data,
    enabled: data.enabled ?? false,
    provider: data.provider || "openai",
    model: data.openai_model || "gpt-4o",
    api_key_configured: data.api_key_configured ?? false,
    edge_function_url: data.edge_function_url || "",
    api_key_hint: data.api_key_hint || "",
    memo: data.memo || "",
  };
}

export async function updateAiSettings(input) {
  const supabase = await getSupabase();
  // 단일 행이므로 upsert 진행
  const { data: current } = await supabase.from("ai_settings").select("id").maybeSingle();
  const payload = {
    enabled: input.enabled,
    provider: input.provider,
    openai_model: input.model,
    api_key_configured: input.api_key_configured ?? false,
    edge_function_url: input.edge_function_url || "",
    api_key_hint: input.api_key_hint || "",
    memo: input.memo || "",
    updated_at: new Date().toISOString(),
  };
  let query;
  if (current?.id) {
    query = supabase.from("ai_settings").update(payload).eq("id", current.id);
  } else {
    query = supabase.from("ai_settings").insert(payload);
  }
  const { error } = await query;
  if (error) throw error;
  // 저장 후 화면이 setForm(반환값)으로 즉시 다시 그리므로, 갱신된 설정 객체를 그대로 돌려준다.
  // ({ ok:true } 만 돌려주면 토글/Provider 가 기본값으로 리셋되어 보이는 버그가 있었다.)
  return await getAiSettings();
}

// ----------------------------------------------------
// 5. 안내 및 유의사항 (Guidance)
// ----------------------------------------------------
export async function getGuidanceItems(programId) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("guidance_items")
    .select("*")
    .eq("support_program_id", programId)
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createGuidanceItem(input) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("guidance_items")
    .insert({
      support_program_id: input.support_program_id,
      title: input.title,
      content: input.content || null,
      link_url: input.link_url || null,
      active: true,
      sort_order: Number(input.sort_order || 0),
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateGuidanceItem(id, input) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("guidance_items")
    .update({
      title: input.title,
      content: input.content,
      link_url: input.link_url,
      sort_order: Number(input.sort_order || 0),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteGuidanceItem(id) {
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("guidance_items")
    .update({ active: false })
    .eq("id", id);
  if (error) throw error;
  return { ok: true };
}

// ----------------------------------------------------
// 6. 창업자 대시보드 및 예산 (Founder Dashboard)
// ----------------------------------------------------
// ==========================================================================
// 예산 대시보드/상세 공용 파생 계산 헬퍼
//  - 창업자 대시보드(getFounderDashboard)·관리자 상세(getAdminCompanyDetail)가 공유한다.
//  - mock 계층 제거(7a03da5) 때 함께 사라졌던 파생 필드(pendingSubmission/round 트리/
//    committedByBudgetId/round2Status 등)를 remote 데이터로 동일하게 재구성한다.
// ==========================================================================

// 검토 대기/보완 중인(아직 확정되지 않은) 예산 제출 상태.
//  - 창업자 화면에서 '내가 진행 중인 제출안'(보완요청 받아 수정 중 포함)을 가리킬 때 사용.
const PENDING_SUBMISSION_STATUSES = [
  "budget_submitted",
  "budget_revision_requested",
  "change_submitted",
  "change_revision_requested",
];

// 관리자가 '아직 결재(승인/보완요청)하지 않아 검토해야 하는' 제출 상태.
//  - 한 번 결재된 제출안(보완요청/승인)은 여기에 포함하지 않는다. 재결재로 기존 결정이
//    덮어써지는 것을 막아, 보완요청→재제출→승인 흐름이 별도 이력으로 보존되게 한다.
const AWAITING_REVIEW_STATUSES = ["budget_submitted", "change_submitted"];

// 지출 신청 → 비목 leaf id 매핑.
//  1순위: business_plan_item_id(= 배정 id)로 leaf 를 찾고(안정 키),
//  2순위(레거시 보조): budget_category 문자열로 leaf 를 찾는다.
function resolveExpenseLeafIds(expenses, allocations, budgets) {
  const leafIdByAllocId = new Map((allocations || []).map((a) => [a.id, a.support_program_budget_id]));
  const leafIdByCategory = new Map();
  for (const b of budgets || []) {
    if (b.budget_category) leafIdByCategory.set(b.budget_category, b.id);
  }
  const map = new Map();
  for (const e of expenses || []) {
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

// 비목별로 이미 점유된(승인+검토중) 지출 금액 — 예산 감액 하한 계산용. { [budgetId]: amount } 반환.
function computeCommittedByBudgetId(expenses, allocations, budgets) {
  const leafIdByExpense = resolveExpenseLeafIds(expenses, allocations, budgets);
  const map = {};
  for (const e of expenses || []) {
    if (!COMMITTED_STATUSES.includes(e.status)) continue;
    const leafId = leafIdByExpense.get(e.id);
    if (!leafId) continue;
    map[leafId] = (map[leafId] || 0) + Number(e.amount_supply || 0);
  }
  return map;
}

// 확정 예산(allocations)에서 비목 leaf별 1차/2차/총(승인) 배정 맵을 만든다.
function buildAllocRoundMaps(allocations) {
  const round1 = new Map();
  const round2 = new Map();
  const total = new Map();
  for (const a of allocations || []) {
    const bid = a.support_program_budget_id;
    const r1 = Number(a.round1_allocated_amount ?? a.allocated_amount ?? 0);
    const r2 = Number(a.round2_allocated_amount ?? 0);
    round1.set(bid, r1);
    round2.set(bid, r2);
    total.set(bid, Number(a.allocated_amount ?? r1 + r2));
  }
  return { round1, round2, total };
}

// 검토 대기/보완 중인 예산 변경 제출안의 비목별 1·2차 요청 금액 맵(표시/프리필용, 잔액 미반영).
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

// 비목 트리를 1차/2차/총 배정 + 검토 중 1·2차 요청 금액으로 채워 트리를 구성한다.
// maps: { round1, round2, total, pendingRound1?, pendingRound2? } — leaf별 금액 맵(Map). 누락 시 0.
function buildBudgetTreeWithAmounts(programBudgets, maps, expenses = [], leafIdByExpense = new Map()) {
  const round1Map = maps.round1 || new Map();
  const round2Map = maps.round2 || new Map();
  const totalMap = maps.total || new Map();
  const pendingR1Map = maps.pendingRound1 || new Map();
  const pendingR2Map = maps.pendingRound2 || new Map();
  const childrenByParent = new Map();
  for (const item of programBudgets || []) {
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
      const related = (expenses || []).filter((e) => leafIdByExpense.get(e.id) === node.id);
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
      pending_allocated_amount: pendingRound1 + pendingRound2,
      allocated_amount: allocated, // 총 승인 예산(= 1차 + 승인 2차)
      approved_amount: approved,
      pending_amount: pending,
      // 잔액 = 총 승인 예산 - 승인금액 - 검토중. 검토중인 신청도 약정으로 보고 미리 차감한다.
      remaining_amount: allocated - approved - pending,
      pending_remaining_amount: pendingRound1 + pendingRound2 - approved - pending,
    };
  };
  return (childrenByParent.get(null) || []).map(decorate);
}

// 2차 배정 컬럼 헤더 상태값(none|pending|revision|approved)을 산출한다(new.md §10.3).
function getRound2Status(budgetStatus, opts = {}) {
  const { hasConfirmedRound2 = false, hasPendingRound2 = false } = opts;
  if (hasPendingRound2) {
    if (budgetStatus === "change_submitted") return "pending";
    if (budgetStatus === "change_revision_requested") return "revision";
  }
  return hasConfirmedRound2 ? "approved" : "none";
}

// 예산 제출 이력 행에 비목별 항목(이전/요청/승인 금액 + 비목명)을 조인한다.
function attachSubmissionItems(submissions, itemsBySubmission, budgetById) {
  return (submissions || []).map((s) => ({
    ...s,
    submitted_by_name: s.profiles?.name || s.submitted_by_name || "",
    items: (itemsBySubmission.get(s.id) || []).map((it) => {
      const node = budgetById.get(it.support_program_budget_id);
      return {
        ...it,
        title: node?.title || "(삭제된 비목)",
        budget_category: node?.budget_category || null,
      };
    }),
  }));
}

// 확정 배정액(allocations)을 창업자 지출 신청 화면의 '예산 항목' 선택지로 평탄화한다.
//  - 한 항목 = 한 확정 배정(company_budget_allocations 행). id 는 alloc.id 로,
//    expense_requests.business_plan_item_id 와 동일 키다(resolveExpenseLeafIds 참고).
//  - mock 제거(7a03da5) 때 함께 사라졌던 budgetSummary 를 remote 에서 동일 형태로 재구성한다.
function buildBudgetSummary(allocations, budgets, expenses) {
  const budgetById = new Map((budgets || []).map((b) => [b.id, b]));
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
  const leafIdByExpense = resolveExpenseLeafIds(expenses, allocations, budgets);
  return (allocations || []).map((alloc) => {
    const budgetNode = budgetById.get(alloc.support_program_budget_id);
    if (!budgetNode) return null;
    const related = (expenses || []).filter((e) => leafIdByExpense.get(e.id) === budgetNode.id);
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

// 회사의 예산 제출 이력 + 항목을 한 번에 읽어 파생 필드를 구성한다.
//   { budgetSubmissions, pendingSubmission, committedByBudgetId, budgetTree, pendingBudgetTree, round2Status }
async function buildBudgetDerived(supabase, { company, programBudgets, allocations, expenses }, options = {}) {
  // pendingStatuses: '현재 진행 중인 제출안'으로 볼 상태 집합.
  //   창업자(기본) = 보완요청 포함, 관리자 = 아직 검토 안 한 *_submitted 만(재결재 방지).
  const pendingStatuses = options.pendingStatuses || PENDING_SUBMISSION_STATUSES;
  const companyId = company.id;
  const budgets = programBudgets || [];
  const budgetById = new Map(budgets.map((b) => [b.id, b]));

  // 제출 이력(최신순) + 제출자 이름
  const { data: rawSubmissions } = await supabase
    .from("budget_submissions")
    .select("*, profiles(name)")
    .eq("company_id", companyId)
    .order("submitted_at", { ascending: false });
  const submissionRows = rawSubmissions || [];

  // 제출별 항목 일괄 조회
  const submissionIds = submissionRows.map((s) => s.id);
  let itemRows = [];
  if (submissionIds.length) {
    const { data } = await supabase
      .from("budget_submission_items")
      .select("*")
      .in("budget_submission_id", submissionIds);
    itemRows = data || [];
  }
  const itemsBySubmission = new Map();
  for (const it of itemRows) {
    if (!itemsBySubmission.has(it.budget_submission_id)) itemsBySubmission.set(it.budget_submission_id, []);
    itemsBySubmission.get(it.budget_submission_id).push(it);
  }

  const budgetSubmissions = attachSubmissionItems(submissionRows, itemsBySubmission, budgetById);
  const pendingSubmission =
    budgetSubmissions.find((s) => pendingStatuses.includes(s.status)) || null;
  if (pendingSubmission && !pendingSubmission.submitted_by_name) {
    pendingSubmission.submitted_by_name = company.representative_name || "-";
  }

  const committedByBudgetId = computeCommittedByBudgetId(expenses, allocations, budgets);
  const leafIdByExpense = resolveExpenseLeafIds(expenses, allocations, budgets);

  const allocMaps = buildAllocRoundMaps(allocations);

  // '변경 전' 기준값(previous_*)을 현재 확정 배정액으로 보정한다.
  //  제출 시 previous_round1/round2 가 저장되지 않아(=0) 변경안이 전부 '0→요청액(증액)'으로
  //  보이던 문제를 막는다. 검토 시점의 확정 배정액이 곧 '변경 전'이다.
  if (pendingSubmission) {
    pendingSubmission.items = (pendingSubmission.items || []).map((it) => {
      const bid = it.support_program_budget_id;
      const prev1 = Number(allocMaps.round1.get(bid) || 0);
      const prev2 = Number(allocMaps.round2.get(bid) || 0);
      return {
        ...it,
        previous_round1_allocated_amount: prev1,
        previous_round2_allocated_amount: prev2,
        previous_allocated_amount: allocMaps.total.has(bid) ? Number(allocMaps.total.get(bid)) : prev1 + prev2,
      };
    });
  }

  const pendingRoundMaps = buildPendingRoundMaps(pendingSubmission);
  allocMaps.pendingRound1 = pendingRoundMaps.round1;
  allocMaps.pendingRound2 = pendingRoundMaps.round2;
  const budgetTree = buildBudgetTreeWithAmounts(budgets, allocMaps, expenses, leafIdByExpense);

  const round2Status = getRound2Status(company.budget_status, {
    hasConfirmedRound2: [...allocMaps.round2.values()].some((v) => Number(v) > 0),
    hasPendingRound2: [...pendingRoundMaps.round2.values()].some((v) => Number(v) > 0),
  });

  // 최초(1차) 예산안 검토 대기 미리보기: 확정 예산이 없으므로 요청 금액으로 트리를 그린다.
  let pendingBudgetTree = null;
  if (pendingSubmission && pendingSubmission.type !== "change") {
    const requestedByBudgetId = new Map(
      (pendingSubmission.items || []).map((it) => [
        it.support_program_budget_id,
        Number(it.requested_allocated_amount || 0),
      ])
    );
    pendingBudgetTree = buildBudgetTreeWithAmounts(
      budgets,
      { round1: requestedByBudgetId, total: requestedByBudgetId },
      expenses,
      leafIdByExpense
    );
  }

  return { budgetSubmissions, pendingSubmission, committedByBudgetId, budgetTree, pendingBudgetTree, round2Status };
}

export async function getFounderDashboard() {
  const supabase = await getSupabase();
  const { user, profile } = await getMyProfile(supabase);
  if (!profile?.company_id) {
    return { company: null, program: null, budgetTree: [], allocations: [], expenses: [], budgetHistory: [] };
  }

  // 1. 기업 및 소속 프로그램 정보 조회
  const { data: company, error: compErr } = await supabase
    .from("companies")
    .select("*, support_programs(*)")
    .eq("id", profile.company_id)
    .single();
  if (compErr) throw compErr;

  const program = company.support_programs;

  // 2. 비목 템플릿 정보 조회
  const { data: programBudgets } = await supabase
    .from("support_program_budgets")
    .select("*")
    .eq("support_program_id", company.support_program_id);

  // 3. 확정 배정액 목록 조회
  const { data: allocations } = await supabase
    .from("company_budget_allocations")
    .select("*")
    .eq("company_id", company.id);

  // 4. 지출 신청 전체 목록 조회
  const { data: expenses } = await supabase
    .from("expense_requests")
    .select("*")
    .eq("company_id", company.id);

  // 5. 예산 제출 이력 + 파생 필드(검토 대기 제출안/라운드 트리/2차 상태 등) 일괄 구성.
  //    mock 제거(7a03da5) 때 사라졌던 pendingSubmission/round2Status/pendingBudgetTree 를 복원한다.
  const derived = await buildBudgetDerived(supabase, {
    company,
    programBudgets,
    allocations,
    expenses,
  });

  return {
    company,
    program,
    budgetTree: derived.budgetTree,
    // 창업자 지출 신청 화면의 '예산 항목' 선택지(확정 배정 비목 평탄화 목록).
    budgetSummary: buildBudgetSummary(allocations, programBudgets, expenses),
    allocations: allocations || [],
    expenses: expenses || [],
    programBudgets: programBudgets || [],
    budgetSubmissions: derived.budgetSubmissions,
    pendingSubmission: derived.pendingSubmission,
    pendingBudgetTree: derived.pendingBudgetTree,
    committedByBudgetId: derived.committedByBudgetId,
    round2Status: derived.round2Status,
    // 기존 호출부 호환: 제출 이력(submitted_by_name 포함)을 budgetHistory 로도 노출한다.
    budgetHistory: derived.budgetSubmissions,
  };
}

// 호출부(dashboard.js)·mock(mockSubmitFounderBudgetAllocations)과 동일한 위치 인자 시그니처를 따른다.
//   inputAllocations: [{ support_program_budget_id, allocated_amount, round2_allocated_amount? }, ...]
// 상태값은 스키마 CHECK 제약(budget_submitted/change_submitted 등)을 그대로 사용한다.
export async function submitFounderBudgetAllocations(companyId, inputAllocations = [], reason = "") {
  const supabase = await getSupabase();
  const { profile } = await getMyProfile(supabase);
  const targetCompanyId = companyId || profile?.company_id;
  if (!targetCompanyId) throw new Error("회사 정보가 등록되지 않았습니다.");

  // 최초 예산이 한 번이라도 승인된 적이 있으면 이번 제출은 예산 변경(change)이다(mock 과 동일 판정).
  const { data: company } = await supabase
    .from("companies")
    .select("budget_status")
    .eq("id", targetCompanyId)
    .single();
  const hasApprovedHistory = ["budget_approved", "change_submitted", "change_revision_requested", "change_approved"]
    .includes(company?.budget_status);
  const type = hasApprovedHistory ? "change" : "initial";
  const submissionStatus = hasApprovedHistory ? "change_submitted" : "budget_submitted";

  const { data: sub, error: subErr } = await supabase
    .from("budget_submissions")
    .insert({
      company_id: targetCompanyId,
      type,
      status: submissionStatus,
      reason: reason || "",
      submitted_by: profile?.id || null,
    })
    .select("id")
    .single();
  if (subErr) throw subErr;

  // '변경 전' 스냅샷: 현재 확정 배정액을 비목별로 읽어 항목에 함께 저장한다.
  //   (이게 없으면 검토 화면에서 변경 전이 0 으로 보여 모든 변경이 '증액'처럼 표시된다.)
  const { data: confirmedAllocs } = await supabase
    .from("company_budget_allocations")
    .select("support_program_budget_id, round1_allocated_amount, round2_allocated_amount, allocated_amount")
    .eq("company_id", targetCompanyId);
  const prevByBudgetId = new Map((confirmedAllocs || []).map((a) => [a.support_program_budget_id, a]));

  const items = (inputAllocations || []).map((a) => {
    const round1 = Number(a.allocated_amount || 0);
    const prev = prevByBudgetId.get(a.support_program_budget_id);
    const prev1 = Number(prev?.round1_allocated_amount ?? a.previous_allocated_amount ?? 0);
    const prev2 = Number(prev?.round2_allocated_amount ?? 0);
    const prevTotal = Number(prev?.allocated_amount ?? prev1 + prev2);
    const round2 = type === "change"
      ? (a.round2_allocated_amount == null ? prev2 : Number(a.round2_allocated_amount || 0))
      : 0;
    return {
      budget_submission_id: sub.id,
      support_program_budget_id: a.support_program_budget_id,
      // 변경 전 총액 스냅샷. (1차/2차 분리 컬럼은 스키마에 없어 총액만 저장한다.
      //   검토 이력 상세는 이 총액을 '변경 전'으로 사용해 증감을 계산한다 — BudgetHistoryDetail 참조.)
      previous_allocated_amount: prevTotal,
      requested_allocated_amount: round1 + (type === "change" ? round2 : 0),
      requested_round1_allocated_amount: round1,
      requested_round2_allocated_amount: round2,
    };
  });
  if (items.length) {
    const { error: itemsErr } = await supabase.from("budget_submission_items").insert(items);
    if (itemsErr) throw itemsErr;
  }

  // 덮어쓰기: 관리자가 아직 결재(승인/보완요청)하지 않은 기존 제출안을 정리한다.
  //   관리자가 손대기 전에 같은 신청을 여러 번 재제출하면 change_submitted/budget_submitted 가 중복으로
  //   쌓여(누적) 검토 화면에 직전 1차/2차 요청값이 계속 남아 보이던 문제를 막는다.
  //   - 보완요청(*_revision_requested) 이력은 '보완→재제출→승인' 흐름 보존을 위해 삭제하지 않는다(AWAITING_REVIEW_STATUSES 만 대상).
  //   - 이번에 만든 제출안(sub.id)은 제외. 항목은 FK ON DELETE CASCADE 로 함께 삭제.
  //   - member DELETE 정책(supabase_migration_budget_submission_member_delete.sql)이 적용돼야 실제로 지워진다.
  const { error: cleanupErr } = await supabase
    .from("budget_submissions")
    .delete()
    .eq("company_id", targetCompanyId)
    .neq("id", sub.id)
    .in("status", AWAITING_REVIEW_STATUSES);
  if (cleanupErr) throw cleanupErr;

  // 기업 예산 상태 업데이트(스키마 chk_budget_status 허용값).
  await supabase
    .from("companies")
    .update({ budget_status: submissionStatus })
    .eq("id", targetCompanyId);

  return { ok: true, submissionId: sub.id };
}

// ----------------------------------------------------
// 7. 관리자 대시보드 (Admin Dashboard)
// ----------------------------------------------------
export async function getAdminDashboard() {
  const supabase = await getSupabase();
  const { profile } = await getMyProfile(supabase);
  
  // 1. 기업 전체 목록 조회
  let query = supabase.from("companies").select("*, support_programs(name)");
  if (profile?.role === "admin" && Array.isArray(profile.program_ids) && profile.program_ids.length > 0) {
    query = query.in("support_program_id", profile.program_ids);
  }
  const { data: companies, error: compErr } = await query;
  if (compErr) throw compErr;

  // UI에서 요구하는 전체 통계 계산
  const totalCount = companies.length;
  const approvedCount = companies.filter((c) => c.approval_status === "approved").length;
  const budgetApprovedCount = companies.filter((c) => c.budget_status === "budget_approved").length;
  
  // 지출 신청 전체 조회 (예산 사용 승인 화면의 검토 대기 목록 + 전체 현황 공용)
  const companyIds = companies.map((c) => c.id);
  const companyNameById = new Map(companies.map((c) => [c.id, c.name]));
  let expenses = [];
  if (companyIds.length > 0) {
    const { data: expenseRows, error: expErr } = await supabase
      .from("expense_requests")
      .select("*")
      .in("company_id", companyIds);
    if (expErr) throw expErr;
    expenses = (expenseRows || []).map((e) => ({
      ...e,
      company_name: companyNameById.get(e.company_id) || "",
    }));
  }
  // 결재 대기 건수 세기 (회사별 지출 신청 중 대기 상태 세기)
  const expensePendingCount = expenses.filter((e) =>
    ["pre_approval_submitted", "final_approval_submitted"].includes(e.status)
  ).length;

  // 가입 신청 및 예산 검토 신청 수 계산
  const signupRequestCount = companies.filter((c) => c.approval_status === "pending").length;
  const budgetRequestCount = companies.filter((c) => ["budget_submitted", "change_submitted"].includes(c.budget_status)).length;

  // 예산 승인 목록/현황 화면용 회사별 파생 필드(검토 대기 제출안·2차 상태)를 배치로 구성한다.
  //   mock 제거(7a03da5) 때 사라진 pendingBudgetSubmission/round2Status 복원.
  const pendingByCompany = new Map();
  const confirmedRound2ByCompany = new Map();
  const pendingRound2ByCompany = new Map();
  if (companyIds.length > 0) {
    // (a) 회사별 최신 검토 대기 제출안
    const { data: pendingSubs } = await supabase
      .from("budget_submissions")
      .select("*")
      .in("company_id", companyIds)
      .in("status", PENDING_SUBMISSION_STATUSES)
      .order("submitted_at", { ascending: false });
    for (const s of pendingSubs || []) {
      if (!pendingByCompany.has(s.company_id)) pendingByCompany.set(s.company_id, s); // desc 정렬 → 첫 건이 최신
    }

    // (b) 확정 2차 배정 존재 여부
    const { data: allocs } = await supabase
      .from("company_budget_allocations")
      .select("company_id, round2_allocated_amount")
      .in("company_id", companyIds);
    for (const a of allocs || []) {
      if (Number(a.round2_allocated_amount || 0) > 0) confirmedRound2ByCompany.set(a.company_id, true);
    }

    // (c) 검토 중 2차 요청 존재 여부(변경 제출안 항목 기준)
    const pendingChangeIds = (pendingSubs || []).filter((s) => s.type === "change").map((s) => s.id);
    if (pendingChangeIds.length > 0) {
      const companyIdBySub = new Map((pendingSubs || []).map((s) => [s.id, s.company_id]));
      const { data: items } = await supabase
        .from("budget_submission_items")
        .select("budget_submission_id, requested_round2_allocated_amount")
        .in("budget_submission_id", pendingChangeIds);
      for (const it of items || []) {
        if (Number(it.requested_round2_allocated_amount || 0) > 0) {
          const cid = companyIdBySub.get(it.budget_submission_id);
          if (cid) pendingRound2ByCompany.set(cid, true);
        }
      }
    }
  }

  // 필터 드롭다운용 참가 사업 목록(관리자 권한 범위 적용)
  let progQuery = supabase.from("support_programs").select("*");
  if (profile?.role === "admin" && Array.isArray(profile.program_ids) && profile.program_ids.length > 0) {
    progQuery = progQuery.in("id", profile.program_ids);
  }
  const { data: supportPrograms } = await progQuery;

  return {
    metrics: {
      total_companies: totalCount,
      approved_companies: approvedCount,
      budget_approved_companies: budgetApprovedCount,
      expense_pending_requests: expensePendingCount,
      signup_pending_requests: signupRequestCount,
      budget_pending_requests: budgetRequestCount,
    },
    supportPrograms: supportPrograms || [],
    expenses,
    companies: companies.map((c) => ({
      ...c,
      program_name: c.support_programs?.name || "",
      pendingBudgetSubmission: pendingByCompany.get(c.id) || null,
      round2Status: getRound2Status(c.budget_status, {
        hasConfirmedRound2: !!confirmedRound2ByCompany.get(c.id),
        hasPendingRound2: !!pendingRound2ByCompany.get(c.id),
      }),
    })),
  };
}

export async function getAdminCompanyDetail(companyId) {
  const supabase = await getSupabase();
  
  // 1. 회사 기본 정보 및 프로그램
  const { data: company, error: compErr } = await supabase
    .from("companies")
    .select("*, support_programs(*)")
    .eq("id", companyId)
    .single();
  if (compErr) throw compErr;

  // 2. 예산 비목 템플릿
  const { data: programBudgets } = await supabase
    .from("support_program_budgets")
    .select("*")
    .eq("support_program_id", company.support_program_id);

  // 3. 확정 배정 예산
  const { data: allocations } = await supabase
    .from("company_budget_allocations")
    .select("*")
    .eq("company_id", companyId);

  // 4. 지출 신청 전체
  const { data: expenses } = await supabase
    .from("expense_requests")
    .select("*")
    .eq("company_id", companyId);

  // 5. 소속원 정보
  const { data: members } = await supabase
    .from("company_members")
    .select("*, profiles(*)")
    .eq("company_id", companyId);

  // 6. 지출 검토 결재 기록(검토 이력 탭의 '지출' 부분).
  const expenseIds = (expenses || []).map((e) => e.id);
  let expenseReviewRows = [];
  if (expenseIds.length) {
    const { data } = await supabase
      .from("expense_reviews")
      .select("*")
      .in("expense_request_id", expenseIds)
      .order("created_at", { ascending: false });
    expenseReviewRows = data || [];
  }

  // 7. 예산 제출 이력 + 파생 필드(검토 대기 제출안/라운드 트리/감액 하한/2차 상태 등).
  //    mock 제거(7a03da5) 때 사라져 예산 심사 화면에 값이 안 들어오던 필드들을 복원한다.
  // 관리자 검토 패널의 pendingSubmission 은 '아직 결재 안 한' 제출안만 대상으로 한다.
  //   이미 보완요청/승인된 제출안을 다시 결재해 기존 결정이 덮어써지는 것을 막는다.
  const derived = await buildBudgetDerived(supabase, {
    company,
    programBudgets,
    allocations,
    expenses,
  }, { pendingStatuses: AWAITING_REVIEW_STATUSES });

  // 검토 이력 탭: '예산 및 지출 검토 이력(승인/보완요청)'을 최신순으로 합친다(new.md / 탭 안내문 기준).
  //  - 지출: expense_reviews (신청 건으로 링크)
  //  - 예산: 검토 완료된 budget_submissions (승인/보완요청 결정 — 지출 상세 링크 없음)
  const expenseTitleById = new Map((expenses || []).map((e) => [e.id, e.title]));
  const expenseReviewHistory = expenseReviewRows.map((r) => ({
    ...r,
    title: expenseTitleById.get(r.expense_request_id) || "-",
  }));
  const budgetReviewHistory = (derived.budgetSubmissions || [])
    .filter((s) => s.reviewed_at)
    .map((s) => ({
      id: `budget-${s.id}`,
      expense_request_id: null, // 지출 신청이 아니므로 상세 링크 없음
      title: s.type === "change" ? "예산 변경안" : "예산 및 비목 배정안",
      decision: ["budget_approved", "change_approved"].includes(s.status)
        ? "approved"
        : (String(s.status).includes("revision") ? "revision_requested" : s.status),
      comment: s.review_comment || "",
      reviewer_id: null, // 검토자 이름 미보유 → 화면에서 '관리자'로 표시
      created_at: s.reviewed_at,
    }));
  const reviewHistory = [...expenseReviewHistory, ...budgetReviewHistory].sort(
    (a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))
  );

  // 8. 기업 담당자(창업자) 계정 정보: 가입 현황 탭에서 사용.
  const ownerMember = (members || []).find((m) => m.member_role === "owner") || (members || [])[0] || null;
  const account = {
    user_id: ownerMember?.user_id || null,
    email: ownerMember?.profiles?.email || null,
    name: ownerMember?.profiles?.name || company.representative_name || null,
  };

  return {
    company,
    account,
    budgetTree: derived.budgetTree,
    pendingBudgetTree: derived.pendingBudgetTree,
    programBudgets: programBudgets || [],
    expenses: expenses || [],
    pendingSubmission: derived.pendingSubmission,
    committedByBudgetId: derived.committedByBudgetId,
    budgetSubmissions: derived.budgetSubmissions,
    round2Status: derived.round2Status,
    reviewHistory,
    // 기존 호출부 호환: 제출 이력을 budgetHistory 로도 노출한다.
    budgetHistory: derived.budgetSubmissions,
    members: (members || []).map((m) => ({
      ...m,
      name: m.profiles?.name || "",
      email: m.profiles?.email || "",
      phone: m.profiles?.phone || "",
    })),
  };
}

export async function approveCompany(companyId) {
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("companies")
    .update({ approval_status: "approved" })
    .eq("id", companyId);
  if (error) throw error;
  return { ok: true };
}

export async function rejectCompany(companyId) {
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("companies")
    .update({ approval_status: "rejected" })
    .eq("id", companyId);
  if (error) throw error;
  return { ok: true };
}

export async function resetFounderPassword(userId, newPassword) {
  // 관리자 권한으로 창업자 비밀번호 초기화는 수파베이스 CLI나 Auth 대시보드 권장하므로 여기선 빈 모듈로 둡니다.
  throw new Error("사용자 비밀번호 제어는 수파베이스 Auth 대시보드를 이용해 주십시오.");
}

export async function reviewBudgetSubmission(submissionId, decision, comment) {
  const supabase = await getSupabase();
  const { profile } = await getMyProfile(supabase);

  // 제출 차수(initial/change)에 맞는 스키마 CHECK 허용 상태값을 사용한다.
  //  - 승인:   initial -> budget_approved,            change -> change_approved
  //  - 보완요청: initial -> budget_revision_requested,  change -> change_revision_requested
  const { data: subType } = await supabase
    .from("budget_submissions").select("type, status").eq("id", submissionId).maybeSingle();
  if (!subType) throw new Error("예산 제출안을 찾을 수 없습니다.");
  // 이미 결재(승인/보완요청)된 제출안은 다시 결재하지 않는다(기존 검토 이력 덮어쓰기 방지).
  if (!AWAITING_REVIEW_STATUSES.includes(subType.status)) {
    throw new Error("이미 검토가 완료된 제출안입니다. 창업자가 다시 제출한 최신 제출안을 검토해 주세요.");
  }
  const isChange = subType?.type === "change";
  const status = decision === "approved"
    ? (isChange ? "change_approved" : "budget_approved")
    : (isChange ? "change_revision_requested" : "budget_revision_requested");

  // 1. 제출 내역 정보 및 심사 기록 업데이트
  const { data: sub, error: subErr } = await supabase
    .from("budget_submissions")
    .update({
      status,
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
      review_comment: comment,
    })
    .eq("id", submissionId)
    .select("company_id")
    .single();

  if (subErr) throw subErr;

  // 2. 승인일 경우, 각 비목별 확정 예산(company_budget_allocations)을 업데이트한다.
  if (decision === "approved") {
    const { data: items } = await supabase
      .from("budget_submission_items")
      .select("*")
      .eq("budget_submission_id", submissionId);

    for (const item of items || []) {
      const { data: currentAlloc } = await supabase
        .from("company_budget_allocations")
        .select("id")
        .eq("company_id", sub.company_id)
        .eq("support_program_budget_id", item.support_program_budget_id)
        .maybeSingle();

      // 1차/2차를 분리해 확정한다. (이전엔 총액을 전부 round1 에 넣고 round2 를 비워, 2차 승인이
      //  확정 테이블에 0원으로 남아 '2차 값 0원 + 2차 미승인으로 재표시'되는 버그가 있었다.)
      const r2 = Number(item.requested_round2_allocated_amount || 0);
      const r1 = item.requested_round1_allocated_amount != null
        ? Number(item.requested_round1_allocated_amount)
        : Number(item.requested_allocated_amount || 0) - r2; // 구버전 호환: 총 요청 - 2차로 역산
      const total = r1 + r2;
      const payload = {
        company_id: sub.company_id,
        support_program_budget_id: item.support_program_budget_id,
        round1_allocated_amount: r1,
        round2_allocated_amount: r2,
        allocated_amount: total,
      };

      if (currentAlloc?.id) {
        await supabase.from("company_budget_allocations").update(payload).eq("id", currentAlloc.id);
      } else {
        await supabase.from("company_budget_allocations").insert(payload);
      }

      await supabase
        .from("budget_submission_items")
        .update({ approved_allocated_amount: total })
        .eq("id", item.id);
    }
  }

  // 3. 기업 테이블 예산 상태 동기화
  await supabase
    .from("companies")
    .update({ budget_status: status })
    .eq("id", sub.company_id);

  return { ok: true };
}

export async function upsertCompanyBudgetAllocation(companyId, budgetId, allocatedAmount) {
  const supabase = await getSupabase();
  const { data: current } = await supabase
    .from("company_budget_allocations")
    .select("id")
    .eq("company_id", companyId)
    .eq("support_program_budget_id", budgetId)
    .maybeSingle();

  const payload = {
    company_id: companyId,
    support_program_budget_id: budgetId,
    allocated_amount: allocatedAmount,
    round1_allocated_amount: allocatedAmount,
  };

  let error;
  if (current?.id) {
    ({ error } = await supabase.from("company_budget_allocations").update(payload).eq("id", current.id));
  } else {
    ({ error } = await supabase.from("company_budget_allocations").insert(payload));
  }
  if (error) throw error;
  return { ok: true };
}

export async function updateCompanySupportTotal(companyId, supportTotal, selfPayment) {
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("companies")
    .update({
      support_total_amount: supportTotal,
      self_payment_required_amount: selfPayment,
    })
    .eq("id", companyId);
  if (error) throw error;
  return { ok: true };
}

export async function updateCompanyInternalMemo(companyId, memo) {
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("companies")
    .update({ internal_memo: memo })
    .eq("id", companyId);
  if (error) throw error;
  return { ok: true };
}

// ----------------------------------------------------
// 8. 지출 신청 및 결재 (Expenses)
// ----------------------------------------------------
// 지출 신청의 예산 항목(=배정 id)을 관리자가 설정한 비목 단계 경로로 해석한다(표시용).
//   business_plan_item_id 로 확정 배정을 찾아 leaf 비목의 부모 경로를 만든다. 없으면 budget_category 로 대체.
function resolveBusinessPlanItemLabel(expense, allocations, budgets) {
  const budgetById = new Map((budgets || []).map((b) => [b.id, b]));
  const alloc = (allocations || []).find((a) => a.id === expense.business_plan_item_id);
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

// 지출 신청 1건의 비목 잔액 적합성(배정/기집행 대비 신청 금액)을 계산한다(관리자 검토 표시용).
//   동일 비목(leaf) 기준으로 다른 신청(승인+검토중)을 합산해 신청 전/후 잔액을 구한다.
function computeExpenseBudgetCheck(expense, allocations, budgets, expenses) {
  const allocById = new Map((allocations || []).map((a) => [a.support_program_budget_id, Number(a.allocated_amount || 0)]));
  const leafIdByExpense = resolveExpenseLeafIds(expenses, allocations, budgets);
  const leafId = leafIdByExpense.get(expense.id);
  const allocated = leafId && allocById.has(leafId) ? allocById.get(leafId) : 0;

  let approvedOther = 0;
  let pendingOther = 0;
  for (const e of expenses || []) {
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
    budget_category: expense.budget_category,
    allocated,
    approved_other: approvedOther,
    pending_other: pendingOther,
    remaining_before: remainingBefore,
    requested,
    remaining_after: remainingBefore - requested,
    exceeds: requested > remainingBefore,
  };
}

export async function getExpenseDetail(id) {
  const supabase = await getSupabase();

  // 1. 지출 내역 + 기업 정보 조회
  const { data: expense, error: expErr } = await supabase
    .from("expense_requests")
    .select("*, companies(name, representative_name, support_program_id)")
    .eq("id", id)
    .single();
  if (expErr) throw expErr;

  const supportProgramId = expense.companies?.support_program_id || null;

  // 2. 첨부된 파일들 정보 조회
  const { data: files } = await supabase
    .from("uploaded_files")
    .select("*")
    .eq("expense_request_id", id);

  // 3. 결재 이력 정보 조회
  const { data: reviews } = await supabase
    .from("expense_reviews")
    .select("*, profiles(name)")
    .eq("expense_request_id", id)
    .order("created_at", { ascending: false });

  // 4. 비목 잔액 적합성/예산 항목 라벨 계산용: 비목 템플릿·확정 배정·동일 기업의 지출 일괄 조회
  const [{ data: programBudgets }, { data: allocations }, { data: companyExpenses }] = await Promise.all([
    supportProgramId
      ? supabase.from("support_program_budgets").select("*").eq("support_program_id", supportProgramId)
      : Promise.resolve({ data: [] }),
    supabase.from("company_budget_allocations").select("*").eq("company_id", expense.company_id),
    supabase.from("expense_requests").select("*").eq("company_id", expense.company_id),
  ]);

  const budgetCheck = computeExpenseBudgetCheck(expense, allocations || [], programBudgets || [], companyExpenses || []);
  const businessPlanItemLabel = resolveBusinessPlanItemLabel(expense, allocations || [], programBudgets || []);

  // 호출부(expense-new/founder·admin expense-detail)는 { expense, files, reviews, budgetCheck } 중첩 형태를 기대한다.
  return {
    expense: {
      ...expense,
      company_name: expense.companies?.name || "",
      representative_name: expense.companies?.representative_name || "",
      support_program_id: supportProgramId || "",
      business_plan_item_label: businessPlanItemLabel,
    },
    files: files || [],
    budgetCheck,
    reviews: (reviews || []).map((r) => ({
      ...r,
      reviewer_name: r.profiles?.name || "관리자",
    })),
  };
}

export async function createExpense(input) {
  const supabase = await getSupabase();
  const { profile } = await getMyProfile(supabase);
  if (!profile?.company_id) throw new Error("회사 정보가 등록되지 않았습니다.");

  const { data, error } = await supabase
    .from("expense_requests")
    .insert({
      company_id: profile.company_id,
      founder_id: profile.id,
      title: input.title,
      expense_type: input.expense_type,
      budget_category: input.budget_category,
      amount_supply: Number(input.amount_supply || 0),
      vat_amount: Number(input.vat_amount || 0),
      total_amount: Number(input.total_amount || 0),
      vendor_name: input.vendor_name || "",
      vendor_business_number: input.vendor_business_number || "",
      purpose: input.purpose || "",
      status: "draft",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function updateExpenseRequest(id, input) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("expense_requests")
    .update({
      title: input.title,
      expense_type: input.expense_type,
      budget_category: input.budget_category,
      amount_supply: Number(input.amount_supply || 0),
      vat_amount: Number(input.vat_amount || 0),
      total_amount: Number(input.total_amount || 0),
      vendor_name: input.vendor_name || "",
      vendor_business_number: input.vendor_business_number || "",
      purpose: input.purpose || "",
      expected_completion_date: input.expected_completion_date || null,
      status: input.status || "draft",
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// 호출부(expense-detail.js)는 submitExpenseRequest(id) 만 호출한다(phase 미전달).
// remote 도 mock 과 동일하게 현재 상태에서 다음 제출 상태를 유도한다(도메인 규칙).
//   draft / pre_approval_revision        -> pre_approval_submitted
//   pre_approved / final_approval_revision -> final_approval_submitted
export async function submitExpenseRequest(id) {
  const supabase = await getSupabase();
  const { data: current, error: curErr } = await supabase
    .from("expense_requests").select("status").eq("id", id).single();
  if (curErr) throw curErr;

  let status, stamp;
  if (["draft", "pre_approval_revision"].includes(current.status)) {
    status = "pre_approval_submitted"; stamp = "submitted_at";
  } else if (["pre_approved", "final_approval_revision"].includes(current.status)) {
    status = "final_approval_submitted"; stamp = "final_submitted_at";
  } else {
    throw new Error("현재 상태에서는 제출할 수 없습니다.");
  }

  const payload = { status, [stamp]: new Date().toISOString() };
  const { data, error } = await supabase
    .from("expense_requests")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function reviewExpenseRequest(id, decision, comment) {
  const supabase = await getSupabase();
  const { profile } = await getMyProfile(supabase);

  // 1. 심사 이력 기록 등록
  const { error: revErr } = await supabase
    .from("expense_reviews")
    .insert({
      expense_request_id: id,
      reviewer_id: profile.id,
      decision,
      comment,
    });
  if (revErr) throw revErr;

  // 2. 지출 신청 정보 상태 전이
  let newStatus = "draft";
  const { data: current } = await supabase.from("expense_requests").select("status").eq("id", id).single();
  
  if (current.status === "pre_approval_submitted") {
    newStatus = decision === "approved" ? "pre_approved" : "pre_approval_revision";
  } else if (current.status === "final_approval_submitted") {
    newStatus = decision === "approved" ? "final_approved" : "final_approval_revision";
  }

  const payload = { status: newStatus };
  if (decision === "approved" && current.status === "pre_approval_submitted") {
    payload.approved_at = new Date().toISOString();
  } else if (decision === "approved" && current.status === "final_approval_submitted") {
    payload.final_approved_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("expense_requests")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

// ----------------------------------------------------
// 9. 첨부서류 요구조건 (Document Requirements)
// ----------------------------------------------------
export async function getBudgetDocumentRequirements(budgetId) {
  if (!budgetId) return [];
  const supabase = await getSupabase();
  // 요구사항은 예산 비목(support_program_budget_id) 기준으로 연결된다.
  const { data, error } = await supabase
    .from("budget_document_requirements")
    .select("*")
    .eq("support_program_budget_id", budgetId)
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  const requirements = data || [];
  if (!requirements.length) return requirements;

  // 업로드 이력 수(upload_count): 이력이 있으면 완전 삭제 대신 비활성화만 허용한다(§9).
  const ids = requirements.map((r) => r.id);
  const { data: files, error: filesError } = await supabase
    .from("uploaded_files")
    .select("requirement_id")
    .in("requirement_id", ids);
  if (filesError) throw filesError;
  const countByReq = (files || []).reduce((acc, f) => {
    if (f.requirement_id) acc[f.requirement_id] = (acc[f.requirement_id] || 0) + 1;
    return acc;
  }, {});
  return requirements.map((r) => ({ ...r, upload_count: countByReq[r.id] || 0 }));
}

export async function createBudgetDocumentRequirement(input) {
  const supabase = await getSupabase();
  const { profile } = await getMyProfile(supabase);
  const { data, error } = await supabase
    .from("budget_document_requirements")
    .insert({
      support_program_id: input.support_program_id,
      support_program_budget_id: input.support_program_budget_id || null,
      title: input.title,
      description: input.description || null,
      phase: input.phase,
      required: input.required ?? true,
      ai_review_enabled: input.ai_review_enabled ?? false,
      active: true,
      sort_order: Number(input.sort_order || 0),
      created_by: profile.id,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateBudgetDocumentRequirement(id, input) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("budget_document_requirements")
    .update({
      title: input.title,
      description: input.description,
      required: input.required,
      ai_review_enabled: input.ai_review_enabled,
      sort_order: Number(input.sort_order || 0),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deactivateBudgetDocumentRequirement(id) {
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("budget_document_requirements")
    .update({ active: false })
    .eq("id", id);
  if (error) throw error;
  return { ok: true };
}

export async function deleteBudgetDocumentRequirement(id) {
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("budget_document_requirements")
    .delete()
    .eq("id", id);
  if (error) throw error;
  return { ok: true };
}

// ----------------------------------------------------
// 10. AI 검토 기준 문서 및 결과 처리
// ----------------------------------------------------
export async function getProgramAiCriteriaDocument(programId) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("ai_criteria_documents")
    .select("*")
    .eq("support_program_id", programId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteProgramAiCriteriaDocument(id) {
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("ai_criteria_documents")
    .update({ active: false })
    .eq("id", id);
  if (error) throw error;
  return { ok: true };
}

export async function getExpenseDocumentRequirements(expenseRequestId, phase) {
  const supabase = await getSupabase();
  
  // 지출 신청 정보를 통해 프로그램 ID 및 예산 비목 ID 조회
  const { data: expense } = await supabase
    .from("expense_requests")
    .select("*, companies(support_program_id)")
    .eq("id", expenseRequestId)
    .single();
    
  const programId = expense.companies?.support_program_id;

  // 해당 프로그램의 활성화된 요구 사항 목록
  const { data: requirements } = await supabase
    .from("budget_document_requirements")
    .select("*")
    .eq("support_program_id", programId)
    .eq("active", true)
    .order("sort_order", { ascending: true });

  // 현재 이 지출 신청에 업로드된 파일 목록
  const { data: uploadedFiles } = await supabase
    .from("uploaded_files")
    .select("*")
    .eq("expense_request_id", expenseRequestId);

  const filterPhase = phase;
  const filteredReqs = (requirements || []).filter(
    (r) => r.phase === "both" || r.phase === filterPhase
  );

  return filteredReqs.map((req) => {
    const file = (uploadedFiles || []).find(
      (f) => f.requirement_id === req.id && f.phase === filterPhase
    );
    return {
      ...req,
      file: file || null,
    };
  });
}

export async function mockSaveProgramAiCriteriaExtraction(criteriaId, text, metrics) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("ai_criteria_documents")
    .update({
      extracted_criteria_text: text,
      extraction_status: "completed",
    })
    .eq("id", criteriaId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function mockSetProgramAiCriteriaExtractionStatus(criteriaId, status) {
  const supabase = await getSupabase();
  await supabase
    .from("ai_criteria_documents")
    .update({ extraction_status: status })
    .eq("id", criteriaId);
}

export async function mockGetProgramAiCriteriaDocumentById(id) {
  const supabase = await getSupabase();
  const { data } = await supabase
    .from("ai_criteria_documents")
    .select("*")
    .eq("id", id)
    .single();
  return data;
}

export async function mockGetAiDocumentReviewTargetByFile(fileId) {
  const supabase = await getSupabase();
  const { data: file } = await supabase.from("uploaded_files").select("*").eq("id", fileId).single();
  const { data: expense } = await supabase.from("expense_requests").select("*").eq("id", file.expense_request_id).single();
  const { data: req } = await supabase.from("budget_document_requirements").select("*").eq("id", file.requirement_id).single();
  const { data: criteria } = await supabase.from("ai_criteria_documents").select("*").eq("support_program_id", req.support_program_id).eq("active", true).maybeSingle();
  
  return {
    file,
    req,
    expense,
    criteriaText: criteria?.extracted_criteria_text || "",
    criteriaTitle: criteria?.title || "",
  };
}

export async function mockSaveAiDocumentReviewResult(fileId, data) {
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("uploaded_files")
    .update({
      ai_review_status: data.status,
      ai_review_comment: data.comment,
      ai_check_result: data.ai_check_result,
    })
    .eq("id", fileId);
  if (error) throw error;
  return { ok: true };
}

export async function mockGetAiDocumentReviewContext(expenseRequestId, phase) {
  const supabase = await getSupabase();
  const { data: expense } = await supabase
    .from("expense_requests")
    .select("*, companies(*)")
    .eq("id", expenseRequestId)
    .single();

  const programId = expense.companies?.support_program_id;
  const { data: criteria } = await supabase
    .from("ai_criteria_documents")
    .select("*")
    .eq("support_program_id", programId)
    .eq("active", true)
    .maybeSingle();

  // 대상 요구 서류들 및 업로드된 파일들 조인
  const reqs = await getExpenseDocumentRequirements(expenseRequestId, phase);
  const targets = reqs.filter((r) => r.ai_review_enabled && r.file);

  return {
    expense,
    criteriaText: criteria?.extracted_criteria_text || "",
    criteriaTitle: criteria?.title || "",
    targets,
  };
}

export async function mockSetExpenseDocumentUserReview(fileId, { cleared, comment, user }) {
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("uploaded_files")
    .update({
      cleared,
      user_review_comment: comment,
      user_reviewed_by: user?.id,
    })
    .eq("id", fileId);
  if (error) throw error;
  return { ok: true };
}

export async function mockUploadProgramAiCriteriaDocument(programId, input) {
  const supabase = await getSupabase();
  // 기존 활성 문서들 비활성화
  await supabase.from("ai_criteria_documents").update({ active: false }).eq("support_program_id", programId);
  const { data, error } = await supabase
    .from("ai_criteria_documents")
    .insert({
      support_program_id: programId,
      title: input.title,
      original_filename: input.original_filename,
      mime_type: input.mime_type,
      size_bytes: input.size_bytes,
      link_url: input.link_url,
      extraction_status: "pending",
      active: true,
      uploaded_by: input.uploaded_by,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function mockUploadExpenseDocumentFile(expenseRequestId, requirementId, phase, input) {
  const supabase = await getSupabase();
  // 해당 비목/단계에 이미 올라간 기존 파일 삭제
  await supabase.from("uploaded_files").delete().eq("expense_request_id", expenseRequestId).eq("requirement_id", requirementId).eq("phase", phase);
  const { data, error } = await supabase
    .from("uploaded_files")
    .insert({
      expense_request_id: expenseRequestId,
      requirement_id: requirementId,
      support_program_budget_id: input.support_program_budget_id,
      phase,
      original_filename: input.original_filename,
      mime_type: input.mime_type,
      size_bytes: input.size_bytes,
      link_url: input.link_url,
      uploaded_by: input.uploaded_by,
      ai_review_status: "not_requested",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function mockDeleteUploadedFile(fileId) {
  const supabase = await getSupabase();
  const { error } = await supabase.from("uploaded_files").delete().eq("id", fileId);
  if (error) throw error;
  return { ok: true };
}

export async function mockValidateRequiredDocuments(expenseRequestId, phase) {
  const reqs = await getExpenseDocumentRequirements(expenseRequestId, phase);
  const missing = reqs.filter((r) => r.required && !r.file).map((r) => r.title);
  // 호출부(expense-detail.js/expense-new.js)·mock 계약은 { ok, missing } 형태다.
  return { ok: missing.length === 0, missing };
}

export async function updateFounderProfile(input) {
  const supabase = await getSupabase();
  const { user, profile } = await getMyProfile(supabase);
  if (!profile) throw new Error("프로필을 찾을 수 없습니다.");
  if (!profile.company_id) throw new Error("회사 정보가 등록되지 않았습니다.");

  // 1. Update profiles table
  const { error: profileErr } = await supabase
    .from("profiles")
    .update({
      name: input.representative_name,
      company_name: input.company_name,
      phone: input.phone || "",
    })
    .eq("id", user.id);
  if (profileErr) throw profileErr;

  // 2. Update companies table
  const { error: companyErr } = await supabase
    .from("companies")
    .update({
      name: input.company_name,
      representative_name: input.representative_name,
      business_number: input.business_number || "",
    })
    .eq("id", profile.company_id);
  if (companyErr) throw companyErr;

  return profile.company_id;
}

export async function updateBusinessPlan(companyId, round, file, options = {}) {
  if (round && typeof round === "object") {
    options = file || {};
    file = round;
    round = "round1";
  }
  const slot = round === "round2" ? "round2" : "round1";

  const supabase = await getSupabase();
  const { data: company, error: compErr } = await supabase
    .from("companies")
    .select("business_plans")
    .eq("id", companyId)
    .single();
  if (compErr) throw compErr;

  const currentPlans = company.business_plans || {};
  const existing = currentPlans[slot];
  const now = new Date().toISOString();
  const filename = file?.original_filename || file?.name || "사업계획서";

  const nextEntry = {
    ...(existing || {}),
    original_filename: filename,
    link_url: file?.link_url || "",
    uploaded_at: existing?.uploaded_at || now,
    updated_at: now,
  };

  const sid = options.budget_submission_id || file?.budget_submission_id || existing?.budget_submission_id || null;
  if (sid) nextEntry.budget_submission_id = sid;

  const business_plans = { ...currentPlans, [slot]: nextEntry };
  const updatePayload = { business_plans };

  const { error: updateErr } = await supabase
    .from("companies")
    .update(updatePayload)
    .eq("id", companyId);
  if (updateErr) throw updateErr;

  return business_plans;
}

