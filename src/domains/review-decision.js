// 검토 결정(expense_reviews.decision) 라벨/톤 정의.
// 관리자 상세, 창업자 상세, 검토 이력 테이블 3곳에 흩어져 있던 매핑을 한 곳으로 모은다.
// 각 화면은 이 맵에 없는 decision 을 걸러내므로, 새 결정값을 추가하면 반드시 여기에 등록한다.
//   approved           : 승인
//   revision_requested : 보완요청 (창업자가 수정 후 재제출)
//   cancelled          : 승인 취소 (관리자가 자신의 승인 결정을 되돌림 — status.js 의 승인 취소 규칙 참고)
export const REVIEW_DECISIONS = {
  approved: { label: "승인", historyLabel: "승인 완료", tone: "success" },
  revision_requested: { label: "보완요청", historyLabel: "보완 요청", tone: "warning" },
  cancelled: { label: "승인 취소", historyLabel: "승인 취소", tone: "danger" },
};

export function getReviewDecisionMeta(decision) {
  return REVIEW_DECISIONS[decision] || null;
}

// 화면에 노출할 수 있는 결정값인지(알 수 없는 값은 목록에서 제외한다).
export function isKnownReviewDecision(decision) {
  return Boolean(REVIEW_DECISIONS[decision]);
}
