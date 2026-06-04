import { escapeHtml } from "../utils.js";
import { getDocumentActionMeta } from "../domains/expense/rules-engine.js";

const statusText = {
  missing: "미제출",
  uploaded: "제출",
  verified: "확인",
  rejected: "반려",
};

/**
 * 서류 제출 체크리스트.
 * @param {Array} items 서류 항목(document_type, label, required, status)
 * @param {{ files?: Array, actionable?: boolean, downloadable?: boolean }} options
 *   files: 업로드된 파일 목록(document_type로 매칭)
 *   actionable: 업로드·수정·삭제 동작 노출 여부
 *   downloadable: 제출된 파일 다운로드 버튼 노출 여부(조회 전용 화면에서도 첨부 파일 재다운로드 허용)
 */
export function Checklist(items, options = {}) {
  if (!items?.length) {
    return `<p class="empty">필수서류가 아직 계산되지 않았습니다.</p>`;
  }

  const { files = [], actionable = true, downloadable = false } = options;
  const fileByType = new Map();
  for (const file of files) {
    if (!fileByType.has(file.document_type)) fileByType.set(file.document_type, file);
  }

  return `
    <div class="checklist">
      ${items.map((item) => {
        const file = fileByType.get(item.document_type);
        const meta = getDocumentActionMeta(item.document_type);
        return `
        <div class="doc-item${file ? " is-done" : ""}">
          <div class="doc-item-head">
            <div class="doc-item-title">
              <strong>${escapeHtml(item.label)}</strong>
              <span class="checklist-tag${item.required ? " is-required" : ""}">${item.required ? "필수" : "선택"}</span>
            </div>
            <span class="checklist-status doc-${item.status}">${statusText[item.status] || item.status}</span>
          </div>
          <div class="doc-item-foot">
            ${file
              ? `
                <span class="doc-file-name" title="${escapeHtml(file.original_filename)}">
                  <span class="doc-file-icon" aria-hidden="true">📎</span>
                  <span class="doc-file-label">${escapeHtml(file.original_filename)}</span>
                </span>
                ${(downloadable || actionable)
                  ? `
                <span class="doc-file-actions">
                  ${downloadable
                    ? `<button class="doc-file-btn" type="button" data-download-file="${escapeHtml(file.link_url || "")}" data-file-name="${escapeHtml(file.original_filename)}">다운로드</button>`
                    : ""}
                  ${actionable
                    ? `
                  <button class="doc-file-btn" type="button" data-document-type="${escapeHtml(item.document_type)}">수정</button>
                  <button class="doc-file-btn is-danger" type="button" data-delete-file="${escapeHtml(file.id)}">삭제</button>
                  `
                    : ""}
                </span>
                `
                  : ""}
              `
              : actionable
                ? meta.action === "upload"
                  ? `
                <label class="doc-dropzone" data-dropzone data-document-type="${escapeHtml(item.document_type)}">
                  <input type="file" hidden>
                  <span class="doc-dropzone-icon" aria-hidden="true">⬆</span>
                  <span class="doc-dropzone-text">파일을 끌어다 놓거나 클릭해서 선택</span>
                </label>
                `
                  : `
                <button class="doc-upload-btn" type="button" data-document-type="${escapeHtml(item.document_type)}">
                  ${escapeHtml(meta.button)}
                </button>
                `
                : `<span class="doc-file-name doc-file-empty">아직 제출되지 않았습니다.</span>`}
          </div>
        </div>`;
      }).join("")}
    </div>
  `;
}
