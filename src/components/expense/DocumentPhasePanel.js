// 단계별(사전/최종) 첨부서류 패널 — 창업자 상세·관리자 상세 공용.
// custom-document-requirements-plan.md §4.3(잠금/해금)·§4.4(AI검토 버튼)·§4.5(코멘트 위치) 구현.
import { escapeHtml, formatDate } from "../../utils.js";

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
  // 신청자가 소명한 건은 AI 보완 필요와 구분해 표시한다.
  const revision = reviewed.filter((r) => r.file.ai_review_status === "needs_revision" && !r.file.cleared).length;
  const notReviewed = reviewed.filter((r) => !r.file.ai_review_status || r.file.ai_review_status === "not_requested").length;
  const aiParts = [];
  if (passed) aiParts.push(`제출 가능 ${passed}건`);
  if (revision) aiParts.push(`보완 필요 ${revision}건`);
  if (cleared) aiParts.push(`신청자 소명 ${cleared}건`);
  if (notReviewed) aiParts.push(`미검토 ${notReviewed}건`);
  return `
    <p class="doc-phase-summary">
      필수 ${required.length}건 중 ${uploadedRequired}건 업로드 완료
      ${aiEnabled && reviewed.length && aiParts.length ? `<span class="doc-phase-summary-ai">· AI검토: ${aiParts.join(", ")}</span>` : ""}
    </p>`;
}

// AI검토 결과 바(§4.5) — 파일명 행과 분리해 별도 줄에 둔다.
// 점·박스 색은 결과에 따라 바뀌고(미검토는 회색), 신청자가 소명하면 파랑(info)으로 표시.
// 검토 완료(코멘트 존재) 상태면 클릭 시 모달([data-doc-ai-comment]).
function aiReviewBar(req, aiEnabled, mode) {
  const file = req.file;
  if (!aiEnabled || !file || !req.ai_review_enabled) return "";
  const cleared = !!file.cleared;
  const tone = cleared ? "info" : aiMeta(file.ai_review_status).tone;
  // 관리자 화면에서는 창업가 결과임을 분명히 하기 위해 '신청자 AI검토'로 표기한다.
  const head = cleared ? "신청자 소명" : (mode === "admin" ? "신청자 AI검토" : "AI검토 결과");
  const status = cleared ? "관리자 확인 필요" : aiMeta(file.ai_review_status).label;
  const dot = `<span class="ai-dot ai-dot-${tone}" aria-hidden="true"></span>`;
  const inner = `${dot}<span class="ai-review-bar-label">${head}</span><span class="ai-review-bar-status">${status}</span>`;
  if (file.ai_review_comment || cleared) {
    return `<button class="ai-review-bar ai-review-bar-${tone} is-clickable" type="button" data-doc-ai-comment="${escapeHtml(file.id)}">${inner}<span class="ai-review-bar-chevron" aria-hidden="true">›</span></button>`;
  }
  return `<div class="ai-review-bar ai-review-bar-${tone}">${inner}</div>`;
}

// 관리자 2차 AI검토 결과 바 — 관리자 화면에서만, 창업가 바 아래에 별도로 표시한다.
// 창업가 컬럼과 분리된 admin_ai_* 값을 읽으며, 미검토면 회색(neutral)으로 둔다.
function adminAiReviewBar(req, aiEnabled, mode) {
  const file = req.file;
  if (mode !== "admin" || !aiEnabled || !file || !req.ai_review_enabled) return "";
  const status = file.admin_ai_review_status || "not_requested";
  const tone = aiMeta(status).tone;
  const dot = `<span class="ai-dot ai-dot-${tone}" aria-hidden="true"></span>`;
  const inner = `${dot}<span class="ai-review-bar-label">관리자 AI검토</span><span class="ai-review-bar-status">${aiMeta(status).label}</span>`;
  if (file.admin_ai_review_comment) {
    return `<button class="ai-review-bar ai-review-bar-${tone} is-clickable" type="button" data-doc-admin-ai-comment="${escapeHtml(file.id)}">${inner}<span class="ai-review-bar-chevron" aria-hidden="true">›</span></button>`;
  }
  return `<div class="ai-review-bar ai-review-bar-${tone}">${inner}</div>`;
}

// AI검토 결과 모달 — 행의 [data-doc-ai-comment] 버튼에서 호출한다.
//  opts: { req, mode, editable, source?, onClear?(comment), onRevert?() }
//  - source "founder"(기본): 창업가(신청자) 1차 검토 결과(ai_review_*). 소명 입력/표시 가능.
//  - source "admin": 관리자 2차 검토 결과(admin_ai_*). 읽기 전용, 소명 섹션 없음.
//  - 창업자 + 수정가능 + 보완 필요: '이상없음 소명' 입력/표시(§AI 오검출 대응).
export function openAiReviewModal({ req, mode, editable, source = "founder", onClear, onRevert }) {
  const file = req.file;
  const isAdminSource = source === "admin";
  const reviewStatus = isAdminSource ? (file.admin_ai_review_status || "not_requested") : file.ai_review_status;
  const reviewComment = isAdminSource ? (file.admin_ai_review_comment || "") : (file.ai_review_comment || "");
  const checkResult = isAdminSource ? (file.admin_ai_check_result || {}) : (file.ai_check_result || {});
  const modalTitle = isAdminSource ? "관리자 AI검토 결과" : "AI검토 결과";
  const meta = aiMeta(reviewStatus);
  // 소명(cleared)·소명 액션은 창업가 1차 결과에만 해당한다.
  const cleared = !isAdminSource && !!file.cleared;
  const canAct = !isAdminSource && mode === "founder" && editable && file.ai_review_status === "needs_revision";

  const overrideSection = cleared
    ? `
      <div class="ai-modal-override is-cleared">
        <div class="ai-modal-override-head"><span class="ai-dot ai-dot-info" aria-hidden="true"></span>신청자 소명 · 관리자 확인 필요</div>
        <p class="ai-modal-override-comment">${escapeHtml(file.user_review_comment || "")}</p>
        ${canAct ? `<button class="button small secondary" type="button" data-ai-revert>소명 취소</button>` : ""}
      </div>`
    : canAct
      ? `
        <div class="ai-modal-override">
          <p class="muted caption" style="margin:0 0 8px">AI 검토가 착오라고 판단되면 확인 근거를 소명으로 남길 수 있습니다. 소명은 AI 결과를 삭제하지 않으며 관리자 확인이 필요합니다.</p>
          <textarea class="ai-modal-textarea" data-ai-comment placeholder="예: 견적서 하단에 발행일자와 공급가액이 정상 표기되어 있어 보완이 불필요합니다."></textarea>
          <button class="button small" type="button" data-ai-clear>소명 등록</button>
        </div>`
      : "";

  const findings = Array.isArray(checkResult.findings) ? checkResult.findings : [];
  const findingsSection = findings.length
    ? `<div class="ai-modal-findings">
        <h3>세부 확인 항목</h3>
        ${findings.map((finding) => `
          <div class="ai-modal-finding">
            <strong>${escapeHtml(finding.label || "확인 항목")}</strong>
            <span class="badge badge-${finding.ok ? "success" : "warning"}">${finding.ok ? "일치" : "확인 필요"}</span>
            ${finding.detail ? `<p>${escapeHtml(finding.detail)}</p>` : ""}
          </div>`).join("")}
      </div>`
    : "";
  // 판단 근거 정보(적용 기준·실행 모델·검토 규칙·추가 지침)는 창업가에게 노출하지 않는다(관리자 전용).
  const auditItems = mode === "founder" ? [] : [
    checkResult.criteria_title ? `적용 기준: ${checkResult.criteria_title}` : "적용 기준: 기본 검토",
    checkResult.provider || checkResult.model
      ? `실행 모델: ${[checkResult.provider, checkResult.model].filter(Boolean).join(" / ")}`
      : "",
    checkResult.reviewed_at ? `검토 시점: ${formatDate(checkResult.reviewed_at)}` : "",
    checkResult.prompt_version ? `검토 규칙 버전: ${checkResult.prompt_version}` : "",
    checkResult.review_instructions ? `추가 검토 지침: ${checkResult.review_instructions}` : "",
  ].filter(Boolean);
  const auditSection = auditItems.length
    ? `<div class="ai-modal-audit">
        <h3>판단 근거 정보</h3>
        <ul>${auditItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>`
    : "";

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="ai-review-modal-title">
      <div class="modal-header">
        <div>
          <h2 id="ai-review-modal-title">${modalTitle}</h2>
          <p class="muted">${escapeHtml(req.title || "")} <span class="badge badge-${meta.tone}">${meta.label}</span></p>
        </div>
        <button class="modal-close" type="button" aria-label="닫기">×</button>
      </div>
      <pre class="ai-review-comment">${escapeHtml(reviewComment)}</pre>
      ${findingsSection}
      ${auditSection}
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
      errEl.textContent = "소명 사유를 입력해주세요.";
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
    const fileEdit = mode === "founder" && editable
      ? `
        <button class="doc-file-btn" type="button" data-doc-replace="${escapeHtml(req.id)}">파일 교체</button>
        <button class="doc-file-btn is-danger" type="button" data-doc-delete="${escapeHtml(file.id)}">삭제</button>`
      : "";
    const reviewStatus = mode === "admin"
      ? file.admin_ai_review_status
      : file.ai_review_status;
    const reviewDataAttr = mode === "admin"
      ? "data-doc-admin-review"
      : "data-doc-review";
    const canReview = aiEnabled
      && req.ai_review_enabled
      && (mode === "admin" || editable);
    const reviewAction = canReview
      ? `<button class="doc-file-btn is-ai" type="button" ${reviewDataAttr}="${escapeHtml(file.id)}">${
          reviewStatus && reviewStatus !== "not_requested" ? "AI 재검토" : "AI 검토"
        }</button>`
      : "";
    body = `
      <div class="doc-item-foot">
        <span class="doc-file-name"><span class="doc-file-icon">📄</span><span class="doc-file-label">${escapeHtml(file.original_filename)}</span></span>
        <div class="doc-file-actions">
          ${fileEdit}
          ${reviewAction}
          <button class="doc-file-btn" type="button" data-doc-open="${escapeHtml(file.id)}">다운로드</button>
        </div>
      </div>
      ${aiReviewBar(req, aiEnabled, mode)}
      ${adminAiReviewBar(req, aiEnabled, mode)}`;
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
  // 관리자 2차 검토: 관리자 화면에서는 읽기전용(editable=false)이어도 재검토 버튼을 노출한다.
  const anyAdminReviewed = requirements.some((r) => r.file && r.file.admin_ai_review_status && r.file.admin_ai_review_status !== "not_requested");
  let batchBtn = "";
  if (editable && mode === "founder" && reviewableCount > 0) {
    batchBtn = `<div class="doc-phase-actions">
         <button class="button small secondary" type="button" data-doc-batch-review>
           ${anyReviewed ? "AI 일괄 재검토" : "AI 일괄검토"} (${reviewableCount}건)
         </button>
       </div>`;
  } else if (mode === "admin" && reviewableCount > 0) {
    batchBtn = `<div class="doc-phase-actions">
         <button class="button small secondary" type="button" data-doc-admin-batch-review>
           ${anyAdminReviewed ? "AI 일괄 재검토 (관리자)" : "AI 재검토 (관리자)"} (${reviewableCount}건)
         </button>
       </div>`;
  }

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
