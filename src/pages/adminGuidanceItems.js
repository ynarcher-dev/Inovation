import { mountShell, runWithErrorBoundary, showError } from "../app.js";
import { createGuidanceItem, deleteGuidanceItem, getGuidanceItems, getGuidanceDownloadUrl, uploadGuidanceFile } from "../api.js";
import { requireRole } from "../auth.js";
import { escapeHtml } from "../utils.js";

function GuidanceList(items) {
  if (!items?.length) return `<p class="empty">등록된 규정 및 유의사항이 없습니다.</p>`;
  return `
    <div class="manual-list">
      ${items.map((item) => `
        <div class="manual-link guidance-admin-row">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            ${item.link_url ? `<button class="button small secondary guidance-file-button" type="button" data-open-guidance="${escapeHtml(item.link_url)}">첨부파일 열기</button>` : ""}
          </div>
          <button class="button small danger" type="button" data-delete-guidance="${escapeHtml(item.id)}">삭제</button>
        </div>
      `).join("")}
    </div>
  `;
}

function getNextSortOrder(items) {
  const maxSortOrder = (items || []).reduce((max, item) => Math.max(max, Number(item.sort_order || 0)), 0);
  return maxSortOrder + 10;
}

try {
  mountShell();
  const user = await requireRole(["admin", "super_admin"]);
  if (user) {
    let guidanceItems = await getGuidanceItems();

    const render = () => {
      document.querySelector("[data-guidance-list]").innerHTML = GuidanceList(guidanceItems);
      document.querySelectorAll("[data-delete-guidance]").forEach((button) => {
        button.addEventListener("click", async () => {
          await runWithErrorBoundary(async () => {
            await deleteGuidanceItem(button.dataset.deleteGuidance);
            guidanceItems = await getGuidanceItems();
            render();
          }, { button });
        });
      });
      document.querySelectorAll("[data-open-guidance]").forEach((button) => {
        button.addEventListener("click", async () => {
          await runWithErrorBoundary(async () => {
            const url = await getGuidanceDownloadUrl(button.dataset.openGuidance);
            window.open(url, "_blank", "noopener,noreferrer");
          }, { button });
        });
      });
    };

    document.querySelector("[data-guidance-form]").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      await runWithErrorBoundary(async () => {
        const file = document.querySelector("#guidance-file").files?.[0] || null;
        const upload = file ? await uploadGuidanceFile(file) : null;
        await createGuidanceItem({
          title: document.querySelector("#guidance-title").value.trim(),
          link_url: upload?.link_url || null,
          sort_order: getNextSortOrder(guidanceItems),
        }, user.id);
        form.reset();
        guidanceItems = await getGuidanceItems();
        render();
      }, { button: event.submitter });
    });

    render();
  }
} catch (error) {
  showError(error);
}
