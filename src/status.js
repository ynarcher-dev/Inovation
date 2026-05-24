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

export function getStatusTone(status) {
  if (["completed", "pre_approved"].includes(status)) return "success";
  if (["rejected"].includes(status)) return "danger";
  if (status?.includes("revision") || status?.includes("required")) return "warning";
  if (status?.includes("submitted")) return "info";
  return "neutral";
}

