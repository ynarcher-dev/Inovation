import { mountShell, runWithErrorBoundary, showError, showToast } from "../../app.js";
import { requireRole } from "../../auth.js";
import { getAiSettings, requestBudgetAiReview, updateAiSettings } from "../../api.js";
import { escapeHtml } from "../../utils.js";

const MODEL_HELP = {
  openai: {
    placeholder: "예: gpt-4o-mini",
    text: "Secret 이름: OPENAI_API_KEY",
  },
  google: {
    placeholder: "예: gemini-2.5-flash",
    text: "Secret 이름: GOOGLE_API_KEY",
  },
  anthropic: {
    placeholder: "예: claude-3-5-sonnet-latest",
    text: "Secret 이름: ANTHROPIC_API_KEY",
  },
};

function updateProviderHelp(provider) {
  const help = MODEL_HELP[provider] || MODEL_HELP.openai;
  const modelInput = document.querySelector("[data-ai-model]");
  const helpEl = document.querySelector("[data-ai-model-help]");
  if (modelInput) modelInput.placeholder = help.placeholder;
  if (helpEl) helpEl.textContent = help.text;
}

function setForm(settings) {
  const provider = settings.provider || "openai";
  document.querySelector("[data-ai-enabled]").checked = !!settings.enabled;
  document.querySelector("[data-ai-enabled-label]").textContent = settings.enabled ? "활성화" : "비활성화";
  document.querySelector("[data-ai-provider]").value = MODEL_HELP[provider] ? provider : "openai";
  document.querySelector("[data-ai-model]").value = settings.model || "";
  document.querySelector("[data-ai-edge-function-url]").value = settings.edge_function_url || "";
  document.querySelector("[data-ai-key-configured]").value = String(!!settings.api_key_configured);
  document.querySelector("[data-ai-key-hint]").value = settings.api_key_hint || "";
  document.querySelector("[data-ai-memo]").value = settings.memo || "";
  updateProviderHelp(provider);
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

function sampleBudgetReviewPayload() {
  return {
    company: {
      id: "ai-test-company",
      name: "AI 연결 테스트 기업",
      representative_name: "테스트 담당자",
      support_program_name: "AI 연결 테스트 사업",
      budget_status: "budget_submitted",
      support_total_amount: 10000000,
      agreement_start_date: "2026-01-01",
      agreement_end_date: "2026-12-31",
    },
    submission: {
      id: "ai-test-submission",
      type: "initial",
      status: "budget_submitted",
      reason: "AI 연결 테스트용 샘플 예산안입니다.",
      submitted_at: new Date().toISOString(),
      submitted_by_name: "테스트 담당자",
      items: [
        {
          budget_path: "사업화 비용 > 홍보비",
          previous_allocated_amount: 0,
          requested_allocated_amount: 3000000,
          previous_round1_allocated_amount: 0,
          requested_round1_allocated_amount: 3000000,
          previous_round2_allocated_amount: 0,
          requested_round2_allocated_amount: 0,
          committed_or_pending_amount: 0,
        },
        {
          budget_path: "사업화 비용 > 장비 구입비",
          previous_allocated_amount: 0,
          requested_allocated_amount: 7000000,
          previous_round1_allocated_amount: 0,
          requested_round1_allocated_amount: 7000000,
          previous_round2_allocated_amount: 0,
          requested_round2_allocated_amount: 0,
          committed_or_pending_amount: 0,
        },
      ],
    },
  };
}

function renderTestResult(result) {
  const target = document.querySelector("[data-ai-test-result]");
  if (!target) return;
  target.innerHTML = `
    <div class="notice notice-success" style="padding:12px 14px;">
      <strong>테스트 성공</strong>
      <p style="margin:6px 0 0;">${escapeHtml(result.summary || "AI provider가 정상 응답했습니다.")}</p>
    </div>
  `;
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

    document.querySelector("[data-ai-provider]").addEventListener("change", (event) => {
      updateProviderHelp(event.currentTarget.value);
    });

    document.querySelector("[data-ai-test-button]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const originalSettings = settings;
      const testResultEl = document.querySelector("[data-ai-test-result]");
      if (testResultEl) {
        testResultEl.innerHTML = `<p class="empty">AI 연결을 테스트하는 중입니다...</p>`;
      }

      await runWithErrorBoundary(async () => {
        try {
          settings = await updateAiSettings({ ...readForm(), enabled: true, api_key_configured: true }, user.id);
          const result = await requestBudgetAiReview(sampleBudgetReviewPayload());
          renderTestResult(result);
          showToast("AI 연결 테스트가 성공했습니다.", { type: "success" });
        } finally {
          settings = await updateAiSettings(originalSettings, user.id);
          setForm(settings);
        }
      }, { button });
    });

    document.querySelector("[data-ai-settings-form]").addEventListener("submit", async (event) => {
      event.preventDefault();
      await runWithErrorBoundary(async () => {
        settings = await updateAiSettings(readForm(), user.id);
        setForm(settings);
        showToast("AI 설정을 저장했습니다.", { type: "success" });
      }, { button: event.submitter });
    });
  }
} catch (error) {
  showError(error);
}
