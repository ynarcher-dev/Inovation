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
} from "../../api.js";
import { requireRole } from "../../auth.js";
import { escapeHtml } from "../../utils.js";

let programs = [];
let selectedIds = [null, null, null, null];
let budgetItems = [];
let currentProgramId = null;
let currentLabels = ["depth.1", "depth.2", "depth.3", "depth.4"];
let guidanceItems = [];
let currentUser = null;

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

    const [budgets, guidance] = await Promise.all([
      getSupportProgramBudgets(programId),
      getGuidanceItems(programId),
    ]);
    budgetItems = budgets;
    guidanceItems = guidance;

    programSections.hidden = false;
    document.querySelector("#program-description").value = program?.description || "";
    document.querySelector("#program-memo").value = program?.memo || "";

    render(budgetEl);
    renderGuidance();
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
