import { mountShell, runWithErrorBoundary, showError, updateAdminNavBadges, showToast, showConfirm } from "../../app.js";
import { approveCompany, getAdminDashboard, rejectCompany } from "../../api.js";
import { requireRole } from "../../auth.js";
import { escapeHtml, formatDate } from "../../utils.js";
import { FilterToolbar, bindFilters, fillFilterSelect, readFilters } from "../../components/admin/FilterToolbar.js";
import { createPaginatedList } from "../../components/admin/Pagination.js";

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

// 열 고정 너비(%). '승인 대기'(관리 열 有)와 '전체 목록'(관리 열 빈칸)이 동일한 너비로 정렬되도록
//   두 표 모두 같은 colgroup 을 쓰고, 전체 목록은 관리 열 자리를 비워 둔다.
const SIGNUP_COL_WIDTHS = [13, 16, 9, 26, 9, 13, 14]; // 기업·이메일·대표자·참가사업·상태·가입일·관리

function SignupTable(companies, options = {}) {
  if (!companies?.length) {
    return `<p class="empty">${escapeHtml(options.emptyText || "표시할 가입 신청이 없습니다.")}</p>`;
  }
  const showActions = options.actions === true;
  const colgroup = `<colgroup>${SIGNUP_COL_WIDTHS.map((w) => `<col style="width:${w}%" />`).join("")}</colgroup>`;
  const href = (id) => `company-detail.html?id=${encodeURIComponent(id)}`;
  return `
    <div class="table-wrap">
      <table class="fixed-table">
        ${colgroup}
        <thead>
          <tr>
            <th>기업명</th>
            <th>ID(이메일)</th>
            <th>대표자</th>
            <th>참가 사업</th>
            <th>승인 상태</th>
            <th>가입일</th>
            <th>${showActions ? "관리" : ""}</th>
          </tr>
        </thead>
        <tbody>
          ${companies.map((company) => `
            <tr data-href="${href(company.id)}">
              <td><a href="${href(company.id)}">${escapeHtml(company.name)}</a></td>
              <td class="wrap-cell">${escapeHtml(company.owner_email || "-")}</td>
              <td>${escapeHtml(company.representative_name || "-")}</td>
              <td>${escapeHtml(company.support_programs?.name || "-")}</td>
              <td>${escapeHtml(approvalText[company.approval_status] || company.approval_status || "-")}</td>
              <td>${formatDate(company.created_at)}</td>
              <td>${showActions ? `
                  <div class="actions">
                    <button class="button small" type="button" data-approve-company="${escapeHtml(company.id)}">승인</button>
                    <button class="button small danger" type="button" data-reject-company="${escapeHtml(company.id)}">반려</button>
                  </div>
              ` : ""}</td>
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
    company.owner_email,
    company.representative_name,
    company.business_number,
    company.support_programs?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(term);
}

// 표 행 전체를 클릭하면 상세로 이동. 행 안의 링크/버튼 클릭은 해당 동작이 우선한다.
function bindRowNavigation(container) {
  container.querySelectorAll("tr[data-href]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) return;
      window.location.href = row.dataset.href;
    });
  });
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
      search: { placeholder: "기업명 · ID(이메일) · 대표자 검색", ariaLabel: "가입 기업 검색" },
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

    // 승인 대기 표의 승인/반려 버튼 바인딩. 페이지 전환마다 다시 그려지므로 컨테이너 범위로 재바인딩한다.
    const bindPendingActions = (container) => {
      container.querySelectorAll("[data-approve-company]").forEach((button) => {
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

      container.querySelectorAll("[data-reject-company]").forEach((button) => {
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

    const pendingList = createPaginatedList({
      container: document.querySelector("[data-pending-signups]"),
      renderItems: (rows) => SignupTable(rows, { actions: true }),
      onRendered: (container) => { bindRowNavigation(container); bindPendingActions(container); },
    });
    const allList = createPaginatedList({
      container: document.querySelector("[data-all-signups]"),
      renderItems: (rows) => SignupTable(rows),
      onRendered: bindRowNavigation,
    });

    const renderAll = () => {
      const { term, selects, dateFrom, dateTo } = readFilters(toolbar);
      const filtered = dashboard.companies.filter((company) =>
        (selects.status === "all" || company.approval_status === selects.status)
        && (selects.program === "all" || company.support_program_id === selects.program)
        && inDateRange(company, dateFrom, dateTo)
        && matchesSearch(company, term)
      );
      allList.setItems(filtered);
    };

    const render = () => {
      const pending = dashboard.companies.filter((company) => company.approval_status === "pending");
      pendingList.setItems(pending);
      renderAll();
      updateAdminNavBadges();
    };

    bindFilters(toolbar, renderAll);

    render();
  }
} catch (error) {
  showError(error);
}

