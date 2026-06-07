import { mountShell, runWithErrorBoundary, showError, showToast, showConfirm, setPendingToast } from "../../app.js";
import { requireRole } from "../../auth.js";
import {
  getExpenseDetail,
  submitExpenseRequest,
  getExpenseDocumentRequirements,
  uploadExpenseDocumentFile,
  deleteExpenseDocumentFile,
  requestAiBatchDocumentReview,
  setExpenseDocumentUserReview,
  validateRequiredDocuments,
  downloadStoredFile,
  getAiSettings,
} from "../../api.js";
import { getStatusLabel, getStatusTone, isDocumentPhaseEditable, getSubmitDocumentPhase } from "../../domains/status.js";
import { renderDocumentPhasePanel, openAiReviewModal } from "../../components/expense/DocumentPhasePanel.js";
import { escapeHtml, formatCurrency, formatDate, getQueryParam } from "../../utils.js";

try {
  mountShell();
  const user = await requireRole(["founder"]);
  if (user) {
    const id = getQueryParam("id");
    const { expense, reviews } = await getExpenseDetail(id);
    const aiSettings = await getAiSettings();

    // ----------------------------------------------------
    // 단계별 첨부서류 패널 (§4) — 사전/최종 패널을 분리하고 상태에 따라 한쪽만 해금한다(§4.3).
    // ----------------------------------------------------
    const PHASES = [
      { phase: "pre", title: "사전승인 첨부서류", container: "[data-doc-panel-pre]",
        lockedNote: "사전승인 단계가 잠겨 있습니다. 제출된 서류는 조회만 가능합니다." },
      { phase: "final", title: "최종승인 첨부서류", container: "[data-doc-panel-final]",
        lockedNote: "사전승인 완료 후 제출할 수 있습니다." },
    ];

    // 숨김 파일 입력으로 업로드/교체를 처리한다.
    const pickFile = () => new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.onchange = () => resolve(input.files[0] || null);
      input.click();
    });

    const renderDocPanels = async () => {
      for (const def of PHASES) {
        const container = document.querySelector(def.container);
        if (!container) continue;
        const requirements = (await getExpenseDocumentRequirements(id, def.phase)) || [];
        const editable = isDocumentPhaseEditable(expense.status, def.phase);
        renderDocumentPhasePanel(container, {
          phase: def.phase,
          title: def.title,
          requirements,
          editable,
          mode: "founder",
          lockedNote: def.lockedNote,
          aiEnabled: aiSettings.enabled,
        });
        attachPanelEvents(container, def.phase, requirements);
      }
    };

    const attachPanelEvents = (container, phase, requirements) => {
      const reqById = new Map(requirements.map((r) => [r.id, r]));

      const doUpload = async (reqId, button) => {
        const req = reqById.get(reqId);
        const file = await pickFile();
        if (!file) return;
        await runWithErrorBoundary(async () => {
          await uploadExpenseDocumentFile(id, req, phase, file, user);
          await renderDocPanels();
        }, { button });
      };

      container.querySelectorAll("[data-doc-upload]").forEach((btn) =>
        btn.addEventListener("click", () => doUpload(btn.dataset.docUpload, btn)));
      container.querySelectorAll("[data-doc-replace]").forEach((btn) =>
        btn.addEventListener("click", () => doUpload(btn.dataset.docReplace, btn)));

      container.querySelectorAll("[data-doc-delete]").forEach((btn) =>
        btn.addEventListener("click", async () => {
          const ok = await showConfirm("첨부 파일을 삭제하시겠습니까?", {
            title: "첨부 파일 삭제",
            confirmText: "삭제",
            cancelText: "취소",
            tone: "danger",
          });
          if (!ok) return;
          await runWithErrorBoundary(async () => {
            await deleteExpenseDocumentFile(btn.dataset.docDelete);
            await renderDocPanels();
          }, { button: btn });
        }));

      // 단계별 일괄 AI검토: 해당 단계의 업로드 파일을 한 번에 검토하고 결과를 각 행에 분배한다.
      container.querySelector("[data-doc-batch-review]")?.addEventListener("click", async (e) => {
        await runWithErrorBoundary(async () => {
          const { reviewed } = await requestAiBatchDocumentReview(id, phase);
          await renderDocPanels();
          if (!reviewed) showToast("AI검토할 업로드 파일이 없습니다.", { type: "info" });
        }, { button: e.currentTarget });
      });

      container.querySelectorAll("[data-doc-open]").forEach((btn) =>
        btn.addEventListener("click", async () => {
          const fileId = btn.dataset.docOpen;
          const req = requirements.find((r) => r.file?.id === fileId);
          await runWithErrorBoundary(async () => {
            await downloadStoredFile(req?.file?.link_url, req?.file?.original_filename);
          }, { button: btn });
        }));

      // AI검토 결과 모달: 행의 점/버튼에서 호출. 보완 필요 건은 '이상없음' 소명도 여기서 처리.
      const editable = isDocumentPhaseEditable(expense.status, phase);
      container.querySelectorAll("[data-doc-ai-comment]").forEach((btn) =>
        btn.addEventListener("click", () => {
          const req = requirements.find((r) => r.file?.id === btn.dataset.docAiComment);
          if (!req?.file) return;
          openAiReviewModal({
            req,
            mode: "founder",
            editable,
            onClear: async (comment) => {
              await setExpenseDocumentUserReview(req.file.id, { cleared: true, comment, user });
              await renderDocPanels();
            },
            onRevert: async () => {
              await setExpenseDocumentUserReview(req.file.id, { cleared: false, user });
              await renderDocPanels();
            },
          });
        }));
    };

    // 검토 결과(decision)별 한글 라벨/배지 톤.
    const REVIEW_DECISIONS = {
      approved: { label: "승인", tone: "success" },
      revision_requested: { label: "보완요청", tone: "warning" },
    };

    // 승인/보완요청 코멘트를 최신순으로 노출한다(검토 이력이 없으면 영역 자체를 숨김).
    const renderReviews = () => {
      const reviewRoot = document.querySelector("[data-reviews]");
      if (!reviewRoot) return;
      const list = (reviews || [])
        .filter((r) => REVIEW_DECISIONS[r.decision])
        .slice()
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      if (!list.length) {
        reviewRoot.innerHTML = "";
        reviewRoot.hidden = true;
        return;
      }
      reviewRoot.hidden = false;
      const rows = list.map((review) => {
        const meta = REVIEW_DECISIONS[review.decision];
        return `
          <div class="review-row">
            <div class="review-row-head">
              <span class="badge badge-${meta.tone}">${escapeHtml(meta.label)}</span>
              <span class="review-date">${formatDate(review.created_at)}</span>
            </div>
            <p class="review-comment">${review.comment ? escapeHtml(review.comment) : "코멘트 없음"}</p>
          </div>`;
      }).join("");
      reviewRoot.innerHTML = `<h2>검토 결과</h2>${rows}`;
    };

    // 수정 가능 상태별 CTA(수정/보완하기, 사전·최종승인 신청)를 렌더한다.
    const renderCta = () => {
      const ctaRoot = document.querySelector("[data-cta]");
      const guideEl = document.querySelector("[data-edit-guide]");
      if (!ctaRoot) return;
      const editHref = `expense-new.html?id=${encodeURIComponent(id)}`;
      const buttons = [];
      let guide = "";

      if (expense.status === "draft") {
        buttons.push(`<a class="button secondary" href="${editHref}">수정하기</a>`);
        buttons.push(`<button class="button" type="button" data-submit-expense>사전승인 신청</button>`);
        guide = "임시저장 상태입니다. 내용·서류를 수정한 뒤 사전승인을 신청하세요.";
      } else if (expense.status === "pre_approval_revision") {
        buttons.push(`<a class="button" href="${editHref}">보완하기</a>`);
        guide = "보완 요청된 건은 같은 신청 건에서 서류와 내용을 수정한 뒤 다시 제출할 수 있습니다.";
      } else if (expense.status === "final_approval_revision") {
        buttons.push(`<a class="button" href="${editHref}">최종승인 보완하기</a>`);
        guide = "최종승인 보완 요청된 건은 같은 신청 건에서 수정한 뒤 다시 제출할 수 있습니다.";
      } else if (expense.status === "pre_approved") {
        buttons.push(`<button class="button" type="button" data-submit-expense>최종승인 신청</button>`);
        guide = "사전승인이 완료되었습니다. 최종승인용 서류를 추가한 뒤 최종승인을 신청하세요.";
      }

      ctaRoot.innerHTML = buttons.join("");
      if (guideEl) guideEl.textContent = guide;

      const submitBtn = ctaRoot.querySelector("[data-submit-expense]");
      if (submitBtn) {
        submitBtn.addEventListener("click", async (event) => {
          const btn = event.currentTarget;
          const label = expense.status === "pre_approved" ? "최종승인" : "사전승인";
          // 제출 전 필수 첨부서류 검증 (§7). 누락 시 서류명을 안내하고 제출을 막는다.
          const phase = getSubmitDocumentPhase(expense.status);
          if (phase) {
            const { ok, missing } = await validateRequiredDocuments(id, phase);
            if (!ok) {
              showToast(`다음 필수 첨부서류를 업로드해야 ${label} 신청을 진행할 수 있습니다.\n- ${missing.join("\n- ")}`, { type: "warning", duration: 6000 });
              return;
            }
          }
          const confirmed = await showConfirm(`${label} 신청을 진행하시겠습니까? 제출 후에는 관리자 검토가 시작됩니다.`, {
            title: `${label} 신청`,
            confirmText: "신청",
            cancelText: "취소",
          });
          if (!confirmed) return;
          await runWithErrorBoundary(async () => {
            await submitExpenseRequest(id);
            // reload 후 완료 토스트를 띄운다.
            setPendingToast(`${label} 신청이 제출되었습니다. 관리자 검토 후 결과가 안내됩니다.`, "success");
            window.location.reload();
          }, { button: btn });
        });
      }
    };

    // 뱃지는 신규 8단계명을 그대로 노출한다.
    document.querySelector("[data-title]").textContent = expense.title;
    document.querySelector("[data-status]").innerHTML =
      `<span class="badge badge-${getStatusTone(expense.status)}">${escapeHtml(getStatusLabel(expense.status))}</span>`;
    document.querySelector("[data-summary]").innerHTML = `
      <dl class="summary-list summary-list--wide">
        <div class="summary-row">
          <dt>지출 제목</dt>
          <dd>${escapeHtml(expense.title || "-")}</dd>
        </div>
        <div class="summary-row">
          <dt>예산 항목</dt>
          <dd>${escapeHtml(expense.business_plan_item_label || expense.budget_category || "-")}</dd>
        </div>
        <div class="summary-row">
          <dt>거래처명</dt>
          <dd>${escapeHtml(expense.vendor_name || "-")}</dd>
        </div>
        <div class="summary-row">
          <dt>거래처 사업자등록번호</dt>
          <dd>${escapeHtml(expense.vendor_business_number || "-")}</dd>
        </div>
        <div class="summary-row">
          <dt>공급가액</dt>
          <dd class="summary-amount">${formatCurrency(expense.amount_supply)}</dd>
        </div>
        <div class="summary-row">
          <dt>부가세</dt>
          <dd class="summary-amount">${formatCurrency(expense.vat_amount)}</dd>
        </div>
        <div class="summary-row">
          <dt>지출 예정일자</dt>
          <dd>${formatDate(expense.expected_completion_date)}</dd>
        </div>
        <div class="summary-row">
          <dt>신청 내용</dt>
          <dd>${escapeHtml(expense.purpose || "-")}</dd>
        </div>
      </dl>
    `;
    renderCta();
    renderReviews();
    renderDocPanels();
  }
} catch (error) {
  showError(error);
}
