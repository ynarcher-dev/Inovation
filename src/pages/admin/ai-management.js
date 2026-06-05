import { mountShell, runWithErrorBoundary, showError } from "../../app.js";
import { requireRole } from "../../auth.js";
import { getAiSettings, updateAiSettings } from "../../api.js";

function setForm(settings) {
  document.querySelector("[data-ai-enabled]").checked = !!settings.enabled;
  document.querySelector("[data-ai-enabled-label]").textContent = settings.enabled ? "활성화" : "비활성화";
  document.querySelector("[data-ai-provider]").value = settings.provider || "openai";
  document.querySelector("[data-ai-model]").value = settings.model || "";
  document.querySelector("[data-ai-edge-function-url]").value = settings.edge_function_url || "";
  document.querySelector("[data-ai-key-configured]").value = String(!!settings.api_key_configured);
  document.querySelector("[data-ai-key-hint]").value = settings.api_key_hint || "";
  document.querySelector("[data-ai-memo]").value = settings.memo || "";
}

function readForm() {
  return {
    enabled: document.querySelector("[data-ai-enabled]").checked,
    provider: document.querySelector("[data-ai-provider]").value,
    model: document.querySelector("[data-ai-model]").value,
    edge_function_url: document.querySelector("[data-ai-edge-function-url]").value,
    api_key_configured: document.querySelector("[data-ai-key-configured]").value === "true",
    api_key_hint: document.querySelector("[data-ai-key-hint]").value,
    memo: document.querySelector("[data-ai-memo]").value,
  };
}

try {
  mountShell();
  const user = await requireRole(["admin", "super_admin"]);
  if (user) {
    let settings = await getAiSettings();
    setForm(settings);

    document.querySelector("[data-ai-enabled]").addEventListener("change", (event) => {
      document.querySelector("[data-ai-enabled-label]").textContent = event.currentTarget.checked ? "활성화" : "비활성화";
    });

    document.querySelector("[data-ai-settings-form]").addEventListener("submit", async (event) => {
      event.preventDefault();
      await runWithErrorBoundary(async () => {
        settings = await updateAiSettings(readForm(), user.id);
        setForm(settings);
        window.alert("AI 설정을 저장했습니다.");
      }, { button: event.submitter });
    });
  }
} catch (error) {
  showError(error);
}
