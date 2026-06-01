export const statusLabels = {
  draft: "작성 중",
  pre_approval_submitted: "사전승인 제출",
  pre_approval_revision_requested: "사전승인 보완 요청",
  pre_approved: "사전승인 완료",
  executing: "집행 중",
  execution_submitted: "집행 증빙 제출",
  inspection_required: "검수 필요",
  inspection_submitted: "검수 제출",
  settlement_required: "정산 필요",
  settlement_submitted: "정산 제출",
  settlement_revision_requested: "정산 보완 요청",
  completed: "최종 완료",
  rejected: "반려",
};

export function getStatusLabel(status) {
  return statusLabels[status] || status || "-";
}

// 사전승인 이후 집행 → 검수 → 정산 → 완료로 이어지는 단계 전이 정의.
// actor: 해당 단계 진행 주체(founder | admin)
export const postApprovalStages = {
  pre_approved: { to: "executing", label: "집행 시작", actor: "founder" },
  executing: { to: "execution_submitted", label: "집행 증빙 제출", actor: "founder" },
  execution_submitted: { to: "inspection_submitted", label: "검수조서 제출", actor: "founder" },
  inspection_submitted: { to: "settlement_submitted", label: "정산 내역 제출", actor: "founder" },
  settlement_submitted: { to: "completed", label: "최종 완료 처리", actor: "admin" },
};

export function getNextStage(status) {
  return postApprovalStages[status] || null;
}

// 창업자 지출 현황용 단순 상태. 복잡한 단계 상태를 검토 중/승인/보완/반려로 압축한다.
// 신청은 작성 즉시 '검토 중'으로 접수되며 별도의 '제출 전' 단계는 없다.
export function getSimpleExpenseStatus(status) {
  if (status === "rejected") return { label: "반려", tone: "danger" };
  if (String(status || "").includes("revision")) return { label: "보완", tone: "warning" };
  const approvedLike = [
    "pre_approved", "executing", "execution_submitted",
    "inspection_required", "inspection_submitted",
    "settlement_required", "settlement_submitted", "completed",
  ];
  if (approvedLike.includes(status)) return { label: "승인", tone: "success" };
  return { label: "검토 중", tone: "neutral" };
}

export function getStatusTone(status) {
  if (["completed", "pre_approved"].includes(status)) return "success";
  if (["rejected"].includes(status)) return "danger";
  if (status?.includes("revision") || status?.includes("required")) return "warning";
  if (status?.includes("submitted")) return "info";
  return "neutral";
}

