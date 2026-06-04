// 예산안/예산 변경 승인 상태 정의.
// 가입 승인 상태(companies.approval_status)와는 의미가 분리된다.
//  - approval_status : 가입/참여기업 승인 (pending -> approved -> rejected)
//  - budget_status   : 기업별 예산안/변경 승인 (아래 상태머신)

export const BUDGET_STATUS = {
  NOT_SUBMITTED: "not_submitted",
  // 최초 예산안
  BUDGET_SUBMITTED: "budget_submitted",
  BUDGET_REVISION_REQUESTED: "budget_revision_requested",
  BUDGET_APPROVED: "budget_approved",
  // 예산 변경 요청 (최초 승인 이후)
  CHANGE_SUBMITTED: "change_submitted",
  CHANGE_REVISION_REQUESTED: "change_revision_requested",
  CHANGE_APPROVED: "change_approved",
};

export const budgetStatusLabels = {
  not_submitted: "예산안 미제출",
  budget_submitted: "예산안 검토 대기",
  budget_revision_requested: "예산안 보완 요청",
  budget_approved: "예산안 승인 완료",
  // 변경 흐름은 1차 수정/2차 배정을 구분하지 않는 중립 라벨("예산 변경")을 쓴다.
  // 차수 구분은 히스토리 '구분' 컬럼이 담당한다.
  change_submitted: "예산 변경 검토 대기",
  change_revision_requested: "예산 변경 보완 요청",
  change_approved: "예산 변경 승인 완료",
};

export function getBudgetStatusLabel(status) {
  return budgetStatusLabels[status] || status || "예산안 미제출";
}

// 단일 budget_status 를 1차(최초)/2차(변경·추가배정) 두 흐름으로 분리해 라벨링한다.
// 창업자 화면과 동일한 개념: 1차 승인(budget_approved) 이후에야 2차(change_*)로 진입한다.

// 1차(최초) 예산 상태 라벨. change_* 단계는 1차가 이미 승인된 이후이므로 "승인 완료"로 본다.
export const round1StatusLabels = {
  not_submitted: "미제출",
  budget_submitted: "검토 대기",
  budget_revision_requested: "보완 요청",
  budget_approved: "승인 완료",
};

export function getRound1StatusLabel(budgetStatus) {
  if (isChangeStatus(budgetStatus)) return "승인 완료";
  return round1StatusLabels[budgetStatus] || "미제출";
}

// 2차(변경·추가배정) 예산 상태 라벨. getRound2Status 가 산출한 none|pending|revision|approved 기준.
export const round2StatusLabels = {
  none: "미신청",
  pending: "검토 대기",
  revision: "보완 요청",
  approved: "승인 완료",
};

export function getRound2StatusLabel(round2Status) {
  return round2StatusLabels[round2Status] || round2StatusLabels.none;
}

// 창업자 대시보드 상단 배너에 노출할 상태별 카피/색상(tone).
// tone 값은 .notice-{tone} 클래스 및 배지 팔레트와 동일하게 맞춘다.
// dismissible: 사용자가 X 버튼으로 직접 닫을 수 있는 배너.
//  - 최초 예산(budget_*): 확정 예산이 없어 기능이 막히는 단계이므로 완료(success)만 닫기 허용.
//  - 예산 변경(change_*): 기존 확정 예산으로 계속 작업 가능한 단계라 모든 상태를 닫기 허용.
export const founderBudgetBanners = {
  not_submitted: {
    tone: "info",
    message: "예산안이 아직 등록되지 않았습니다. 예산을 작성·제출해 승인을 받으면 지출 신청을 시작할 수 있습니다.",
  },
  budget_submitted: {
    tone: "info",
    message: "예산안이 검토 중입니다. 승인 완료 후 지출 신청을 시작할 수 있습니다.",
  },
  budget_revision_requested: {
    tone: "warning",
    message: "예산안에 보완 요청이 있습니다. 검토 의견을 확인해 수정한 뒤 다시 제출해 주세요.",
  },
  budget_approved: {
    tone: "success",
    message: "예산이 확정되었습니다. 이제 지출 신청을 진행할 수 있습니다.",
    dismissible: true,
  },
  change_submitted: {
    tone: "info",
    message: "예산 변경 요청이 검토 중입니다. 승인 완료 전까지는 변경한 금액이 지출 가능 예산에 반영되지 않습니다.",
    dismissible: true,
  },
  change_revision_requested: {
    tone: "warning",
    message: "예산 변경 요청에 보완 요청이 있습니다. 검토 의견을 확인해 금액을 수정한 뒤 다시 제출해 주세요.",
    dismissible: true,
  },
  change_approved: {
    tone: "success",
    message: "예산 변경이 승인되어 반영되었습니다. 승인된 예산으로 지출 신청을 진행할 수 있습니다.",
    dismissible: true,
  },
};

export function getBudgetStatusTone(status) {
  if (["budget_approved", "change_approved"].includes(status)) return "success";
  if (status?.includes("revision")) return "warning";
  // 검토 대기(*_submitted)는 별도 강조 없이 회색(neutral)으로 표시
  return "neutral";
}

// 확정(승인된) 예산이 존재하여 지출 사용 신청이 가능한 상태인지 판단한다.
// 최초 예산안이 한 번이라도 승인되면(이후 변경 요청 중/보완 포함) 기존 확정 예산으로 지출 가능하다.
export function hasApprovedBudget(status) {
  return [
    BUDGET_STATUS.BUDGET_APPROVED,
    BUDGET_STATUS.CHANGE_SUBMITTED,
    BUDGET_STATUS.CHANGE_REVISION_REQUESTED,
    BUDGET_STATUS.CHANGE_APPROVED,
  ].includes(status);
}

// 현재 검토 대기 중인(관리자 판단이 필요한) 예산 제출 상태인지.
export function isBudgetPendingReview(status) {
  return [BUDGET_STATUS.BUDGET_SUBMITTED, BUDGET_STATUS.CHANGE_SUBMITTED].includes(status);
}

// 변경 요청(최초 승인 이후) 흐름의 상태인지.
export function isChangeStatus(status) {
  return typeof status === "string" && status.startsWith("change_");
}

// 창업자가 예산안을 (재)작성/제출할 수 있는 상태인지.
export function canEditBudget(status) {
  return [
    BUDGET_STATUS.NOT_SUBMITTED,
    BUDGET_STATUS.BUDGET_REVISION_REQUESTED,
    BUDGET_STATUS.BUDGET_APPROVED, // 승인된 이후엔 '변경 요청' 으로 진입
    BUDGET_STATUS.CHANGE_REVISION_REQUESTED,
    BUDGET_STATUS.CHANGE_APPROVED,
  ].includes(status);
}
