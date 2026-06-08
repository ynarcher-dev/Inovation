// 지출결의서 모달 (두 가지)
//   1) openExpenseVoucherSettingsModal — '지출결의 정리기': 텍스트 템플릿 편집(토큰 칩 + 미리보기).
//   2) openVoucherTextModal — '지출결의' 결과: 생성된 텍스트 표시 + '복사' 버튼.
//   EvidenceFilenameModal 의 modal-backdrop/.modal/닫기 패턴을 재사용한다.
import { escapeHtml } from "../utils.js";
import {
  VOUCHER_TOKENS,
  DEFAULT_VOUCHER_SETTINGS,
  buildVoucherTokenValues,
  renderVoucherText,
} from "../domains/expense/voucher-template.js";
import {
  DEFAULT_EVIDENCE_FILENAME_SETTINGS,
  buildExpenseTokenValues,
  buildFileTokenValues,
  renderEvidenceFilename,
} from "../domains/expense/filename-template.js";

// 미리보기용 샘플 첨부 2건(첨부목록이 줄바꿈으로 펼쳐지는 걸 보여주기 위함).
const SAMPLE_FILES = [
  { attachLabel: "견적서", originalFilename: "estimate.pdf" },
  { attachLabel: "통장사본", originalFilename: "bankbook.jpg" },
];

const SAMPLE_EXPENSE = {
  company_name: "딜챗2",
  representative_name: "홍길동",
  title: "사무용품 구매",
  business_plan_item_label: "사무용품비",
  vendor_name: "오피스마트",
  vendor_business_number: "123-45-67890",
  amount_supply: 1000000,
  vat_amount: 100000,
  total_amount: 1100000,
  purpose: "사무용 비품 구매",
  submitted_at: "2026-06-08",
  status: "pre_approved",
};

const TOKEN_GROUPS = ["신청", "금액", "기타", "첨부"];

// '지출결의 정리기' — 텍스트 템플릿 편집 모달.
//   settings: { template }, sampleExpense: 실제 신청 1건(없으면 샘플), onSave: async ({template}) => updated
export function openExpenseVoucherSettingsModal({ settings, sampleExpense, onSave } = {}) {
  const current = { ...DEFAULT_VOUCHER_SETTINGS, ...(settings || {}) };
  const sample = sampleExpense || SAMPLE_EXPENSE;

  // 미리보기 {첨부목록}: 파일명 정리기 기본 규칙으로 샘플 첨부명을 만든다.
  const sampleExpenseFileValues = buildExpenseTokenValues(sample);
  const sampleAttachLines = SAMPLE_FILES.map((file, index) => {
    const stem = renderEvidenceFilename(DEFAULT_EVIDENCE_FILENAME_SETTINGS.template, {
      ...sampleExpenseFileValues,
      ...buildFileTokenValues(file, index, DEFAULT_EVIDENCE_FILENAME_SETTINGS),
    });
    const ext = file.originalFilename.split(".").pop();
    return `${stem}.${ext}`;
  });

  const chipFor = (t) =>
    `<button type="button" class="token-chip" data-token="${escapeHtml(t.token)}" title="${escapeHtml(t.token)}">${escapeHtml(t.label)}</button>`;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="voucher-settings-title" style="max-width:720px;">
      <div class="modal-header">
        <div>
          <h2 id="voucher-settings-title">지출결의 정리기</h2>
          <p class="muted">'지출결의' 버튼이 만들 텍스트 양식입니다. 모든 관리자에게 공통 적용됩니다.</p>
        </div>
        <button class="modal-close" type="button" aria-label="닫기">×</button>
      </div>
      <p class="error" data-modal-error hidden></p>

      <div class="field">
        <label for="voucher-template-input">지출결의서 양식</label>
        <textarea id="voucher-template-input" rows="12" spellcheck="false" style="font-family:var(--mono,monospace); resize:vertical;">${escapeHtml(current.template)}</textarea>
      </div>

      <div class="token-palette">
        ${TOKEN_GROUPS.map((group) => {
          const items = VOUCHER_TOKENS.filter((t) => t.group === group);
          if (!items.length) return "";
          return `
          <div class="token-group">
            <span class="token-group-title">${escapeHtml(group)}</span>
            <div class="token-chips">${items.map(chipFor).join("")}</div>
          </div>`;
        }).join("")}
        <p class="muted" style="font-size:12px;margin:4px 0 0;">칩을 누르면 커서 위치에 토큰이 삽입됩니다. <code>{첨부목록}</code>은 첨부 파일명(파일명 정리기 규칙)이 한 줄에 하나씩 펼쳐집니다.</p>
      </div>

      <div class="notice notice-info" style="margin-top:12px;">
        <strong>미리보기</strong>
        <p class="muted" style="margin:4px 0 8px;font-size:12px;">샘플 신청 1건 · 첨부 2건 기준</p>
        <pre data-voucher-preview class="voucher-preview"></pre>
      </div>

      <div class="actions" style="margin-top:16px;">
        <button class="button" data-save-voucher type="button">저장</button>
        <button class="button secondary" data-cancel-voucher type="button">취소</button>
      </div>
    </section>
  `;

  const templateInput = backdrop.querySelector("#voucher-template-input");
  const previewEl = backdrop.querySelector("[data-voucher-preview]");
  const errorTarget = backdrop.querySelector("[data-modal-error]");
  const saveBtn = backdrop.querySelector("[data-save-voucher]");

  let caret = { start: templateInput.value.length, end: templateInput.value.length };
  const rememberCaret = () => {
    caret = { start: templateInput.selectionStart, end: templateInput.selectionEnd };
  };
  templateInput.addEventListener("keyup", rememberCaret);
  templateInput.addEventListener("click", rememberCaret);
  templateInput.addEventListener("select", rememberCaret);

  const renderPreview = () => {
    const values = { ...buildVoucherTokenValues(sample), "{첨부목록}": sampleAttachLines.join("\n") };
    previewEl.textContent = renderVoucherText(templateInput.value, values);
  };

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
  renderPreview();

  const close = () => backdrop.remove();
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.querySelector("[data-cancel-voucher]").addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });

  saveBtn.addEventListener("click", async () => {
    const template = templateInput.value.trim();
    if (!template) {
      errorTarget.hidden = false;
      errorTarget.textContent = "지출결의서 양식을 입력해주세요.";
      return;
    }
    try {
      saveBtn.disabled = true;
      errorTarget.hidden = true;
      if (onSave) await onSave({ template });
      close();
    } catch (error) {
      errorTarget.hidden = false;
      errorTarget.textContent = error?.message || "지출결의 양식 저장 중 오류가 발생했습니다.";
    } finally {
      saveBtn.disabled = false;
    }
  });

  document.body.append(backdrop);
}

// '지출결의' 결과 — 생성된 텍스트를 보여주고 클립보드로 복사한다.
//   title: 신청 제목(헤더 표시용), text: 생성된 지출결의서 텍스트.
export function openVoucherTextModal({ title, text } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="voucher-text-title" style="max-width:720px;">
      <div class="modal-header">
        <div>
          <h2 id="voucher-text-title">지출결의서</h2>
          <p class="muted">${escapeHtml(title || "")} · 아래 내용을 복사해 결재시스템에 붙여넣으세요.</p>
        </div>
        <button class="modal-close" type="button" aria-label="닫기">×</button>
      </div>
      <div class="field">
        <textarea data-voucher-text rows="16" spellcheck="false" style="font-family:var(--mono,monospace); resize:vertical;">${escapeHtml(text || "")}</textarea>
      </div>
      <div class="actions" style="margin-top:16px;">
        <button class="button" data-copy-voucher type="button">복사</button>
        <button class="button secondary" data-close-voucher type="button">닫기</button>
      </div>
    </section>
  `;

  const textArea = backdrop.querySelector("[data-voucher-text]");
  const copyBtn = backdrop.querySelector("[data-copy-voucher]");

  const close = () => backdrop.remove();
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.querySelector("[data-close-voucher]").addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });

  copyBtn.addEventListener("click", async () => {
    const value = textArea.value;
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        ok = true;
      }
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      // 폴백: textarea 선택 후 execCommand (구형/비보안 컨텍스트).
      textArea.focus();
      textArea.select();
      try {
        ok = document.execCommand("copy");
      } catch (e) {
        ok = false;
      }
    }
    copyBtn.textContent = ok ? "복사됨!" : "복사 실패 — 직접 선택해 복사하세요";
    copyBtn.classList.toggle("secondary", !ok);
    setTimeout(() => {
      copyBtn.textContent = "복사";
      copyBtn.classList.remove("secondary");
    }, 2000);
  });

  document.body.append(backdrop);
  // 열리면 바로 전체 선택해 두어 수동 복사도 쉽게.
  textArea.focus();
  textArea.select();
}
