import { escapeHtml } from "../utils.js";
import { getDocumentActionMeta } from "../rulesEngine.js";

const statusText = {
  missing: "미제출",
  uploaded: "제출",
  verified: "확인",
  rejected: "반려",
};

export function Checklist(items) {
  if (!items?.length) {
    return `<p class="empty">필수서류가 아직 계산되지 않았습니다.</p>`;
  }

  return `
    <div class="checklist">
      ${items.map((item) => `
        <button class="checklist-row checklist-action" type="button" data-document-type="${escapeHtml(item.document_type)}">
          <div>
            <strong>${escapeHtml(item.label)}</strong>
            <span>${item.required ? "필수" : "선택"}</span>
          </div>
          <div class="doc-action-side">
            <em class="doc-${item.status}">${statusText[item.status] || item.status}</em>
            <span>${escapeHtml(getDocumentActionMeta(item.document_type).button)}</span>
          </div>
        </button>
      `).join("")}
    </div>
  `;
}
