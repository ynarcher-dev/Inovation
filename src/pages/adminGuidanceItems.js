import { mountShell, runWithErrorBoundary, showError } from "../app.js";
import { createGuidanceItem, deleteGuidanceItem, getGuidanceItems } from "../api.js";
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
            ${item.content ? `<span class="muted block">${escapeHtml(item.content)}</span>` : ""}
            ${item.link_url ? `<span class="muted block">${escapeHtml(item.link_url)}</span>` : ""}
          </div>
          <button class="button small danger" type="button" data-delete-guidance="${escapeHtml(item.id)}">삭제</button>
        </div>
      `).join("")}
    </div>
  `;
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
    };

    document.querySelector("[data-guidance-form]").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      await runWithErrorBoundary(async () => {
        await createGuidanceItem({
          title: document.querySelector("#guidance-title").value.trim(),
          link_url: document.querySelector("#guidance-link").value.trim(),
          sort_order: document.querySelector("#guidance-sort").value,
          content: document.querySelector("#guidance-content").value.trim(),
        }, user.id);
        form.reset();
        document.querySelector("#guidance-sort").value = "0";
        guidanceItems = await getGuidanceItems();
        render();
      }, { button: event.submitter });
    });

    render();
  }
} catch (error) {
  showError(error);
}
