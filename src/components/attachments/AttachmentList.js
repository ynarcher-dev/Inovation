// 관리자가 등록한 첨부파일(안내자료) 목록 — 창업자 대시보드 사업개요 탭용.
import { escapeHtml } from "../../utils.js";

export function AttachmentList(items) {
  if (!items?.length) return `<p class="empty">등록된 첨부파일이 없습니다.</p>`;
  return `<div class="attachment-list">${items.map((it) => {
    const filename = it.content || "첨부파일";
    const fileBlock = it.link_url
      ? `<div class="attachment-file">
           <span class="attachment-filename">${escapeHtml(filename)}</span>
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
