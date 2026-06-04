// 지출 결재 상태 정의 (new.md 2장).
// 사전승인(pre_*)과 최종승인(final_*)으로 분리하고, 보완 건은 같은 expense.id 를 유지한 채
// 수정/재제출한다. 반려 개념은 없으며 검토 결과는 승인/보완요청 두 가지다.
export const statusLabels = {
  draft: "제출 대기",
  pre_approval_submitted: "사전승인 대기",
  pre_approval_revision: "사전승인 보완",
  pre_approved: "사전승인 완료",
  final_approval_submitted: "최종승인 대기",
  final_approval_revision: "최종승인 보완",
  final_approved: "최종승인 완료",
};

export function getStatusLabel(status) {
  return statusLabels[status] || status || "-";
}

// ----------------------------------------------------
// 상태 그룹 상수 (new.md 4장 예산 집계 / 검토 분기 기준)
// ----------------------------------------------------

// 예산 집계에서 '승인/예약 금액'으로 보는 상태.
// 사전승인 완료 이후(최종승인 대기/보완/완료 포함)는 약정된 금액으로 본다.
export const BUDGET_APPROVED_STATUSES = [
  "pre_approved",
  "final_approval_submitted",
  "final_approval_revision",
  "final_approved",
];

// 예산 집계에서 '검토 중 금액'으로 보는 상태(사전승인 검토 대기/보완).
export const BUDGET_PENDING_STATUSES = [
  "pre_approval_submitted",
  "pre_approval_revision",
];

// 예산을 점유하지 않는 상태(임시저장).
export const BUDGET_NONE_STATUSES = ["draft"];

// 예산 감액 하한 계산에 쓰는 '이미 점유된' 상태(승인/예약 + 검토 중).
export const COMMITTED_STATUSES = [...BUDGET_APPROVED_STATUSES, ...BUDGET_PENDING_STATUSES];

// 관리자 검토 대기 목록에 노출하는 상태(사전승인 검토 + 최종승인 검토).
export const ADMIN_REVIEW_STATUSES = ["pre_approval_submitted", "final_approval_submitted"];

// founder 가 내용/첨부를 자유롭게 수정할 수 있는 상태(임시저장 + 보완).
export const FOUNDER_EDITABLE_STATUSES = ["draft", "pre_approval_revision", "final_approval_revision"];

// 첨부 파일 추가/삭제가 가능한 상태(수정 가능 상태 + 사전승인 완료의 최종승인 서류 추가).
export const ATTACHMENT_EDITABLE_STATUSES = [...FOUNDER_EDITABLE_STATUSES, "pre_approved"];

// 현재 상태가 사전승인 검토 대상인지 / 최종승인 검토 대상인지 구분한다.
export function getReviewKind(status) {
  if (status === "pre_approval_submitted") return "pre";
  if (status === "final_approval_submitted") return "final";
  return null;
}

// 창업자 지출 현황용 단순 상태(대시보드 카운터 그룹핑). 각 단계를 대기/승인/보완으로 묶는다.
export function getSimpleExpenseStatus(status) {
  if (status === "draft") return { label: "제출 대기", tone: "neutral" };
  if (["pre_approval_revision", "final_approval_revision"].includes(status)) return { label: "보완", tone: "warning" };
  if (["pre_approved", "final_approved"].includes(status)) return { label: "승인", tone: "success" };
  if (["pre_approval_submitted", "final_approval_submitted"].includes(status)) return { label: "검토 중", tone: "info" };
  return { label: "검토 중", tone: "neutral" };
}

export function getStatusTone(status) {
  if (["pre_approved", "final_approved"].includes(status)) return "success";
  if (status?.includes("revision")) return "warning";
  if (status?.includes("submitted")) return "info";
  if (status === "draft") return "neutral";
  return "neutral";
}

// ----------------------------------------------------
// 프로세스 시각화 메타 (new.md §5 / §11.3)
// ----------------------------------------------------
// step: 작성(0) → 사전승인(1) → 최종승인(2) → 완료(3) 의 4-스텝 미니 프로세스에서의 위치.
// phase: 현재 결재 구간 라벨. group: 대시보드 단순 집계용 그룹.
export const statusMeta = {
  draft: { phase: "작성", step: 0, group: "draft" },
  pre_approval_submitted: { phase: "사전승인", step: 1, group: "pending" },
  pre_approval_revision: { phase: "사전승인", step: 1, group: "revision" },
  pre_approved: { phase: "사전승인 완료", step: 2, group: "approved" },
  final_approval_submitted: { phase: "최종승인", step: 2, group: "pending" },
  final_approval_revision: { phase: "최종승인", step: 2, group: "revision" },
  final_approved: { phase: "완료", step: 3, group: "approved" },
};

export function getStatusMeta(status) {
  return statusMeta[status] || { phase: getStatusLabel(status), step: 0, group: "draft" };
}

// 지출 현황 필터/요약 카드용 정확 상태 순서(new.md §4.2/§4.3 권장안).
export const EXPENSE_STATUS_ORDER = [
  "draft",
  "pre_approval_submitted",
  "pre_approval_revision",
  "pre_approved",
  "final_approval_submitted",
  "final_approval_revision",
  "final_approved",
];

// 결재 구간 필터(new.md §4.2): 작성 중 / 사전승인 / 최종승인 / 종료.
export const EXPENSE_SEGMENTS = [
  { key: "all", label: "전체" },
  { key: "draft", label: "작성 중" },
  { key: "pre", label: "사전승인" },
  { key: "final", label: "최종승인" },
  { key: "closed", label: "종료" },
];

export function getExpenseSegment(status) {
  if (status === "draft") return "draft";
  if (status === "final_approved") return "closed";
  if (status?.startsWith("pre_")) return "pre";
  if (status?.startsWith("final_")) return "final";
  return "draft";
}

// 4-스텝 미니 프로세스(작성 → 사전승인 → 최종승인 → 완료)에서 각 스텝의 상태(new.md §5).
// state: "done"(통과) | "active"(현재 진행) | "revision"(보완 필요) | "todo"(미진입).
const PROCESS_STEP_LABELS = ["작성", "사전승인", "최종승인", "완료"];
const PROCESS_STEP_STATES = {
  draft: ["active", "todo", "todo", "todo"],
  pre_approval_submitted: ["done", "active", "todo", "todo"],
  pre_approval_revision: ["done", "revision", "todo", "todo"],
  pre_approved: ["done", "done", "todo", "todo"],
  final_approval_submitted: ["done", "done", "active", "todo"],
  final_approval_revision: ["done", "done", "revision", "todo"],
  final_approved: ["done", "done", "done", "done"],
};

export function getProcessSteps(status) {
  const states = PROCESS_STEP_STATES[status] || PROCESS_STEP_STATES.draft;
  return PROCESS_STEP_LABELS.map((label, i) => ({ label, state: states[i] }));
}
