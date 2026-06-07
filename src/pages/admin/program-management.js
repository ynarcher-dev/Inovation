import { mountShell, runWithErrorBoundary, showError } from "../../app.js";
import {
  getSupportPrograms,
  getSupportProgramBudgets,
  createSupportProgramBudget,
  deleteSupportProgramBudget,
  updateSupportProgramLevelLabels,
  updateSupportProgramDescription,
  updateSupportProgramMemo,
  getGuidanceItems,
  createGuidanceItem,
  deleteGuidanceItem,
  updateGuidanceItem,
  uploadGuidanceFile,
  getGuidanceDownloadUrl,
  getBudgetDocumentRequirements,
  createBudgetDocumentRequirement,
  updateBudgetDocumentRequirement,
  deleteBudgetDocumentRequirement,
  getProgramAiCriteriaDocument,
  uploadProgramAiCriteriaDocument,
  extractProgramAiCriteria,
  deleteProgramAiCriteriaDocument,
} from "../../api.js";
import { requireRole } from "../../auth.js";
import { escapeHtml, formatDate } from "../../utils.js";

let programs = [];
let selectedIds = [null, null, null, null];
let budgetItems = [];
let currentProgramId = null;
let currentLabels = ["depth.1", "depth.2", "depth.3", "depth.4"];
let guidanceItems = [];
let currentUser = null;
let editingReqId = null;   // 첨부서류 요구사항 인라인 편집 대상 (null = 편집 안 함)
let showReqAddForm = false; // 첨부서류 추가 폼 표시 여부
let aiExtracting = false;   // AI 기준 문서 추출 진행 중 여부 (로딩 표시용)
let aiCriteriaDoc = null;   // 현재 사업의 공통 AI 기준 문서 (remote 비동기 조회 결과 캐시)

function parseLevelLabels(levelLabels) {
  if (!levelLabels) return ["depth.1"];
  const result = [];
  for (let i = 1; i <= 4; i++) {
    const val = levelLabels[String(i)];
    if (val) result.push(val);
    else break;
  }
  return result.length > 0 ? result : ["depth.1"];
}

function labelsToObj(labels) {
  return Object.fromEntries(labels.map((l, i) => [String(i + 1), l]));
}

function syncProgramLabels(updated) {
  currentLabels = parseLevelLabels(updated.level_labels);
  const prog = programs.find((p) => p.id === currentProgramId);
  if (prog) prog.level_labels = updated.level_labels;
}

function getChildren(parentId, level) {
  return budgetItems.filter(
    (item) =>
      item.level === level &&
      (item.parent_id || null) === (parentId || null)
  );
}

function renderLabelEditor() {
  const count = currentLabels.length;
  return `
    <div class="label-editor">
      <span class="label-editor-title">단계 명칭</span>
      ${currentLabels.map((label, i) => `
        <div class="label-item">
          <span class="label-num">${i + 1}단계</span>
          <input class="label-input" data-label-index="${i}"
            value="${escapeHtml(label)}" placeholder="depth.${i + 1}">
          ${i === count - 1 && count > 1
            ? `<button class="label-remove-btn" type="button" id="remove-last-level"
                title="${escapeHtml(label)} 단계 삭제">삭제</button>`
            : ""}
        </div>
        ${i < count - 1 ? '<span class="label-arrow">›</span>' : ""}
      `).join("")}
      ${count < 4
        ? `<button class="button small secondary" type="button" id="add-level">+ 단계 추가</button>`
        : ""}
      <button class="button small" type="button" id="save-labels">저장</button>
    </div>
  `;
}

function renderPanel(panelLevel) {
  const parentId = panelLevel === 1 ? null : selectedIds[panelLevel - 2];
  const isEnabled = panelLevel === 1 || parentId !== null;
  const label = currentLabels[panelLevel - 1];
  const selectedId = selectedIds[panelLevel - 1];
  const items = isEnabled ? getChildren(parentId, panelLevel) : [];

  let listHtml;
  if (!isEnabled) {
    listHtml = `<p class="panel-empty">← ${currentLabels[panelLevel - 2]} 선택 시 표시</p>`;
  } else if (items.length === 0) {
    listHtml = `<p class="panel-empty">등록된 항목이 없습니다</p>`;
  } else {
    listHtml = items.map((item) => `
      <div class="panel-item ${item.id === selectedId ? "selected" : ""}"
        data-select-item="${escapeHtml(item.id)}"
        data-item-level="${panelLevel}">
        <span class="panel-item-name">${escapeHtml(item.title)}</span>
        <button class="panel-delete-btn" type="button"
          data-delete-budget="${escapeHtml(item.id)}" title="삭제">×</button>
      </div>
    `).join("");
  }

  const footerHtml = isEnabled ? `
    <div class="panel-add-form" data-add-panel="${panelLevel}" style="display:none">
      <input class="panel-add-input" placeholder="${escapeHtml(label)}명" aria-label="${escapeHtml(label)}명 입력">
      <button class="button small" type="button"
        data-confirm-panel-add="${panelLevel}">추가</button>
      <button class="button small secondary" type="button"
        data-cancel-panel-add="${panelLevel}">취소</button>
    </div>
    <button class="button small secondary panel-add-btn" type="button"
      data-show-panel-add="${panelLevel}">+ ${escapeHtml(label)} 추가</button>
  ` : "";

  return `
    <div class="budget-panel" data-panel="${panelLevel}">
      <div class="panel-header">${escapeHtml(label)}</div>
      <div class="panel-list">${listHtml}</div>
      <div class="panel-footer">${footerHtml}</div>
    </div>
  `;
}

function render(container) {
  container.innerHTML = `
    ${renderLabelEditor()}
    <div class="budget-panels">
      ${currentLabels.map((_, i) => renderPanel(i + 1)).join("")}
    </div>
  `;
  attachBudgetEvents(container);
  // 선택한 예산 항목이 바뀔 때마다 첨부서류 설정 패널을 갱신한다.
  renderDocRequirements();
}

// 현재 패널에서 가장 깊게 선택된 예산 비목 id (없으면 null).
function getSelectedBudgetId() {
  for (let i = selectedIds.length - 1; i >= 0; i--) {
    if (selectedIds[i]) return selectedIds[i];
  }
  return null;
}

const PHASE_LABELS = { pre: "사전승인", final: "최종승인", both: "공통" };

// 첨부서류 추가/수정 공용 폼 마크업. values 가 있으면 편집 모드(수정), 없으면 추가 모드.
function requirementFormHtml(values = {}) {
  const v = {
    title: values.title || "",
    description: values.description || "",
    phase: values.phase || "both",
    required: values.required === undefined ? true : !!values.required,
    ai: values.ai_review_enabled === undefined ? true : !!values.ai_review_enabled,
    sort_order: values.sort_order ?? "",
  };
  const opt = (val, label, sel) => `<option value="${val}" ${sel ? "selected" : ""}>${label}</option>`;
  return `
    <div class="doc-req-form">
      <div class="doc-req-form-grid">
        <label class="doc-req-field doc-req-field--wide">
          <span>서류명</span>
          <input data-req-title value="${escapeHtml(v.title)}" placeholder="예: 견적서">
        </label>
        <label class="doc-req-field doc-req-field--wide">
          <span>설명</span>
          <input data-req-desc value="${escapeHtml(v.description)}" placeholder="예: 거래처가 발행한 견적서를 첨부해주세요.">
        </label>
        <label class="doc-req-field">
          <span>제출 단계</span>
          <select data-req-phase>
            ${opt("pre", "사전승인", v.phase === "pre")}
            ${opt("final", "최종승인", v.phase === "final")}
            ${opt("both", "공통", v.phase === "both")}
          </select>
        </label>
        <label class="doc-req-field">
          <span>필수 여부</span>
          <select data-req-required>
            ${opt("true", "필수첨부", v.required)}
            ${opt("false", "선택첨부", !v.required)}
          </select>
        </label>
        <label class="doc-req-field">
          <span>AI 검토</span>
          <select data-req-ai>
            ${opt("true", "사용", v.ai)}
            ${opt("false", "미사용", !v.ai)}
          </select>
        </label>
        <label class="doc-req-field">
          <span>정렬 순서</span>
          <input data-req-sort type="number" value="${escapeHtml(String(v.sort_order))}" placeholder="자동">
        </label>
      </div>
      <div class="doc-req-form-actions">
        <button class="button small" type="button" data-req-save>저장</button>
        <button class="button small secondary" type="button" data-req-cancel>취소</button>
      </div>
    </div>`;
}

function readRequirementForm(root) {
  return {
    title: root.querySelector("[data-req-title]").value.trim(),
    description: root.querySelector("[data-req-desc]").value.trim(),
    phase: root.querySelector("[data-req-phase]").value,
    required: root.querySelector("[data-req-required]").value === "true",
    ai_review_enabled: root.querySelector("[data-req-ai]").value === "true",
    sort_order: root.querySelector("[data-req-sort]").value === ""
      ? undefined : Number(root.querySelector("[data-req-sort]").value),
  };
}

async function renderDocRequirements() {
  const panel = document.querySelector("[data-doc-req-panel]");
  if (!panel) return;

  const budgetId = getSelectedBudgetId();
  if (!budgetId) {
    panel.innerHTML = `<div class="doc-req-empty muted">예산 항목을 선택하면 해당 항목의 첨부서류를 설정할 수 있습니다.</div>`;
    return;
  }

  const node = budgetItems.find((b) => b.id === budgetId);
  const requirements = (await getBudgetDocumentRequirements(budgetId)) || [];

  const rows = requirements.length
    ? requirements.map((r) => {
        if (editingReqId === r.id) {
          return `<div class="doc-req-row doc-req-row--editing" data-req-edit-row="${escapeHtml(r.id)}">
            ${requirementFormHtml(r)}
          </div>`;
        }
        const canDelete = !r.upload_count;
        return `
          <div class="doc-req-row ${r.active ? "" : "is-inactive"}" data-req-row="${escapeHtml(r.id)}">
            <div class="doc-req-cell doc-req-cell--title">
              <strong>${escapeHtml(r.title)}</strong>
              ${r.description ? `<span class="muted caption">${escapeHtml(r.description)}</span>` : ""}
            </div>
            <span class="doc-req-cell doc-req-badge">${PHASE_LABELS[r.phase] || r.phase}</span>
            <span class="doc-req-cell doc-req-badge ${r.required ? "is-required" : ""}">${r.required ? "필수" : "선택"}</span>
            <span class="doc-req-cell doc-req-badge">AI ${r.ai_review_enabled ? "사용" : "미사용"}</span>
            <span class="doc-req-cell doc-req-badge ${r.active ? "is-active" : "is-off"}">${r.active ? "활성" : "비활성"}</span>
            <div class="doc-req-cell doc-req-actions">
              <button class="doc-req-link" type="button" data-req-editbtn="${escapeHtml(r.id)}">수정</button>
              <button class="doc-req-link" type="button" data-req-toggle="${escapeHtml(r.id)}" data-active="${r.active}">${r.active ? "비활성화" : "활성화"}</button>
              ${canDelete
                ? `<button class="doc-req-link is-danger" type="button" data-req-delete="${escapeHtml(r.id)}">삭제</button>`
                : `<span class="muted caption" title="업로드 이력이 있어 삭제 대신 비활성화만 가능합니다.">이력 있음</span>`}
            </div>
          </div>`;
      }).join("")
    : `<div class="doc-req-empty muted">등록된 첨부서류가 없습니다.</div>`;

  panel.innerHTML = `
    <div class="doc-req-head">
      <h3>첨부서류 설정 <span class="muted">— ${escapeHtml(node?.title || "선택한 항목")}</span></h3>
      ${showReqAddForm
        ? ""
        : `<button class="button small secondary" type="button" data-req-show-add>+ 첨부서류 추가</button>`}
    </div>
    <div class="doc-req-table-header">
      <span>서류명</span><span>단계</span><span>필수</span><span>AI</span><span>상태</span><span></span>
    </div>
    <div class="doc-req-list">${rows}</div>
    ${showReqAddForm ? `<div data-req-add-root>${requirementFormHtml()}</div>` : ""}
  `;

  attachDocRequirementEvents(panel, budgetId);
}

function attachDocRequirementEvents(panel, budgetId) {
  panel.querySelector("[data-req-show-add]")?.addEventListener("click", async () => {
    showReqAddForm = true;
    editingReqId = null;
    await renderDocRequirements();
    panel.querySelector("[data-req-title]")?.focus();
  });

  // 추가 폼 저장/취소
  const addRoot = panel.querySelector("[data-req-add-root]");
  if (addRoot) {
    addRoot.querySelector("[data-req-cancel]").addEventListener("click", () => {
      showReqAddForm = false;
      renderDocRequirements();
    });
    addRoot.querySelector("[data-req-save]").addEventListener("click", async (e) => {
      const input = readRequirementForm(addRoot);
      if (!input.title) { addRoot.querySelector("[data-req-title]").focus(); return; }
      await runWithErrorBoundary(async () => {
        await createBudgetDocumentRequirement({
          ...input,
          support_program_id: currentProgramId,
          support_program_budget_id: budgetId,
          created_by: currentUser.id,
        });
        showReqAddForm = false;
        await renderDocRequirements();
      }, { button: e.currentTarget });
    });
  }

  // 인라인 편집 저장/취소
  const editRow = panel.querySelector("[data-req-edit-row]");
  if (editRow) {
    const reqId = editRow.dataset.reqEditRow;
    editRow.querySelector("[data-req-cancel]").addEventListener("click", () => {
      editingReqId = null;
      renderDocRequirements();
    });
    editRow.querySelector("[data-req-save]").addEventListener("click", async (e) => {
      const input = readRequirementForm(editRow);
      if (!input.title) { editRow.querySelector("[data-req-title]").focus(); return; }
      await runWithErrorBoundary(async () => {
        await updateBudgetDocumentRequirement(reqId, input);
        editingReqId = null;
        await renderDocRequirements();
      }, { button: e.currentTarget });
    });
  }

  panel.querySelectorAll("[data-req-editbtn]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editingReqId = btn.dataset.reqEditbtn;
      showReqAddForm = false;
      renderDocRequirements();
    });
  });

  panel.querySelectorAll("[data-req-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.reqToggle;
      const isActive = btn.dataset.active === "true";
      await runWithErrorBoundary(async () => {
        await updateBudgetDocumentRequirement(id, { active: !isActive });
        await renderDocRequirements();
      }, { button: btn });
    });
  });

  panel.querySelectorAll("[data-req-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("이 첨부서류 요구사항을 삭제하시겠습니까?")) return;
      await runWithErrorBoundary(async () => {
        await deleteBudgetDocumentRequirement(btn.dataset.reqDelete);
        await renderDocRequirements();
      }, { button: btn });
    });
  });
}

function attachBudgetEvents(container) {
  container.querySelector("#save-labels")?.addEventListener("click", async (e) => {
    const inputs = container.querySelectorAll("[data-label-index]");
    const newLabels = Array.from(inputs).map((input, i) =>
      input.value.trim() || `depth.${i + 1}`
    );
    await runWithErrorBoundary(async () => {
      const updated = await updateSupportProgramLevelLabels(
        currentProgramId, labelsToObj(newLabels)
      );
      syncProgramLabels(updated);
      render(container);
    }, { button: e.currentTarget });
  });

  container.querySelector("#remove-last-level")?.addEventListener("click", async (e) => {
    const level = currentLabels.length;
    const hasItems = budgetItems.some((item) => item.level === level);
    if (hasItems) {
      alert(`"${currentLabels[level - 1]}" 단계에 등록된 항목이 있어 삭제할 수 없습니다.\n해당 단계의 항목을 모두 삭제한 후 다시 시도하세요.`);
      return;
    }
    if (!confirm(`"${currentLabels[level - 1]}" 단계를 삭제하시겠습니까?`)) return;

    const newLabels = currentLabels.slice(0, -1);
    selectedIds[level - 1] = null;

    await runWithErrorBoundary(async () => {
      const updated = await updateSupportProgramLevelLabels(
        currentProgramId, labelsToObj(newLabels)
      );
      syncProgramLabels(updated);
      render(container);
    }, { button: e.currentTarget });
  });

  container.querySelector("#add-level")?.addEventListener("click", async (e) => {
    const newLevel = currentLabels.length + 1;
    const newLabels = [...currentLabels, `depth.${newLevel}`];
    await runWithErrorBoundary(async () => {
      const updated = await updateSupportProgramLevelLabels(
        currentProgramId, labelsToObj(newLabels)
      );
      syncProgramLabels(updated);
      render(container);
    }, { button: e.currentTarget });
  });

  container.querySelectorAll("[data-select-item]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-delete-budget]")) return;
      const id = el.dataset.selectItem;
      const level = Number(el.dataset.itemLevel);
      selectedIds[level - 1] = id;
      for (let i = level; i < 4; i++) selectedIds[i] = null;
      // 선택 항목이 바뀌면 첨부서류 편집/추가 상태를 초기화한다.
      editingReqId = null;
      showReqAddForm = false;
      render(container);
    });
  });

  container.querySelectorAll("[data-delete-budget]").forEach((button) => {
    button.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!window.confirm("이 항목을 삭제하시겠습니까? 하위 항목도 함께 삭제됩니다.")) return;
      const id = button.dataset.deleteBudget;
      for (let i = 0; i < 4; i++) {
        if (selectedIds[i] === id) {
          for (let j = i; j < 4; j++) selectedIds[j] = null;
          break;
        }
      }
      await runWithErrorBoundary(async () => {
        await deleteSupportProgramBudget(id);
        budgetItems = await getSupportProgramBudgets(currentProgramId);
        render(container);
      }, { button });
    });
  });

  container.querySelectorAll("[data-show-panel-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const level = button.dataset.showPanelAdd;
      const panel = container.querySelector(`[data-panel="${level}"]`);
      panel.querySelector("[data-add-panel]").style.display = "flex";
      button.style.display = "none";
      panel.querySelector(".panel-add-input").focus();
    });
  });

  container.querySelectorAll("[data-cancel-panel-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const level = button.dataset.cancelPanelAdd;
      const panel = container.querySelector(`[data-panel="${level}"]`);
      panel.querySelector("[data-add-panel]").style.display = "none";
      panel.querySelector(".panel-add-btn").style.display = "";
      panel.querySelector(".panel-add-input").value = "";
    });
  });

  container.querySelectorAll("[data-confirm-panel-add]").forEach((button) => {
    button.addEventListener("click", async () => {
      const level = Number(button.dataset.confirmPanelAdd);
      const panel = container.querySelector(`[data-panel="${level}"]`);
      const input = panel.querySelector(".panel-add-input");
      const title = input.value.trim();
      if (!title) { input.focus(); return; }

      const parentId = level === 1 ? null : selectedIds[level - 2];
      const siblings = getChildren(parentId, level);

      await runWithErrorBoundary(async () => {
        await createSupportProgramBudget({
          support_program_id: currentProgramId,
          parent_id: parentId,
          level,
          title,
          sort_order: (siblings.length + 1) * 10,
        });
        budgetItems = await getSupportProgramBudgets(currentProgramId);
        render(container);
      }, { button });
    });
  });

  container.querySelectorAll(".panel-add-input").forEach((input) => {
    input.addEventListener("keydown", (e) => {
      const panel = input.closest("[data-panel]");
      const level = panel.dataset.panel;
      if (e.key === "Enter") panel.querySelector(`[data-confirm-panel-add="${level}"]`).click();
      else if (e.key === "Escape") panel.querySelector(`[data-cancel-panel-add="${level}"]`).click();
    });
  });
}

const EXTRACTION_STATUS_LABELS = {
  not_started: "파싱 대기",
  pending: "파싱 중",
  completed: "파싱 완료",
  failed: "파싱 실패",
};

// 파싱 결과 지표(페이지 수/글자 수/텍스트 포함 페이지)와 이미지 PDF 경고를 렌더한다.
function renderParseMetrics(doc) {
  if (doc.parse_char_count == null) return "";
  const pages = doc.parse_page_count ?? 0;
  const chars = doc.parse_char_count ?? 0;
  const withText = doc.parse_pages_with_text ?? 0;
  const metric = `<p class="muted caption" style="margin:0 0 8px">
    파싱 결과: 총 ${pages}페이지 · 텍스트 ${chars.toLocaleString()}자 추출 · 텍스트 포함 페이지 ${withText}/${pages}
  </p>`;
  const warn = doc.parse_image_likely
    ? `<div class="ai-criteria-image-warn" style="margin:0 0 10px;padding:10px 12px;border:1px solid #fca5a5;background:#fef2f2;border-radius:8px;color:#b91c1c;font-size:13px;line-height:1.5">
        ⚠ 이미지(스캔)로 된 PDF로 보입니다. 텍스트 레이어가 거의 없어 추출된 내용이 부족합니다.<br>
        텍스트가 포함된 PDF로 다시 업로드하거나, OCR 처리 후 업로드해주세요.
      </div>`
    : "";
  return metric + warn;
}

// 공통 AI 기준 문서를 다시 조회해 캐시에 담고 화면을 갱신한다.
// (remote 구현은 async 이므로 반드시 await 로 조회한 뒤 렌더해야 한다.)
async function reloadAiCriteria() {
  aiCriteriaDoc = (await getProgramAiCriteriaDocument(currentProgramId)) || null;
  renderAiCriteria();
}

function renderAiCriteria() {
  const root = document.querySelector("[data-ai-criteria]");
  if (!root) return;
  const doc = aiCriteriaDoc;

  const guideNote = `<p class="muted caption" style="margin-top:10px">공통 기준 문서가 등록되면 AI검토가 해당 사업의 지침을 함께 참고합니다. 기준 문서가 없을 경우 기본 항목 일치 여부만 검토합니다.</p>`;

  if (!doc) {
    root.innerHTML = `
      <div class="ai-criteria-empty muted">등록된 공통 기준 문서가 없습니다.</div>
      <label class="button small secondary" style="margin-top:12px;cursor:pointer">
        📎 기준 문서 업로드<input type="file" hidden data-ai-criteria-upload>
      </label>
      ${guideNote}`;
  } else {
    const isCompleted = doc.extraction_status === "completed";
    // 추출 진행 중일 때는 '추출 중' 으로 표시한다.
    const statusKey = aiExtracting ? "pending" : doc.extraction_status;
    const statusLabel = EXTRACTION_STATUS_LABELS[statusKey] || statusKey;

    root.innerHTML = `
      <div class="ai-criteria-card">
        <div class="ai-criteria-row">
          <span class="ai-criteria-key">기준 문서명</span>
          <span class="ai-criteria-val">${escapeHtml(doc.title)}</span>
        </div>
        <div class="ai-criteria-row">
          <span class="ai-criteria-key">업로드 파일</span>
          <span class="ai-criteria-val">
            ${doc.link_url
              ? `<button type="button" class="doc-req-link" data-ai-criteria-open>${escapeHtml(doc.original_filename || "파일 열기")}</button>`
              : `<span class="muted">파일 없음</span>`}
          </span>
        </div>
        <div class="ai-criteria-row">
          <span class="ai-criteria-key">최근 업데이트</span>
          <span class="ai-criteria-val">${formatDate(doc.updated_at)}</span>
        </div>
        <div class="ai-criteria-row">
          <span class="ai-criteria-key">텍스트 파싱 상태</span>
          <span class="ai-criteria-val doc-req-badge ${isCompleted && !aiExtracting ? "is-active" : ""}">
            ${aiExtracting ? `<span class="ai-criteria-spinner"></span> ` : ""}${statusLabel}
          </span>
        </div>
      </div>

      ${isCompleted
        ? `<div class="ai-criteria-extracted" style="margin-top:12px">
            <div class="ai-criteria-extracted-head">
              <span class="ai-criteria-key">파싱된 문서 텍스트</span>
              <span class="muted caption">제출 서류 AI 검토 시 이 텍스트가 함께 적용됩니다.</span>
            </div>
            ${renderParseMetrics(doc)}
            <pre class="ai-criteria-extracted-text">${escapeHtml(doc.extracted_criteria_text || "(추출된 텍스트가 없습니다.)")}</pre>
          </div>`
        : `<div class="ai-criteria-extract-cta" style="margin-top:12px">
            <p class="muted caption" style="margin:0 0 8px">
              ${aiExtracting
                ? "문서에서 텍스트를 파싱하고 있습니다. 잠시만 기다려주세요…"
                : "업로드한 문서의 텍스트를 파싱해야 제출 서류 AI 검토에 반영됩니다."}
            </p>
            <button class="button small" type="button" data-ai-criteria-extract ${aiExtracting ? "disabled" : ""}>
              ${aiExtracting ? "파싱 중…" : "텍스트 파싱"}
            </button>
          </div>`}

      <div class="ai-criteria-actions" style="margin-top:12px;display:flex;gap:8px">
        <label class="button small secondary" style="cursor:pointer">
          새 문서로 교체<input type="file" hidden data-ai-criteria-upload>
        </label>
        <button class="button small secondary" type="button" data-ai-criteria-delete style="color:#ef4444;border-color:#fca5a5">삭제</button>
      </div>
      ${guideNote}`;
  }

  root.querySelector("[data-ai-criteria-upload]")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await runWithErrorBoundary(async () => {
      // 새 문서를 올리면 추출 상태가 초기화되므로 진행 플래그도 해제한다.
      aiExtracting = false;
      await uploadProgramAiCriteriaDocument(currentProgramId, file, currentUser);
      await reloadAiCriteria();
    }, {});
  });

  root.querySelector("[data-ai-criteria-extract]")?.addEventListener("click", async () => {
    if (!doc?.id) return; // 기준 문서가 없으면 추출할 대상이 없다.
    aiExtracting = true;
    renderAiCriteria(); // 로딩 상태 즉시 표시
    await runWithErrorBoundary(async () => {
      await extractProgramAiCriteria(doc.id);
    }, {});
    aiExtracting = false;
    await reloadAiCriteria(); // 추출 결과 반영
  });

  root.querySelector("[data-ai-criteria-open]")?.addEventListener("click", async (e) => {
    await runWithErrorBoundary(async () => {
      const url = await getGuidanceDownloadUrl(doc.link_url);
      window.open(url, "_blank", "noopener,noreferrer");
    }, { button: e.currentTarget });
  });

  root.querySelector("[data-ai-criteria-delete]")?.addEventListener("click", async (e) => {
    if (!confirm("공통 AI 검토 기준 문서를 삭제하시겠습니까?")) return;
    await runWithErrorBoundary(async () => {
      await deleteProgramAiCriteriaDocument(doc.id);
      await reloadAiCriteria();
    }, { button: e.currentTarget });
  });
}

function renderGuidance() {
  const container = document.querySelector("[data-guidance-list]");
  if (!container) return;

  if (!guidanceItems.length) {
    container.innerHTML = `<p class="muted" style="text-align:center;padding:16px 0">등록된 항목이 없습니다.</p>`;
    return;
  }

  container.innerHTML = guidanceItems.map((item) => `
    <div class="guidance-row" data-guidance-id="${escapeHtml(item.id)}">
      <span class="guidance-col-text" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
      <div class="guidance-col-file">
        ${item.link_url ? `
          <span class="guidance-filename"
            data-open-guidance="${escapeHtml(item.id)}"
            title="${escapeHtml(item.content || "파일 열기")}">${escapeHtml(item.content || "파일 열기")}</span>
          <button class="guidance-file-remove" type="button"
            data-remove-file="${escapeHtml(item.id)}" title="파일 삭제">×</button>
        ` : `
          <label class="guidance-file-pick" style="cursor:pointer">
            <span class="guidance-file-pick-label">📎 파일 첨부</span>
            <input type="file" hidden data-attach-file="${escapeHtml(item.id)}">
          </label>
        `}
      </div>
      <div class="guidance-col-actions">
        <button class="guidance-icon-btn" type="button"
          data-delete-guidance="${escapeHtml(item.id)}" title="삭제" style="color:#ef4444;border-color:#fca5a5">×</button>
      </div>
    </div>
  `).join("");

  container.querySelectorAll("[data-open-guidance]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const item = guidanceItems.find((i) => i.id === btn.dataset.openGuidance);
      await runWithErrorBoundary(async () => {
        const url = await getGuidanceDownloadUrl(item.link_url);
        window.open(url, "_blank", "noopener,noreferrer");
      }, { button: btn });
    });
  });

  container.querySelectorAll("[data-remove-file]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("첨부 파일을 삭제하시겠습니까?")) return;
      await runWithErrorBoundary(async () => {
        await updateGuidanceItem(btn.dataset.removeFile, { link_url: null, content: null });
        guidanceItems = await getGuidanceItems(currentProgramId);
        renderGuidance();
      }, { button: btn });
    });
  });

  container.querySelectorAll("[data-attach-file]").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      await runWithErrorBoundary(async () => {
        const upload = await uploadGuidanceFile(file);
        await updateGuidanceItem(input.dataset.attachFile, {
          link_url: upload.link_url,
          content: upload.original_filename,
        });
        guidanceItems = await getGuidanceItems(currentProgramId);
        renderGuidance();
      }, {});
    });
  });

  container.querySelectorAll("[data-delete-guidance]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("이 항목을 삭제하시겠습니까?")) return;
      await runWithErrorBoundary(async () => {
        await deleteGuidanceItem(btn.dataset.deleteGuidance);
        guidanceItems = await getGuidanceItems(currentProgramId);
        renderGuidance();
      }, { button: btn });
    });
  });
}

try {
  mountShell();
  currentUser = await requireRole(["admin", "super_admin"]);
  if (!currentUser) throw new Error("접근 권한이 없습니다.");

  programs = await getSupportPrograms();

  const programSelect = document.querySelector("#program-select");
  const programSections = document.querySelector("[data-program-sections]");
  const budgetEl = document.querySelector("[data-budget-tree]");

  programs.forEach((program) => {
    const option = document.createElement("option");
    option.value = program.id;
    option.textContent = program.name;
    programSelect.append(option);
  });

  const loadProgram = async (programId) => {
    const program = programs.find((p) => p.id === programId);
    currentProgramId = programId;
    currentLabels = parseLevelLabels(program?.level_labels);
    selectedIds = [null, null, null, null];
    editingReqId = null;
    showReqAddForm = false;

    const [budgets, guidance, aiCriteria] = await Promise.all([
      getSupportProgramBudgets(programId),
      getGuidanceItems(programId),
      getProgramAiCriteriaDocument(programId),
    ]);
    budgetItems = budgets;
    guidanceItems = guidance;
    aiCriteriaDoc = aiCriteria || null;

    programSections.hidden = false;
    document.querySelector("#program-description").value = program?.description || "";
    document.querySelector("#program-memo").value = program?.memo || "";

    render(budgetEl);
    renderGuidance();
    renderAiCriteria();
  };

  programSelect.addEventListener("change", async () => {
    const programId = programSelect.value;
    if (!programId) {
      programSections.hidden = true;
      currentProgramId = null;
      selectedIds = [null, null, null, null];
      return;
    }
    await runWithErrorBoundary(() => loadProgram(programId), {});
  });

  // 참가사업 설명 저장
  document.querySelector("#save-description").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const description = document.querySelector("#program-description").value;
    await runWithErrorBoundary(async () => {
      const updated = await updateSupportProgramDescription(currentProgramId, description);
      const prog = programs.find((p) => p.id === currentProgramId);
      if (prog) prog.description = updated.description;
      const orig = btn.textContent;
      btn.textContent = "저장됨";
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }, { button: btn });
  });

  // 메모 저장
  document.querySelector("#save-memo").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const memo = document.querySelector("#program-memo").value;
    await runWithErrorBoundary(async () => {
      const updated = await updateSupportProgramMemo(currentProgramId, memo);
      const prog = programs.find((p) => p.id === currentProgramId);
      if (prog) prog.memo = updated.memo;
      const orig = btn.textContent;
      btn.textContent = "저장됨";
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }, { button: btn });
  });

  // 안내사항 행 추가
  const guidanceShowAddBtn = document.querySelector("#guidance-show-add");
  const guidanceAddRow = document.querySelector("[data-guidance-add-row]");
  const guidanceAddTitle = document.querySelector("#guidance-add-title");
  const guidanceAddFile = document.querySelector("#guidance-add-file");
  const guidanceAddFileLabel = document.querySelector("#guidance-add-file-label");

  const resetAddRow = () => {
    guidanceAddRow.style.display = "none";
    guidanceShowAddBtn.style.display = "";
    guidanceAddTitle.value = "";
    guidanceAddFile.value = "";
    guidanceAddFileLabel.textContent = "📎 파일 첨부";
  };

  guidanceShowAddBtn.addEventListener("click", () => {
    guidanceAddRow.style.display = "grid";
    guidanceShowAddBtn.style.display = "none";
    guidanceAddTitle.focus();
  });

  guidanceAddFile.addEventListener("change", () => {
    const file = guidanceAddFile.files[0];
    guidanceAddFileLabel.textContent = file ? file.name : "📎 파일 첨부";
  });

  document.querySelector("#guidance-cancel-add").addEventListener("click", resetAddRow);

  document.querySelector("#guidance-confirm-add").addEventListener("click", async (e) => {
    const title = guidanceAddTitle.value.trim();
    if (!title) { guidanceAddTitle.focus(); return; }
    const file = guidanceAddFile.files[0] || null;
    await runWithErrorBoundary(async () => {
      const upload = file ? await uploadGuidanceFile(file) : null;
      const maxSort = guidanceItems.reduce((max, i) => Math.max(max, Number(i.sort_order || 0)), 0);
      await createGuidanceItem({
        title,
        content: upload?.original_filename || null,
        link_url: upload?.link_url || null,
        sort_order: maxSort + 10,
        support_program_id: currentProgramId,
      }, currentUser.id);
      resetAddRow();
      guidanceItems = await getGuidanceItems(currentProgramId);
      renderGuidance();
    }, { button: e.currentTarget });
  });

  guidanceAddTitle.addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.querySelector("#guidance-confirm-add").click();
    else if (e.key === "Escape") resetAddRow();
  });

} catch (error) {
  showError(error);
}
