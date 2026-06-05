import { CONFIG } from "../config.js";
import { mockGetAiSettings } from "./mock/ai-settings.mock.js";

const DEFAULT_MODEL_BY_PROVIDER = {
  openai: "gpt-4o-mini",
  google: "gemini-2.5-flash",
  anthropic: "claude-3-5-sonnet-latest",
};

function joinUrl(base, path) {
  return `${String(base || "").replace(/\/+$/, "")}/${String(path || "").replace(/^\/+/, "")}`;
}

function resolveEdgeFunctionUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/functions/")) return joinUrl(CONFIG.supabaseUrl, raw);
  if (raw.startsWith("functions/")) return joinUrl(CONFIG.supabaseUrl, raw);
  return raw;
}

function normalizeAiReviewResult(result = {}) {
  const risks = Array.isArray(result.risks) ? result.risks : [];
  return {
    summary: String(result.summary || "").trim(),
    decision_suggestion: String(result.decision_suggestion || "needs_review").trim(),
    risks: risks.map((risk) => ({
      level: String(risk.level || "info").trim(),
      title: String(risk.title || "").trim(),
      detail: String(risk.detail || "").trim(),
    })).filter((risk) => risk.title || risk.detail),
    revision_comment_draft: String(result.revision_comment_draft || "").trim(),
    raw_text: String(result.raw_text || "").trim(),
  };
}

function normalizeDocumentReviewResult(result = {}) {
  const status = String(result.status || "").trim().toLowerCase() === "passed" ? "passed" : "needs_revision";
  const findings = Array.isArray(result.findings) ? result.findings : [];
  return {
    status,
    comment: String(result.comment || "").trim(),
    findings: findings.map((f) => ({
      label: String(f.label || "").trim(),
      ok: !!f.ok,
      detail: String(f.detail || "").trim(),
    })).filter((f) => f.label || f.detail),
    raw_text: String(result.raw_text || "").trim(),
  };
}

export async function requestBudgetAiReview(input = {}) {
  const settings = mockGetAiSettings();
  if (!settings.enabled) {
    throw new Error("AI 기능이 비활성화되어 있습니다. AI 관리에서 기능 상태를 켜주세요.");
  }
  if (!settings.api_key_configured) {
    throw new Error("API Key 등록 상태가 미등록입니다. 선택한 provider의 Secret을 Supabase Edge Function에 등록한 뒤 AI 관리에서 등록됨으로 바꿔주세요.");
  }

  const url = resolveEdgeFunctionUrl(settings.edge_function_url);
  if (!url) {
    throw new Error("Supabase Edge Function URL을 입력해주세요. 예: /functions/v1/ai-review");
  }

  const provider = settings.provider || "openai";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CONFIG.supabaseAnonKey,
    },
    body: JSON.stringify({
      type: "budget_submission_review",
      provider,
      model: settings.model || DEFAULT_MODEL_BY_PROVIDER[provider] || DEFAULT_MODEL_BY_PROVIDER.openai,
      payload: input,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Edge Function 인증에서 401이 발생했습니다. ai-review 함수의 verify_jwt=false 설정을 반영해 다시 배포해주세요.");
    }
    throw new Error(data.error || "AI 검토 요청에 실패했습니다.");
  }
  return normalizeAiReviewResult(data.result || data);
}

// 제출 서류(영수증/견적서 등) 한 건을 실제 LLM 으로 검토한다.
// 브라우저가 문서 바이트(base64)와 신청 정보·적용 기준을 Edge Function 으로 보내면,
// 설정된 provider 의 비전/문서 모델이 문서를 읽어 구조화된 검토 결과를 돌려준다.
export async function requestDocumentReview(input = {}) {
  const settings = mockGetAiSettings();
  if (!settings.enabled) {
    throw new Error("AI 기능이 비활성화되어 있습니다. AI 관리에서 기능 상태를 켜주세요.");
  }
  if (!settings.api_key_configured) {
    throw new Error("API Key 등록 상태가 미등록입니다. 선택한 provider의 Secret을 Supabase Edge Function에 등록한 뒤 AI 관리에서 등록됨으로 바꿔주세요.");
  }
  if (!input.fileBase64) {
    throw new Error("검토할 문서 데이터가 비어 있습니다.");
  }

  const url = resolveEdgeFunctionUrl(settings.edge_function_url);
  if (!url) {
    throw new Error("Supabase Edge Function URL을 입력해주세요. 예: /functions/v1/ai-review");
  }

  const provider = settings.provider || "openai";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CONFIG.supabaseAnonKey,
    },
    body: JSON.stringify({
      type: "document_review",
      provider,
      model: settings.model || DEFAULT_MODEL_BY_PROVIDER[provider] || DEFAULT_MODEL_BY_PROVIDER.openai,
      payload: {
        document: {
          filename: input.filename || "document",
          mime_type: input.mimeType || "application/pdf",
          data_base64: input.fileBase64,
        },
        context: input.context || {},
        criteria_text: input.criteriaText || "",
        batch_count: input.batchCount || 1,
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Edge Function 인증에서 401이 발생했습니다. ai-review 함수의 verify_jwt=false 설정을 반영해 다시 배포해주세요.");
    }
    throw new Error(data.error || "문서 AI 검토 요청에 실패했습니다.");
  }
  return normalizeDocumentReviewResult(data.result || data);
}

// 운영사업 공통 AI 검토 기준 문서에서 검토 기준 텍스트를 추출한다.
// 브라우저가 문서 바이트(base64)를 Edge Function 으로 보내면, 설정된 provider 의
// 모델이 문서를 읽어 구조화된 검토 기준 텍스트를 돌려준다.
export async function requestCriteriaExtraction(input = {}) {
  const settings = mockGetAiSettings();
  if (!settings.enabled) {
    throw new Error("AI 기능이 비활성화되어 있습니다. AI 관리에서 기능 상태를 켜주세요.");
  }
  if (!settings.api_key_configured) {
    throw new Error("API Key 등록 상태가 미등록입니다. 선택한 provider의 Secret을 Supabase Edge Function에 등록한 뒤 AI 관리에서 등록됨으로 바꿔주세요.");
  }
  if (!input.fileBase64) {
    throw new Error("추출할 문서 데이터가 비어 있습니다.");
  }

  const url = resolveEdgeFunctionUrl(settings.edge_function_url);
  if (!url) {
    throw new Error("Supabase Edge Function URL을 입력해주세요. 예: /functions/v1/ai-review");
  }

  const provider = settings.provider || "openai";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CONFIG.supabaseAnonKey,
    },
    body: JSON.stringify({
      type: "criteria_extraction",
      provider,
      model: settings.model || DEFAULT_MODEL_BY_PROVIDER[provider] || DEFAULT_MODEL_BY_PROVIDER.openai,
      payload: {
        document: {
          filename: input.filename || "criteria",
          mime_type: input.mimeType || "application/pdf",
          data_base64: input.fileBase64,
        },
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Edge Function 인증에서 401이 발생했습니다. ai-review 함수의 verify_jwt=false 설정을 반영해 다시 배포해주세요.");
    }
    throw new Error(data.error || "기준 문서 추출 요청에 실패했습니다.");
  }
  return String(data.result?.extracted_text || data.extracted_text || "").trim();
}
