import { mountShell, runWithErrorBoundary, showError } from "../app.js";
import { requireRole } from "../auth.js";
import { getExpenseDetail, markDocumentUploaded, submitExpenseRequest, uploadDocumentFile } from "../api.js";
import { Checklist } from "../components/Checklist.js";
import { openDocumentActionModal } from "../components/DocumentActionModal.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { escapeHtml, formatCurrency, getQueryParam } from "../utils.js";

try {
  mountShell();
  const user = await requireRole(["founder"]);
  if (user) {
    const id = getQueryParam("id");
    let { expense, documents, files } = await getExpenseDetail(id);
    const renderFiles = () => {
      const filesRoot = document.querySelector("[data-files]");
      if (!filesRoot) return;
      filesRoot.innerHTML = files?.length
        ? `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>서류</th>
                  <th>파일명</th>
                  <th>크기</th>
                </tr>
              </thead>
              <tbody>
                ${files.map((file) => `
                  <tr>
                    <td>${escapeHtml(file.document_type)}</td>
                    <td>${escapeHtml(file.original_filename)}</td>
                    <td>${Math.ceil(Number(file.size_bytes || 0) / 1024).toLocaleString()} KB</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `
        : `<p class="empty">업로드된 파일이 없습니다.</p>`;
    };
    const renderChecklist = () => {
      const checklistRoot = document.querySelector("[data-checklist]");
      checklistRoot.innerHTML = Checklist(documents);
      checklistRoot.querySelectorAll("[data-document-type]").forEach((button) => {
        button.addEventListener("click", () => {
          const documentType = button.dataset.documentType;
          const item = documents.find((documentItem) => documentItem.document_type === documentType);
          openDocumentActionModal(item, {
            onComplete: async (_documentItem, payload) => {
              const uploaded = payload?.file
                ? await uploadDocumentFile(expense.id, documentType, payload.file, user)
                : await markDocumentUploaded(expense.id, documentType);
              if (uploaded?.original_filename) {
                files = [{ document_type: documentType, ...uploaded, size_bytes: payload.file.size }, ...(files || [])];
              }
              documents = documents.map((documentItem) =>
                documentItem.document_type === documentType ? { ...documentItem, status: "uploaded" } : documentItem
              );
              renderChecklist();
              renderFiles();
            },
            onError: showError,
          });
        });
      });
    };
    document.querySelector("[data-title]").textContent = expense.title;
    document.querySelector("[data-status]").innerHTML = StatusBadge(expense.status);
    document.querySelector("[data-summary]").innerHTML = `
      <p><strong>비목</strong> ${escapeHtml(expense.budget_category)}</p>
      <p><strong>지출 유형</strong> ${escapeHtml(expense.expense_type)}</p>
      <p><strong>공급가액</strong> ${formatCurrency(expense.amount_supply)}</p>
      <p><strong>거래처</strong> ${escapeHtml(expense.vendor_name || "-")}</p>
      <p><strong>신청 내용</strong><br>${escapeHtml(expense.purpose || "-")}</p>
    `;
    renderChecklist();
    renderFiles();
    document.querySelector("[data-submit]").addEventListener("click", async (event) => {
      await runWithErrorBoundary(async () => {
        await submitExpenseRequest(expense.id);
        window.location.reload();
      }, { button: event.currentTarget });
    });
  }
} catch (error) {
  showError(error);
}
