import { getDocumentActionMeta } from "../domains/expense/rules-engine.js";
import { escapeHtml } from "../utils.js";

const statusText = {
  missing: "미제출",
  uploaded: "제출",
  verified: "확인",
  rejected: "반려",
};

const checklistHints = {
  estimate: ["업체명과 발행일이 보여야 합니다.", "공급가액과 부가세가 구분되어야 합니다.", "날인 또는 발행 주체가 확인되어야 합니다."],
  comparative_estimate: ["기존 견적과 비교 가능한 동일 또는 유사 과업이어야 합니다.", "공급가액 500만원 이상 신청 건에서 필요합니다.", "업체명, 금액, 발행일이 확인되어야 합니다."],
  contract: ["과업 범위와 납품물이 구체적으로 적혀 있어야 합니다.", "계약기간은 협약기간 내에 있어야 합니다.", "날인 전 검토가 필요한 경우 사전승인 단계에서 제출합니다."],
  vendor_business_license: ["거래처명과 사업자등록번호가 확인되어야 합니다.", "견적서의 업체명과 합리적으로 일치해야 합니다."],
  vendor_bankbook: ["예금주가 거래처명과 합리적으로 일치해야 합니다.", "계좌번호가 식별 가능해야 합니다."],
  task_order: ["과업 내용, 산출물, 일정, 검수 기준을 구체적으로 작성합니다."],
  appropriateness_review: ["업체 업종과 과업의 연관성을 확인합니다.", "비용 산출 근거와 특수관계 여부를 점검합니다."],
};

export function openDocumentActionModal(documentItem, options) {
  const meta = getDocumentActionMeta(documentItem.document_type);
  const completeLabel = options.completeLabel || `${meta.button} 완료 처리`;
  const hints = checklistHints[documentItem.document_type] || ["문서의 발행 주체, 금액, 날짜가 식별 가능해야 합니다.", "관리자가 원본 파일을 확인할 수 있어야 합니다."];
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="document-action-title">
      <div class="modal-header">
        <div>
          <h2 id="document-action-title">${escapeHtml(documentItem.label)}</h2>
          <p class="muted">현재 상태: ${escapeHtml(statusText[documentItem.status] || documentItem.status)}</p>
        </div>
        <button class="modal-close" type="button" aria-label="닫기">×</button>
      </div>
      <p>${escapeHtml(meta.description)}</p>
      <p class="error" data-modal-error hidden></p>
      <div class="notice">
        <strong>확인할 내용</strong>
        <ul>
          ${hints.map((hint) => `<li>${escapeHtml(hint)}</li>`).join("")}
        </ul>
      </div>
      <div class="field" data-upload-field ${meta.action === "upload" ? "" : "hidden"}>
        <label for="document-upload-input">파일 선택</label>
        <input id="document-upload-input" type="file">
      </div>
      <div class="field" data-form-field ${meta.action === "form" ? "" : "hidden"}>
        <label for="document-form-note">작성 내용</label>
        <textarea id="document-form-note" placeholder="MVP에서는 작성 내용을 메모로 남기고 제출 처리합니다."></textarea>
      </div>
      <div class="notice" data-generate-field ${meta.action === "generate" ? "" : "hidden"}>
        MVP에서는 입력된 신청 정보를 바탕으로 자동작성 미리보기를 생성한 것으로 처리합니다.
      </div>
      <div class="actions" style="margin-top:16px">
        <button class="button" data-complete-document type="button">${escapeHtml(completeLabel)}</button>
        <button class="button secondary" data-cancel-document type="button">취소</button>
      </div>
    </section>
  `;

  const close = () => backdrop.remove();
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.querySelector("[data-cancel-document]").addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  backdrop.querySelector("[data-complete-document]").addEventListener("click", async () => {
    const completeButton = backdrop.querySelector("[data-complete-document]");
    const errorTarget = backdrop.querySelector("[data-modal-error]");
    const fileInput = backdrop.querySelector("#document-upload-input");
    const file = fileInput?.files?.[0] || null;
    if (meta.action === "upload" && options.requireFile !== false && !file) {
      window.alert("업로드할 파일을 선택해야 합니다.");
      return;
    }
    try {
      completeButton.disabled = true;
      if (errorTarget) errorTarget.hidden = true;
      await options.onComplete(documentItem, { file });
      close();
    } catch (error) {
      if (errorTarget) {
        errorTarget.hidden = false;
        errorTarget.textContent = error?.message || "서류 처리 중 오류가 발생했습니다.";
      }
      if (options.onError) options.onError(error);
    } finally {
      completeButton.disabled = false;
    }
  });

  document.body.append(backdrop);
}
