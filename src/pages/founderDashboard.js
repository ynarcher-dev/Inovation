import { mountShell, runWithErrorBoundary, showError, setText } from "../app.js";
import { requireRole } from "../auth.js";
import { getFounderDashboard, submitFounderBudgetAllocations, downloadStoredFile, uploadFile, updateBusinessPlan } from "../api.js";
import { FounderExpenseStatusTable } from "../components/FounderExpenseStatusTable.js";
import { BudgetTreeView } from "../components/BudgetTreeView.js";
import { getSimpleExpenseStatus } from "../status.js";
import { hasApprovedBudget, isBudgetPendingReview, getBudgetStatusLabel, getBudgetStatusTone, founderBudgetBanners } from "../budgetStatus.js";
import { escapeHtml, formatCurrency, formatDate, formatNumber, parseNumber } from "../utils.js";

// 관리자가 등록한 첨부파일(안내자료) 목록 — 사업개요 탭용
// 입력한 필드 내용(제목)과 파일 다운로드를 좌/우로 분리해 보여준다.
function AttachmentList(items) {
  if (!items?.length) return `<p class="empty">등록된 첨부파일이 없습니다.</p>`;
  return `<div class="attachment-list">${items.map((it) => {
    const filename = it.content || "첨부파일";
    const fileBlock = it.link_url
      ? `<div class="attachment-file">
           <span class="attachment-filename" title="${escapeHtml(filename)}">${escapeHtml(filename)}</span>
           <button type="button" class="button small secondary"
             data-attachment-download="${escapeHtml(it.link_url)}"
             data-attachment-name="${escapeHtml(filename)}">다운로드</button>
         </div>`
      : `<span class="muted caption">첨부된 파일 없음</span>`;
    return `
      <div class="attachment-row">
        <div class="attachment-info">
          <span class="attachment-title">📄 ${escapeHtml(it.title)}</span>
        </div>
        ${fileBlock}
      </div>`;
  }).join("")}</div>`;
}

// 예산 제출안의 비목별 등록/변경 내역 — 히스토리 행 클릭 시 펼쳐지는 상세
function BudgetHistoryDetail(s) {
  if (!s.items?.length) return `<p class="muted caption" style="margin:0;">비목별 상세 내역이 없습니다.</p>`;
  const isChange = s.type === "change";
  const isApproved = ["budget_approved", "change_approved"].includes(s.status);
  return `
    <table class="budget-history-detail-table">
      <thead>
        <tr>
          <th>비목</th>
          ${isChange ? `<th class="num">변경 전</th>` : ``}
          <th class="num">${isChange ? "변경 요청액" : "등록 금액"}</th>
          ${isChange ? `<th class="num">증감</th>` : ``}
          ${isApproved ? `<th class="num">승인 금액</th>` : ``}
        </tr>
      </thead>
      <tbody>
        ${s.items.map((it) => {
          const prev = Number(it.previous_allocated_amount || 0);
          const req = Number(it.requested_allocated_amount || 0);
          const delta = req - prev;
          const deltaLabel = delta === 0 ? "변동 없음" : `${delta > 0 ? "▲" : "▼"} ${formatCurrency(Math.abs(delta))}`;
          const deltaClass = delta > 0 ? "delta-up" : delta < 0 ? "delta-down" : "delta-none";
          const appr = it.approved_allocated_amount;
          return `
            <tr>
              <td>${escapeHtml(it.title)}</td>
              ${isChange ? `<td class="num">${formatCurrency(prev)}</td>` : ``}
              <td class="num">${formatCurrency(req)}</td>
              ${isChange ? `<td class="num ${deltaClass}">${deltaLabel}</td>` : ``}
              ${isApproved ? `<td class="num">${appr == null ? "-" : formatCurrency(Number(appr))}</td>` : ``}
            </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

// 예산안 제출/변경 요청과 검토 결과 이력 — 예산 변경 히스토리 탭용
// 각 행을 클릭하면 비목별 등록/변경 내역이 펼쳐진다.
function BudgetHistoryTable(submissions) {
  if (!submissions?.length) return `<p class="empty">예산 제출/변경 이력이 없습니다.</p>`;
  const typeLabel = (t) => (t === "change" ? "예산 변경" : "예산안 등록");
  return `
    <div class="table-wrap">
      <table class="review-history-table budget-history-table">
        <thead>
          <tr>
            <th class="expand-col" aria-hidden="true"></th>
            <th>구분</th>
            <th>제출일</th>
            <th>상태</th>
            <th>검토일</th>
            <th class="comment-header">사유 / 검토 의견</th>
          </tr>
        </thead>
        <tbody>
          ${submissions.map((s, i) => `
            <tr class="history-row" data-history-row="${i}" tabindex="0" role="button" aria-expanded="false">
              <td class="expand-col"><span class="expand-icon" aria-hidden="true">▸</span></td>
              <td>${escapeHtml(typeLabel(s.type))}</td>
              <td class="date-cell">${formatDate(s.submitted_at)}</td>
              <td><span class="badge badge-${getBudgetStatusTone(s.status)}">${escapeHtml(getBudgetStatusLabel(s.status))}</span></td>
              <td class="date-cell">${s.reviewed_at ? formatDate(s.reviewed_at) : "-"}</td>
              <td class="comment-cell">${escapeHtml(s.review_comment || s.reason || "-")}</td>
            </tr>
            <tr class="history-detail-row" data-history-detail="${i}" hidden>
              <td colspan="6">
                <div class="history-detail">
                  <h4 class="history-detail-title">비목별 ${s.type === "change" ? "변경" : "등록"} 내역</h4>
                  ${BudgetHistoryDetail(s)}
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>`;
}

try {
  mountShell();
  const user = await requireRole(["founder"]);
  if (user) {
    let detail = await getFounderDashboard();
    const { expenses, manualLinks } = detail;
    const approvalNotice = document.querySelector("[data-approval-notice]");
    const newExpenseLink = document.querySelector("[data-new-expense-link]");

    // Tabs switching
    const tabButtons = document.querySelectorAll(".tab-button");
    const tabContents = document.querySelectorAll(".tab-content");
    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetTab = btn.dataset.tab;
        tabButtons.forEach((b) => b.classList.remove("active"));
        tabContents.forEach((c) => c.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById(targetTab)?.classList.add("active");
      });
    });

    // Recalculate allocation sums dynamically in editing mode
    const recalculateTreeSums = () => {
      const inputs = document.querySelectorAll("[data-allocation-input]");
      const values = {};
      inputs.forEach((input) => { values[input.dataset.allocationInput] = parseNumber(input.value); });

      const getSum = (node) => {
        if (node.isLeaf) return values[node.id] || 0;
        return node.children ? node.children.reduce((s, c) => s + getSum(c), 0) : 0;
      };

      const updateDom = (nodes) => {
        for (const node of nodes) {
          if (!node.isLeaf) {
            const sum = getSum(node);
            const cell = document.querySelector(`[data-parent-allocation="${node.id}"]`);
            if (cell) cell.textContent = formatCurrency(sum);
            if (node.children) updateDom(node.children);
          }
        }
      };

      updateDom(detail.budgetTree);
      const grandTotal = detail.budgetTree.reduce((s, root) => s + getSum(root), 0);
      document.getElementById("budget-edit-total").textContent = formatCurrency(grandTotal);
    };

    // 비목 트리에서 leaf 노드만 평탄화한다.
    const collectLeaves = (nodes, acc = []) => {
      for (const node of nodes || []) {
        if (node.isLeaf) acc.push(node);
        else if (node.children) collectLeaves(node.children, acc);
      }
      return acc;
    };

    // 최초 예산안 작성(mode: initial) 또는 예산 변경 요청(mode: change) 편집 화면.
    const renderEditableTree = (opts = {}) => {
      const isChange = opts.mode === "change";
      document.getElementById("budget-empty-card").hidden = true;
      const container = document.getElementById("budget-tree-container");
      container.hidden = false;

      // 이미 사용(승인/제출)된 금액 = 비목별 감액 하한.
      const leaves = collectLeaves(detail.budgetTree);
      const floorByLeafId = {};
      const titleByLeafId = {};
      for (const leaf of leaves) {
        floorByLeafId[leaf.id] = Number(leaf.approved_amount || 0) + Number(leaf.pending_amount || 0);
        titleByLeafId[leaf.id] = leaf.title;
      }

      const reasonBlock = isChange ? `
        <div style="margin-bottom:12px;">
          <label for="budget-change-reason" style="display:block; font-weight:600; margin-bottom:4px;">변경 사유 (필수)</label>
          <textarea id="budget-change-reason" placeholder="예산 변경이 필요한 사유를 구체적으로 작성하세요." style="width:100%; height:64px; box-sizing:border-box;"></textarea>
        </div>` : "";

      const treeEl = document.querySelector("[data-budget-tree]");
      treeEl.innerHTML = reasonBlock + BudgetTreeView(detail.budgetTree, true, detail.company?.support_programs?.level_labels) + `
        <div style="margin-top: 24px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--line); padding-top: 16px;">
          <div>
            <strong>총 배정 금액: </strong>
            <span id="budget-edit-total" style="font-size: var(--text-lg); font-weight: 700; color: var(--primary);">0원</span>
          </div>
          <div class="actions">
            <button class="button" id="save-budget-btn" type="submit">${isChange ? "변경 요청 제출" : "승인 신청"}</button>
            <button class="button secondary" id="cancel-budget-btn" type="button">취소</button>
          </div>
        </div>
      `;

      recalculateTreeSums();

      const table = document.getElementById("budget-matrix-table");
      table.addEventListener("input", (event) => {
        if (event.target.classList.contains("budget-alloc-input")) {
          const cursorAtEnd = event.target.selectionStart === event.target.value.length;
          event.target.value = formatNumber(event.target.value);
          if (cursorAtEnd) {
            event.target.setSelectionRange(event.target.value.length, event.target.value.length);
          }
          recalculateTreeSums();
        }
      });

      document.getElementById("cancel-budget-btn").addEventListener("click", () => { renderInitialState(); });

      // onsubmit 할당으로 재진입 시 핸들러 중복 누적을 방지한다.
      document.getElementById("budget-form").onsubmit = async (event) => {
        event.preventDefault();
        const saveBtn = document.getElementById("save-budget-btn");
        const cancelBtn = document.getElementById("cancel-budget-btn");

        const inputs = document.querySelectorAll("[data-allocation-input]");
        const allocations = Array.from(inputs).map((input) => ({
          support_program_budget_id: input.dataset.allocationInput,
          allocated_amount: parseNumber(input.value),
        }));

        // 변경 사유 필수(변경 요청)
        let reason = "";
        if (isChange) {
          reason = document.getElementById("budget-change-reason").value.trim();
          if (!reason) {
            window.alert("예산 변경 사유를 입력해야 합니다.");
            document.getElementById("budget-change-reason").focus();
            return;
          }
        }

        // 감액 하한 검증: 이미 승인/제출된 지출보다 낮게 줄일 수 없다.
        const violations = allocations.filter((a) => a.allocated_amount < (floorByLeafId[a.support_program_budget_id] || 0));
        if (violations.length) {
          const lines = violations.map((v) => `· ${titleByLeafId[v.support_program_budget_id] || v.support_program_budget_id}: 최소 ${formatCurrency(floorByLeafId[v.support_program_budget_id] || 0)}`);
          window.alert("이미 승인/제출된 지출보다 낮게 예산을 줄일 수 없습니다.\n\n" + lines.join("\n"));
          return;
        }

        saveBtn.disabled = true;
        cancelBtn.disabled = true;
        await runWithErrorBoundary(async () => {
          await submitFounderBudgetAllocations(detail.company.id, allocations, reason);
          window.alert(isChange
            ? "예산 변경 요청이 제출되었습니다. 관리자 승인 전까지 기존 확정 예산이 유지됩니다."
            : "예산안이 제출되었습니다. 관리자 승인 후 지출 신청이 가능합니다.");
          detail = await getFounderDashboard();
          renderInitialState();
        }, { button: saveBtn });
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
      };
    };

    const renderInitialState = () => {
      const hasAllocations = detail.allocations && detail.allocations.length > 0;
      
      // Top Cards
      setText("[data-company-name]", detail.company?.name || "-");
      setText("[data-representative]", detail.company?.representative_name || "-");
      setText("[data-support-program]", detail.company?.support_programs?.name || "-");
      // 참가 사업 아래 협약 기간 표시 (양쪽 날짜가 모두 있을 때만)
      const agreeStart = detail.company?.agreement_start_date;
      const agreeEnd = detail.company?.agreement_end_date;
      setText("[data-agreement]", (agreeStart || agreeEnd)
        ? `협약기간 ${formatDate(agreeStart)} ~ ${formatDate(agreeEnd)}`
        : "협약기간 미정");
      
      const supportTotal = Number(detail.company?.support_total_amount || 0);
      setText("[data-support-total]", `${formatCurrency(supportTotal)}`);
      
      // Approved total
      const approvedExpenses = expenses.filter((r) => r.status === "pre_approved");
      const approvedTotalSum = approvedExpenses.reduce((s, r) => s + Number(r.amount_supply || 0), 0);
      setText("[data-approved-total]", formatCurrency(approvedTotalSum));

      // Execution rate
      const rate = supportTotal ? Math.round((approvedTotalSum / supportTotal) * 100) : 0;
      setText("[data-execution-rate]", `${rate}% 집행 완료`);

      // Counters — 지출 현황 표와 동일한 단순 상태(승인/대기/보완/반려) 기준으로 집계한다.
      const countByLabel = (label) => expenses.filter((r) => getSimpleExpenseStatus(r.status).label === label).length;
      setText("[data-approved-count]", countByLabel("승인"));
      setText("[data-pending-count]", countByLabel("검토 중"));
      setText("[data-revision-count]", countByLabel("보완"));
      setText("[data-rejected-count]", countByLabel("반려"));

      // Business Plan — 상단 요약 카드(사업 계획서), 최종 수정일자 반영
      const bp = detail.company?.business_plan;
      setText("[data-bp-name]", bp?.original_filename || "미등록");
      // 첨부된 파일이 있을 때만 다운로드 링크 스타일/커서를 적용한다.
      document.getElementById("bp-download-trigger")?.classList.toggle("bp-name-link", !!bp?.original_filename);
      const bpModifiedAt = bp?.updated_at || bp?.approved_at;
      setText("[data-bp-updated]", bpModifiedAt ? `최종 수정일: ${formatDate(bpModifiedAt)}` : "최종 수정일: -");

      // 탭 3: 예산 변경 히스토리 (제출/변경 후에도 갱신)
      const budgetHistoryEl = document.querySelector("[data-budget-history]");
      if (budgetHistoryEl) {
        budgetHistoryEl.innerHTML = BudgetHistoryTable(detail.budgetSubmissions);
        if (!budgetHistoryEl.dataset.bound) {
          budgetHistoryEl.dataset.bound = "1";
          const toggleRow = (row) => {
            const idx = row.dataset.historyRow;
            const detailRow = budgetHistoryEl.querySelector(`[data-history-detail="${idx}"]`);
            if (!detailRow) return;
            const willOpen = detailRow.hidden;
            detailRow.hidden = !willOpen;
            row.classList.toggle("expanded", willOpen);
            row.setAttribute("aria-expanded", String(willOpen));
          };
          budgetHistoryEl.addEventListener("click", (e) => {
            const row = e.target.closest("[data-history-row]");
            if (row) toggleRow(row);
          });
          budgetHistoryEl.addEventListener("keydown", (e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            const row = e.target.closest("[data-history-row]");
            if (row) { e.preventDefault(); toggleRow(row); }
          });
        }
      }

      // 보완 요청 안내는 대시보드 상단 알람으로 띄우지 않는다.
      // 각 건의 상태는 지출 현황 표의 행 색상/배지로만 노출한다.

      // 가입 승인 상태와 예산안 승인 상태를 분리해 지출 신청 가능 여부를 안내한다.
      const signupApproved = detail.company?.approval_status === "approved";
      const budgetStatus = detail.company?.budget_status || "not_submitted";
      // 검토 대기(*_submitted) 중에는 확정 예산이 있어도 지출 신청을 제한한다.
      const canRequestExpense = signupApproved && hasApprovedBudget(budgetStatus) && !isBudgetPendingReview(budgetStatus);

      // 상단 배너: 톤(색상) + 카피 + (dismissible 상태만) X 닫기 버튼.
      // 한 번 닫은 배너라도 상태가 바뀌면(새 승인/변경 사이클) 다시 보이도록 닫힘 기록을 지운다.
      Object.keys(founderBudgetBanners).forEach((k) => {
        if (founderBudgetBanners[k].dismissible && k !== budgetStatus) {
          localStorage.removeItem(`founder_banner_dismissed:${k}`);
        }
      });
      const renderApprovalNotice = ({ tone, message, dismissible, key }) => {
        const dismissKey = dismissible && key ? `founder_banner_dismissed:${key}` : null;
        if (dismissKey && localStorage.getItem(dismissKey) === "1") {
          approvalNotice.hidden = true;
          return;
        }
        approvalNotice.hidden = false;
        approvalNotice.className = `notice notice-${tone}${dismissible ? " notice--dismissible" : ""}`;
        approvalNotice.innerHTML =
          `<span class="notice__text">${escapeHtml(message)}</span>` +
          (dismissible ? `<button type="button" class="notice__close" aria-label="닫기">&times;</button>` : "");
        if (dismissible) {
          approvalNotice.querySelector(".notice__close").addEventListener("click", () => {
            approvalNotice.hidden = true;
            if (dismissKey) localStorage.setItem(dismissKey, "1");
          });
        }
      };

      if (!signupApproved) {
        // 세션 유지 중 관리자가 반려/승인취소한 엣지 케이스 대비(로그인 단계에서 1차 차단됨).
        renderApprovalNotice(detail.company?.approval_status === "rejected"
          ? { tone: "danger", message: "가입이 반려되었습니다. 관리자에게 문의해 주세요." }
          : { tone: "info", message: "가입 승인 대기 중입니다. 관리자 승인 후 예산안 작성과 지출 신청이 가능합니다." });
      } else {
        const banner = founderBudgetBanners[budgetStatus];
        if (banner) {
          renderApprovalNotice({ ...banner, key: budgetStatus });
        } else {
          approvalNotice.hidden = true;
        }
      }

      if (canRequestExpense) {
        newExpenseLink.classList.remove("disabled");
        newExpenseLink.style.pointerEvents = "auto";
      } else {
        newExpenseLink.classList.add("disabled");
        newExpenseLink.style.pointerEvents = "none";
      }

      // 예산 관리 탭: 확정 예산 > 검토 대기 제출안 > 미작성 순으로 표시한다.
      const emptyCard = document.getElementById("budget-empty-card");
      const treeContainer = document.getElementById("budget-tree-container");
      const treeEl = document.querySelector("[data-budget-tree]");
      const pending = detail.pendingSubmission;

      // 예산 변경 요청 버튼: 확정 예산이 있으면 항상 노출하되, 검토 중에는 비활성화(회색)한다.
      const showChangeBtn = hasApprovedBudget(budgetStatus);
      const changeDisabled = isBudgetPendingReview(budgetStatus);
      const changeBtn = showChangeBtn
        ? `<div style="text-align:right; margin-bottom:8px;"><button class="button${changeDisabled ? " disabled" : ""}" id="start-change-btn" type="button"${changeDisabled ? " disabled" : ""}>예산 변경 요청</button></div>`
        : "";
      const bindChangeBtn = () => {
        if (showChangeBtn && !changeDisabled) {
          document.getElementById("start-change-btn").addEventListener("click", () => renderEditableTree({ mode: "change" }));
        }
      };

      if (pending && isBudgetPendingReview(budgetStatus) && detail.pendingBudgetTree) {
        // 검토 대기 중인 제출안을 읽기 전용으로 보여준다(확정 전이므로 수정 불가).
        // 검토 대기 안내는 상단 배너(approvalNotice)에서 이미 노출하므로 트리 위 노티는 생략한다.
        emptyCard.hidden = true;
        treeContainer.hidden = false;
        treeEl.innerHTML =
          changeBtn +
          BudgetTreeView(detail.pendingBudgetTree, false, detail.company?.support_programs?.level_labels);
        bindChangeBtn();
      } else if (!hasAllocations) {
        emptyCard.hidden = false;
        treeContainer.hidden = true;
      } else {
        // 변경 보완/반려 등 상태 안내는 상단 배너로 일원화했으므로 트리 위 노티는 두지 않는다.
        emptyCard.hidden = true;
        treeContainer.hidden = false;
        treeEl.innerHTML = changeBtn + BudgetTreeView(detail.budgetTree, false, detail.company?.support_programs?.level_labels);
        bindChangeBtn();
      }
    };

    document.getElementById("start-budget-btn").addEventListener("click", () => { renderEditableTree(); });

    setText("[data-user-name]", user.profile.name);

    // 첨부파일 다운로드 버튼 바인딩(사업개요 탭) — 첨부한 실제 파일을 원본 파일명으로 내려받는다.
    const bindGuidanceDownloads = (root) => {
      root?.querySelectorAll("[data-attachment-download]").forEach((button) => {
        button.addEventListener("click", async () => {
          await runWithErrorBoundary(async () => {
            await downloadStoredFile(button.dataset.attachmentDownload, button.dataset.attachmentName);
          }, { button });
        });
      });
    };

    // 탭 1: 지출 현황 — 신청명/금액(공급가액+부가세)/제출일/상태
    document.querySelector("[data-expense-table]").innerHTML = FounderExpenseStatusTable(expenses);

    // 탭 4: 사업개요 및 첨부파일 — 관리자가 등록한 값 그대로 반영
    setText("[data-program-description]", detail.company?.support_programs?.description || "등록된 사업 개요가 없습니다.");
    const attachmentsEl = document.querySelector("[data-program-attachments]");
    attachmentsEl.innerHTML = AttachmentList(manualLinks);
    bindGuidanceDownloads(attachmentsEl);

    // 사업 계획서 파일 첨부/수정 — 실제 파일을 보관하고 link_url 을 함께 저장한다.
    const bpFileInput = document.getElementById("bp-file-input");
    document.getElementById("bp-upload-btn")?.addEventListener("click", () => bpFileInput?.click());
    bpFileInput?.addEventListener("change", async () => {
      const file = bpFileInput.files?.[0];
      if (!file) return;
      await runWithErrorBoundary(async () => {
        const upload = await uploadFile(file);
        await updateBusinessPlan(detail.company.id, { name: file.name, link_url: upload.link_url });
        detail = await getFounderDashboard();
        renderInitialState();
        window.alert("사업계획서가 첨부되었습니다.");
      }, {});
      bpFileInput.value = "";
    });

    // 사업계획서 파일명 클릭 → 첨부한 파일 다운로드
    document.getElementById("bp-download-trigger")?.addEventListener("click", async () => {
      const bp = detail.company?.business_plan;
      if (!bp?.original_filename) return;
      await runWithErrorBoundary(async () => {
        await downloadStoredFile(bp.link_url, bp.original_filename);
      }, {});
    });

    renderInitialState();
  }
} catch (error) {
  showError(error);
}
