// 단계별(사전/최종) 첨부서류 패널 — 창업자 상세·관리자 상세 공용.
// custom-document-requirements-plan.md §4.3(잠금/해금)·§4.4(AI검토 버튼)·§4.5(코멘트 위치) 구현.
import { escapeHtml } from "../../utils.js";

// 파일 선택 드롭존 아이콘(feather upload) — 이모지 대신 라인 아이콘으로 통일.
const UPLOAD_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;

// 잠금 단계 오버레이용 자물쇠 아이콘(feather lock).
const LOCK_ICON = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;

const AI_STATUS = {
  not_requested: { label: "미검토", tone: "neutral" },
  pending: { label: "검토 중", tone: "info" },
  passed: { label: "제출 가능", tone: "success" },
  needs_revision: { label: "보완 필요", tone: "warning" },
  failed: { label: "검토 실패", tone: "danger" },
};

function aiMeta(status) {
  return AI_STATUS[status] || AI_STATUS.not_requested;
}

// 패널 상단 요약: 필수 업로드 진행률 + AI 검토 결과 분포 (§4.5).
function summaryHtml(requirements, aiEnabled) {
  const required = requirements.filter((r) => r.required);
  const uploadedRequired = required.filter((r) => r.file).length;
  const reviewed = requirements.filter((r) => r.file);
  const cleared = reviewed.filter((r) => r.file.cleared).length;
  const passed = reviewed.filter((r) => r.file.ai_review_status === "passed" && !r.file.cleared).length;
  // 신청자가 이상없음으로 소명한 건은 '보완 필요'에서 제외한다.
  const revision = reviewed.filter((r) => r.file.ai_review_status === "needs_revision" && !r.file.cleared).length;
  const notReviewed = reviewed.filter((r) => !r.file.ai_review_status || r.file.ai_review_status === "not_requested").length;
  const aiParts = [];
  if (passed) aiParts.push(`제출 가능 ${passed}건`);
  if (revision) aiParts.push(`보완 필요 ${revision}건`);
  if (cleared) aiParts.push(`이상없음 처리 ${cleared}건`);
  if (notReviewed) aiParts.push(`미검토 ${notReviewed}건`);
  return `
    <p class="doc-phase-summary">
      필수 ${required.length}건 중 ${uploadedRequired}건 업로드 완료
      ${aiEnabled && reviewed.length && aiParts.length ? `<span class="doc-phase-summary-ai">· AI검토: ${aiParts.join(", ")}</span>` : ""}
    </p>`;
}

// AI검토 결과 바(§4.5) — 파일명 행과 분리해 별도 줄에 둔다.
// 점·박스 색은 결과에 따라 바뀌고(미검토는 회색), 신청자가 이상없음 처리하면 파랑(info)으로 표시.
// 검토 완료(코멘트 존재) 상태면 클릭 시 모달([data-doc-ai-comment]).
function aiReviewBar(req, aiEnabled) {
  const file = req.file;
  if (!aiEnabled || !file || !req.ai_review_enabled) return "";
  const cleared = !!file.cleared;
  const tone = cleared ? "info" : aiMeta(file.ai_review_status).tone;
  const head = cleared ? "신청자 확인" : "AI검토 결과";
  const status = cleared ? "이상없음" : aiMeta(file.ai_review_status).label;
  const dot = `<span class="ai-dot ai-dot-${tone}" aria-hidden="true"></span>`;
  const inner = `${dot}<span class="ai-review-bar-label">${head}</span><span class="ai-review-bar-status">${status}</span>`;
  if (file.ai_review_comment || cleared) {
    return `<button class="ai-review-bar ai-review-bar-${tone} is-clickable" type="button" data-doc-ai-comment="${escapeHtml(file.id)}">${inner}<span class="ai-review-bar-chevron" aria-hidden="true">›</span></button>`;
  }
  return `<div class="ai-review-bar ai-review-bar-${tone}">${inner}</div>`;
}

// AI검토 결과 모달 — 행의 [data-doc-ai-comment] 버튼에서 호출한다.
//  opts: { req, mode, editable, onClear?(comment), onRevert?() }
//  - 창업자 + 수정가능 + 보완 필요: '이상없음 소명' 입력/표시(§AI 오검출 대응).
//  - 관리자/읽기전용: AI 결과 + (있으면) 신청자 소명만 표시.
export function openAiReviewModal({ req, mode, editable, onClear, onRevert }) {
  const file = req.file;
  const meta = aiMeta(file.ai_review_status);
  const cleared = !!file.cleared;
  const canAct = mode === "founder" && editable && file.ai_review_status === "needs_revision";

  const overrideSection = cleared
    ? `
      <div class="ai-modal-override is-cleared">
        <div class="ai-modal-override-head"><span class="ai-dot ai-dot-info" aria-hidden="true"></span>신청자 확인 · 이상없음</div>
        <p class="ai-modal-override-comment">${escapeHtml(file.user_review_comment || "")}</p>
        ${canAct ? `<button class="button small secondary" type="button" data-ai-revert>이상없음 처리 취소</button>` : ""}
      </div>`
    : canAct
      ? `
        <div class="ai-modal-override">
          <p class="muted caption" style="margin:0 0 8px">AI 검토가 착오라고 판단되면, 직접 확인한 내용을 사유로 남기고 이상없음으로 표시할 수 있습니다. 관리자 검토 시 함께 표시됩니다.</p>
          <textarea class="ai-modal-textarea" data-ai-comment placeholder="예: 견적서 하단에 발행일자와 공급가액이 정상 표기되어 있어 보완이 불필요합니다."></textarea>
          <button class="button small" type="button" data-ai-clear>이상없음으로 표시</button>
        </div>`
      : "";

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="ai-review-modal-title">
      <div class="modal-header">
        <div>
          <h2 id="ai-review-modal-title">AI검토 결과</h2>
          <p class="muted">${escapeHtml(req.title || "")} <span class="badge badge-${meta.tone}">${meta.label}</span></p>
        </div>
        <button class="modal-close" type="button" aria-label="닫기">×</button>
      </div>
      <pre class="ai-review-comment">${escapeHtml(file.ai_review_comment || "")}</pre>
      <p class="error" data-ai-error hidden></p>
      ${overrideSection}
    </section>`;

  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };
  function onKey(event) {
    if (event.key === "Escape") close();
  }
  const runAction = async (fn, button) => {
    const errEl = backdrop.querySelector("[data-ai-error]");
    try {
      button.disabled = true;
      errEl.hidden = true;
      await fn();
      close();
    } catch (error) {
      errEl.hidden = false;
      errEl.textContent = error?.message || "처리 중 오류가 발생했습니다.";
    } finally {
      button.disabled = false;
    }
  };

  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  backdrop.querySelector("[data-ai-clear]")?.addEventListener("click", (event) => {
    const comment = backdrop.querySelector("[data-ai-comment]")?.value || "";
    if (!comment.trim()) {
      const errEl = backdrop.querySelector("[data-ai-error]");
      errEl.hidden = false;
      errEl.textContent = "이상없음 사유를 입력해주세요.";
      return;
    }
    runAction(() => onClear(comment), event.currentTarget);
  });
  backdrop.querySelector("[data-ai-revert]")?.addEventListener("click", (event) =>
    runAction(() => onRevert(), event.currentTarget));

  document.addEventListener("keydown", onKey);
  document.body.append(backdrop);
}

// 한 요구사항(서류) 행을 렌더한다.
function requirementRowHtml(req, { editable, mode, aiEnabled }) {
  const file = req.file;
  const tag = req.required
    ? `<span class="checklist-tag is-required">[필수]</span>`
    : `<span class="checklist-tag">[선택]</span>`;

  let body;
  if (file) {
    // AI 검토는 단계별 일괄검토(패널 상단 버튼)로 수행한다. 행에는 AI검토 점·파일 동작만 둔다(§4.4 코멘트는 모달 분리).
    const fileEdit = mode === "founder" && editable
      ? `
        <button class="doc-file-btn" type="button" data-doc-replace="${escapeHtml(req.id)}">파일 교체</button>
        <button class="doc-file-btn is-danger" type="button" data-doc-delete="${escapeHtml(file.id)}">삭제</button>`
      : "";
    body = `
      <div class="doc-item-foot">
        <span class="doc-file-name"><span class="doc-file-icon">📄</span><span class="doc-file-label">${escapeHtml(file.original_filename)}</span></span>
        <div class="doc-file-actions">
          ${fileEdit}
          <button class="doc-file-btn" type="button" data-doc-open="${escapeHtml(file.id)}">다운로드</button>
        </div>
      </div>
      ${aiReviewBar(req, aiEnabled)}`;
  } else if (editable && mode === "founder") {
    body = `
      <button class="doc-dropzone" type="button" data-doc-upload="${escapeHtml(req.id)}">
        <span class="doc-dropzone-icon">${UPLOAD_ICON}</span> 파일 선택
      </button>`;
  } else {
    body = `<p class="doc-file-empty caption">${mode === "admin" ? "미제출" : "잠긴 단계입니다. 해당 단계가 해금되면 업로드할 수 있습니다."}</p>`;
  }

  return `
    <div class="doc-item" data-doc-req-id="${escapeHtml(req.id)}">
      <div class="doc-item-head">
        <div class="doc-item-title">${tag}<strong>${escapeHtml(req.title)}</strong></div>
      </div>
      ${req.description ? `<p class="muted caption" style="margin:0">${escapeHtml(req.description)}</p>` : ""}
      ${body}
    </div>`;
}

// 패널 전체를 그린다.
//  opts: { phase, title, requirements, editable, mode, lockedNote }
export function renderDocumentPhasePanel(container, opts) {
  const { title, requirements, editable, mode, lockedNote } = opts;
  const aiEnabled = opts.aiEnabled !== false;
  const locked = !editable && mode === "founder" && !!lockedNote;
  if (!requirements.length) {
    container.classList.remove("doc-phase-is-locked");
    container.innerHTML = `<h2>${escapeHtml(title)}</h2><p class="muted">설정된 첨부서류가 없습니다.</p>`;
    return;
  }
  // 잠금 단계: 박스 내용은 살짝 비치게 흐리고(.is-locked) 자물쇠 오버레이로 덮는다 (§4.3).
  const lockOverlay = locked
    ? `<div class="doc-phase-lock-overlay">
         <div class="doc-phase-lock-overlay-inner">
           <span class="doc-phase-lock-icon">${LOCK_ICON}</span>
           <p class="doc-phase-lock-text">${escapeHtml(lockedNote)}</p>
         </div>
       </div>`
    : "";

  // AI 일괄검토 버튼: 해금된 단계 + AI검토 사용 서류에 파일이 1건 이상 올라와 있을 때 노출(§4.4).
  const reviewableCount = aiEnabled ? requirements.filter((r) => r.ai_review_enabled && r.file).length : 0;
  const anyReviewed = requirements.some((r) => r.file && r.file.ai_review_status && r.file.ai_review_status !== "not_requested");
  const batchBtn = editable && mode === "founder" && reviewableCount > 0
    ? `<div class="doc-phase-actions">
         <button class="button small secondary" type="button" data-doc-batch-review>
           ${anyReviewed ? "AI 일괄 재검토" : "AI 일괄검토"} (${reviewableCount}건)
         </button>
       </div>`
    : "";

  container.classList.toggle("doc-phase-is-locked", locked);
  container.innerHTML = `
    <h2>${escapeHtml(title)}</h2>
    <div class="doc-phase-body${locked ? " is-locked" : ""}">
      ${summaryHtml(requirements, aiEnabled)}
      ${batchBtn}
      <div class="checklist">${requirements.map((r) => requirementRowHtml(r, { editable, mode, aiEnabled })).join("")}</div>
    </div>
    ${lockOverlay}`;
}
