import { mountShell, runWithErrorBoundary, showError, updateAdminNavBadges, showToast, showConfirm } from "../../app.js";
import { approveCompany, getAdminDashboard, rejectCompany } from "../../api.js";
import { requireRole } from "../../auth.js";
import { escapeHtml, formatDate } from "../../utils.js";
import { FilterToolbar, bindFilters, fillFilterSelect, readFilters } from "../../components/admin/FilterToolbar.js";

const SIGNUP_STATUS_OPTIONS = [
  { value: "all", label: "전체 상태" },
  { value: "pending", label: "승인 대기" },
  { value: "approved", label: "승인 완료" },
  { value: "rejected", label: "반려" },
];

const approvalText = {
  pending: "승인 대기",
  approved: "승인 완료",
  rejected: "반려",
};

function SignupTable(companies, options = {}) {
  if (!companies?.length) return `<p class="empty">표시할 가입 신청이 없습니다.</p>`;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>기업명</th>
            <th>대표자</th>
            <th>사업자등록번호</th>
            <th>참가 사업</th>
            <th>승인 상태</th>
            <th>가입일</th>
            ${options.actions ? "<th>관리</th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${companies.map((company) => `
            <tr>
              <td><a href="company-detail.html?id=${encodeURIComponent(company.id)}">${escapeHtml(company.name)}</a></td>
              <td>${escapeHtml(company.representative_name || "-")}</td>
              <td>${escapeHtml(company.business_number || "-")}</td>
              <td>${escapeHtml(company.support_programs?.name || "-")}</td>
              <td>${escapeHtml(approvalText[company.approval_status] || company.approval_status || "-")}</td>
              <td>${formatDate(company.created_at)}</td>
              ${options.actions ? `
                <td>
                  <div class="actions">
                    <button class="button small" type="button" data-approve-company="${escapeHtml(company.id)}">승인</button>
                    <button class="button small danger" type="button" data-reject-company="${escapeHtml(company.id)}">반려</button>
                  </div>
                </td>
              ` : ""}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function matchesSearch(company, term) {
  if (!term) return true;
  const haystack = [
    company.name,
    company.representative_name,
    company.business_number,
    company.support_programs?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(term);
}

function inDateRange(company, from, to) {
  if (!from && !to) return true;
  const created = (company.created_at || "").slice(0, 10);
  if (!created) return false;
  if (from && created < from) return false;
  if (to && created > to) return false;
  return true;
}

try {
  mountShell();
  const user = await requireRole(["admin", "super_admin"]);
  if (user) {
    let dashboard = await getAdminDashboard();
    const toolbar = document.querySelector("[data-signup-toolbar]");
    toolbar.innerHTML = FilterToolbar({
      search: { placeholder: "기업명 · 대표자 · 사업자등록번호 검색", ariaLabel: "가입 기업 검색" },
      selects: [
        { key: "status", ariaLabel: "승인 상태 필터", options: SIGNUP_STATUS_OPTIONS },
        { key: "program", ariaLabel: "참가 사업 필터", options: [{ value: "all", label: "전체 참가 사업" }] },
      ],
      dateRange: { fromLabel: "가입일 시작", toLabel: "가입일 종료" },
    });
    fillFilterSelect(
      toolbar,
      "program",
      (dashboard.supportPrograms || []).map((p) => ({ value: p.id, label: p.name }))
    );

    const renderAll = () => {
      const { term, selects, dateFrom, dateTo } = readFilters(toolbar);
      const filtered = dashboard.companies.filter((company) =>
        (selects.status === "all" || company.approval_status === selects.status)
        && (selects.program === "all" || company.support_program_id === selects.program)
        && inDateRange(company, dateFrom, dateTo)
        && matchesSearch(company, term)
      );
      document.querySelector("[data-all-signups]").innerHTML = SignupTable(filtered);
    };

    const render = () => {
      const pending = dashboard.companies.filter((company) => company.approval_status === "pending");
      document.querySelector("[data-pending-signups]").innerHTML = SignupTable(pending, { actions: true });
      renderAll();
      updateAdminNavBadges();

      document.querySelectorAll("[data-approve-company]").forEach((button) => {
        button.addEventListener("click", async () => {
          const ok = await showConfirm("이 기업의 가입을 승인하시겠습니까?", {
            title: "가입 승인",
            confirmText: "승인",
            cancelText: "취소",
          });
          if (!ok) return;
          await runWithErrorBoundary(async () => {
            await approveCompany(button.dataset.approveCompany, user.id);
            dashboard = await getAdminDashboard();
            render();
            showToast("가입이 승인되었습니다.", { type: "success" });
          }, { button });
        });
      });

      document.querySelectorAll("[data-reject-company]").forEach((button) => {
        button.addEventListener("click", async () => {
          const ok = await showConfirm("이 기업의 가입을 반려하시겠습니까?", {
            title: "가입 반려",
            confirmText: "반려",
            cancelText: "취소",
            tone: "danger",
          });
          if (!ok) return;
          await runWithErrorBoundary(async () => {
            await rejectCompany(button.dataset.rejectCompany);
            dashboard = await getAdminDashboard();
            render();
            showToast("가입이 반려되었습니다.", { type: "success" });
          }, { button });
        });
      });
    };

    bindFilters(toolbar, renderAll);

    render();
  }
} catch (error) {
  showError(error);
}

