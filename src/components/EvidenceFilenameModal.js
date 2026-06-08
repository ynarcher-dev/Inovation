// 증빙 파일명 정리기 모달
//   관리자가 토큰({기업명},{첨부분류},{순번} 등)과 자유 텍스트로 파일명 규칙(템플릿)을 조립하고,
//   순번 시작값/자릿수를 정한 뒤 실시간 미리보기로 결과를 확인해 저장한다.
//   DocumentActionModal 의 modal-backdrop/.modal/닫기 패턴을 재사용한다.
import { escapeHtml } from "../utils.js";
import {
  EVIDENCE_TOKENS,
  DEFAULT_EVIDENCE_FILENAME_SETTINGS,
  buildExpenseTokenValues,
  buildFileTokenValues,
  renderEvidenceFilename,
} from "../domains/expense/filename-template.js";

// 미리보기에 쓸 샘플 첨부 2건(순번이 1,2로 늘어나는 걸 보여주기 위함).
const SAMPLE_FILES = [
  { attachLabel: "견적서", originalFilename: "estimate_2026.pdf" },
  { attachLabel: "통장사본", originalFilename: "bankbook_scan.jpg" },
];

const TOKEN_GROUPS = [
  { title: "신청 정보", scope: "expense" },
  { title: "파일 정보", scope: "file" },
];

// openEvidenceFilenameModal({ settings, sampleExpense, onSave })
//   settings:  { template, seq_start, seq_pad } — 현재 저장값(없으면 기본).
//   sampleExpense: 미리보기에 쓸 실제 신청 1건(없으면 가상 샘플).
//   onSave: async ({ template, seq_start, seq_pad }) => updated  — 저장 위임(throw 시 모달에 에러).
export function openEvidenceFilenameModal({ settings, sampleExpense, onSave } = {}) {
  const current = { ...DEFAULT_EVIDENCE_FILENAME_SETTINGS, ...(settings || {}) };

  // 미리보기용 신청 토큰 값(실제 행이 있으면 그 값, 없으면 샘플).
  const sampleExpenseValues = sampleExpense
    ? buildExpenseTokenValues({
        company_name: sampleExpense.company_name,
        title: sampleExpense.title,
        business_plan_item_label: sampleExpense.business_plan_item_label,
        budget_category: sampleExpense.budget_category,
        amount_supply: sampleExpense.amount_supply,
        total_amount: sampleExpense.total_amount,
        vat_amount: sampleExpense.vat_amount,
        status: sampleExpense.status,
        submitted_at: sampleExpense.submitted_at,
        created_at: sampleExpense.created_at,
      })
    : buildExpenseTokenValues({
        company_name: "딜챗2",
        title: "사무용품 구매",
        business_plan_item_label: "사무용품비",
        amount_supply: 1000000,
        total_amount: 1100000,
        status: "pre_approved",
        submitted_at: "2026-06-08",
      });

  const chipFor = (t) =>
    `<button type="button" class="token-chip" data-token="${escapeHtml(t.token)}" title="${escapeHtml(t.token)}">${escapeHtml(t.label)}</button>`;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="evidence-filename-title" style="max-width:640px;">
      <div class="modal-header">
        <div>
          <h2 id="evidence-filename-title">증빙 파일명 정리기</h2>
          <p class="muted">증빙 다운로드 시 ZIP 안 파일명을 만들 규칙입니다. 모든 관리자에게 공통 적용됩니다.</p>
        </div>
        <button class="modal-close" type="button" aria-label="닫기">×</button>
      </div>
      <p class="error" data-modal-error hidden></p>

      <div class="field">
        <label for="evidence-template-input">파일명 규칙</label>
        <input id="evidence-template-input" type="text" value="${escapeHtml(current.template)}" autocomplete="off" spellcheck="false">
      </div>

      <div class="token-palette">
        ${TOKEN_GROUPS.map(
          (g) => `
          <div class="token-group">
            <span class="token-group-title">${escapeHtml(g.title)}</span>
            <div class="token-chips">
              ${EVIDENCE_TOKENS.filter((t) => t.scope === g.scope).map(chipFor).join("")}
            </div>
          </div>`,
        ).join("")}
        <p class="muted" style="font-size:12px;margin:4px 0 0;">칩을 누르면 커서 위치에 토큰이 삽입됩니다. 토큰 사이 글자(<code>_</code>, <code>첨부</code> 등)는 그대로 유지됩니다.</p>
      </div>

      <div class="grid grid-2" style="gap:12px;margin-top:12px;">
        <div class="field">
          <label for="evidence-seq-start">순번 시작값</label>
          <input id="evidence-seq-start" type="number" min="0" step="1" value="${escapeHtml(String(current.seq_start))}">
        </div>
        <div class="field">
          <label for="evidence-seq-pad">순번 자릿수(0 채움)</label>
          <input id="evidence-seq-pad" type="number" min="1" max="6" step="1" value="${escapeHtml(String(current.seq_pad))}">
        </div>
      </div>

      <div class="notice notice-info" style="margin-top:12px;">
        <strong>미리보기</strong>
        <p class="muted" style="margin:4px 0 8px;font-size:12px;">샘플 신청 1건 · 첨부 2건 기준</p>
        <ul data-evidence-preview style="margin:0;padding-left:18px;"></ul>
      </div>

      <div class="actions" style="margin-top:16px;">
        <button class="button" data-save-evidence-filename type="button">저장</button>
        <button class="button secondary" data-cancel-evidence-filename type="button">취소</button>
      </div>
    </section>
  `;

  const templateInput = backdrop.querySelector("#evidence-template-input");
  const seqStartInput = backdrop.querySelector("#evidence-seq-start");
  const seqPadInput = backdrop.querySelector("#evidence-seq-pad");
  const previewEl = backdrop.querySelector("[data-evidence-preview]");
  const errorTarget = backdrop.querySelector("[data-modal-error]");
  const saveBtn = backdrop.querySelector("[data-save-evidence-filename]");

  // 마지막 커서 위치 기억(칩 클릭으로 input 이 blur 돼도 그 자리에 삽입).
  let caret = { start: templateInput.value.length, end: templateInput.value.length };
  const rememberCaret = () => {
    caret = { start: templateInput.selectionStart, end: templateInput.selectionEnd };
  };
  templateInput.addEventListener("keyup", rememberCaret);
  templateInput.addEventListener("click", rememberCaret);
  templateInput.addEventListener("select", rememberCaret);

  const readSeqConfig = () => ({
    seq_start: Number.isFinite(Number(seqStartInput.value)) ? Number(seqStartInput.value) : 1,
    seq_pad: Math.max(1, Number(seqPadInput.value) || 1),
  });

  const renderPreview = () => {
    const template = templateInput.value;
    const seqConfig = readSeqConfig();
    previewEl.innerHTML = SAMPLE_FILES.map((file, index) => {
      const values = { ...sampleExpenseValues, ...buildFileTokenValues(file, index, seqConfig) };
      const stem = renderEvidenceFilename(template, values) || "(빈 파일명 — 기본명으로 대체됩니다)";
      const ext = file.originalFilename.split(".").pop();
      return `<li><code>${escapeHtml(stem)}.${escapeHtml(ext)}</code></li>`;
    }).join("");
  };

  // 칩 삽입: 기억한 커서 위치에 토큰을 끼워넣고 커서를 토큰 뒤로 이동.
  backdrop.querySelectorAll(".token-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const token = chip.dataset.token;
      const v = templateInput.value;
      const start = caret.start ?? v.length;
      const end = caret.end ?? v.length;
      templateInput.value = v.slice(0, start) + token + v.slice(end);
      const pos = start + token.length;
      caret = { start: pos, end: pos };
      templateInput.focus();
      templateInput.setSelectionRange(pos, pos);
      renderPreview();
    });
  });

  templateInput.addEventListener("input", renderPreview);
  seqStartInput.addEventListener("input", renderPreview);
  seqPadInput.addEventListener("input", renderPreview);
  renderPreview();

  const close = () => backdrop.remove();
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.querySelector("[data-cancel-evidence-filename]").addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });

  saveBtn.addEventListener("click", async () => {
    const template = templateInput.value.trim();
    if (!template) {
      errorTarget.hidden = false;
      errorTarget.textContent = "파일명 규칙을 입력해주세요.";
      return;
    }
    const payload = { template, ...readSeqConfig() };
    try {
      saveBtn.disabled = true;
      errorTarget.hidden = true;
      if (onSave) await onSave(payload);
      close();
    } catch (error) {
      errorTarget.hidden = false;
      errorTarget.textContent = error?.message || "파일명 규칙 저장 중 오류가 발생했습니다.";
    } finally {
      saveBtn.disabled = false;
    }
  });

  document.body.append(backdrop);
}
