import { mountShell, showError, setText } from "../../app.js";
import { requireRole } from "../../auth.js";
import { getAdminDashboard } from "../../api.js";
import { escapeHtml } from "../../utils.js";

// 예산 승인 완료로 보는 상태
const BUDGET_APPROVED_STATUSES = ["budget_approved", "change_approved"];

// ── 전체 통계 ────────────────────────────────────────
function renderStatsSection({ companies, supportPrograms, companyCount }) {
  const activePrograms = (supportPrograms || []).filter((p) => p.active !== false).length;
  const signupApproved = companies.filter((c) => c.approval_status === "approved").length;
  const budgetApproved = companies.filter((c) => BUDGET_APPROVED_STATUSES.includes(c.budget_status)).length;

  const cards = [
    { label: "전체 기업 수", value: companyCount ?? companies.length },
    { label: "진행 중인 사업 수", value: activePrograms },
    { label: "가입 승인 완료 기업 수", value: signupApproved },
    { label: "예산 승인 완료 기업 수", value: budgetApproved },
  ];

  document.querySelector("[data-stats-section]").innerHTML = cards
    .map((card) => `<div class="card metric"><span>${escapeHtml(card.label)}</span><strong>${card.value}</strong></div>`)
    .join("");
}

try {
  mountShell();
  const user = await requireRole(["admin", "super_admin"]);
  if (user) {
    const { companies, supportPrograms, companyCount } = await getAdminDashboard();
    setText("[data-user-name]", user.profile.name);
    renderStatsSection({ companies, supportPrograms, companyCount });
  }
} catch (error) {
  showError(error);
}
