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

function updateReviewInstructionsCount() {
  const input = document.querySelector("[data-ai-review-instructions]");
  const count = document.querySelector("[data-ai-review-instructions-count]");
  if (input && count) count.textContent = `${input.value.length} / 4000자`;
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
  document.querySelector("[data-ai-review-instructions]").value = settings.review_instructions || "";
  document.querySelector("[data-ai-memo]").value = settings.memo || "";
  updateProviderHelp(provider);
  updateReviewInstructionsCount();
}

function readForm() {
  return {
    enabled: document.querySelector("[data-ai-enabled]").checked,
    provider: document.querySelector("[data-ai-provider]").value,
    model: document.querySelector("[data-ai-model]").value,
    edge_function_url: document.querySelector("[data-ai-edge-function-url]").value,
    api_key_configured: document.querySelector("[data-ai-key-configured]").value === "true",
    api_key_hint: document.querySelector("[data-ai-key-hint]").value,
    review_instructions: document.querySelector("[data-ai-review-instructions]").value.trim(),
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

const PROVIDER_LABELS = {
  openai: "OpenAI",
  google: "Google Gemini",
  anthropic: "Anthropic Claude",
};

// 원인 code 별 사용자 친화 카피. ai-agent.js 가 던지는 error.code 와 매핑된다.
const FAILURE_COPY = {
  no_url: {
    title: "연결 정보가 비어 있어요",
    detail: "'Supabase Edge Function URL'을 입력한 뒤 다시 시도해 주세요. (예: /functions/v1/ai-review)",
  },
  auth: {
    title: "권한을 확인할 수 없어요",
    detail: "관리자 계정으로 로그인했는지 확인하고, API Key가 서버(Edge Function Secret)에 등록되어 있는지 점검해 주세요.",
  },
  rate_limit: {
    title: "요청이 잠시 몰렸어요",
    detail: "1~2분 후 다시 '테스트 실행'을 눌러 주세요.",
  },
  overloaded: {
    title: "AI 서버가 잠시 혼잡해요",
    detail: "자동으로 3번까지 다시 시도했지만 실패했습니다. 잠시 후 다시 시도해 주세요.",
  },
  payload: {
    title: "전송한 데이터를 처리할 수 없어요",
    detail: "설정을 확인한 뒤 다시 시도해 주세요. 문제가 계속되면 개발팀에 문의해 주세요.",
  },
};

const FAILURE_FALLBACK = {
  title: "연결에 실패했어요",
  detail: "설정(Provider·모델·URL·API Key 등록 상태)을 다시 확인하고 시도해 주세요. 문제가 계속되면 개발팀에 문의해 주세요.",
};

function renderTestSuccess(result, form) {
  const target = document.querySelector("[data-ai-test-result]");
  if (!target) return;
  const providerLabel = PROVIDER_LABELS[form.provider] || form.provider || "선택한 AI";
  const modelLabel = form.model ? ` · ${form.model}` : "";
  const summary = String(result.summary || "").trim();
  const previewBlock = summary
    ? `
      <div style="margin-top:10px; padding-top:10px; border-top:1px solid rgba(6,95,70,0.2);">
        <p class="muted" style="margin:0 0 4px; font-size:0.85rem;">샘플 분석 결과 미리보기</p>
        <p style="margin:0;">${escapeHtml(summary)}</p>
      </div>`
    : "";
  target.innerHTML = `
    <div class="notice notice-success" style="padding:12px 14px;">
      <strong>✅ AI 연결 성공</strong>
      <p style="margin:6px 0 0;">선택하신 AI(${escapeHtml(providerLabel + modelLabel)})가 정상적으로 응답했어요.<br>이제 예산 심사 화면에서 'AI 검토' 기능을 사용할 수 있습니다.</p>
      ${previewBlock}
    </div>
  `;
}

function renderTestFailure(error) {
  const target = document.querySelector("[data-ai-test-result]");
  if (!target) return;
  const copy = FAILURE_COPY[error?.code] || FAILURE_FALLBACK;
  target.innerHTML = `
    <div class="notice notice-danger" style="padding:12px 14px;">
      <strong>❌ ${escapeHtml(copy.title)}</strong>
      <p style="margin:6px 0 0;">${escapeHtml(copy.detail)}</p>
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
    document.querySelector("[data-ai-review-instructions]").addEventListener("input", updateReviewInstructionsCount);

    document.querySelector("[data-ai-test-button]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const originalSettings = settings;
      const testResultEl = document.querySelector("[data-ai-test-result]");
      if (testResultEl) {
        testResultEl.innerHTML = `<p class="empty">AI 연결을 확인하고 있어요. 잠시만 기다려 주세요…</p>`;
      }

      // 성공/실패 모두 결과 박스에 안내 카피로 표시한다(상단 빨간 에러 대신).
      button.disabled = true;
      const form = readForm();
      try {
        settings = await updateAiSettings({ ...form, enabled: true, api_key_configured: true }, user.id);
        const result = await requestBudgetAiReview(sampleBudgetReviewPayload());
        renderTestSuccess(result, form);
        showToast("AI 연결 테스트가 성공했습니다.", { type: "success" });
      } catch (error) {
        console.error(error);
        renderTestFailure(error);
      } finally {
        try {
          settings = await updateAiSettings(originalSettings, user.id);
          setForm(settings);
        } catch (restoreError) {
          console.error(restoreError);
        }
        button.disabled = false;
      }
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
