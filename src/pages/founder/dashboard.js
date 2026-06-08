import { mountShell, runWithErrorBoundary, showError, setText, showToast, showConfirm } from "../../app.js";
import { requireRole } from "../../auth.js";
import { getFounderDashboard, submitFounderBudgetAllocations, downloadStoredFile, uploadFile, updateBusinessPlan } from "../../api.js";
import { FounderExpenseStatusTable } from "../../components/FounderExpenseStatusTable.js";
import { BudgetTreeView } from "../../components/BudgetTreeView.js";
import { BUDGET_APPROVED_STATUSES, EXPENSE_STATUS_ORDER, EXPENSE_SEGMENTS, getExpenseSegment, getStatusLabel, getStatusTone } from "../../domains/status.js";
import { hasApprovedBudget, isBudgetPendingReview, isChangeStatus, founderBudgetBanners } from "../../domains/budget/budget-status.js";
import { escapeHtml, formatCurrency, formatDate, formatNumber, parseNumber } from "../../utils.js";
import { AttachmentList } from "../../components/attachments/AttachmentList.js";
import { BudgetHistoryTable } from "../../components/budget/BudgetHistoryTable.js";

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

      // 소계 셀이 있는 모든 노드를 갱신한다. 대분류만 있는(중분류 없는) leaf 루트도 소계가 있으므로 포함한다.
      const updateDom = (nodes) => {
        for (const node of nodes) {
          const cell = document.querySelector(`[data-parent-allocation="${node.id}"]`);
          if (cell) cell.textContent = formatCurrency(getSum(node));
          if (node.children) updateDom(node.children);
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

    // 1차/2차 입력 합계를 재계산해 소계·총합 셀을 갱신한다(예산 변경 모드).
    const recalcChangeSums = () => {
      const v1 = {}, v2 = {};
      document.querySelectorAll("[data-alloc-round1]").forEach((i) => { v1[i.dataset.allocRound1] = parseNumber(i.value); });
      document.querySelectorAll("[data-alloc-round2]").forEach((i) => { v2[i.dataset.allocRound2] = parseNumber(i.value); });
      const sum = (node, vals) => (node.isLeaf ? (vals[node.id] || 0) : (node.children || []).reduce((s, c) => s + sum(c, vals), 0));
      // 소계 셀이 있는 모든 노드를 갱신한다(대분류만 있는 leaf 루트 포함).
      const walk = (nodes) => {
        for (const n of nodes || []) {
          const c1 = document.querySelector(`[data-parent-round1="${CSS.escape(n.id)}"]`);
          if (c1) c1.textContent = formatCurrency(sum(n, v1));
          const c2 = document.querySelector(`[data-parent-round2="${CSS.escape(n.id)}"]`);
          if (c2) c2.textContent = formatCurrency(sum(n, v2));
          walk(n.children);
        }
      };
      walk(detail.budgetTree);
      const t1 = detail.budgetTree.reduce((s, r) => s + sum(r, v1), 0);
      const t2 = detail.budgetTree.reduce((s, r) => s + sum(r, v2), 0);
      setText("#budget-edit-total-round1", formatCurrency(t1));
      setText("#budget-edit-total-round2", formatCurrency(t2));
      setText("#budget-edit-total", formatCurrency(t1 + t2));
    };

    // 사업계획서 업로드 블록(HTML). 예산안 작성/예산 변경 화면에서 1차/2차 사업계획서를 첨부한다(new.md §10).
    // 상단 카드는 조회/다운로드만 담당하고, 신규·수정·2차 신청 첨부는 모두 이 예산 화면에서 처리한다.
    const planUploadBlockHtml = (round, { required = false, hidden = false, note = "" } = {}) => {
      const label = round === "round2" ? "2차 수정 사업계획서" : "1차 사업계획서";
      const existing = detail.company?.business_plans?.[round]?.original_filename;
      return `
        <div class="plan-upload-block${round === "round2" ? " round2-plan-block" : ""}" data-plan-block="${round}"${hidden ? " hidden" : ""}>
          <label style="display:block; font-weight:600; margin-bottom:4px;">${label}${required ? " (필수)" : ""}</label>
          ${note ? `<p class="muted caption" style="margin:0 0 8px;">${escapeHtml(note)}</p>` : ""}
          <div class="plan-upload-row">
            <button type="button" class="button small secondary" data-plan-btn="${round}">파일 첨부</button>
            <span class="muted caption" data-plan-name="${round}">${escapeHtml(existing || "첨부된 파일 없음")}</span>
            <button type="button" class="plan-clear-btn" data-plan-clear="${round}" hidden>제거</button>
            <input type="file" hidden data-plan-input="${round}" accept=".pdf,.doc,.docx,.hwp,.hwpx,.xls,.xlsx,.ppt,.pptx">
          </div>
        </div>`;
    };

    // 업로드 블록에 파일 선택/제거 핸들러를 연결하고, 현재 선택된 File 을 돌려주는 getter 를 반환한다.
    // '제거'는 이번에 새로 첨부한 파일 선택을 취소하고, 기존에 저장된 파일명(있으면)으로 되돌린다.
    const bindPlanUpload = (round) => {
      const input = document.querySelector(`[data-plan-input="${round}"]`);
      const nameEl = document.querySelector(`[data-plan-name="${round}"]`);
      const clearBtn = document.querySelector(`[data-plan-clear="${round}"]`);
      const resetText = detail.company?.business_plans?.[round]?.original_filename || "첨부된 파일 없음";
      document.querySelector(`[data-plan-btn="${round}"]`)?.addEventListener("click", () => input?.click());
      input?.addEventListener("change", () => {
        const file = input.files?.[0];
        if (nameEl) nameEl.textContent = file?.name || resetText;
        if (clearBtn) clearBtn.hidden = !file;
      });
      clearBtn?.addEventListener("click", () => {
        if (input) input.value = "";
        if (nameEl) nameEl.textContent = resetText;
        clearBtn.hidden = true;
      });
      return () => input?.files?.[0] || null;
    };

    // 최초 예산안 작성(mode: initial) 또는 예산 변경(mode: change, 1차 수정 + 2차 신청) 편집 화면.
    const renderEditableTree = (opts = {}) => {
      const isChange = opts.mode === "change";
      document.getElementById("budget-empty-card").hidden = true;
      const container = document.getElementById("budget-tree-container");
      container.hidden = false;

      // 비목별 감액 하한 = 이미 사용(승인/제출)된 지출. 승인 후 총 배정(1차+2차)이 이 값 이상이어야 한다(new.md §10.7).
      const leaves = collectLeaves(detail.budgetTree);
      const floorByLeafId = {};
      const titleByLeafId = {};
      const round1ByLeafId = {};
      const round2ByLeafId = {};
      for (const leaf of leaves) {
        floorByLeafId[leaf.id] = Number(leaf.approved_amount || 0) + Number(leaf.pending_amount || 0);
        titleByLeafId[leaf.id] = leaf.title;
        round1ByLeafId[leaf.id] = Number(leaf.round1_allocated_amount || 0);
        round2ByLeafId[leaf.id] = Number(leaf.round2_allocated_amount || 0);
      }

      const treeEl = document.querySelector("[data-budget-tree]");

      if (isChange) {
        // 2차 입력 기본 활성화 여부: 이미 2차 예산이 있거나 2차 요청이 진행 중이면 켜둔다.
        const hasRound2 = leaves.some((l) => Number(l.round2_allocated_amount || 0) > 0) ||
          ["pending", "revision", "approved"].includes(detail.round2Status);
        const reasonBlock = `
          <div class="notice notice-info" style="margin-bottom:12px;">
            예산 변경 · 비목별 <strong>1차 배정금액</strong>을 수정할 수 있습니다. 추가 예산이 필요하면
            <strong>2차 배정 신청</strong> 컬럼 헤더의 체크박스를 선택해 2차 배정금액을 입력하세요. 2차 배정은 승인 완료 후 1차 잔액과 합산되어 지출에 반영됩니다.
          </div>
          <div style="margin-bottom:12px;">
            <label for="budget-change-reason" style="display:block; font-weight:600; margin-bottom:4px;">변경 사유 (필수)</label>
            <textarea id="budget-change-reason" placeholder="예산 변경(1차 수정 또는 2차 배정)이 필요한 사유를 구체적으로 작성하세요." style="width:100%; height:64px; box-sizing:border-box;"></textarea>
          </div>
          ${planUploadBlockHtml("round1", { note: "1차 사업계획서를 교체하려면 새 파일을 첨부하세요. (선택)" })}
          ${planUploadBlockHtml("round2", { required: true, hidden: !hasRound2, note: "수정 사업계획서를 첨부하고, 비목별 2차 배정 금액을 입력해 제출합니다. 승인 완료 후 1차 배정액과 2차 승인액을 합산해 지출 가능 예산에 반영합니다." })}`;

        treeEl.innerHTML = reasonBlock + BudgetTreeView(
          detail.budgetTree,
          true,
          detail.company?.support_programs?.level_labels,
          // 이미 2차 예산이 있으면(최초 신청 이후) 활성 상태로, 아니면 헤더 체크박스로 신청받는다.
          { editTarget: "change", round2Status: detail.round2Status, round2Enabled: hasRound2, round2Checkbox: !hasRound2 },
        ) + `
          <div style="margin-top: 24px; display: flex; justify-content: space-between; align-items: flex-end; border-top: 1px solid var(--line); padding-top: 16px;">
            <div style="line-height:1.7;">
              <div>총 1차 배정: <strong id="budget-edit-total-round1">0원</strong></div>
              <div>총 2차 신청: <strong id="budget-edit-total-round2">0원</strong></div>
              <div><strong>승인 후 총 배정: </strong><span id="budget-edit-total" style="font-size: var(--text-lg); font-weight: 700; color: var(--primary);">0원</span></div>
            </div>
            <div class="actions">
              <button class="button" id="save-budget-btn" type="submit">예산 변경 요청 제출</button>
              <button class="button secondary" id="cancel-budget-btn" type="button">취소</button>
            </div>
          </div>
        `;

        recalcChangeSums();

        // 1차/2차 사업계획서 파일 선택(제출 시 업로드). 1차는 선택, 2차는 신청 시 필수. new.md §10.4.
        const getRound1File = bindPlanUpload("round1");
        const getRound2File = bindPlanUpload("round2");

        // 2차 배정 신청 체크박스(최초 신청 전에만 노출): 선택 시 한 번 확인 후 2차 입력을 활성화하고 체크박스를 제거한다.
        const round2Toggle = document.getElementById("round2-toggle");
        if (round2Toggle) {
          round2Toggle.addEventListener("change", async (e) => {
            if (!e.target.checked) return;
            const ok = await showConfirm("2차 예산을 신청하시겠습니까?", {
              title: "2차 예산 배정 신청",
              confirmText: "신청",
              cancelText: "취소",
            });
            if (!ok) {
              e.target.checked = false;
              return;
            }
            // 2차 입력 활성화 + 회색 잠금 해제 + 체크박스 제거(되돌리기 방지).
            document.querySelectorAll("[data-alloc-round2]").forEach((i) => { i.disabled = false; });
            document.getElementById("budget-matrix-table")?.classList.remove("round2-locked");
            const wrap = document.getElementById("round2-toggle-wrap");
            if (wrap) wrap.replaceWith(document.createTextNode("2차 배정 신청"));
            // 2차 신청을 켜면 2차 수정 사업계획서 첨부 영역을 노출한다(필수).
            const planBlock = document.querySelector('[data-plan-block="round2"]');
            if (planBlock) planBlock.hidden = false;
            recalcChangeSums();
          });
        }

        const table = document.getElementById("budget-matrix-table");
        table?.addEventListener("input", (event) => {
          if (event.target.classList.contains("budget-alloc-input")) {
            const cursorAtEnd = event.target.selectionStart === event.target.value.length;
            event.target.value = formatNumber(event.target.value);
            if (cursorAtEnd) event.target.setSelectionRange(event.target.value.length, event.target.value.length);
            recalcChangeSums();
          }
        });

        document.getElementById("cancel-budget-btn").addEventListener("click", () => { renderInitialState(); });

        document.getElementById("budget-form").onsubmit = async (event) => {
          event.preventDefault();
          const saveBtn = document.getElementById("save-budget-btn");
          const cancelBtn = document.getElementById("cancel-budget-btn");
          // 2차 신청 여부 = 2차 입력이 활성화(잠금 해제)되었는지로 판단한다.
          const firstRound2 = document.querySelector("[data-alloc-round2]");
          const round2On = !!firstRound2 && !firstRound2.disabled;

          const reason = document.getElementById("budget-change-reason").value.trim();
          if (!reason) {
            showToast("예산 변경 사유를 입력해야 합니다.", { type: "warning" });
            document.getElementById("budget-change-reason").focus();
            return;
          }

          // 비목별 1차/2차 입력 수집. 2차 미신청 시 round2_allocated_amount 를 보내지 않아 기존 확정 2차를 유지한다.
          const allocations = Array.from(document.querySelectorAll("[data-alloc-round1]")).map((i1) => {
            const id = i1.dataset.allocRound1;
            const i2 = document.querySelector(`[data-alloc-round2="${CSS.escape(id)}"]`);
            return {
              support_program_budget_id: id,
              allocated_amount: parseNumber(i1.value),
              ...(round2On ? { round2_allocated_amount: parseNumber(i2 ? i2.value : 0) } : {}),
            };
          });

          // 감액 하한 검증: 승인 후 총 배정(1차 + 2차) ≥ 이미 집행/검토중 금액.
          const resultingTotalOf = (a) =>
            a.allocated_amount + (round2On ? Number(a.round2_allocated_amount || 0) : Number(round2ByLeafId[a.support_program_budget_id] || 0));
          const violations = allocations.filter((a) => resultingTotalOf(a) < (floorByLeafId[a.support_program_budget_id] || 0));
          if (violations.length) {
            const lines = violations.map((v) => `· ${titleByLeafId[v.support_program_budget_id] || v.support_program_budget_id}: 최소 ${formatCurrency(floorByLeafId[v.support_program_budget_id] || 0)}`);
            showToast("이미 승인/제출된 지출보다 낮게 예산을 줄일 수 없습니다.\n" + lines.join("\n"), { type: "warning", duration: 5000 });
            return;
          }

          // 변경 내용 확인: 1차도 그대로, 2차도 신청/변경 없음이면 막는다.
          const round1Changed = allocations.some((a) => a.allocated_amount !== Number(round1ByLeafId[a.support_program_budget_id] || 0));
          const round2Changed = round2On && allocations.some((a) => Number(a.round2_allocated_amount || 0) !== Number(round2ByLeafId[a.support_program_budget_id] || 0));
          if (!round1Changed && !round2Changed) {
            showToast("변경된 내용이 없습니다. 1차 배정금액을 수정하거나 2차 예산 배정을 신청해 주세요.", { type: "warning" });
            return;
          }

          // 2차 배정 신청 시 수정 사업계획서 첨부 필수(new.md §10.4). 기존 첨부가 있으면 유지 허용.
          const round1PlanFile = getRound1File();
          const round2PlanFile = getRound2File();
          const existingRound2Plan = detail.company?.business_plans?.round2?.original_filename;
          if (round2On && !round2PlanFile && !existingRound2Plan) {
            showToast("2차 예산 배정 신청에는 수정 사업계획서 첨부가 필요합니다.", { type: "warning" });
            return;
          }

          // 제출 전 최종 확인(되돌리기 어려운 요청).
          const okSubmit = await showConfirm("예산 변경 요청을 제출하시겠습니까? 제출 후 관리자 승인 전까지는 변경 금액이 지출 예산에 반영되지 않습니다.", {
            title: "예산 변경 요청",
            confirmText: "제출",
            cancelText: "취소",
          });
          if (!okSubmit) return;

          saveBtn.disabled = true;
          cancelBtn.disabled = true;
          await runWithErrorBoundary(async () => {
            const res = await submitFounderBudgetAllocations(detail.company.id, allocations, reason);
            // 1차 사업계획서를 교체했다면 이번 변경 제출 건에 연결한다 — 승인 전까지는 교체본이 노출되지 않는다.
            if (round1PlanFile) {
              const upload = await uploadFile(round1PlanFile, { companyId: detail.company.id });
              await updateBusinessPlan(
                detail.company.id,
                "round1",
                { name: round1PlanFile.name, link_url: upload.link_url },
                { budget_submission_id: res?.submissionId },
              );
            }
            // 새 2차 사업계획서를 첨부했다면 이번 제출 건에 연결해 보관한다.
            if (round2On && round2PlanFile) {
              const upload = await uploadFile(round2PlanFile, { companyId: detail.company.id });
              await updateBusinessPlan(
                detail.company.id,
                "round2",
                { name: round2PlanFile.name, link_url: upload.link_url },
                { budget_submission_id: res?.submissionId },
              );
            }
            showToast("예산 변경 요청이 제출되었습니다. 관리자 승인 전까지는 변경한 금액이 지출 가능 예산에 반영되지 않습니다.", { type: "success", duration: 5000 });
            detail = await getFounderDashboard();
            renderInitialState();
          }, { button: saveBtn });
          saveBtn.disabled = false;
          cancelBtn.disabled = false;
        };
        return;
      }

      // ----- 최초/1차 예산안 단일 입력 폼 -----
      treeEl.innerHTML = planUploadBlockHtml("round1", {
        required: true,
        note: "예산안과 함께 1차 사업계획서를 첨부하세요. 승인 후 상단 카드에서 다운로드할 수 있습니다.",
      }) + BudgetTreeView(
        detail.budgetTree,
        true,
        detail.company?.support_programs?.level_labels,
        { editTarget: "round1", round2Status: detail.round2Status },
      ) + `
        <div style="margin-top: 24px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--line); padding-top: 16px;">
          <div>
            <strong>총 배정 금액: </strong>
            <span id="budget-edit-total" style="font-size: var(--text-lg); font-weight: 700; color: var(--primary);">0원</span>
          </div>
          <div class="actions">
            <button class="button" id="save-budget-btn" type="submit">승인 신청</button>
            <button class="button secondary" id="cancel-budget-btn" type="button">취소</button>
          </div>
        </div>
      `;

      recalculateTreeSums();

      // 1차 사업계획서 파일 선택(제출 시 업로드). new.md §10.
      const getRound1File = bindPlanUpload("round1");

      // 비목 구조가 없으면 BudgetTreeView 가 매트릭스 대신 안내 문구만 렌더한다 → 입력 핸들러를 붙이지 않는다.
      const table = document.getElementById("budget-matrix-table");
      table?.addEventListener("input", (event) => {
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

        const violations = allocations.filter((a) => a.allocated_amount < (floorByLeafId[a.support_program_budget_id] || 0));
        if (violations.length) {
          const lines = violations.map((v) => `· ${titleByLeafId[v.support_program_budget_id] || v.support_program_budget_id}: 최소 ${formatCurrency(floorByLeafId[v.support_program_budget_id] || 0)}`);
          showToast("이미 승인/제출된 지출보다 낮게 예산을 줄일 수 없습니다.\n" + lines.join("\n"), { type: "warning", duration: 5000 });
          return;
        }

        // 1차 사업계획서 첨부 필수(기존 첨부가 있으면 유지 허용). new.md §10.
        const round1PlanFile = getRound1File();
        const existingRound1Plan = detail.company?.business_plans?.round1?.original_filename;
        if (!round1PlanFile && !existingRound1Plan) {
          showToast("예산안 제출에는 1차 사업계획서 첨부가 필요합니다.", { type: "warning" });
          return;
        }

        // 제출 전 최종 확인(승인 신청은 관리자 검토가 시작됨).
        const okInitial = await showConfirm("예산안을 제출하시겠습니까? 제출 후 관리자 검토가 시작됩니다.", {
          title: "예산안 승인 신청",
          confirmText: "신청",
          cancelText: "취소",
        });
        if (!okInitial) return;

        saveBtn.disabled = true;
        cancelBtn.disabled = true;
        await runWithErrorBoundary(async () => {
          const res = await submitFounderBudgetAllocations(detail.company.id, allocations, "");
          if (round1PlanFile) {
            const upload = await uploadFile(round1PlanFile, { companyId: detail.company.id });
            // 1차 사업계획서도 이번 제출 건에 연결한다 — 제출이 승인되기 전까지는 노출/다운로드되지 않는다.
            await updateBusinessPlan(
              detail.company.id,
              "round1",
              { name: round1PlanFile.name, link_url: upload.link_url },
              { budget_submission_id: res?.submissionId },
            );
          }
          showToast("예산안이 제출되었습니다. 관리자 승인 후 지출 신청이 가능합니다.", { type: "success", duration: 5000 });
          detail = await getFounderDashboard();
          renderInitialState();
        }, { button: saveBtn });
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
      };
    };

    // ----- 지출 현황 검색/필터 (new.md §4) -----
    const expenseFilter = { search: "", segment: "all", status: "all" };

    const expenseMatchesSearch = (e, q) => {
      if (!q) return true;
      const hay = [e.title, e.business_plan_item_label, e.budget_category, e.vendor_name, getStatusLabel(e.status)]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    };

    // 상태 칩 바: 전체 + 8단계 정확 상태별 건수. 클릭 시 해당 상태로 필터(다시 클릭하면 해제).
    const renderStatusChips = (base, countByStatus) => {
      const chipsEl = document.querySelector("[data-status-chips]");
      if (!chipsEl) return;
      const chip = (status, label, count, tone) => {
        const active = expenseFilter.status === status;
        const empty = count === 0 && status !== "all";
        return `<button type="button" class="status-chip chip-${tone}${active ? " active" : ""}${empty ? " chip-empty" : ""}" data-chip-status="${status}">
            <span class="chip-label">${escapeHtml(label)}</span><span class="chip-count">${count}</span>
          </button>`;
      };
      // 결재 단계(작성/사전승인/최종승인)별로 칩을 묶어 좌→우 프로세스 흐름처럼 보여준다.
      // 같은 단계 내부는 가는 화살표(›), 단계가 바뀌는 지점은 굵은 화살표로 연결한다.
      const phaseOf = (s) => (s === "draft" ? "draft" : s.startsWith("pre_") ? "pre" : "final");
      const arrow = (major) => `<span class="chip-arrow${major ? " chip-arrow-major" : ""}" aria-hidden="true">›</span>`;
      const groups = [];
      for (const s of EXPENSE_STATUS_ORDER) {
        const phase = phaseOf(s);
        if (!groups.length || groups[groups.length - 1].phase !== phase) groups.push({ phase, items: [] });
        groups[groups.length - 1].items.push(s);
      }
      const groupsHtml = groups
        .map((g) => `<span class="chip-group">${g.items
          .map((s, i) => (i > 0 ? arrow(false) : "") + chip(s, getStatusLabel(s), countByStatus[s] || 0, getStatusTone(s)))
          .join("")}</span>`)
        .join(arrow(true));
      chipsEl.innerHTML =
        chip("all", "전체", base.length, "neutral") +
        `<span class="chip-divider" aria-hidden="true"></span>` +
        groupsHtml;
    };

    const renderExpenseSection = () => {
      const q = expenseFilter.search.trim().toLowerCase();
      // 검색 + 결재 구간으로 필터한 모집단(칩 카운트 기준)
      const base = expenses.filter((e) =>
        expenseMatchesSearch(e, q) &&
        (expenseFilter.segment === "all" || getExpenseSegment(e.status) === expenseFilter.segment));

      const countByStatus = {};
      for (const e of base) countByStatus[e.status] = (countByStatus[e.status] || 0) + 1;
      renderStatusChips(base, countByStatus);

      // 상태 칩 필터까지 적용한 최종 행
      const rows = expenseFilter.status === "all" ? base : base.filter((e) => e.status === expenseFilter.status);

      const totalExpenses = expenses.length;
      const filtering = q || expenseFilter.segment !== "all" || expenseFilter.status !== "all";
      const emptyMsg = totalExpenses === 0
        ? "아직 등록된 지출 신청이 없습니다. ‘새 지출 신청’으로 시작하세요."
        : "검색/필터 조건에 맞는 지출 신청이 없습니다.";
      document.querySelector("[data-expense-table]").innerHTML = FounderExpenseStatusTable(rows, emptyMsg);

      const info = document.querySelector("[data-expense-filter-info]");
      if (info) {
        info.textContent = filtering
          ? `전체 ${totalExpenses}건 중 ${rows.length}건 표시`
          : `총 ${totalExpenses}건`;
      }
    };

    // ----- 사업 계획서 1차/2차 슬롯 (조회/다운로드 전용) -----
    // 상단 카드는 첨부/수정을 하지 않는다. 신규·수정·2차 신청 첨부는 모두 예산 관리 화면에서 처리한다(요청사항).
    const renderBusinessPlanSlots = () => {
      const plans = detail.company?.business_plans || {};

      // 파일이 없을 때 1차/2차 공통 안내 문구.
      const EMPTY_PLAN_TEXT = "예산 배정 후 반영됩니다.";

      // 사업계획서는 첨부된 예산 제출 건이 승인된 후에만 노출/다운로드된다(new.md §10.4/§11.4).
      // 레거시 데이터(연결 id 없음)는 과거 호환을 위해 승인된 것으로 간주한다.
      const approvedSubmissionIds = new Set(
        (detail.budgetSubmissions || [])
          .filter((s) => ["budget_approved", "change_approved"].includes(s.status))
          .map((s) => s.id),
      );
      const isPlanApproved = (plan) =>
        !plan?.budget_submission_id || approvedSubmissionIds.has(plan.budget_submission_id);

      const renderSlot = (round) => {
        const plan = plans[round];
        const hasFile = !!plan?.original_filename;
        const approved = hasFile && isPlanApproved(plan);
        const nameEl = document.querySelector(`[data-bp-name="${round}"]`);
        const updatedEl = document.querySelector(`[data-bp-updated="${round}"]`);
        // 승인 전(검토 중)에도 다운로드는 막아야 하므로 비활성 처리한다.
        document.querySelector(`[data-bp-slot="${round}"]`)?.classList.toggle("bp-slot-disabled", !approved);
        if (!nameEl) return;
        if (approved) {
          nameEl.textContent = plan.original_filename;
          nameEl.classList.add("bp-name-link");
          const m = plan.updated_at || plan.uploaded_at;
          if (updatedEl) updatedEl.textContent = m ? `최종 수정일: ${formatDate(m)}` : "";
        } else if (hasFile) {
          // 첨부는 되었으나 예산 제출이 아직 승인되지 않은 상태 — 파일명/링크를 숨기고 검토 중임을 알린다.
          nameEl.textContent = "승인 검토 중 — 승인 후 다운로드 가능";
          nameEl.classList.remove("bp-name-link");
          if (updatedEl) updatedEl.textContent = "";
        } else {
          nameEl.textContent = EMPTY_PLAN_TEXT;
          nameEl.classList.remove("bp-name-link");
          if (updatedEl) updatedEl.textContent = "";
        }
      };

      renderSlot("round1");
      renderSlot("round2");
    };

    const renderInitialState = () => {
      const hasAllocations = detail.allocations && detail.allocations.length > 0;
      
      // Top Cards
      setText("[data-company-name]", detail.company?.name || "-");
      setText("[data-representative]", detail.company?.representative_name || "-");
      setText("[data-support-program]", detail.company?.support_programs?.name || "-");
      // 참가 사업 아래 협약 기간 표시 (양쪽 날짜가 모두 있을 때만)
      // 협약 기간은 참가 사업(신규사업)에 세팅된 값을 우선 사용한다(기업별 레거시 값은 대체용).
      const agreeStart = detail.company?.support_programs?.agreement_start_date || detail.company?.agreement_start_date;
      const agreeEnd = detail.company?.support_programs?.agreement_end_date || detail.company?.agreement_end_date;
      setText("[data-agreement]", (agreeStart || agreeEnd)
        ? `협약기간 ${formatDate(agreeStart)} ~ ${formatDate(agreeEnd)}`
        : "협약기간 미정");
      
      const supportTotal = Number(detail.company?.support_total_amount || 0);
      setText("[data-support-total]", `${formatCurrency(supportTotal)}`);
      
      // Approved total — 사전승인 완료 이후(최종승인 대기/보완/완료 포함) 약정 금액을 집행 현황으로 본다.
      const approvedExpenses = expenses.filter((r) => BUDGET_APPROVED_STATUSES.includes(r.status));
      const approvedTotalSum = approvedExpenses.reduce((s, r) => s + Number(r.amount_supply || 0), 0);
      setText("[data-approved-total]", formatCurrency(approvedTotalSum));

      // Execution rate
      const rate = supportTotal ? Math.round((approvedTotalSum / supportTotal) * 100) : 0;
      setText("[data-execution-rate]", `${rate}% 집행 완료`);

      // 지출 8단계 상태 칩/검색/필터 + 표 (new.md §4/§5)
      renderExpenseSection();

      // 사업 계획서 1차/2차 슬롯 (new.md §10.2/§10.3)
      renderBusinessPlanSlots();

      // 탭 3: 예산 변경 히스토리 (제출/변경 후에도 갱신)
      const budgetHistoryEl = document.querySelector("[data-budget-history]");
      if (budgetHistoryEl) {
        // 2차 사업계획서가 연결된 제출 건은 '2차 예산 수정'으로 표기하기 위해 연결 제출 id를 함께 넘긴다.
        budgetHistoryEl.innerHTML = BudgetHistoryTable(
          detail.budgetSubmissions,
          detail.company?.business_plans?.round2?.budget_submission_id || null,
        );
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

      // 비활성 시 클릭을 막지 않고, 왜 불가한지 토스트로 안내한다(§5.1).
      if (canRequestExpense) {
        newExpenseLink.classList.remove("disabled");
        newExpenseLink.style.pointerEvents = "auto";
        newExpenseLink.removeAttribute("aria-disabled");
        newExpenseLink.dataset.disabledReason = "";
      } else {
        newExpenseLink.classList.add("disabled");
        // pointer-events 로 막으면 사유를 알 수 없으므로 클릭은 허용하고 핸들러에서 차단한다.
        newExpenseLink.style.pointerEvents = "auto";
        newExpenseLink.setAttribute("aria-disabled", "true");
        const reason = !signupApproved
          ? "가입 승인 완료 후 지출 신청이 가능합니다."
          : isBudgetPendingReview(budgetStatus)
            ? "예산안 검토가 진행 중입니다. 승인 완료 후 지출 신청이 가능합니다."
            : "예산 승인 완료 후 지출 신청이 가능합니다.";
        newExpenseLink.dataset.disabledReason = reason;
      }

      // 예산 관리 탭: 확정 예산 > 검토 대기 제출안 > 미작성 순으로 표시한다.
      const emptyCard = document.getElementById("budget-empty-card");
      const treeContainer = document.getElementById("budget-tree-container");
      const treeEl = document.querySelector("[data-budget-tree]");
      const pending = detail.pendingSubmission;

      // 예산 신청/변경 버튼.
      //  - 검토 대기 중(*_submitted): 신청한 내용만 읽기 전용으로 보이고, 버튼은 회색(disabled)으로 표시한다.
      //    HTML disabled 로 막으면 사유를 알 수 없으므로 클릭은 허용하고(aria-disabled) 핸들러에서 토스트로 안내한다(§5.1, 지출 버튼과 동일 패턴).
      //  - 확정 예산 존재(검토 중 아님): 활성 '예산 변경' 버튼으로 1차 수정 + 2차 배정 신청을 받는다.
      const changePending = isBudgetPendingReview(budgetStatus);
      const showChangeBtn = changePending || hasApprovedBudget(budgetStatus);
      const isChangeFlow = isChangeStatus(budgetStatus);
      const changeLabel = changePending && !isChangeFlow ? "예산 신청" : "예산 변경";
      const changePendingReason = isChangeFlow
        ? "예산 변경 신청이 접수되어 검토 중입니다. 관리자 승인 후 다시 변경할 수 있습니다."
        : "예산안 신청이 접수되어 검토 중입니다. 관리자 승인 후 진행됩니다.";
      const changeBtn = showChangeBtn
        ? `<div style="text-align:right; margin-bottom:8px;"><button class="button${changePending ? " disabled" : ""}" id="start-change-btn" type="button"${changePending ? ' aria-disabled="true"' : ""}>${changeLabel}</button></div>`
        : "";
      const bindChangeBtn = () => {
        if (!showChangeBtn) return;
        const btn = document.getElementById("start-change-btn");
        if (!btn) return;
        btn.addEventListener("click", () => {
          if (changePending) {
            showToast(changePendingReason, { type: "info" });
            return;
          }
          renderEditableTree({ mode: "change" });
        });
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
        // 확정 예산: 1차/2차/총 승인 예산 컬럼으로 표시. 2차 요청 중이면 헤더 상태로 노출한다(new.md §10.3).
        emptyCard.hidden = true;
        treeContainer.hidden = false;
        treeEl.innerHTML = changeBtn + BudgetTreeView(
          detail.budgetTree,
          false,
          detail.company?.support_programs?.level_labels,
          { showRounds: true, round2Status: detail.round2Status },
        );
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

    // 새 지출 신청 링크: 비활성 상태면 이동을 막고 사유를 안내한다(1회 바인딩, 사유는 dataset 에서 클릭 시 읽는다).
    newExpenseLink?.addEventListener("click", (event) => {
      if (newExpenseLink.getAttribute("aria-disabled") === "true") {
        event.preventDefault();
        showToast(newExpenseLink.dataset.disabledReason || "현재 지출 신청을 할 수 없습니다.", { type: "info" });
      }
    });

    // 지출 표: 행 클릭 → 상세 페이지 이동(위임 바인딩, 표는 필터마다 다시 렌더되므로 컨테이너에 1회 바인딩)
    const expenseTableEl = document.querySelector("[data-expense-table]");
    const gotoExpense = (row) => {
      const href = row?.dataset.expenseHref;
      if (href) window.location.href = href;
    };
    expenseTableEl?.addEventListener("click", (e) => {
      const row = e.target.closest(".clickable-row");
      if (row) gotoExpense(row);
    });
    expenseTableEl?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const row = e.target.closest(".clickable-row");
      if (row) { e.preventDefault(); gotoExpense(row); }
    });

    // 탭 1: 지출 현황 검색/구간 필터 toolbar 바인딩 (렌더는 renderExpenseSection 에서)
    const searchInput = document.querySelector("[data-expense-search]");
    searchInput?.addEventListener("input", () => {
      expenseFilter.search = searchInput.value;
      renderExpenseSection();
    });
    const segmentSelect = document.querySelector("[data-expense-segment]");
    if (segmentSelect) {
      segmentSelect.innerHTML = EXPENSE_SEGMENTS
        .map((s) => `<option value="${s.key}">결재 구간: ${escapeHtml(s.label)}</option>`)
        .join("");
      segmentSelect.addEventListener("change", () => {
        expenseFilter.segment = segmentSelect.value;
        renderExpenseSection();
      });
    }
    // 상태 칩 클릭 → 정확 상태 필터(같은 칩 다시 클릭 시 전체로 해제)
    document.querySelector("[data-status-chips]")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-chip-status]");
      if (!btn) return;
      const next = btn.dataset.chipStatus;
      expenseFilter.status = expenseFilter.status === next && next !== "all" ? "all" : next;
      renderExpenseSection();
    });

    // 탭 4: 사업개요 및 첨부파일 — 관리자가 등록한 값 그대로 반영
    setText("[data-program-description]", detail.company?.support_programs?.description || "등록된 사업 개요가 없습니다.");
    const attachmentsEl = document.querySelector("[data-program-attachments]");
    attachmentsEl.innerHTML = AttachmentList(manualLinks);
    bindGuidanceDownloads(attachmentsEl);

    // 사업 계획서 1차/2차 파일 다운로드 — 상단 카드는 조회/다운로드 전용(첨부/수정은 예산 관리 화면에서).
    document.querySelector(".bp-card")?.addEventListener("click", async (e) => {
      const dl = e.target.closest("[data-bp-download]");
      if (!dl) return;
      const plan = detail.company?.business_plans?.[dl.dataset.bpDownload];
      if (!plan?.original_filename) return;
      // 첨부된 예산 제출이 승인된 경우에만 다운로드 허용. 미승인 첨부본은 노출하지 않는다.
      const approvedIds = new Set(
        (detail.budgetSubmissions || [])
          .filter((s) => ["budget_approved", "change_approved"].includes(s.status))
          .map((s) => s.id),
      );
      const approved = !plan.budget_submission_id || approvedIds.has(plan.budget_submission_id);
      if (!approved) return;
      await runWithErrorBoundary(async () => {
        await downloadStoredFile(plan.link_url, plan.original_filename);
      }, {});
    });

    renderInitialState();
  }
} catch (error) {
  showError(error);
}
